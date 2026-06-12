-- 1. Create Churches Table (Tenants)
CREATE TABLE IF NOT EXISTS public.churches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    domain TEXT UNIQUE, -- For future domain masking
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Churches
ALTER TABLE public.churches ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own church information
CREATE POLICY "Users can view their own church" ON public.churches
    FOR SELECT USING (
        id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
    );

-- Allow church Managers to update their church info (code, name)
CREATE POLICY "Managers can update their church" ON public.churches
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'Manager' 
            AND profiles.church_id = public.churches.id
        )
    );

-- Allow Super Admins to manage all churches
CREATE POLICY "SuperAdmins can manage all churches" ON public.churches
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role IN ('Super Admin', 'SuperAdmin')
        )
    );

-- 2. Create Profiles Table (Users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    church_id UUID REFERENCES public.churches(id),
    full_name TEXT,
    role TEXT DEFAULT 'Member', -- Super Admin, Admin, Leader, Member
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profiles in their church" ON public.profiles
    FOR SELECT USING (
        church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- 3. Create Members Table (Per Church)
CREATE TABLE IF NOT EXISTS public.church_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID REFERENCES public.churches(id) NOT NULL,
    name TEXT NOT NULL,
    initials TEXT,
    role TEXT[],
    joined TEXT,
    family TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    age INTEGER,
    dob DATE,
    occupation TEXT,
    status TEXT, -- Pastor, Leader, Member, New Friend
    referral_source TEXT,
    friends_with UUID[], -- Array of IDs
    skills TEXT[],
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Church Members
ALTER TABLE public.church_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Church members data isolation" ON public.church_members
    FOR ALL USING (
        church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
    );

-- 4. Create Member Relationships (Links)
CREATE TABLE IF NOT EXISTS public.member_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_id UUID REFERENCES public.churches(id) NOT NULL,
    source_id UUID REFERENCES public.church_members(id) ON DELETE CASCADE,
    target_id UUID REFERENCES public.church_members(id) ON DELETE CASCADE,
    type TEXT, -- Mentor, Family, Team Member, Invited, Friend
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Member Links
ALTER TABLE public.member_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member links data isolation" ON public.member_links
    FOR ALL USING (
        church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
    );

-- 5. FUNCTION: Handle new user registration
-- This function will be triggered when a user signs up via Auth and creates a profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    target_church_id UUID;
    church_name TEXT;
BEGIN
    -- Find church by code (passed in metadata)
    SELECT id INTO target_church_id FROM public.churches WHERE code = NEW.raw_user_meta_data->>'church_code';
    
    -- If church doesn't exist, create a default one or handle error
    IF target_church_id IS NULL THEN
        -- Optionally create a new church if we want self-service onboarding
        -- INSERT INTO public.churches (name, code) VALUES ('New Church', NEW.raw_user_meta_data->>'church_code') RETURNING id INTO target_church_id;
        
        -- For now, we assume church must exist or we map to a 'PENDING' church if needed
        -- Or just fallback to a default ID for 'tester' church if specified
    END IF;

    INSERT INTO public.profiles (id, church_id, full_name, role)
    VALUES (
        NEW.id,
        target_church_id,
        NEW.raw_user_meta_data->>'full_name',
        'Pending'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function on auth.users insert
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Create Church Applications Table
CREATE TABLE IF NOT EXISTS public.church_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    church_name TEXT NOT NULL,
    leader_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    source_link TEXT,
    status TEXT DEFAULT 'Pending', -- Pending, Approved, Rejected
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on Church Applications
ALTER TABLE public.church_applications ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert an application
CREATE POLICY "Anyone can submit an application" ON public.church_applications
    FOR INSERT WITH CHECK (true);

-- Allow authenticated users to view/manage applications
CREATE POLICY "Authenticated users can manage applications" ON public.church_applications
    FOR ALL USING (auth.uid() IS NOT NULL);


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
CREATE POLICY "Church events isolation" ON public.church_events FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

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
CREATE POLICY "Attendance data isolation" ON public.attendance_records FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

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
CREATE POLICY "Church tasks isolation" ON public.church_tasks FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

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
CREATE POLICY "Church groups isolation" ON public.church_groups FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

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
CREATE POLICY "Group posts isolation" ON public.group_posts FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));

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
CREATE POLICY "Publications data isolation" ON public.church_publications FOR ALL USING (church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()));
