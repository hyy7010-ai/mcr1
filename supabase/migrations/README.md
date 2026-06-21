# Migrations

> **Scope note:** These are **incremental security-hardening migrations** applied on
> top of the project's existing schema. The base schema (tables `churches`,
> `profiles`, `church_applications`, `church_finance`, `church_members`, helper
> functions `is_super_admin()`, `is_church_manager()`, `get_my_church_id()`, and the
> `handle_new_user` / `guard_profile_priv_change` triggers) was created outside this
> repo and is **not** captured here. These files therefore assume that base schema
> already exists — they are not a from-scratch rebuild.

They are written to be idempotent (`create or replace`, `drop ... if exists`,
`add column if not exists`) so they can be re-applied safely.

Apply order is by filename timestamp:

1. `20260621000001_churches_join_code_lock.sql` — stop anonymous reads of join codes;
   add `validate_church_code` RPC.
2. `20260621000002_profiles_privilege_hardening.sql` — block self privilege-escalation
   and self-approval (RLS restrictive policies).
3. `20260621000003_join_and_claim_rpcs.sql` — server-enforced join + approved-applicant
   linking RPCs; trusted-path bypass in the guard trigger; `church_applications.church_id`.
4. `20260621000004_finance_amount_validation.sql` — non-negative finance amounts.

Edge functions (`supabase/functions/*`) deploy separately via
`supabase functions deploy <name>`.
