# Supabase 链接与数据库配置手册 (Step-by-Step)

要让你的 **GraceSystem** 正式运行，你需要按照以下步骤配置 Supabase 云端服务。

---

## 第一步：创建 Supabase 项目
1. 访问 [supabase.com](https://supabase.com/) 并登录。
2. 点击 **"New Project"**。
3. 输入项目名称（例如 `GraceSystem`），设置数据库密码。
4. 选择离你最近的区域（例如 `Singapore`）。
5. 等待项目初始化完成。

---

## 第二步：配置环境变量 (API Keys)
1. 在 Supabase 左侧菜单点击 **Project Settings** (齿轮图标) -> **API**。
2. 找到以下两个值：
   - **Project URL** (示例: `https://xxxx.supabase.co`)
   - **anon public** (示例: `eyJhbGci...`)
3. **在 AI Studio 中配置：**
   - 点击 AI Studio 右上角的 **Settings** (齿轮图标)。
   - 在 **Secrets** 栏目下，添加以下两个变量：
     - `VITE_SUPABASE_URL` = 填入你的 Project URL
     - `VITE_SUPABASE_ANON_KEY` = 填入你的 anon key
   - 保存并刷新页面。

---

## 第三步：初始化数据库 (关键步骤)
Supabase 提供了一个 **SQL Editor**。你需要将下面的代码复制并运行，以创建之前报错中提到的 `churches` 及其它必要的表。

1. 在 Supabase 左侧菜单点击 **SQL Editor**。
2. 点击 **"New Query"**。
3. 复制以下 SQL 代码并点击 **Run**：

```sql
-- 1. 创建教会表 (Churches)
CREATE TABLE churches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  domain TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 创建用户 Profile 表
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT DEFAULT 'Member', -- 'Member', 'Leader', 'Super Admin'
  church_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 创建成员关联表 (用于统计人数)
CREATE TABLE church_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id UUID REFERENCES churches(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(church_id, profile_id)
);

-- 4. 开启 RLS 安全策略 (Row Level Security)
ALTER TABLE churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_members ENABLE ROW LEVEL SECURITY;

-- 5. 创建简单策略
CREATE POLICY "Public Read Churches" ON churches FOR SELECT USING (true);
CREATE POLICY "Allow anyone to insert a church" ON churches FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can manage their own profiles" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Public Read Memberships" ON church_members FOR SELECT USING (true);
CREATE POLICY "Super Admins can manage all churches" ON churches FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Super Admin')
);

-- 6. 自动同步逻辑：当新用户注册时，自动在 profiles 表创建记录
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    target_church_id UUID;
BEGIN
  -- 插入 Profile
  INSERT INTO public.profiles (id, full_name, church_code, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'church_code',
    CASE WHEN new.raw_user_meta_data->>'is_leader_onboarding' = 'true' THEN 'Leader' ELSE 'Member' END
  );

  -- 如果有 church_code，尝试关联到 church_members 表 (用于统计人数)
  IF (new.raw_user_meta_data->>'church_code' IS NOT NULL) THEN
    SELECT id INTO target_church_id FROM churches WHERE code = (new.raw_user_meta_data->>'church_code') LIMIT 1;
    IF target_church_id IS NOT NULL THEN
      INSERT INTO public.church_members (church_id, profile_id)
      VALUES (target_church_id, new.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

---

## 第四步：测试运行
配置完成后，回到你的应用页面，点击 **"Signup"** -> **"Setup System"** (开通系统)。
1. 填入教会名称和你的信息。
2. 点击 **"Initialize System"**。
3. 如果一切正常，你会看到系统初始化成功的提示，并且在 Supabase 的 **Table Editor** 中能看到新增加的数据！

---

## 第五步：配置存储空间 (Storage) - 用于上传 Logo 和图片
如果你的应用需要上传 Logo 或照片，你需要手动创建一个公共存储桶。
1. 在 Supabase 左侧菜单点击 **Storage** (盒子图标)。
2. 点击 **"New Bucket"**。
3. 输入 Bucket 名称: `public` (这是最通用的名称)。
4. **务必勾选 "Public bucket"** (任何人都可以查看上传后的图片链接)。
5. 点击 **Save**。
6. **重要：配置权限（RLS Policies）**
   - 进入你刚创建的 `public` bucket。
   - 点击 **Policies** 标签页。
   - 点击 **"New Policy"**。
   - 选择 **"For full customization"**。
   - 在 **Allowed operations** 中勾选 **SELECT**, **INSERT**, **UPDATE**。
   - 在 **Target roles** 中保持 `authenticated` (只有登录用户能上传) 或如果要方便测试可以设为 `anon`。
   - 点击 **Review** -> **Save**。
   - 现在你的图片上传功能就可以正式使用了！

---

## 常见问题
- **报错 "churches not found":** 请确保你已经在 SQL Editor 中运行了上面的代码。
- **无法上传图片 (Upload failed):** 请确保你已经按照第五步创建了名为 `public` 的 **Public Bucket**，并且配置了权限。
- **无法登录:** 确保你在 Supabase 的 **Authentication** -> **Providers** 中开启了 **Email**（默认是开启的）。
