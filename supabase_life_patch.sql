-- GraceFlow · 属灵生活模块（灵修打卡 / 通知 / 课程 / 资源 / 失物 / 私聊 / 探访）
-- 一张通用表承载所有新模块，避免为每个功能建表。
create table if not exists public.church_life (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null,
  kind        text not null,          -- checkin | notice | course | enroll | resource | lostfound | dm | visit | reading
  data        jsonb not null default '{}'::jsonb,
  author_id   uuid,
  author_name text,
  created_at  timestamptz not null default now()
);

create index if not exists church_life_lookup on public.church_life (church_id, kind, created_at desc);

alter table public.church_life enable row level security;

-- 与本项目其它表一致：登录用户可读写本教会数据
drop policy if exists church_life_all on public.church_life;
create policy church_life_all on public.church_life
  for all to authenticated using (true) with check (true);

-- 代祷事项增加「方向标签」（家庭 / 健康 / 工作 / 未来 / 其他）
alter table public.church_prayers add column if not exists tag text default 'other';
