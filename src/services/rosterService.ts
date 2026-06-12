import { supabase } from '../lib/supabase';

export interface Assignment {
  id: string;
  staffId: string;
  role: string;
  color?: string;
}

export interface RosterRecord {
  id: string;
  church_id: string;
  date: string; // YYYY-MM-DD
  staff_id: string;
  role: string;
  color?: string;
  created_at: string;
}

export const rosterService = {
  async getRosterByMonth(churchId: string, monthStr: string) {
    // monthStr: YYYY-MM
    const startDate = `${monthStr}-01`;
    const [y, m] = monthStr.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // actual last day of month
    const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('rosters')
      .select('*')
      .eq('church_id', churchId)
      .gte('date', startDate)
      .lte('date', endDate);
    
    if (error) {
       // Table might not exist yet, return empty
       console.warn('Roster fetch error:', error);
       return [];
    }
    return data as RosterRecord[];
  },

  async saveAssignments(churchId: string, date: string, assignments: Omit<Assignment, 'id'>[]) {
    // Delete existing for that day first
    const { error: deleteError } = await supabase
      .from('rosters')
      .delete()
      .eq('church_id', churchId)
      .eq('date', date);

    if (deleteError) {
      console.error('Roster delete error:', deleteError);
      throw deleteError;
    }

    if (assignments.length === 0) return;

    const toInsert = assignments.map(a => ({
      church_id: churchId,
      date,
      staff_id: a.staffId,
      role: a.role,
      color: a.color
    }));

    console.log('💾 Inserting roster records:', { churchId, date, count: toInsert.length, records: toInsert });

    const { error } = await supabase
      .from('rosters')
      .insert(toInsert);

    if (error) {
      console.error('Roster insert error:', error);
      throw error;
    }
  },

  async getAllRoster(churchId: string) {
    const { data, error } = await supabase
      .from('rosters')
      .select('*, profiles:staff_id(full_name)')
      .eq('church_id', churchId)
      .order('date', { ascending: true });
    
    if (error) return [];
    return data;
  },

  async getUnavailabilities(churchId: string, monthStr: string) {
    const startDate = `${monthStr}-01`;
    const [y, m] = monthStr.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('unavailabilities')
      .select('*')
      .eq('church_id', churchId)
      .gte('date', startDate)
      .lte('date', endDate);
    
    if (error) return [];
    return data;
  },

  async toggleUnavailability(churchId: string, userId: string, date: string, isUnavailable: boolean) {
    if (isUnavailable) {
      const { error } = await supabase
        .from('unavailabilities')
        .insert({ church_id: churchId, user_id: userId, date });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('unavailabilities')
        .delete()
        .eq('church_id', churchId)
        .eq('user_id', userId)
        .eq('date', date);
      if (error) throw error;
    }
  }
};
