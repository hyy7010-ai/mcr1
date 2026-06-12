import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Group post comments (replies under each 小组 post)
// ---------------------------------------------------------------------------
export interface GroupComment {
  id: string;
  church_id: string;
  post_id: string;
  author_id?: string | null;
  author_name?: string | null;
  content: string;
  created_at: string;
}

const cKey = (postId: string) => `group_comments_${postId}`;
function lsGetComments(postId: string): GroupComment[] {
  try { return JSON.parse(localStorage.getItem(cKey(postId)) || '[]'); } catch { return []; }
}
function lsSetComments(postId: string, list: GroupComment[]) {
  localStorage.setItem(cKey(postId), JSON.stringify(list));
}

// ---------------------------------------------------------------------------
// Notifications (小铃铛 bell, 请假 leave requests, roster published, messages)
// ---------------------------------------------------------------------------
export interface AppNotification {
  id: string;
  church_id: string;
  recipient_id?: string | null;   // a specific person
  recipient_role?: string | null; // a whole role, e.g. 'Manager'
  sender_id?: string | null;
  sender_name?: string | null;
  type: string;                   // roster | leave | message | general
  title?: string | null;
  body?: string | null;
  link?: string | null;
  read: boolean;
  created_at: string;
}

const nKey = (churchId: string) => `notifications_${churchId}`;
function lsGetNotifs(churchId: string): AppNotification[] {
  try { return JSON.parse(localStorage.getItem(nKey(churchId)) || '[]'); } catch { return []; }
}
function lsSetNotifs(churchId: string, list: AppNotification[]) {
  localStorage.setItem(nKey(churchId), JSON.stringify(list));
}

// A notification is visible to me if it targets me, my role, or everyone.
function visibleToMe(n: AppNotification, profileId?: string, role?: string) {
  if (!n.recipient_id && !n.recipient_role) return true;        // broadcast
  if (n.recipient_id && n.recipient_id === profileId) return true;
  if (n.recipient_role && role && n.recipient_role === role) return true;
  return false;
}

export const socialService = {
  // ----- comments -----
  async getCommentsForPosts(churchId: string, postIds: string[]): Promise<Record<string, GroupComment[]>> {
    if (postIds.length === 0) return {};
    try {
      const { data, error } = await supabase
        .from('group_post_comments')
        .select('*')
        .in('post_id', postIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const grouped: Record<string, GroupComment[]> = {};
      (data || []).forEach((c: any) => {
        (grouped[c.post_id] = grouped[c.post_id] || []).push(c);
      });
      // mirror to localStorage
      postIds.forEach(pid => lsSetComments(pid, grouped[pid] || []));
      return grouped;
    } catch {
      const grouped: Record<string, GroupComment[]> = {};
      postIds.forEach(pid => { grouped[pid] = lsGetComments(pid); });
      return grouped;
    }
  },

  async addComment(c: Omit<GroupComment, 'id' | 'created_at'>): Promise<GroupComment> {
    try {
      const { data, error } = await supabase.from('group_post_comments').insert(c).select().single();
      if (error) throw error;
      lsSetComments(c.post_id, [...lsGetComments(c.post_id), data as GroupComment]);
      return data as GroupComment;
    } catch {
      const nc: GroupComment = { ...c, id: `local_${Date.now()}`, created_at: new Date().toISOString() } as GroupComment;
      lsSetComments(c.post_id, [...lsGetComments(c.post_id), nc]);
      return nc;
    }
  },

  // ----- notifications -----
  async getNotifications(churchId: string, profileId?: string, role?: string): Promise<AppNotification[]> {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('church_id', churchId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      lsSetNotifs(churchId, (data as AppNotification[]) || []);
      return ((data as AppNotification[]) || []).filter(n => visibleToMe(n, profileId, role));
    } catch {
      return lsGetNotifs(churchId).filter(n => visibleToMe(n, profileId, role));
    }
  },

  async addNotification(n: Omit<AppNotification, 'id' | 'created_at' | 'read'> & { read?: boolean }): Promise<void> {
    const payload = { ...n, read: n.read ?? false };
    try {
      const { error } = await supabase.from('notifications').insert(payload);
      if (error) throw error;
    } catch {
      const local: AppNotification = { ...payload, id: `local_${Date.now()}`, created_at: new Date().toISOString() } as AppNotification;
      lsSetNotifs(n.church_id, [local, ...lsGetNotifs(n.church_id)]);
    }
  },

  // Send the same notification to many recipients at once (e.g. roster → all staff).
  async addNotificationToMany(base: Omit<AppNotification, 'id' | 'created_at' | 'read' | 'recipient_id'>, recipientIds: string[]): Promise<void> {
    const rows = recipientIds.map(rid => ({ ...base, recipient_id: rid, read: false }));
    if (rows.length === 0) return;
    try {
      const { error } = await supabase.from('notifications').insert(rows);
      if (error) throw error;
    } catch {
      const existing = lsGetNotifs(base.church_id);
      const locals: AppNotification[] = rows.map((r, i) => ({ ...r, id: `local_${Date.now()}_${i}`, created_at: new Date().toISOString() } as AppNotification));
      lsSetNotifs(base.church_id, [...locals, ...existing]);
    }
  },

  async markRead(id: string, churchId: string): Promise<void> {
    try {
      if (!id.startsWith('local_')) {
        await supabase.from('notifications').update({ read: true }).eq('id', id);
      }
    } catch { /* ignore */ }
    lsSetNotifs(churchId, lsGetNotifs(churchId).map(n => n.id === id ? { ...n, read: true } : n));
  },

  async markAllRead(churchId: string, profileId?: string, role?: string): Promise<void> {
    const all = await this.getNotifications(churchId, profileId, role);
    const ids = all.filter(n => !n.read && !n.id.startsWith('local_')).map(n => n.id);
    try {
      if (ids.length) await supabase.from('notifications').update({ read: true }).in('id', ids);
    } catch { /* ignore */ }
    lsSetNotifs(churchId, lsGetNotifs(churchId).map(n => ({ ...n, read: true })));
  },
};
