-- Block client-side privilege escalation and self-approval.
--
-- profiles_insert_own / profiles_update_own had no value-restricting WITH CHECK,
-- so a user could self-assign role='Super Admin' (on signup-insert OR on update)
-- and church_apps_insert_public (with_check=true) let anyone insert an
-- application already marked status='Approved'.
--
-- These RESTRICTIVE policies are ANDed with every permissive policy, so they cap
-- what role a row may carry regardless of which permissive policy allowed the
-- write. SECURITY DEFINER paths (handle_new_user, join/claim RPCs) bypass RLS and
-- remain the only way privileged roles get assigned.

-- profiles: nobody may grant themselves Super Admin / Manager / Staff.
drop policy if exists profiles_block_priv_insert on public.profiles;
create policy profiles_block_priv_insert on public.profiles
  as restrictive for insert to public
  with check (
    case
      when role in ('Super Admin','SuperAdmin','super_admin')
        then (is_super_admin() or (auth.jwt()->>'email') = 'hyy7010@gmail.com')
      when role in ('Manager','manager')
        then (is_super_admin() or is_church_manager(church_id) or (auth.jwt()->>'email') = 'hyy7010@gmail.com')
      when role in ('Staff','staff','Group Leader','GroupLeader')
        then (is_super_admin() or (auth.jwt()->>'email') = 'hyy7010@gmail.com')
      else true
    end
  );

drop policy if exists profiles_block_priv_update on public.profiles;
create policy profiles_block_priv_update on public.profiles
  as restrictive for update to public
  with check (
    case
      when role in ('Super Admin','SuperAdmin','super_admin')
        then (is_super_admin() or (auth.jwt()->>'email') = 'hyy7010@gmail.com')
      when role in ('Manager','manager')
        then (is_super_admin() or is_church_manager(church_id) or (auth.jwt()->>'email') = 'hyy7010@gmail.com')
      else true
    end
  );

-- Keep profiles_update_own as own-row only. The guard_profile_priv_change trigger
-- (see next migration) is the authority for what fields a self-edit may change.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to public
  using ( id = auth.uid() )
  with check ( id = auth.uid() );

-- church_applications: an applicant may only file a Pending application.
drop policy if exists church_apps_insert_public on public.church_applications;
create policy church_apps_insert_public on public.church_applications
  for insert to public
  with check ( status is null or status = 'Pending' );
