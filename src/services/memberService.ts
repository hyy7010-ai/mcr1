import { supabase } from '../lib/supabase';

export interface Member {
  id: string;
  church_id: string;
  name: string;
  initials: string;
  role: string[];
  joined: string;
  family: string;
  phone?: string;
  email?: string;
  address?: string;
  age?: number;
  dob?: string;
  occupation?: string;
  jobTitle?: string;
  origin?: string;
  yearsInAus?: string;
  christianYears?: string;
  status: 'Pastor' | 'Leader' | 'Member' | 'New Friend' | 'Pending';
  referral_source?: string;
  friends_with?: string[];
  skills?: string[];
  avatar_url?: string;
  churchMemberId?: string | null;
}

export interface MemberLink {
  id: string;
  church_id: string;
  source_id: string;
  target_id: string;
  type: 'Mentor' | 'Family' | 'Team Member' | 'Invited' | 'Friend';
}

// ─── localStorage helpers ──────────────────────────────────────────────────────
const membersKey  = (churchId: string) => `church_members_${churchId}`;
const linksKey    = (churchId: string) => `member_links_${churchId}`;

function lsGetMembers(churchId: string): Member[] {
  try { return JSON.parse(localStorage.getItem(membersKey(churchId)) || '[]'); } catch { return []; }
}
function lsSaveMembers(churchId: string, members: Member[]) {
  localStorage.setItem(membersKey(churchId), JSON.stringify(members));
}
function lsGetLinks(churchId: string): MemberLink[] {
  try { return JSON.parse(localStorage.getItem(linksKey(churchId)) || '[]'); } catch { return []; }
}
function lsSaveLinks(churchId: string, links: MemberLink[]) {
  localStorage.setItem(linksKey(churchId), JSON.stringify(links));
}

// ─── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// ─── Service ───────────────────────────────────────────────────────────────────
export const memberService = {
  async getMembers(churchId: string): Promise<Member[]> {
    try {
      const { data, error } = await withTimeout(
        supabase.from('church_members').select('*').eq('church_id', churchId)
      );
      if (error) throw error;
      const dbData = (data as Member[]) || [];
      if (dbData.length > 0) {
        lsSaveMembers(churchId, dbData);
        return dbData;
      }
      // DB returned empty — merge with any locally-saved members
      const local = lsGetMembers(churchId);
      return local;
    } catch {
      return lsGetMembers(churchId);
    }
  },

  async getMemberLinks(churchId: string): Promise<MemberLink[]> {
    try {
      const { data, error } = await withTimeout(
        supabase.from('member_links').select('*').eq('church_id', churchId)
      );
      if (error) throw error;
      const dbLinks = (data as MemberLink[]) || [];
      // DB is the single source of truth — mirror it to localStorage (this also clears any
      // stale local-only links so old accidental relationships don't keep reappearing).
      lsSaveLinks(churchId, dbLinks);
      return dbLinks;
    } catch {
      // IMPORTANT: do NOT fall back to localStorage here. Stale local links (from old
      // accidental drags) were reappearing whenever the DB read timed out. Better to show
      // no lines than phantom ones — the next successful read restores the real links.
      lsSaveLinks(churchId, []);
      return [];
    }
  },

  async addMember(member: Omit<Member, 'id'>): Promise<Member> {
    try {
      const { data, error } = await withTimeout(
        supabase.from('church_members').insert(member).select().single(),
        12000
      );
      if (error) throw error;
      // Mirror to localStorage
      const existing = lsGetMembers(member.church_id);
      lsSaveMembers(member.church_id, [...existing, data as Member]);
      return data as Member;
    } catch {
      // Create locally
      const newMember: Member = { ...member, id: `local_${Date.now()}` };
      const existing = lsGetMembers(member.church_id);
      lsSaveMembers(member.church_id, [...existing, newMember]);
      return newMember;
    }
  },

  async updateMember(id: string, updates: Partial<Member>): Promise<Member> {
    try {
      const { data, error } = await withTimeout(
        supabase.from('church_members').update(updates).eq('id', id).select().single()
      );
      if (error) throw error;
      // Mirror to localStorage
      const churchId = (data as Member).church_id;
      const existing = lsGetMembers(churchId);
      lsSaveMembers(churchId, existing.map(m => m.id === id ? { ...m, ...data } : m));
      return data as Member;
    } catch {
      // Update locally — need churchId from existing local data
      let updated: Member | null = null;
      // Try to find any church in localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('church_members_')) {
          const churchId = key.replace('church_members_', '');
          const members = lsGetMembers(churchId);
          const idx = members.findIndex(m => m.id === id);
          if (idx !== -1) {
            members[idx] = { ...members[idx], ...updates };
            lsSaveMembers(churchId, members);
            updated = members[idx];
            break;
          }
        }
      }
      if (!updated) throw new Error('Member not found');
      return updated;
    }
  },

  async deleteMember(id: string): Promise<void> {
    try {
      const { error } = await withTimeout(
        supabase.from('church_members').delete().eq('id', id)
      );
      if (error) throw error;
    } catch {
      // Delete locally
    }
    // Always delete from localStorage too
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('church_members_')) {
        const churchId = key.replace('church_members_', '');
        const members = lsGetMembers(churchId);
        lsSaveMembers(churchId, members.filter(m => m.id !== id));
      }
    }
  },

  async upsertMemberLink(link: Omit<MemberLink, 'id'>): Promise<MemberLink> {
    try {
      const { data, error } = await withTimeout(
        supabase.from('member_links').upsert(link).select().single()
      );
      if (error) throw error;
      const existing = lsGetLinks(link.church_id);
      lsSaveLinks(link.church_id, [...existing.filter(l => l.source_id !== link.source_id || l.target_id !== link.target_id), data as MemberLink]);
      return data as MemberLink;
    } catch {
      const newLink: MemberLink = { ...link, id: `local_link_${Date.now()}` };
      const existing = lsGetLinks(link.church_id);
      lsSaveLinks(link.church_id, [...existing.filter(l => l.source_id !== link.source_id || l.target_id !== link.target_id), newLink]);
      return newLink;
    }
  },

  async deleteMemberLink(id: string, churchId: string): Promise<void> {
    try {
      await withTimeout(supabase.from('member_links').delete().eq('id', id));
    } catch {}
    const existing = lsGetLinks(churchId);
    lsSaveLinks(churchId, existing.filter(l => l.id !== id));
  },
};
