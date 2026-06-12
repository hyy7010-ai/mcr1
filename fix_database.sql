-- 1. Ensure profiles has the church_id column (UUID)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='church_id') THEN
        ALTER TABLE public.profiles ADD COLUMN church_id UUID REFERENCES public.churches(id);
    END IF;
END $$;

-- 2. Make sure role has a default of 'Pending'
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'Pending';

-- 1. Ensure churches table has join code columns
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='churches' AND column_name='staff_join_code') THEN
        ALTER TABLE public.churches ADD COLUMN staff_join_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='churches' AND column_name='member_join_code') THEN
        ALTER TABLE public.churches ADD COLUMN member_join_code TEXT;
    END IF;
END $$;

-- Update the handle_new_user trigger to handle metadata join codes (optional but good for signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    target_church_id UUID;
    target_role TEXT := 'Pending';
BEGIN
    -- Try to match by main code first
    SELECT id INTO target_church_id FROM public.churches WHERE code = UPPER(TRIM(NEW.raw_user_meta_data->>'church_code'));
    
    -- If not found, try staff code
    IF target_church_id IS NULL THEN
        SELECT id INTO target_church_id FROM public.churches WHERE staff_join_code = UPPER(TRIM(NEW.raw_user_meta_data->>'church_code'));
        IF target_church_id IS NOT NULL THEN
            target_role := 'Staff';
        END IF;
    END IF;

    -- If still not found, try member code
    IF target_church_id IS NULL THEN
        SELECT id INTO target_church_id FROM public.churches WHERE member_join_code = UPPER(TRIM(NEW.raw_user_meta_data->>'church_code'));
        IF target_church_id IS NOT NULL THEN
            target_role := 'Member';
        END IF;
    END IF;
    
    -- Insert user into profiles
    INSERT INTO public.profiles (id, church_id, full_name, role)
    VALUES (
        NEW.id,
        target_church_id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'New Member'),
        target_role
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Re-attach the trigger safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Fix RLS Policies for Super Admin and Managers safely
-- Using SECURITY DEFINER functions to break infinite recursion

-- Check if user is Super Admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
DECLARE
  u_email TEXT;
  u_role TEXT;
BEGIN
  -- 1. Check JWT Email (Highest priority, zero recursion)
  u_email := auth.jwt()->>'email';
  IF (u_email IN ('jzey805@gmail.com', 'hyy7010@gmail.com')) THEN
    RETURN TRUE;
  END IF;

  -- 2. Check role column directly - SECURITY DEFINER ignores RLS on profiles table here
  SELECT role INTO u_role FROM public.profiles WHERE id = auth.uid();
  
  RETURN COALESCE(u_role IN ('Super Admin', 'SuperAdmin'), FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Check if user is Manager of a specific church
CREATE OR REPLACE FUNCTION public.is_church_manager(cid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  u_role TEXT;
  u_church_id UUID;
BEGIN
  SELECT role, church_id INTO u_role, u_church_id 
  FROM public.profiles 
  WHERE id = auth.uid();
  
  RETURN COALESCE(u_role = 'Manager' AND u_church_id = cid, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper to get user's church safely
CREATE OR REPLACE FUNCTION public.get_user_church_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT church_id FROM public.profiles WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- CLEAN SLATE: DROP ALL POLICIES
DO $$ 
DECLARE 
    pol RECORD;
BEGIN 
    FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('churches', 'profiles', 'church_applications')) 
    LOOP 
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Enable RLS
ALTER TABLE public.churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_applications ENABLE ROW LEVEL SECURITY;

-- NEW POLICIES (NON-RECURSIVE)

-- CHURCHES
CREATE POLICY "churches_select_all" ON public.churches FOR SELECT USING (true); -- Churches are public to browse
CREATE POLICY "churches_all_super_admin" ON public.churches FOR ALL USING (public.is_super_admin());
CREATE POLICY "churches_update_manager" ON public.churches FOR UPDATE USING (public.is_church_manager(id));

-- PROFILES
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_select_church" ON public.profiles FOR SELECT USING (church_id = public.get_user_church_id());
CREATE POLICY "profiles_all_super_admin" ON public.profiles FOR ALL USING (public.is_super_admin());
CREATE POLICY "profiles_update_manager" ON public.profiles FOR UPDATE USING (public.is_church_manager(church_id));

-- CHURCH APPLICATIONS
CREATE POLICY "church_apps_all_super_admin" ON public.church_applications FOR ALL USING (public.is_super_admin());
CREATE POLICY "church_apps_insert_public" ON public.church_applications FOR INSERT WITH CHECK (true);

-- 7. Ensure churches can be seen by their own members
-- (Already covered by churches_select_all for now)



-- Calendar Events Table
CREATE TABLE IF NOT EXISTS public.church_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TEXT,
  category TEXT DEFAULT 'Service',
  color TEXT DEFAULT '#6366f1',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.church_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Church events isolation" ON public.church_events FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

-- Timezone field for churches
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Australia/Sydney';

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  service_date DATE NOT NULL,
  headcount INTEGER DEFAULT 0,
  notes TEXT,
  present_member_ids UUID[],
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Attendance data isolation" ON public.attendance_records FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

-- Baptism & Pastoral Visit fields on church_members
ALTER TABLE public.church_members ADD COLUMN IF NOT EXISTS baptism_date DATE;
ALTER TABLE public.church_members ADD COLUMN IF NOT EXISTS baptism_type TEXT DEFAULT 'none';
ALTER TABLE public.church_members ADD COLUMN IF NOT EXISTS pastoral_visits JSONB DEFAULT '[]';

-- Tasks Table
CREATE TABLE IF NOT EXISTS public.church_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  category TEXT DEFAULT 'General',
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.church_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Church tasks isolation" ON public.church_tasks FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

-- Groups Table
CREATE TABLE IF NOT EXISTS public.church_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'group',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.church_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Church groups isolation" ON public.church_groups FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

-- Group Posts Table
CREATE TABLE IF NOT EXISTS public.group_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  group_id UUID REFERENCES public.church_groups(id) ON DELETE CASCADE NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.group_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Group posts isolation" ON public.group_posts FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

-- Giving settings columns on churches table
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_country TEXT DEFAULT 'AU';
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_field1 TEXT DEFAULT '';
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_field2 TEXT DEFAULT '';
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_payment_url TEXT DEFAULT '';
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_apple_pay BOOLEAN DEFAULT true;
ALTER TABLE public.churches ADD COLUMN IF NOT EXISTS giving_google_pay BOOLEAN DEFAULT true;

-- Publications Table
CREATE TABLE IF NOT EXISTS public.church_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES public.churches(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'Other',
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.church_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Publications data isolation" ON public.church_publications FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));
