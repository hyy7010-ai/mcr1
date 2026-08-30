// Supabase Edge Function: zoom
//
// GraceFlow 所有 Zoom API 调用的唯一出口。
//
// 为什么必须有这一层：
//   1. Zoom 的 Server-to-Server OAuth 要拿 client_secret 去换 access token。
//      前端是纯静态站，任何写进 bundle 的密钥都等于公开发布。
//   2. api.zoom.us 不给浏览器发 CORS 头，前端即使有密钥也调不通。
//
// 授权模型（B 方案）：每个教会在自己的 Zoom 后台建一个 Server-to-Server
// OAuth 内部应用，把 Account ID / Client ID / Client Secret 填进 GraceFlow。
// 凭证按 church_id 存在 church_integrations 表里（该表 RLS 开着且零策略，
// 只有本函数用 service_role 能读）。于是会议开在教会自己的账号下，容量、
// 云录制空间、会议归属都是他们的，也不需要上架 Zoom Marketplace 审核。
//
// ── 一次性部署 ───────────────────────────────────────────────────────────
//   supabase login
//   supabase link --project-ref tgnngqjgaiunmamigvjp
//   supabase functions deploy zoom
//   # 无需 supabase secrets set —— Zoom 凭证是每个教会各自填的，
//   # 本函数只用到平台自带的 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。
//
// 前端调用：POST {VITE_SUPABASE_URL}/functions/v1/zoom
//   body: { action: "...", ... }，Authorization 带用户自己的 Supabase JWT。

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const ZOOM_OAUTH = "https://zoom.us/oauth/token";
const ZOOM_API = "https://api.zoom.us/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── PostgREST 小工具（不引 supabase-js，和本项目其它函数保持一致）──────────
async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** 用调用者自己的 JWT 验明身份，再用 service_role 查他的 church_id 和角色。 */
async function resolveCaller(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const rows = await db(
    `profiles?id=eq.${user.id}&select=church_id,role`,
  );
  const profile = rows?.[0];
  if (!profile?.church_id) return null;

  const role = String(profile.role ?? "");
  return {
    userId: user.id as string,
    email: String(user.email ?? "").toLowerCase(),
    churchId: profile.church_id as string,
    role,
    // 与前端 permissions.ts 的 canManageChurch 保持同一份名单。两边改一处
    // 就会出现「界面上有按钮、后端 403」的错配。
    canManage: ["Manager", "Admin", "Leader"].includes(role) ||
      role.replace(/\s+/g, "").toUpperCase() === "SUPERADMIN",
  };
}

// ── Zoom OAuth ───────────────────────────────────────────────────────────
type Integration = {
  account_id: string;
  client_id: string;
  client_secret: string;
  sdk_client_id: string | null;
  sdk_client_secret: string | null;
  plan_type: string | null;
};

