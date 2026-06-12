# SaaS Admin Setup & Seed Instructions

To transition to the multi-tenant SaaS model, follow these steps:

## 1. Supabase Database Setup
Run the SQL code provided in `supabase_setup.sql` in your Supabase SQL Editor. This will create the necessary tables (`churches`, `profiles`, `church_members`, `member_links`) and enable Row Level Security (RLS).

## 2. Create the Initial "Seed" Church & Admin
You need to manually create the first church and admin user in your Supabase database since the system prevents self-assignment for security.

### Step A: Create a Church
Insert your church into the `churches` table:
```sql
INSERT INTO public.churches (name, code) 
VALUES ('My Great Church', 'CHURCH001');
```

### Step B: Promote a User to Super Admin
After the owner user has signed up via the web UI and confirmed their email, find their `id` in the `auth.users` table or `profiles` table. Then promote them:
```sql
-- Replace 'USER_ID' with the actual UUID and 'CHURCH_ID' with the church UUID from Step A
UPDATE public.profiles 
SET role = 'Super Admin', 
    church_id = 'CHURCH_ID' 
WHERE id = 'USER_ID';
```

## 3. Email Confirmation Redirect
I have already updated `src/pages/Login.tsx` to use `window.location.origin` for the redirect. 
**Action Required:** Go to your Supabase Dashboard -> Authentication -> URL Configuration and ensure:
- **Site URL**: `https://mcr.fliptus.com`
- **Redirect URLs**: Add `https://mcr.fliptus.com/**`

## 4. Multi-tenancy logic
The app now uses a `church_id` based on the user's profile. When a user registers with a `church_code`, the database trigger (if enabled) or manual admin assignment will link them to the correct church. 

Logical isolation is enforced via Supabase RLS policies, ensuring data for one church is never visible to another.
