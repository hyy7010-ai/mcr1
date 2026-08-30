import { supabase } from '../lib/supabase';

/**
 * Zoom 集成的前端出口。
 *
 * 这里**不存在**任何 Zoom 密钥 —— 每个教会的 Server-to-Server OAuth 凭证存在
 * church_integrations 表里（RLS 开着且零策略，前端读不到），所有调用都由
 * supabase/functions/zoom 这个 Edge Function 代发。浏览器也无法直连
 * api.zoom.us：Zoom 不给跨域预检发 CORS 头。
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const ZOOM_ENDPOINT = `${SUPABASE_URL}/functions/v1/zoom`;

/** Edge Function 用约定好的错误码表达「不是异常，是状态」。 */
export const ZOOM_ERRORS = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  NO_CLOUD_RECORDING: 'NO_CLOUD_RECORDING',
  SDK_NOT_CONFIGURED: 'SDK_NOT_CONFIGURED',
} as const;

export class ZoomError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ZoomError';
    this.status = status;
    // 约定错误码本身就是 message，判定时用 err.code 而不是字符串匹配
    if (Object.values(ZOOM_ERRORS).includes(message as any)) this.code = message;
  }
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!SUPABASE_URL) throw new ZoomError('VITE_SUPABASE_URL is not configured.', 0);

  // 必须带**用户自己的** JWT，不能只带 anon key —— Edge Function 要靠它认出
  // 调用者属于哪个教会、是不是管理员。
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ZoomError('Not signed in', 401);

  const res = await fetch(ZOOM_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ZoomError(data?.error || `Zoom request failed (${res.status})`, res.status);
  return data as T;
}

// ── 连接状态 ──────────────────────────────────────────────────────────────
export interface ZoomStatus {
  connected: boolean;
  clientIdMasked: string | null;
  zoomUserEmail: string | null;
  /** 'basic' = 免费账号，没有云录制，参会报表字段也受限 */
  planType: string | null;
  status: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
  /** Meeting SDK 凭证是否也填了（网页内嵌会议需要，和 S2S 是两套） */
  sdkConfigured: boolean;
}

const DISCONNECTED: ZoomStatus = {
  connected: false, clientIdMasked: null, zoomUserEmail: null, planType: null,
  status: null, lastError: null, lastVerifiedAt: null, sdkConfigured: false,
};

/**
 * 走 SECURITY DEFINER 的 RPC 而不是 Edge Function：这是每次进日历 / 出席页
 * 都要问一次的东西，没必要为了一个布尔值唤醒一个函数实例。RPC 只回非敏感
 * 字段。
 */
export async function getZoomStatus(): Promise<ZoomStatus> {
  try {
    const { data, error } = await supabase.rpc('zoom_integration_status');
    if (error || !data || !data.length) return DISCONNECTED;
    const r = data[0];
    return {
      connected: !!r.connected,
      clientIdMasked: r.client_id_masked ?? null,
      zoomUserEmail: r.zoom_user_email ?? null,
      planType: r.plan_type ?? null,
      status: r.status ?? null,
      lastError: r.last_error ?? null,
      lastVerifiedAt: r.last_verified_at ?? null,
      sdkConfigured: !!r.sdk_configured,
    };
  } catch {
    // 迁移还没跑（函数不存在）时不该让整个页面挂掉，当作未连接处理
    return DISCONNECTED;
  }
}

export function connectZoom(creds: {
  accountId: string;
  clientId: string;
  clientSecret: string;
  sdkClientId?: string;
  sdkClientSecret?: string;
}) {
  return call<{ ok: true; planType: string; zoomEmail: string | null; sdkConfigured: boolean }>(
    'connect', creds,
  );
}

export function disconnectZoom() {
  return call<{ ok: true }>('disconnect');
}

// ── ① 会议 ────────────────────────────────────────────────────────────────
export interface ZoomMeeting {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
  passcode: string | null;
}

/**
 * 用日历活动的日期 + 时间拼出 Zoom 要的 start_time。
 *
 * 刻意拼成**不带时区后缀**的本地时间字符串，再单独把 timezone 传过去。用
 * toISOString() 会转成 UTC，Zoom 收到后按教会时区重新解释，会议时间就整整
 * 差了一个时区（悉尼是 10 小时）。
 */