/**
 * access token 缓存。Zoom 的 S2S token 有效期 1 小时，且账号级别有取 token
 * 的频率限制 —— 每次 API 调用都换一次新 token 迟早撞限流。缓存按 church_id
 * 分开，isolate 回收就没了，不影响正确性。
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getIntegration(churchId: string): Promise<Integration | null> {
  const rows = await db(
    `church_integrations?church_id=eq.${churchId}&provider=eq.zoom` +
      `&select=account_id,client_id,client_secret,sdk_client_id,sdk_client_secret,plan_type`,
  );
  return rows?.[0] ?? null;
}

async function fetchToken(
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(
    `${ZOOM_OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // Zoom 的报错文案对填错凭证的人其实挺有用，原样带回去
    throw new Error(data.reason || data.message || `Zoom OAuth ${res.status}`);
  }
  return data.access_token as string;
}

async function tokenFor(churchId: string, integration: Integration) {
  const cached = tokenCache.get(churchId);
  // 提前 60 秒过期，避免刚好卡在边界上拿到一个用不了的 token
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const token = await fetchToken(
    integration.account_id,
    integration.client_id,
    integration.client_secret,
  );
  tokenCache.set(churchId, { token, expiresAt: Date.now() + 3600_000 });
  return token;
}

/** 调 Zoom REST API。401 时清缓存重试一次（token 可能被 Zoom 侧提前作废）。*/
async function zoomApi(
  churchId: string,
  integration: Integration,
  path: string,
  init: RequestInit = {},
  isRetry = false,
): Promise<any> {
  const token = await tokenFor(churchId, integration);
  const res = await fetch(`${ZOOM_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (res.status === 401 && !isRetry) {
    tokenCache.delete(churchId);
    return zoomApi(churchId, integration, path, init, true);
  }

  // DELETE 成功返回 204 空 body
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err: any = new Error(data.message || `Zoom API ${res.status}`);
    err.status = res.status;
    err.zoomCode = data.code;
    throw err;
  }
  return data;
}

// ── Meeting SDK 签名（网页内嵌会议用）────────────────────────────────────
function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Meeting SDK 要的是一个 HS256 JWT，不是 REST 那套 access token —— Zoom 侧
 * 是**另一个应用类型**（Meeting SDK app），凭证也另有一套，不能拿 S2S 的
 * client_id/secret 来签，签了会在加入会议时报 signature invalid。
 */
async function sdkSignature(
  sdkKey: string,
  sdkSecret: string,
  meetingNumber: string,
  role: number,
) {
  const iat = Math.floor(Date.now() / 1000) - 30; // 容忍两边几十秒的时钟偏差
  const exp = iat + 60 * 60 * 2;                  // 2 小时，够一场主日聚会

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    appKey: sdkKey,
    sdkKey,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  }));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sdkSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

// ── 主处理 ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "Function is missing SUPABASE_URL / SERVICE_ROLE_KEY" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body?.action ?? "");
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "Unauthorized" }, 401);

  // 写操作一律限管理员。只在前端隐藏按钮不算权限控制 —— 谁都能直接 POST
  // 这个函数。
  const MANAGER_ONLY = new Set([
    "connect", "disconnect", "createMeeting", "updateMeeting",
    "deleteMeeting", "participants", "recordings",
  ]);
  if (MANAGER_ONLY.has(action) && !caller.canManage) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    // ── connect：验证凭证后落库 ──────────────────────────────────────────
    if (action === "connect") {
      const accountId = String(body.accountId ?? "").trim();
      const clientId = String(body.clientId ?? "").trim();
      const clientSecret = String(body.clientSecret ?? "").trim();
      if (!accountId || !clientId || !clientSecret) {
        return json({ error: "accountId / clientId / clientSecret are all required" }, 400);
      }

      // 先换一次 token —— 凭证填错要当场告诉他，而不是存下来等到开会议时才炸
      let token: string;
      try {
        token = await fetchToken(accountId, clientId, clientSecret);
      } catch (e) {
        return json({ error: `Zoom rejected these credentials: ${String((e as Error).message)}` }, 400);
      }

      // 探测账号能力：type 1 = Basic（免费，没有云录制），2 = Licensed，3 = On-prem
      let planType = "unknown";
      let zoomEmail: string | null = null;
      try {
        const me = await fetch(`${ZOOM_API}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json());
        planType = me?.type === 1 ? "basic" : me?.type === 2 ? "licensed" : me?.type === 3 ? "onprem" : "unknown";
        zoomEmail = me?.email ?? null;
      } catch { /* 探测失败不影响连接本身，能力检测退化成 unknown */ }

      const row = {
        church_id: caller.churchId,
        provider: "zoom",
        account_id: accountId,
        client_id: clientId,
        client_secret: clientSecret,
        sdk_client_id: body.sdkClientId ? String(body.sdkClientId).trim() : null,
        sdk_client_secret: body.sdkClientSecret ? String(body.sdkClientSecret).trim() : null,
        plan_type: planType,
        zoom_user_email: zoomEmail,
        status: "connected",
        last_error: null,
        last_verified_at: new Date().toISOString(),
        connected_by: caller.userId,
        updated_at: new Date().toISOString(),
      };

      await db("church_integrations?on_conflict=church_id,provider", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });

      tokenCache.set(caller.churchId, { token, expiresAt: Date.now() + 3600_000 });
      return json({ ok: true, planType, zoomEmail, sdkConfigured: !!row.sdk_client_id });
    }

    if (action === "disconnect") {
      await db(
        `church_integrations?church_id=eq.${caller.churchId}&provider=eq.zoom`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
      tokenCache.delete(caller.churchId);
      return json({ ok: true });
    }

    // 以下动作都需要教会已经连上 Zoom
    const integration = await getIntegration(caller.churchId);
    if (!integration) {
      return json({ error: "NOT_CONNECTED" }, 409);
    }

    switch (action) {
      // ── ① 创建 / 更新 / 删除会议 ─────────────────────────────────────
      case "createMeeting": {
        const meeting = await zoomApi(caller.churchId, integration, "/users/me/meetings", {
          method: "POST",
          body: JSON.stringify({
            topic: String(body.topic ?? "GraceFlow Meeting").slice(0, 200),
            type: 2,                       // 定时会议
            start_time: body.startTime,    // 'YYYY-MM-DDTHH:mm:ss'（配合 timezone）
            duration: Number(body.duration) || 90,
            timezone: body.timezone || "Australia/Sydney",
            agenda: String(body.agenda ?? "").slice(0, 2000),
            settings: {
              join_before_host: true,      // 会众常常比主领早到，别让他们卡在等待室
              waiting_room: false,
              mute_upon_entry: true,
              approval_type: 2,            // 无需注册
              auto_recording: body.autoRecord ? "cloud" : "none",
            },
          }),
        });
        return json({
          meetingId: String(meeting.id),
          joinUrl: meeting.join_url,
          startUrl: meeting.start_url,
          passcode: meeting.password ?? null,
        });
      }

      case "updateMeeting": {
        const id = String(body.meetingId ?? "");
        if (!id) return json({ error: "meetingId is required" }, 400);
        const patch: Record<string, unknown> = {};
        if (body.topic) patch.topic = String(body.topic).slice(0, 200);
        if (body.startTime) patch.start_time = body.startTime;
        if (body.duration) patch.duration = Number(body.duration);
        if (body.timezone) patch.timezone = body.timezone;
        if (body.agenda !== undefined) patch.agenda = String(body.agenda).slice(0, 2000);
        await zoomApi(caller.churchId, integration, `/meetings/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        return json({ ok: true });
      }

      case "deleteMeeting": {
        const id = String(body.meetingId ?? "");
        if (!id) return json({ error: "meetingId is required" }, 400);
        try {
          await zoomApi(caller.churchId, integration, `/meetings/${id}`, { method: "DELETE" });
        } catch (e: any) {
          // 3001 = 会议不存在。删日历活动时会议早被人在 Zoom 里删掉了很常见，
          // 这种情况不该让整个删除操作失败。
          if (e?.zoomCode !== 3001) throw e;
        }
        return json({ ok: true });
      }

      /** 主持人链接现取现用 —— start_url 带一次性 token 且约 2 小时过期，
       *  存进数据库既会过期，又等于把主持权限摊给任何能读活动表的人。*/
      case "startUrl": {
        const id = String(body.meetingId ?? "");
        if (!id) return json({ error: "meetingId is required" }, 400);
        if (!caller.canManage) return json({ error: "Forbidden" }, 403);
        const m = await zoomApi(caller.churchId, integration, `/meetings/${id}`);
        return json({ startUrl: m.start_url });
      }

      // ── ② 线上出席 ───────────────────────────────────────────────────
      case "participants": {
        const id = String(body.meetingId ?? "");
        if (!id) return json({ error: "meetingId is required" }, 400);

        // 两条路：report 端点字段全（含邮箱），但要 Pro 以上套餐；免费账号
        // 只能走 past_meetings，拿到的多半只有昵称。先试前者，403/报表无权限
        // 就退到后者，而不是直接把错误抛给用户。
        let raw: any[] = [];
        let source = "report";
        try {
          const rep = await zoomApi(
            caller.churchId, integration,
            `/report/meetings/${id}/participants?page_size=300`,
          );
          raw = rep.participants ?? [];
        } catch (e: any) {
          if (e?.status !== 400 && e?.status !== 403 && e?.zoomCode !== 200) throw e;
          source = "past_meetings";
          const past = await zoomApi(
            caller.churchId, integration,
            `/past_meetings/${id}/participants?page_size=300`,
          );
          raw = past.participants ?? [];
        }

        // 同一个人中途掉线重连会出现多条记录，按 名字+邮箱 去重并累加时长
        const merged = new Map<string, any>();
        for (const p of raw) {
          const name = String(p.name ?? p.user_name ?? "").trim();
          const email = String(p.user_email ?? p.email ?? "").trim().toLowerCase();
          const key = email || name.toLowerCase();
          if (!key) continue;
          const prev = merged.get(key);
          if (prev) {
            prev.duration += Number(p.duration ?? 0);
          } else {
            merged.set(key, { name, email, duration: Number(p.duration ?? 0) });
          }
        }
        return json({ source, participants: [...merged.values()] });
      }

      // ── ③ 云录制 ─────────────────────────────────────────────────────
      case "recordings": {
        // 免费账号根本没有云录制，先明说，别让人对着空列表猜
        if (integration.plan_type === "basic") {
          return json({ error: "NO_CLOUD_RECORDING", planType: "basic" }, 409);
        }
        const from = String(body.from ?? "");
        const to = String(body.to ?? "");
        const qs = new URLSearchParams({ page_size: "60" });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);

        const data = await zoomApi(
          caller.churchId, integration,
          `/users/me/recordings?${qs.toString()}`,
        );
        const meetings = (data.meetings ?? []).map((m: any) => ({
          meetingId: String(m.id),
          uuid: m.uuid,
          topic: m.topic,
          startTime: m.start_time,
          duration: m.duration,
          totalSize: m.total_size,
          shareUrl: m.share_url,
          // 录制设了密码时，光有链接打不开 —— 一并带回去，归档时写进说明，
          // 否则会众点进去只会看到一个要密码的播放页。
          playPasscode: m.recording_play_passcode ?? null,
          files: (m.recording_files ?? [])
            // 只留能直接看/听的，聊天记录和字幕文件对归档没意义
            .filter((f: any) => ["MP4", "M4A"].includes(f.file_type))
            .map((f: any) => ({
              id: f.id,
              fileType: f.file_type,
              fileSize: f.file_size,
              playUrl: f.play_url,
              // download_url 需要额外带 token，前端只用 play_url
            })),
        })).filter((m: any) => m.files.length > 0);

        return json({ meetings });
      }

      // ── ④ 网页内嵌会议的签名 ─────────────────────────────────────────
      case "sdkSignature": {
        if (!integration.sdk_client_id || !integration.sdk_client_secret) {
          return json({ error: "SDK_NOT_CONFIGURED" }, 409);
        }
        const mn = String(body.meetingNumber ?? "").replace(/\D/g, "");
        if (!mn) return json({ error: "meetingNumber is required" }, 400);

        // role 1 = 主持人。只有管理员能拿主持权限，会众一律 0（参会者）——
        // 这个判断必须在服务端做，前端传什么都不算数。
        const role = body.role === 1 && caller.canManage ? 1 : 0;
        const signature = await sdkSignature(
          integration.sdk_client_id, integration.sdk_client_secret, mn, role,
        );
        return json({ signature, sdkKey: integration.sdk_client_id, role });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    // 把失败也记在集成行上，管理员在设置页能看见「上次出了什么错」
    try {
      await db(`church_integrations?church_id=eq.${caller.churchId}&provider=eq.zoom`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "error",
          last_error: String(err?.message ?? err).slice(0, 500),
        }),
      });
    } catch { /* 记录失败不能盖过原始错误 */ }

    return json({ error: String(err?.message ?? err) }, err?.status === 403 ? 403 : 500);
  }
});
