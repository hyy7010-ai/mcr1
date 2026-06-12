import { supabase } from '../lib/supabase';

export interface ChurchApplication {
  id?: string;
  church_name: string;
  leader_name: string;
  email: string;
  phone: string;
  address?: string;
  source_link?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  created_at?: string;
}

export const applicationService = {
  async submitApplication(app: Omit<ChurchApplication, 'id' | 'status' | 'created_at'>) {
    const { error } = await supabase
      .from('church_applications')
      .insert([{ ...app, status: 'Pending' }]);

    if (error) {
      console.error('Error submitting application:', error);
      throw new Error(error.message || 'Error submitting application');
    }
  },

  async getApplications() {
    const { data, error } = await supabase
      .from('church_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching applications:', error);
      return [];
    }
    return data || [];
  },

  async updateStatus(id: string, status: 'Approved' | 'Rejected', finalName?: string) {
    const updateData: any = { status };
    if (finalName) updateData.church_name = finalName;
    
    const { error } = await supabase
      .from('church_applications')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
  }
};
