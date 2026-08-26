-- GraceFlow · 示例教会（Demo Church / sample tenant）
--
-- 全平台共用一个「示例教会」，装满示例数据，任何登录用户都能进去参观、随便试，
-- Super Admin 可在平台管理控制台一键重置。
--
-- 这里只做两件事：
--   1. 建出这一条 churches 记录（固定 UUID，前端 src/lib/demoChurch.ts 里同一个常量）
--   2. 给相关表补一条「本行属于示例教会」就放行的 RLS 策略
-- 示例内容本身由前端的「重置示例教会」按钮写入，方便随时改文案。

-- ── 1. 教会记录 ─────────────────────────────────────────────────────────────
insert into public.churches (id, name, code)
values ('0de00000-0000-4000-a000-000000000001', '示例教会 Grace Demo Church', 'DEMO')
on conflict (id) do update set name = excluded.name;

-- ── 2. RLS：示例教会的数据对所有登录用户开放 ───────────────────────────────
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
  -- 让所有人看得见这一条教会记录（否则切换进去拿不到教会名/Logo）
  execute format(
    'drop policy if exists demo_church_readable on public.churches');
  execute format(
    'create policy demo_church_readable on public.churches for select to authenticated using (id = %L)', demo_id);

  foreach t in array tables loop
    -- 表可能还没建（不同环境跑过的补丁不一样），跳过即可
    if to_regclass('public.' || t) is null then
      raise notice 'skip % (not present)', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_church_open on public.%I', t);
    execute format(
      'create policy demo_church_open on public.%I for all to authenticated using (church_id = %L) with check (church_id = %L)',
      t, demo_id, demo_id);
  end loop;
end $$;
