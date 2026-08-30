-- Zoom 集成：每个教会绑定自己的 Server-to-Server OAuth 应用。
--
-- 为什么把凭证放在库里而不是 Supabase secrets：secrets 是**平台级**的，一份
-- 密钥全站共用，那样所有教会的会议都会开在平台方的 Zoom 账号下，共享会议
-- 并发数和云录制空间。这里要的是每个教会用自己的账号，所以凭证必须按
-- church_id 分行存。
--
-- 安全模型 —— client_secret 绝不能被前端读到：
--   1. 本表启用 RLS 且**不建任何策略**。anon / authenticated 因此完全够不着它，
--      只有 service_role（绕过 RLS）能读写，也就是只有 Edge Function 能碰。
--   2. 前端要判断「有没有连上」时调 zoom_integration_status()，它是
--      SECURITY DEFINER，只回非敏感字段（连接状态、脱敏后的 client_id、
--      账号套餐），永远不回 secret。
--   3. 写入也只走 Edge Function：前端把凭证 POST 给它，它先拿凭证向 Zoom
--      换一次 token 验证有效，通过了才用 service_role 落库。

create table if not exists public.church_integrations (
  id                 uuid primary key default gen_random_uuid(),
  church_id          uuid not null references public.churches(id) on delete cascade,
  provider           text not null default 'zoom',

  -- Server-to-Server OAuth 应用（开会议 / 拉出席 / 拉录制用这套）
  account_id         text,
  client_id          text,
  client_secret      text,

  -- Meeting SDK 应用（网页内嵌会议用，Zoom 侧是**另一个**应用类型，
  -- 凭证不能和上面那套混用）
  sdk_client_id      text,
  sdk_client_secret  text,

  -- 连接时探测到的账号能力，前端据此决定隐藏哪些入口：
  -- plan_type 'basic' 的账号没有云录制，参会报表字段也受限。
  plan_type          text,
  zoom_user_email    text,
  granted_scopes     text[],

  status             text not null default 'connected',  -- connected | error
  last_error         text,
  last_verified_at   timestamptz,
  connected_by       uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint church_integrations_provider_unique unique (church_id, provider)
);

alter table public.church_integrations enable row level security;

-- 刻意不建任何 policy。RLS 开着 + 零策略 = 除 service_role 外一律拒绝。
-- 如果以后有人「为了方便」在这里加一条 select 策略，client_secret 就泄了。
revoke all on public.church_integrations from anon, authenticated;

comment on table public.church_integrations is
  'Per-church third-party credentials. RLS on with NO policies on purpose: only '
  'service_role (Edge Functions) may read or write. Never add a SELECT policy here.';


-- ── 前端可见的连接状态（不含任何密钥）────────────────────────────────────
create or replace function public.zoom_integration_status()
returns table (
  connected        boolean,
  client_id_masked text,
  zoom_user_email  text,
  plan_type        text,
  status           text,
  last_error       text,
  last_verified_at timestamptz,
  sdk_configured   boolean
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_church uuid := public.get_my_church_id();
begin
  if v_church is null then
    return;
  end if;

  return query
  select
    true,
    -- 只露最后 4 位，够管理员认出「填的是哪一个应用」，又不构成可用凭证
    case when i.client_id is null or length(i.client_id) < 4
         then null
         else repeat('•', 6) || right(i.client_id, 4) end,
    i.zoom_user_email,
    i.plan_type,
    i.status,
    i.last_error,
    i.last_verified_at,
    (i.sdk_client_id is not null and i.sdk_client_secret is not null)
  from public.church_integrations i
  where i.church_id = v_church and i.provider = 'zoom';
end;
$fn$;

revoke all on function public.zoom_integration_status() from public;
grant execute on function public.zoom_integration_status() to authenticated;


-- ── 日历活动挂 Zoom 会议 ─────────────────────────────────────────────────
alter table public.church_events add column if not exists zoom_meeting_id text;
alter table public.church_events add column if not exists zoom_join_url   text;
alter table public.church_events add column if not exists zoom_passcode   text;
-- start_url 是**主持人**专用链接，本身带一次性 token 且 2 小时过期，所以
-- 不落库（存了既会过期又等于把主持权限写进了任何能读 church_events 的人
-- 眼皮底下）。需要时由 Edge Function 现取。

create index if not exists church_events_zoom_meeting_id_idx
  on public.church_events (zoom_meeting_id)
  where zoom_meeting_id is not null;


-- ── 出席记录关联 Zoom 会议 ───────────────────────────────────────────────
alter table public.attendance_records add column if not exists zoom_meeting_id text;
alter table public.attendance_records add column if not exists zoom_synced_at   timestamptz;
-- 线上参会但没匹配上任何 member 的人（昵称对不上、访客），原样存下来，
-- 免得点名的人以为「Zoom 上 40 人怎么只导进来 28 个」。
alter table public.attendance_records add column if not exists zoom_unmatched   jsonb;


-- ── 云录制归档到出版物 ───────────────────────────────────────────────────
-- 复用 church_publications，不另起一张表：录制归档后就是一份「可播放的资料」，
-- 和讲道稿、周报同一个消费场景。加两列用来去重和标记来源。
alter table public.church_publications add column if not exists source      text;
alter table public.church_publications add column if not exists external_id text;

-- 同一场录制重复导入会生成重复条目 —— 用唯一索引在库层面挡掉，
-- 而不是指望前端每次都先查一遍。
create unique index if not exists church_publications_external_uniq
  on public.church_publications (church_id, source, external_id)
  where external_id is not null;
