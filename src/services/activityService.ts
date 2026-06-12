import { supabase } from '../lib/supabase';

export interface ActivityEntry {
  id: string;
  church_id: string;
  user_id: string | null;
  user_name: string;
  user_role: string;
  action: string;
  target: string;
  type: 'Resource' | 'Roster' | 'Member' | 'System';
  note?: string | null;
  created_at: string;
}

export async function logActivity(params: {
  churchId: string;
  userId?: string;
  userName: string;
  userRole: string;
  action: string;
  target: string;
  type: 'Resource' | 'Roster' | 'Member' | 'System';
  note?: string;
}) {
  try {
    await supabase.from('activity_logs').insert({
      church_id: params.churchId,
      user_id: params.userId || null,
      user_name: params.userName,
      user_role: params.userRole,
      action: params.action,
      target: params.target,
      type: params.type,
      note: params.note || null,
    });
  } catch {
    // Logging must never break the main flow
  }
}

export async function fetchActivities(churchId: string, limit = 50): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('church_id', churchId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as ActivityEntry[];
}
