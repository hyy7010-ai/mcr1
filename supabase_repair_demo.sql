-- ════════════════════════════════════════════════════════════════════════════
--  GraceFlow · 示例教会「诊断 + 修复」
--
--  用法：Supabase → SQL Editor → New query → 整份粘贴 → Run
--  可重复执行。跑完会输出两张表，把结果截给我。
--
--  背景：填充示例内容时有 6 张表全部失败，且失败的恰好全是启用了 RLS 的表。
--  fix_database.sql 里用了 `CREATE POLICY IF NOT EXISTS` —— Postgres 不支持
--  这个语法，脚本会在那一行中断，于是后面的表变成「RLS 开着但没有任何策略」，
--  也就是对所有人全部拒绝。这份脚本把示例教会需要的策略强制重建一遍。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 修复 ────────────────────────────────────────────────────────────────────
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select
    exists (select 1 from public.profiles
            where id = auth.uid()
              and upper(replace(role, ' ', '')) = 'SUPERADMIN')
    or lower(coalesce(auth.jwt() ->> 'email', '')) in ('jzey805@gmail.com', 'hyy7010@gmail.com');
$fn$;

do $$
declare
  demo_id constant uuid := '0de00000-0000-4000-a000-000000000001';
  t text;
  tables text[] := array[
    'church_members', 'church_prayers', 'church_groups', 'church_group_members',
    'church_events', 'church_tasks', 'rosters', 'unavailabilities',
    'church_life', 'group_posts', 'group_post_comments', 'member_links',
    'attendance_records', 'church_publications', 'publications',
    'songs', 'church_ppt_library', 'church_finance', 'notifications', 'activity_logs'
  ];
begin
  execute 'drop policy if exists demo_church_readable on public.churches';
  execute format('create policy demo_church_readable on public.churches for select to authenticated using (id = %L)', demo_id);
  execute 'drop policy if exists demo_church_writable on public.churches';
  execute format('create policy demo_church_writable on public.churches for update to authenticated using (id = %L and public.is_platform_admin()) with check (id = %L)', demo_id, demo_id);

  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_church_open  on public.%I', t);
    execute format('drop policy if exists demo_church_read  on public.%I', t);
    execute format('drop policy if exists demo_church_write on public.%I', t);
    execute format('create policy demo_church_read on public.%I for select to authenticated using (church_id = %L)', t, demo_id);
    execute format('create policy demo_church_write on public.%I for all to authenticated using (church_id = %L and public.is_platform_admin()) with check (church_id = %L and public.is_platform_admin())', t, demo_id, demo_id);
  end loop;
end $$;

-- ── 诊断输出 ① 我是不是平台管理员（必须是 true）─────────────────────────────
select public.is_platform_admin() as 我是平台管理员;

-- ── 诊断输出 ② 之前失败的那几张表，现在的 RLS 与策略 ───────────────────────
select
  c.relname                                          as 表名,
  c.relrowsecurity                                   as rls已启用,
  count(p.polname)                                   as 策略数,
  coalesce(string_agg(p.polname, ', ' order by p.polname), '(没有策略 → 全部拒绝)') as 策略列表
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('churches','church_groups','church_events','church_tasks',
                    'church_publications','attendance_records','church_members','church_life')
group by c.relname, c.relrowsecurity
order by c.relname;
