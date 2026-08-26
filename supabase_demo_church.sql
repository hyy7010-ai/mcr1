-- GraceFlow · 示例教会（Demo Church / sample tenant）
--
-- 全平台共用一个「示例教会」，装满示例数据，任何登录用户都能进去参观。
--
-- 权限模型：**所有人只读，只有平台管理员能写**。
-- 只读是刻意的 —— 共用一个教会又允许所有人写，第一个把示例排班删掉的人
-- 就毁掉了后面所有访客看到的样板间，而"定期重置"是永远补不完的手工活。
-- 用户想留下什么，走前端的「复制到我的教会」，把结构复制进他自己的教会。
--
-- 这里只做三件事：
--   1. 建出这一条 churches 记录（固定 UUID，前端 src/lib/demoChurch.ts 里同一个常量）
--   2. 一个判断平台管理员的辅助函数
--   3. 给相关表补 RLS：示例教会的行人人可读，仅平台管理员可写

-- ── 1. 教会记录 ─────────────────────────────────────────────────────────────
insert into public.churches (id, name, code)
values ('0de00000-0000-4000-a000-000000000001', '示例教会 Grace Demo Church', 'DEMO')
on conflict (id) do update set name = excluded.name;

-- ── 2. 平台管理员判定（与前端 lib/permissions.ts 的 isSuperAdmin 对齐）────────
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('Super Admin', 'SuperAdmin', 'super_admin')
    )
    or lower(coalesce(auth.jwt() ->> 'email', '')) in ('jzey805@gmail.com', 'hyy7010@gmail.com');
$$;

-- ── 3. RLS：示例教会人人可读，仅平台管理员可写 ─────────────────────────────
-- 作用域严格限定在 church_id = 示例教会，不影响任何真实教会的隔离。
do $$
declare
  demo_id constant uuid := '0de00000-0000-4000-a000-000000000001';
  t text;
  tables text[] := array[
    'church_members', 'church_prayers', 'church_groups', 'church_group_members',
    'church_events', 'church_tasks', 'rosters', 'unavailabilities',
    'church_life', 'group_posts', 'group_post_comments', 'member_links',
    'attendance_records', 'church_publications', 'publications',
    'songs', 'church_ppt_library', 'church_finance', 'notifications'
  ];
begin
  -- 让所有人看得见这一条教会记录（否则切换进去拿不到教会名 / roster_roles）
  execute 'drop policy if exists demo_church_readable on public.churches';
  execute format(
    'create policy demo_church_readable on public.churches for select to authenticated using (id = %L)', demo_id);

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

    -- 上一版是 for all（人人可写），务必先删掉
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