export function toZoomStartTime(eventDate: string, eventTime?: string): string {
  const time = (eventTime || '10:00').trim();
  // event_time 在库里是自由文本，'10:00' / '10:00 AM' / '上午10点' 都出现过
  const m = time.match(/(\d{1,2})[:：](\d{2})\s*(AM|PM|am|pm)?/);
  let hh = 10, mm = 0;
  if (m) {
    hh = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
    const ampm = m[3]?.toUpperCase();
    if (ampm === 'PM' && hh < 12) hh += 12;
    if (ampm === 'AM' && hh === 12) hh = 0;
  }
  return `${eventDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

export function createMeeting(params: {
  topic: string;
  startTime: string;
  duration?: number;
  timezone?: string;
  agenda?: string;
  autoRecord?: boolean;
}) {
  return call<ZoomMeeting>('createMeeting', params);
}

export function updateMeeting(params: {
  meetingId: string;
  topic?: string;
  startTime?: string;
  duration?: number;
  timezone?: string;
  agenda?: string;
}) {
  return call<{ ok: true }>('updateMeeting', params);
}

export function deleteMeeting(meetingId: string) {
  return call<{ ok: true }>('deleteMeeting', { meetingId });
}

/** 主持人链接现取 —— 它带一次性 token 且约 2 小时过期，不适合存库。 */
export function getStartUrl(meetingId: string) {
  return call<{ startUrl: string }>('startUrl', { meetingId });
}

// ── ② 线上出席 ────────────────────────────────────────────────────────────
export interface ZoomParticipant {
  name: string;
  email: string;
  /** 累计在线分钟数，中途掉线重连的多段已合并 */
  duration: number;
}

export function getParticipants(meetingId: string) {
  return call<{ source: 'report' | 'past_meetings'; participants: ZoomParticipant[] }>(
    'participants', { meetingId },
  );
}

export interface MatchedParticipant extends ZoomParticipant {
  memberId: string | null;
  memberName: string | null;
  /** email = 邮箱精确匹配，name = 姓名匹配，none = 没匹配上 */
  matchedBy: 'email' | 'name' | 'none';
}

/**
 * 把 Zoom 参会者匹配到 church_members。
 *
 * 结果**一律交给人确认**，不直接写库。免费 Zoom 账号拿不到参会者邮箱，只能
 * 靠昵称匹配，而昵称是「Ming」「张明的iPad」「iPhone」什么都有；一家人共用
 * 一个账号进会更是常态。全自动写库会安静地记错出席。
 */
export function matchParticipants(
  participants: ZoomParticipant[],
  members: { id: string; name: string; email?: string | null }[],
): MatchedParticipant[] {
  const byEmail = new Map<string, { id: string; name: string }>();
  const byName = new Map<string, { id: string; name: string }>();
  for (const m of members) {
    if (m.email) byEmail.set(m.email.toLowerCase().trim(), m);
    byName.set(normalizeName(m.name), m);
  }

  return participants.map((p) => {
    const hitEmail = p.email ? byEmail.get(p.email.toLowerCase().trim()) : undefined;
    if (hitEmail) {
      return { ...p, memberId: hitEmail.id, memberName: hitEmail.name, matchedBy: 'email' as const };
    }
    const hitName = byName.get(normalizeName(p.name));
    if (hitName) {
      return { ...p, memberId: hitName.id, memberName: hitName.name, matchedBy: 'name' as const };
    }
    return { ...p, memberId: null, memberName: null, matchedBy: 'none' as const };
  });
}

/**
 * 姓名归一化。去掉设备后缀和空格，中英文都压成可比较的形式。
 * 「张明的 iPhone」「Ming Zhang (iPad)」这类昵称在 Zoom 里遍地都是。
 */
function normalizeName(raw: string): string {
  return String(raw)
    .replace(/[’']s\s+(iphone|ipad|mac|macbook|pc|laptop)$/i, '')
    .replace(/的(iphone|ipad|手机|电脑|平板)$/i, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

// ── ③ 云录制 ──────────────────────────────────────────────────────────────
export interface ZoomRecordingFile {
  id: string;
  fileType: 'MP4' | 'M4A';
  fileSize: number;
  playUrl: string;
}

export interface ZoomRecording {
  meetingId: string;
  uuid: string;
  topic: string;
  startTime: string;
  duration: number;
  totalSize: number;
  /** Zoom 的分享页，比单个文件的 play_url 更适合发给会众 */
  shareUrl?: string;
  /** 录制设了密码时的播放密码，没设就是 null */
  playPasscode: string | null;
  files: ZoomRecordingFile[];
}

export function listRecordings(range?: { from?: string; to?: string }) {
  return call<{ meetings: ZoomRecording[] }>('recordings', range || {});
}

// ── ④ 网页内嵌会议 ────────────────────────────────────────────────────────
/**
 * 取 Meeting SDK 签名。role 是**建议值** —— 服务端会重新判断，非管理员一律
 * 降级成参会者，前端传 1 也拿不到主持权限。
 */
export function getSdkSignature(meetingNumber: string, role: 0 | 1 = 0) {
  return call<{ signature: string; sdkKey: string; role: 0 | 1 }>(
    'sdkSignature', { meetingNumber, role },
  );
}
