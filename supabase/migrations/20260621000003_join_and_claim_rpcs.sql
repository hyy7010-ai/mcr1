-- Server-enforced church joining and approved-applicant linking.
--
-- The guard_profile_priv_change trigger blocks self-set of role/church_id, which
-- also (correctly) blocks the OAuth join flow where the client tried to set its
-- own church_id. The fix: route joins through SECURITY DEFINER RPCs that the
-- trigger trusts via a transaction-local flag (app.trusted_join). Clients cannot
-- set GUCs through PostgREST, so only these RPCs can take the trusted path.

-- Recreate the guard trigger function with a trusted-path early-return at the top.
-- Everything below the early-return is the original guard logic, unchanged.
create or replace function public.guard_profile_priv_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_super boolean := coalesce(public.is_super_admin(), false) or v_email = 'hyy7010@gmail.com';
  has_approved_app boolean;
  member_of_new boolean;
begin
  -- Trusted server path (join_church_with_code / claim_approved_church).
  if coalesce(current_setting('app.trusted_join', true), '') = 'on' then
    return new;
  end if;

  -- Only guard a user editing their OWN row. Manager / super-admin edits of
  -- other people run under their own RLS policies and stay trusted.
  if auth.uid() is null or auth.uid() is distinct from new.id then
    return new;
  end if;

  has_approved_app := exists (
    select 1 from public.church_applications a
    where lower(a.email) = v_email and a.status = 'Approved'
  );

  -- Block privileged ROLE self-escalation.
  if new.role is distinct from old.role then
    if new.role in ('Super Admin','SuperAdmin','super_admin') then
      if not actor_super then new.role := old.role; end if;
    elsif new.role in ('Manager','manager') then
      if not (actor_super or has_approved_app) then new.role := old.role; end if;
    elsif new.role in ('Staff','staff','Group Leader','GroupLeader') then
      if not actor_super then new.role := old.role; end if;
    end if;
  end if;

  -- Block CHURCH_ID hopping: you can only move to a church you belong to.
  if new.church_id is distinct from old.church_id and not actor_super then
    member_of_new := exists (
      select 1 from public.church_members m
      where lower(m.email) = v_email and m.church_id = new.church_id
    );
    if not (member_of_new or has_approved_app) then
      new.church_id := old.church_id;
    end if;
  end if;

  return new;
end $fn$;

-- Join a church with a code: the code is validated and role/church_id assigned
-- entirely server-side.
create or replace function public.join_church_with_code(p_code text, p_full_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_church record;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_church from public.validate_church_code(p_code) limit 1;
  if v_church.id is null then raise exception 'invalid join code'; end if;
  perform set_config('app.trusted_join','on',true);
  insert into public.profiles (id, email, full_name, church_id, role)
  values (v_uid, v_email,
          coalesce(nullif(p_full_name,''), nullif(split_part(coalesce(v_email,''),'@',1),''), 'New Member'),
          v_church.id, coalesce(v_church.role,'Pending'))
  on conflict (id) do update
    set church_id = excluded.church_id,
        role = case when public.profiles.role in ('Super Admin','Manager')
                    then public.profiles.role else excluded.role end,
        full_name = coalesce(nullif(public.profiles.full_name,''), excluded.full_name)
  returning * into v_profile;
  return v_profile;
end $fn$;

grant execute on function public.join_church_with_code(text,text) to authenticated;

-- Link an approved application to the church created for it, so a not-yet-
-- registered applicant can be auto-linked (as Manager) on first login.
alter table public.church_applications
  add column if not exists church_id uuid references public.churches(id);

create or replace function public.claim_approved_church()
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_church_id uuid;
  v_leader text;
  v_profile public.profiles;
begin
  if v_uid is null or v_email = '' then raise exception 'not authenticated'; end if;
  select church_id, leader_name into v_church_id, v_leader
  from public.church_applications
  where lower(email) = v_email and status = 'Approved' and church_id is not null
  order by created_at desc limit 1;
  if v_church_id is null then return null; end if;
  perform set_config('app.trusted_join','on',true);
  insert into public.profiles (id, email, full_name, church_id, role)
  values (v_uid, auth.jwt()->>'email',
          coalesce(nullif(v_leader,''), split_part(v_email,'@',1)), v_church_id, 'Manager')
  on conflict (id) do update
    set church_id = v_church_id,
        role = case when public.profiles.role = 'Super Admin' then 'Super Admin' else 'Manager' end
  returning * into v_profile;
  return v_profile;
end $fn$;

grant execute on function public.claim_approved_church() to authenticated;
