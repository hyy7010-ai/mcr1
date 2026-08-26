-- ════════════════════════════════════════════════════════════════════════════
--  GraceFlow · 补建三张缺失的表
--
--  用法：Supabase → SQL Editor → New query → 整份粘贴 → Run。可重复执行。
--
--  为什么会缺：fix_database.sql 里用了 `CREATE POLICY IF NOT EXISTS`，
--  Postgres 不支持这个语法，脚本在那一行直接中断，**中断点之后的建表语句
--  全都没有执行**。诊断查询问 8 张表只回了 5 行，缺的正是这三张。
--
--  跑完：回示例教会 → 点「填充示例内容」→ 回执应为 0 张表失败。
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.church_events (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id),
  title       text not null,
  event_date  date not null,
  event_time  text,
  category    text default 'Service',
  color       text default '#6366f1',
  description text,
  created_at  timestamptz default now()
);

create table if not exists public.church_tasks (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references public.churches(id),
  title           text not null,
  description     text,
  due_date        date,
  priority        text default 'medium',
  status          text default 'pending',
  category        text default 'General',
  created_by_name text,
  created_at      timestamptz default now()
);

create table if not exists public.attendance_records (
  id                 uuid primary key default gen_random_uuid(),
  church_id          uuid not null references public.churches(id),
  service_date       date not null,
  headcount          integer default 0,
  notes              text,
  present_member_ids uuid[],
  created_by         text,
  created_at         timestamptz default now()
);

create index if not exists church_events_lookup      on public.church_events (church_id, event_date);
create index if not exists church_tasks_lookup       on public.church_tasks (church_id, created_at desc);
create index if not exists attendance_records_lookup on public.attendance_records (church_id, service_date desc);

-- ── RLS：本教会隔离 + 示例教会（人人可读，仅平台管理员可写）─────────────────
-- 注意这里全部写成 drop + create，不用 Postgres 不支持的 CREATE POLICY IF NOT EXISTS。
do $$
declare
  demo_id constant uuid := '0de00000-0000-4000-a000-000000000001';
  t text;
begin
  foreach t in array array['church_events', 'church_tasks', 'attendance_records'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using      (church_id in (select church_id from public.profiles where id = auth.uid()))
         with check (church_id in (select church_id from public.profiles where id = auth.uid()))',
      t || '_own', t);

    execute format('drop policy if exists demo_church_read on public.%I', t);
    execute format(
      'create policy demo_church_read on public.%I for select to authenticated using (church_id = %L)',
      t, demo_id);

    execute format('drop policy if exists demo_church_write on public.%I', t);
    execute format(
      'create policy demo_church_write on public.%I for all to authenticated
         using      (church_id = %L and public.is_platform_admin())
         with check (church_id = %L and public.is_platform_admin())',
      t, demo_id, demo_id);
  end loop;
end $$;

-- ── 复核：这三张表现在应该各有 3 条策略 ─────────────────────────────────────
select
  c.relname                                          as 表名,
  c.relrowsecurity                                   as rls已启用,
  count(p.polname)                                   as 策略数,
  coalesce(string_agg(p.polname, ', ' order by p.polname), '(没有策略)') as 策略列表
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('church_events', 'church_tasks', 'attendance_records')
group by c.relname, c.relrowsecurity
order by c.relname;
