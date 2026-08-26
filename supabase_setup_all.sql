-- ════════════════════════════════════════════════════════════════════════════
--  GraceFlow · 一次性安装脚本
--
--  用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整份粘贴 → Run
--  可重复执行，跑几次都不会出问题。
--
--  包含：
--    1. church_life 表（灵修打卡 / 通知 / 课程 / 资源 / 失物 / 私聊 / 探访）
--    2. church_prayers.tag 列（代祷方向标签）
--    3. 示例教会记录 + 只读 RLS
--
--  跑完之后：进 App → 平台管理控制台 → demo → 重置示例教会
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. 属灵生活模块 ─────────────────────────────────────────────────────────
-- 一张通用表承载所有新模块，靠 kind 区分，避免为每个功能建表。
create table if not exists public.church_life (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null,
  kind        text not null,   -- checkin | notice | course | enroll | resource | lostfound | dm | visit | reading
  data        jsonb not null default '{}'::jsonb,
  author_id   uuid,
  author_name text,
  created_at  timestamptz not null default now()
);

create index if not exists church_life_lookup
  on public.church_life (church_id, kind, created_at desc);

alter table public.church_life enable row level security;

-- ⚠ 早期版本这条策略是 using (true) —— 等于任何登录用户都能读写**所有教会**的
-- church_life 数据，包括别家教会的代祷事项和探访记录。这里改成与项目其它表
-- 一致的「只能碰自己教会」。旧策略务必先删掉。
drop policy if exists church_life_all on public.church_life;
drop policy if exists church_life_own on public.church_life;
create policy church_life_own on public.church_life
  for all to authenticated
  using      (church_id in (select church_id from public.profiles where id = auth.uid()))
  with check (church_id in (select church_id from public.profiles where id = auth.uid()));


-- ── 2. 代祷方向标签（家庭 / 健康 / 工作 / 未来 / 其他）──────────────────────
alter table public.church_prayers add column if not exists tag text default 'other';


-- ── 3. 示例教会（Demo Church / sample tenant）──────────────────────────────
-- 全平台共用一个装满示例内容的教会，任何登录用户都能进去参观。
--
-- 权限模型：**所有人只读，只有平台管理员能写**。
-- 只读是刻意的 —— 共用一个教会又允许所有人写，第一个把示例排班删掉的人就
-- 毁掉了后面所有访客看到的样板间，而「定期重置」是永远补不完的手工活。
-- 用户想留下什么，走前端的「复制到我的教会」。
--
-- UUID 与 src/lib/demoChurch.ts 里的 DEMO_CHURCH_ID 必须一致。

insert into public.churches (id, name, code)
values ('0de00000-0000-4000-a000-000000000001', '示例教会 Grace Demo Church', 'DEMO')
on conflict (id) do update set name = excluded.name;

-- 平台管理员判定（与前端 lib/permissions.ts 的 isSuperAdmin 对齐）
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    -- 线上实际存过 'Super Admin' / 'SuperAdmin' / 'SUPERADMIN' 三种写法，
    -- 统一去空格转大写再比，别再漏。
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and upper(replace(role, ' ', '')) = 'SUPERADMIN'
    )
    or lower(coalesce(auth.jwt() ->> 'email', '')) in ('jzey805@gmail.com', 'hyy7010@gmail.com');
$fn$;

-- 示例教会的行：人人可读，仅平台管理员可写。
-- 作用域严格限定 church_id = 示例教会，不影响任何真实教会的隔离。
do $$
declare
  demo_id constant uuid := '0de00000-0000-4000-a000-000000000001';
  t text;
  tables text[] := array[
    'church_members', 'church_prayers', 'church_groups', 'church_group_members',
    'church_events', 'church_tasks', 'rosters', 'unavailabilities',
    'church_life', 'group_posts', 'group_post_comments', 'member_links',
    'attendance_records', 'church_publications', 'publications',
    'songs', 'church_ppt_library', 'church_finance', 'notifications',
    'activity_logs'
  ];
begin
  -- 让所有人看得见这一条教会记录（否则切进去拿不到教会名 / roster_roles）
  execute 'drop policy if exists demo_church_readable on public.churches';
  execute format(
    'create policy demo_church_readable on public.churches for select to authenticated using (id = %L)',
    demo_id);

  execute 'drop policy if exists demo_church_writable on public.churches';
  execute format(
    'create policy demo_church_writable on public.churches for update to authenticated using (id = %L and public.is_platform_admin()) with check (id = %L)',
    demo_id, demo_id);

  foreach t in array tables loop
    -- 表可能还没建（不同环境跑过的补丁不一样），跳过即可
    if to_regclass('public.' || t) is null then
      raise notice 'skip % (not present)', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- 早期版本是 demo_church_open（人人可写），务必先删掉
    execute format('drop policy if exists demo_church_open on public.%I', t);

    execute format('drop policy if exists demo_church_read on public.%I', t);
    execute format(
      'create policy demo_church_read on public.%I for select to authenticated using (church_id = %L)',
      t, demo_id);

    execute format('drop policy if exists demo_church_write on public.%I', t);
    execute format(
      'create policy demo_church_write on public.%I for all to authenticated using (church_id = %L and public.is_platform_admin()) with check (church_id = %L and public.is_platform_admin())',
      t, demo_id, demo_id);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  跑完了。下一步：App → 平台管理控制台 → demo → 重置示例教会
-- ════════════════════════════════════════════════════════════════════════════
