-- ============================================================================
-- GraceFlow PATCH — run this ONCE in Supabase → SQL Editor → New query → Run.
-- Safe to re-run (uses "if not exists" / "drop policy if exists").
-- Fixes: disappearing relationship arrows, publications that won't download,
--        group post replies, and the notification bell / leave requests.
-- ============================================================================

-- 1) MEMBER RELATIONSHIP LINKS (the arrows in 会友网络 / Member Network) -------
--    IMPORTANT: the old member_links table had source_id/target_id as UUID with a
--    foreign key to church_members. The app now uses PROFILE ids as node ids, so
--    every insert was rejected and arrows never saved. We rebuild it with plain
--    text columns and no foreign keys so ANY node id works.
drop table if exists public.member_links cascade;
create table public.member_links (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  source_id text not null,
  target_id text not null,
  type text default 'Friend',
  created_at timestamptz default now()
);
alter table public.member_links enable row level security;
drop policy if exists ml_all on public.member_links;
create policy ml_all on public.member_links for all using (true) with check (true);
create index if not exists member_links_church_idx on public.member_links(church_id);

-- 2) GROUP POST REPLIES (评论 / comments under each 小组 post) -----------------
create table if not exists public.group_post_comments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  post_id uuid not null,
  author_id uuid,
  author_name text,
  content text not null,
  created_at timestamptz default now()
);
alter table public.group_post_comments enable row level security;
drop policy if exists gpc_all on public.group_post_comments;
create policy gpc_all on public.group_post_comments for all using (true) with check (true);
create index if not exists gpc_post_idx on public.group_post_comments(post_id);

-- 3) NOTIFICATIONS (小铃铛 bell + 请假 leave requests + roster published) ------
--    recipient_id  = a specific person
--    recipient_role= a whole role (e.g. 'Manager' so every manager sees 请假)
--    both null      = everyone in the church
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  recipient_id uuid,
  recipient_role text,
  sender_id uuid,
  sender_name text,
  type text not null default 'general',     -- roster | leave | message | general
  title text,
  body text,
  link text,
  read boolean default false,
  created_at timestamptz default now()
);
alter table public.notifications enable row level security;
drop policy if exists notif_all on public.notifications;
create policy notif_all on public.notifications for all using (true) with check (true);
create index if not exists notifications_church_idx on public.notifications(church_id);

-- 4) PUBLICATIONS — make sure the metadata table is readable/writable --------
--    (the 免费刊物 that uploaded "successfully" but were invisible to others)
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='church_publications') then
    execute 'alter table public.church_publications enable row level security';
    execute 'drop policy if exists pub_all on public.church_publications';
    execute 'create policy pub_all on public.church_publications for all using (true) with check (true)';
  end if;
end $$;

-- 5) STORAGE BUCKETS — files + avatars must be public so everyone can see them
insert into storage.buckets (id, name, public) values ('publications', 'publications', true)
  on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists "gf_storage_read"   on storage.objects;
create policy "gf_storage_read"   on storage.objects for select
  using (bucket_id in ('publications','avatars'));
drop policy if exists "gf_storage_insert" on storage.objects;
create policy "gf_storage_insert" on storage.objects for insert
  with check (bucket_id in ('publications','avatars'));
drop policy if exists "gf_storage_update" on storage.objects;
create policy "gf_storage_update" on storage.objects for update
  using (bucket_id in ('publications','avatars'));
drop policy if exists "gf_storage_delete" on storage.objects;
create policy "gf_storage_delete" on storage.objects for delete
  using (bucket_id in ('publications','avatars'));

-- Done. Hard-refresh the app after running this.
