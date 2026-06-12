import { supabase } from '../lib/supabase';

export interface Church {
  id: string;
  name: string;
  code: string;
  domain?: string;
  roster_roles?: string[];
  created_at: string;
  member_count?: number; // 虚拟字段，通过查询聚合
}

export const churchService = {
  async getAllChurches() {
    // 获取教会列表，并尝试统计成员数量
    const { data: churches, error } = await supabase
      .from('churches')
      .select(`
        *,
        church_members(count)
      `);
    
    if (error) throw error;

    return churches.map(c => ({
      ...c,
      member_count: c.church_members?.[0]?.count || 0
    })) as Church[];
  },

  async updateChurch(id: string, updates: Partial<Church>) {
    const { data, error } = await supabase
      .from('churches')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async createChurch(name: string, code: string, extra?: { address?: string; phone?: string; website?: string }) {
    // Only insert columns that exist in the churches table (address/phone/website may not exist)
    const { data, error } = await supabase
      .from('churches')
      .insert([{
        name,
        code,
        domain: code.toLowerCase() + '.gracesystem.org',
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getChurchByDomain(domain: string) {
    const { data, error } = await supabase
      .from('churches')
      .select('*')
      .eq('domain', domain)
      .maybeSingle();
    
    if (error) throw error;
    return data;
  }
};
