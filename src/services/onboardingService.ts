import { supabase } from '../lib/supabase';

export interface OnboardingData {
  churchName: string;
  location: string;
  subdomain?: string;
  leaderName: string;
  leaderRole: string;
  email: string;
  password: string;
}

export const onboardingService = {
  async registerChurch(data: OnboardingData) {
    // 1. 生成唯一的 Church Code (例如: GRACE-2024-XXXX)
    const shortName = data.churchName.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const churchCode = `${shortName}-${new Date().getFullYear()}-${randomSuffix}`;
    const staffCode = `STAFF-${randomSuffix}`;

    // 2. 先在数据库创建教会
    const { data: church, error: churchError } = await supabase
      .from('churches')
      .insert({
        name: data.churchName,
        code: churchCode,
        domain: data.subdomain ? `${data.subdomain}.mcr.fliptus.com` : null
      })
      .select()
      .single();

    if (churchError) throw churchError;

    // 3. 注册管理员账号
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: data.leaderName,
          church_code: churchCode,
          is_leader_onboarding: true // 标记这是在开通教会
        }
      }
    });

    if (authError) throw authError;

    // 4. 注意：Profile 的创建通常由数据库 Trigger 处理
    // 但我们可以返回这些 Code 给用户看
    return {
      churchCode,
      staffCode,
      church,
      user: authData.user
    };
  }
};
