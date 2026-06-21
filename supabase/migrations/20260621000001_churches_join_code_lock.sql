-- Stop the church join codes from being publicly readable.
--
-- Before: policy `churches_select_all` (qual = true, role public) let ANYONE —
-- including logged-out visitors — SELECT every churches row, exposing
-- staff_join_code / member_join_code / code. A stranger could read a code and
-- self-join.
--
-- After: a user can only read their OWN church. Anonymous code validation goes
-- through validate_church_code() (SECURITY DEFINER), which checks the code
-- server-side and returns only {id, name, role} — never the raw codes.

-- RPC: validate a join code and return the role it grants (computed server-side).
create or replace function public.validate_church_code(p_code text)
returns table(id uuid, name text, role text)
language sql
security definer
set search_path = public
as $$
  select c.id, c.name,
    case
      when upper(coalesce(c.staff_join_code,'')) = upper(p_code) then 'Staff'
      when upper(coalesce(c.member_join_code,'')) = upper(p_code) then 'Member'
      else case
             when coalesce((c.feature_config->>'code_auto_approve')::boolean, false)
             then 'Member' else 'Pending'
           end
    end as role
  from public.churches c
  where upper(coalesce(c.code,'')) = upper(p_code)
     or upper(coalesce(c.staff_join_code,'')) = upper(p_code)
     or upper(coalesce(c.member_join_code,'')) = upper(p_code)
  limit 1;
$$;

grant execute on function public.validate_church_code(text) to anon, authenticated;

-- Lock the table: drop the wide-open SELECT, allow own-church reads only.
drop policy if exists churches_select_all on public.churches;
drop policy if exists churches_select_own on public.churches;

create policy churches_select_own
  on public.churches
  for select
  to authenticated
  using ( id in (select church_id from public.profiles where id = auth.uid()) );
