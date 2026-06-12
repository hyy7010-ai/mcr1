import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { logActivity } from '../services/activityService';
import { socialService, GroupComment } from '../services/socialService';
import { tr } from '../lib/uiText';

interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  memberCount?: number;
  leader_name?: string;
  leader_contact?: string;
  meeting_time?: string;
  meeting_address?: string;
  image_url?: string;
  leader_id?: string;
}

interface Post {
  id: string;
  group_id: string;
  type: 'text' | 'link' | 'photo';
  content: string;
  url?: string;
  image_url?: string;
  author_name: string;
  author_id?: string;
  created_at: string;
}

interface GroupMember {
  id: string;
  profile_id: string;
  group_id: string;
  full_name: string;
  role: string;
  avatar_url?: string;
}

const GROUP_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#DB2777', '#374151',
];

const emptyGroupDraft = () => ({
  name: '', description: '', color: GROUP_COLORS[0],
  leader_name: '', leader_contact: '', meeting_time: '', meeting_address: '', image_url: '',
});

export default function Groups() {
  const { isZh, language } = useLanguage();
  const { mode } = useMode();
  const { profile, church } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const isManager = mode === 'Manager';
  // Managers can edit any group; a group's leader can edit their own group (intro/avatar/details).
  const canEditGroup = (g?: Group | null) => isManager || (!!g && !!profile?.id && g.leader_id === profile.id);

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Record<string, GroupComment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentPosting, setCommentPosting] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  const [myGroupId, setMyGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);

  // Group management
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupDraft, setGroupDraft] = useState(emptyGroupDraft());

  // Post creation
  const [isPosting, setIsPosting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postDraft, setPostDraft] = useState({ type: 'text' as 'text' | 'link' | 'photo', content: '', url: '', image_url: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  // Member assignment modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningGroupId, setAssigningGroupId] = useState<string | null>(null);
  const [assignSearch, setAssignSearch] = useState('');

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeChurchId) return;
    setLoading(true);

    const loadAll = async () => {
      // Load groups
      const { data: groupsData } = await supabase
        .from('church_groups')
        .select('*')
        .eq('church_id', activeChurchId)
        .order('created_at', { ascending: true });

      // Load group memberships
      const { data: membershipsData } = await supabase
        .from('church_group_members')
        .select('id, profile_id, group_id')
        .eq('church_id', activeChurchId);

      // Load all church profiles (for manager assignment)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, role, avatar_url')
        .eq('church_id', activeChurchId)
        .neq('role', 'Pending');

      const memberships = membershipsData || [];
      const profiles = profilesData || [];

      // Find my group
      const myMembership = memberships.find((m: any) => m.profile_id === profile?.id);
      setMyGroupId(myMembership?.group_id || null);

      // Attach member counts to groups
      const enriched = (groupsData || []).map((g: any) => ({
        ...g,
        memberCount: memberships.filter((m: any) => m.group_id === g.id).length,
      }));
      setGroups(enriched);

      // Build group member list with names
      const enrichedMembers: GroupMember[] = memberships.map((m: any) => {
        const p = profiles.find((pr: any) => pr.id === m.profile_id);
        return { id: m.id, profile_id: m.profile_id, group_id: m.group_id, full_name: p?.full_name || '?', role: p?.role || '', avatar_url: p?.avatar_url || '' };
      });
      setGroupMembers(enrichedMembers);
      setAllProfiles(profiles);

      // Auto-select group
      if (!isManager && myMembership?.group_id) {
        const myGroup = (groupsData || []).find((g: any) => g.id === myMembership.group_id);
        if (myGroup) setSelectedGroup(myGroup);
      }

      setLoading(false);
    };

    loadAll();
  }, [activeChurchId, profile?.id, isManager]);

  // ── Load posts ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedGroup || !activeChurchId) { setPosts([]); return; }
    setPostsLoading(true);
    supabase
      .from('group_posts')
      .select('*')
      .eq('group_id', selectedGroup.id)
      .eq('church_id', activeChurchId)
      .order('created_at', { ascending: false })
      .then(async ({ data }) => {
        const loaded = (data || []) as Post[];
        setPosts(loaded);
        setPostsLoading(false);
        // Load replies for these posts
        if (loaded.length > 0 && activeChurchId) {
          const grouped = await socialService.getCommentsForPosts(activeChurchId, loaded.map(p => p.id));
          setComments(grouped);
        } else {
          setComments({});
        }
      });
  }, [selectedGroup?.id, activeChurchId]);

  // ── Visible groups: members only see their own group ──────────────────────
  const visibleGroups = isManager
    ? groups
    : groups.filter(g => g.id === myGroupId);

  // ── Group CRUD ────────────────────────────────────────────────────────────
  const handleCreateGroup = async () => {
    if (!groupDraft.name.trim() || !activeChurchId) return;
    const { data, error } = await supabase
      .from('church_groups')
      .insert({
        church_id: activeChurchId,
        name: groupDraft.name.trim(),
        description: groupDraft.description.trim(),
        color: groupDraft.color,
        leader_name: groupDraft.leader_name.trim() || null,
        leader_contact: groupDraft.leader_contact.trim() || null,
        meeting_time: groupDraft.meeting_time.trim() || null,
        meeting_address: groupDraft.meeting_address.trim() || null,
        image_url: groupDraft.image_url || null,
      })
      .select().single();
    if (!error && data) {
      setGroups(prev => [...prev, { ...data, memberCount: 0 }]);
      setGroupDraft(emptyGroupDraft());
      setIsCreatingGroup(false);
      logActivity({ churchId: activeChurchId!, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: 'Created group', target: groupDraft.name, type: 'System' });
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup || !groupDraft.name.trim()) return;
    const { data, error } = await supabase
      .from('church_groups')
      .update({
        name: groupDraft.name,
        description: groupDraft.description,
        color: groupDraft.color,
        leader_name: groupDraft.leader_name.trim() || null,
        leader_contact: groupDraft.leader_contact.trim() || null,
        meeting_time: groupDraft.meeting_time.trim() || null,
        meeting_address: groupDraft.meeting_address.trim() || null,
        image_url: groupDraft.image_url || null,
      })
      .eq('id', editingGroup.id).select().single();
    if (!error && data) {
      setGroups(prev => prev.map(g => g.id === editingGroup.id ? { ...data, memberCount: g.memberCount } : g));
      if (selectedGroup?.id === editingGroup.id) setSelectedGroup({ ...data, memberCount: selectedGroup.memberCount });
    }
    setEditingGroup(null);
    setGroupDraft(emptyGroupDraft());
  };

  const handleDeleteGroup = async (id: string) => {
    if (!window.confirm(tr('Delete this group?', language))) return;
    const deletedGroup = groups.find(g => g.id === id);
    await supabase.from('church_groups').delete().eq('id', id);
    setGroups(prev => prev.filter(g => g.id !== id));
    if (selectedGroup?.id === id) setSelectedGroup(null);
    logActivity({ churchId: activeChurchId!, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: 'Deleted group', target: deletedGroup?.name || id, type: 'System' });
  };

  // ── Member assignment ─────────────────────────────────────────────────────
  const assignMemberToGroup = async (profileId: string, groupId: string | null) => {
    if (!activeChurchId) return;
    // Remove from any existing group first
    await supabase.from('church_group_members').delete().eq('profile_id', profileId).eq('church_id', activeChurchId);
    setGroupMembers(prev => prev.filter(m => m.profile_id !== profileId));

    if (groupId) {
      const profile_obj = allProfiles.find(p => p.id === profileId);
      const targetGroup = groups.find(g => g.id === groupId);
      const { data } = await supabase
        .from('church_group_members')
        .insert({ church_id: activeChurchId, group_id: groupId, profile_id: profileId })
        .select().single();
      if (data) {
        setGroupMembers(prev => [...prev, { id: data.id, profile_id: profileId, group_id: groupId, full_name: profile_obj?.full_name || '?', role: profile_obj?.role || '' }]);
        logActivity({ churchId: activeChurchId!, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: `Added ${profile_obj?.full_name || '?'} to group`, target: targetGroup?.name || groupId, type: 'Member' });
      }
    } else {
      const removedProfile = allProfiles.find(p => p.id === profileId);
      const removedFrom = groupMembers.find(m => m.profile_id === profileId);
      const fromGroup = groups.find(g => g.id === removedFrom?.group_id);
      if (removedProfile && fromGroup) {
        logActivity({ churchId: activeChurchId!, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: `Removed ${removedProfile.full_name} from group`, target: fromGroup.name, type: 'Member' });
      }
    }
    // Update counts
    setGroups(prev => prev.map(g => ({
      ...g,
      memberCount: groupMembers.filter(m => m.group_id === g.id && m.profile_id !== profileId).length + (g.id === groupId ? 1 : 0),
    })));
  };

  // ── Assign a group's leader (managers only) ─────────────────────────────────
  const setGroupLeader = async (groupId: string, leaderId: string | null) => {
    await supabase.from('church_groups').update({ leader_id: leaderId }).eq('id', groupId);
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, leader_id: leaderId || undefined } : g));
    setSelectedGroup(s => (s && s.id === groupId) ? { ...s, leader_id: leaderId || undefined } : s);
  };

  // ── Post CRUD ─────────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (posting) return; // prevent duplicate posts from rapid clicks
    if (!selectedGroup || !activeChurchId) return;
    if (postDraft.type === 'text' && !postDraft.content.trim()) return;
    if (postDraft.type === 'link' && !postDraft.url.trim()) return;
    if (postDraft.type === 'photo' && !postDraft.image_url) return;

    setPosting(true);
    try {
      const { data, error } = await supabase.from('group_posts').insert({
        church_id: activeChurchId,
        group_id: selectedGroup.id,
        type: postDraft.type,
        content: postDraft.content.trim(),
        url: postDraft.url.trim() || null,
        image_url: postDraft.image_url || null,
        author_name: profile?.full_name || (tr('Anonymous', language)),
        author_id: profile?.id || null,
      }).select().single();

      if (!error && data) {
        setPosts(prev => [data as Post, ...prev]);
        setPostDraft({ type: 'text', content: '', url: '', image_url: '' });
        setIsPosting(false);
      }
    } finally {
      setPosting(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    await supabase.from('group_posts').delete().eq('id', postId);
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  const toggleCommentBox = (postId: string) => {
    setOpenComments(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  };

  const handleAddComment = async (post: Post) => {
    const text = (commentDrafts[post.id] || '').trim();
    if (!text || !activeChurchId || commentPosting) return;
    setCommentPosting(post.id);
    try {
      const saved = await socialService.addComment({
        church_id: activeChurchId,
        post_id: post.id,
        author_id: profile?.id || null,
        author_name: profile?.full_name || tr('Anonymous', language),
        content: text,
      });
      setComments(prev => ({ ...prev, [post.id]: [...(prev[post.id] || []), saved] }));
      setCommentDrafts(prev => ({ ...prev, [post.id]: '' }));
      // Notify the post author that someone replied (unless replying to self)
      if (post.author_id && post.author_id !== profile?.id) {
        socialService.addNotification({
          church_id: activeChurchId,
          recipient_id: post.author_id,
          sender_id: profile?.id || null,
          sender_name: profile?.full_name || tr('Anonymous', language),
          type: 'message',
          title: tr('New reply to your post', language),
          body: text.slice(0, 120),
          link: '/app/groups',
        }).catch(() => {});
      }
    } finally {
      setCommentPosting(null);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const maxW = 800;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPostDraft(prev => ({ ...prev, image_url: canvas.toDataURL('image/jpeg', 0.8), type: 'photo' }));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Group avatar: compress to a small square data URL
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const handleGroupAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx?.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        setGroupDraft(prev => ({ ...prev, image_url: canvas.toDataURL('image/jpeg', 0.8) }));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(tr('en-AU', language), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-[#F7F6F3] overflow-hidden">

      {/* ── Left sidebar ── */}
      <div className="w-72 flex-shrink-0 bg-white border-r border-outline-variant/10 flex flex-col shadow-sm">
        <div className="p-6 border-b border-outline-variant/10">
          <h2 className="font-serif text-2xl font-black text-on-surface">{tr('Groups', language)}</h2>
          <p className="text-[10px] font-black uppercase tracking-widest text-outline mt-0.5">
            {isManager ? (tr('Manager · All Groups', language)) : (tr('My Group', language))}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="py-16 text-center">
              <span className="material-symbols-outlined text-3xl text-outline/30 animate-spin block mb-2">progress_activity</span>
            </div>
          )}

          {!loading && visibleGroups.length === 0 && (
            <div className="py-16 text-center px-4">
              <span className="material-symbols-outlined text-5xl text-outline/20 mb-3 block">group</span>
              <p className="text-sm text-outline/50 font-medium">
                {isManager ? (tr('No groups yet', language)) : (tr('Not in a group yet', language))}
              </p>
              {!isManager && <p className="text-xs text-outline/30 mt-1">{tr('Ask your manager to add you to a group', language)}</p>}
            </div>
          )}

          {visibleGroups.map(g => (
            <div key={g.id} onClick={() => setSelectedGroup(g)}
              className={`group relative w-full rounded-2xl p-4 cursor-pointer transition-all flex items-center gap-3 ${
                selectedGroup?.id === g.id ? 'text-white shadow-lg' : 'hover:bg-surface-container-low text-on-surface'
              }`}
              style={selectedGroup?.id === g.id ? { background: g.color } : {}}>
              <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-black text-lg overflow-hidden"
                style={{ background: g.image_url ? 'transparent' : (selectedGroup?.id === g.id ? 'rgba(255,255,255,0.2)' : g.color) }}>
                {g.image_url ? <img src={g.image_url} alt="" className="w-full h-full object-cover" /> : g.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{g.name}</p>
                <p className={`text-[10px] mt-0.5 ${selectedGroup?.id === g.id ? 'text-white/70' : 'text-outline'}`}>
                  {g.memberCount || 0} {tr('members', language)}
                </p>
              </div>

              {(isManager || canEditGroup(g)) && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isManager && (
                    <button onClick={e => { e.stopPropagation(); setAssigningGroupId(g.id); setShowAssignModal(true); }}
                      title={tr('Assign members', language)}
                      className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors">
                      <span className="material-symbols-outlined text-[13px]">person_add</span>
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); setEditingGroup(g); setGroupDraft({ name: g.name, description: g.description, color: g.color, leader_name: g.leader_name || '', leader_contact: g.leader_contact || '', meeting_time: g.meeting_time || '', meeting_address: g.meeting_address || '', image_url: g.image_url || '' }); }}
                    title={isZh ? '编辑小组' : 'Edit group'}
                    className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors">
                    <span className="material-symbols-outlined text-[13px]">edit</span>
                  </button>
                  {isManager && (
                    <button onClick={e => { e.stopPropagation(); handleDeleteGroup(g.id); }}
                      className="w-7 h-7 rounded-lg bg-error/10 hover:bg-error text-error hover:text-white flex items-center justify-center transition-all">
                      <span className="material-symbols-outlined text-[13px]">delete</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {isManager && (
          <div className="p-4 border-t border-outline-variant/10">
            <button onClick={() => { setIsCreatingGroup(true); setEditingGroup(null); setGroupDraft(emptyGroupDraft()); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-primary/30 text-primary hover:bg-primary hover:text-white hover:border-primary transition-all font-black text-[11px] uppercase tracking-widest">
              <span className="material-symbols-outlined text-sm">add</span>
              {tr('New Group', language)}
            </button>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!selectedGroup ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center p-12">
            <div className="w-24 h-24 rounded-[32px] bg-surface-container flex items-center justify-center">
              <span className="material-symbols-outlined text-5xl text-outline/30">group</span>
            </div>
            <div>
              <h3 className="font-serif text-2xl font-black text-on-surface/40">
                {isManager
                  ? (visibleGroups.length === 0 ? (tr('Create a group first', language)) : (tr('Select a group', language)))
                  : (tr('Not in a group yet', language))}
              </h3>
              <p className="text-sm text-outline mt-2">
                {isManager
                  ? (tr('Create groups and use 👤 to assign members', language))
                  : (tr('Ask your manager to add you to a group', language))}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Group header */}
            <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-outline-variant/10 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-lg overflow-hidden" style={{ background: selectedGroup.image_url ? 'transparent' : selectedGroup.color }}>
                  {selectedGroup.image_url ? <img src={selectedGroup.image_url} alt="" className="w-full h-full object-cover" /> : selectedGroup.name.charAt(0)}
                </div>
                <div>
                  <h2 className="font-serif text-xl font-black text-on-surface">{selectedGroup.name}</h2>
                  <div className="flex items-center gap-3">
                    {selectedGroup.description && <p className="text-xs text-outline">{selectedGroup.description}</p>}
                    <p className="text-xs text-outline">
                      {groupMembers.filter(m => m.group_id === selectedGroup.id).length} {tr('members', language)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isManager && (
                  <select
                    value={selectedGroup.leader_id || ''}
                    onChange={(e) => setGroupLeader(selectedGroup.id, e.target.value || null)}
                    title={isZh ? '设置组长' : 'Set group leader'}
                    className="px-3 py-2.5 rounded-2xl border border-outline-variant/30 text-[11px] font-bold bg-white outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="">{isZh ? '— 选组长 —' : '— Leader —'}</option>
                    {allProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                  </select>
                )}
                {isManager && (
                  <button onClick={() => { setAssigningGroupId(selectedGroup.id); setShowAssignModal(true); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-outline-variant/30 text-outline font-black text-[11px] uppercase tracking-widest hover:bg-surface-container transition-all">
                    <span className="material-symbols-outlined text-sm">person_add</span>
                    {tr('Assign', language)}
                  </button>
                )}
                {canEditGroup(selectedGroup) && (
                  <button onClick={() => { setEditingGroup(selectedGroup); setGroupDraft({ name: selectedGroup.name, description: selectedGroup.description, color: selectedGroup.color, leader_name: selectedGroup.leader_name || '', leader_contact: selectedGroup.leader_contact || '', meeting_time: selectedGroup.meeting_time || '', meeting_address: selectedGroup.meeting_address || '', image_url: selectedGroup.image_url || '' }); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-outline-variant/30 text-outline font-black text-[11px] uppercase tracking-widest hover:bg-surface-container transition-all">
                    <span className="material-symbols-outlined text-sm">edit</span>
                    {isZh ? '编辑' : 'Edit'}
                  </button>
                )}
                <button onClick={() => setIsPosting(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-white font-black text-[11px] uppercase tracking-widest shadow-lg transition-all hover:opacity-90 active:scale-95"
                  style={{ background: selectedGroup.color }}>
                  <span className="material-symbols-outlined text-sm">add_circle</span>
                  {tr('Share', language)}
                </button>
              </div>
            </div>

            {/* Group info: leader, contact, meeting time & place */}
            {(selectedGroup.leader_name || selectedGroup.leader_contact || selectedGroup.meeting_time || selectedGroup.meeting_address) && (
              <div className="flex flex-wrap gap-x-8 gap-y-3 px-8 py-4 bg-surface-container-lowest border-b border-outline-variant/10">
                {selectedGroup.leader_name && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: selectedGroup.color }}>person</span>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-outline">{tr('Leader', language)}</p>
                      <p className="text-sm font-bold text-on-surface">{selectedGroup.leader_name}</p>
                    </div>
                  </div>
                )}
                {selectedGroup.leader_contact && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: selectedGroup.color }}>call</span>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-outline">{tr('Contact', language)}</p>
                      <p className="text-sm font-bold text-on-surface">{selectedGroup.leader_contact}</p>
                    </div>
                  </div>
                )}
                {selectedGroup.meeting_time && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: selectedGroup.color }}>schedule</span>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-outline">{tr('Meeting Time', language)}</p>
                      <p className="text-sm font-bold text-on-surface">{selectedGroup.meeting_time}</p>
                    </div>
                  </div>
                )}
                {selectedGroup.meeting_address && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: selectedGroup.color }}>place</span>
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-outline">{tr('Meeting Place', language)}</p>
                      <p className="text-sm font-bold text-on-surface">{selectedGroup.meeting_address}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Members strip */}
            {groupMembers.filter(m => m.group_id === selectedGroup.id).length > 0 && (
              <div className="flex items-center gap-2 px-8 py-3 bg-white border-b border-outline-variant/5 overflow-x-auto">
                {groupMembers.filter(m => m.group_id === selectedGroup.id).map(m => (
                  <div key={m.id} className="flex-shrink-0 flex flex-col items-center gap-1 group/member relative">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-black overflow-hidden" style={{ background: selectedGroup.color }}>
                      {m.avatar_url ? <img src={m.avatar_url} alt="" className="w-full h-full object-cover" /> : m.full_name.charAt(0)}
                    </div>
                    <p className="text-[8px] text-outline font-bold truncate max-w-[40px]">{m.full_name.split(' ')[0]}</p>
                    {isManager && (
                      <button
                        onClick={() => assignMemberToGroup(m.profile_id, null)}
                        title={tr('Remove from group', language)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-error text-white text-[9px] flex items-center justify-center opacity-0 group-hover/member:opacity-100 transition-opacity shadow-sm"
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Post creation form */}
            <AnimatePresence>
              {isPosting && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden bg-white border-b border-outline-variant/10">
                  <div className="px-8 py-6 space-y-4">
                    <div className="flex gap-2">
                      {([
                        { type: 'text', icon: 'notes', label: tr('Text', language) },
                        { type: 'link', icon: 'link', label: tr('Link', language) },
                        { type: 'photo', icon: 'image', label: tr('Photo', language) },
                      ] as const).map(opt => (
                        <button key={opt.type} onClick={() => setPostDraft(p => ({ ...p, type: opt.type }))}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${postDraft.type === opt.type ? 'text-white' : 'bg-surface-container text-outline'}`}
                          style={postDraft.type === opt.type ? { background: selectedGroup.color } : {}}>
                          <span className="material-symbols-outlined text-sm">{opt.icon}</span>{opt.label}
                        </button>
                      ))}
                    </div>

                    {postDraft.type === 'text' && (
                      <textarea value={postDraft.content} onChange={e => setPostDraft(p => ({ ...p, content: e.target.value }))}
                        placeholder={tr('Share something with the group...', language)}
                        className="w-full bg-surface-container-low rounded-2xl p-4 text-sm resize-none outline-none h-28" />
                    )}
                    {postDraft.type === 'link' && (
                      <div className="space-y-3">
                        <input type="url" value={postDraft.url} onChange={e => setPostDraft(p => ({ ...p, url: e.target.value }))} placeholder="https://..."
                          className="w-full bg-surface-container-low rounded-2xl px-5 py-3 text-sm outline-none" />
                        <input value={postDraft.content} onChange={e => setPostDraft(p => ({ ...p, content: e.target.value }))}
                          placeholder={tr('Description (optional)', language)}
                          className="w-full bg-surface-container-low rounded-2xl px-5 py-3 text-sm outline-none" />
                      </div>
                    )}
                    {postDraft.type === 'photo' && (
                      <div className="space-y-3">
                        <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                        {postDraft.image_url ? (
                          <div className="relative">
                            <img src={postDraft.image_url} alt="preview" className="max-h-48 rounded-2xl object-cover w-full" />
                            <button onClick={() => setPostDraft(p => ({ ...p, image_url: '' }))} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => fileRef.current?.click()} className="w-full h-32 rounded-2xl border-2 border-dashed border-outline-variant/40 flex flex-col items-center justify-center gap-2 text-outline hover:border-primary hover:text-primary transition-all">
                            <span className="material-symbols-outlined text-3xl">add_photo_alternate</span>
                            <span className="text-xs font-bold">{tr('Choose Photo', language)}</span>
                          </button>
                        )}
                        <input value={postDraft.content} onChange={e => setPostDraft(p => ({ ...p, content: e.target.value }))}
                          placeholder={tr('Caption (optional)', language)}
                          className="w-full bg-surface-container-low rounded-2xl px-5 py-3 text-sm outline-none" />
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={handlePost} disabled={posting} className="px-8 py-3 rounded-2xl text-white font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all shadow-lg disabled:opacity-50" style={{ background: selectedGroup.color }}>
                        {posting ? '…' : tr('Post', language)}
                      </button>
                      <button onClick={() => { setIsPosting(false); setPostDraft({ type: 'text', content: '', url: '', image_url: '' }); }}
                        className="px-6 py-3 rounded-2xl bg-surface-container text-outline font-black text-sm hover:bg-error/10 hover:text-error transition-all">
                        {tr('Cancel', language)}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Posts feed */}
            <div className="flex-1 overflow-y-auto p-8 space-y-4">
              {postsLoading ? (
                <div className="flex justify-center py-16"><span className="material-symbols-outlined text-3xl text-outline/30 animate-spin">progress_activity</span></div>
              ) : posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <span className="material-symbols-outlined text-6xl text-outline/20 mb-4">forum</span>
                  <p className="font-bold text-outline/40 text-lg">{tr('No posts yet', language)}</p>
                  <p className="text-outline/30 text-sm mt-1">{tr('Click "Share" above to get started', language)}</p>
                </div>
              ) : posts.map(post => (
                <motion.div key={post.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-[24px] p-6 shadow-sm border border-outline-variant/10 group relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm overflow-hidden" style={{ background: selectedGroup.color }}>
                        {(() => { const av = allProfiles.find(p => p.id === (post as any).author_id || p.full_name === post.author_name)?.avatar_url; return av ? <img src={av} alt="" className="w-full h-full object-cover" /> : post.author_name.charAt(0); })()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">{post.author_name}</p>
                        <p className="text-[10px] text-outline">{formatDate(post.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${post.type === 'link' ? 'bg-blue-50 text-blue-600' : post.type === 'photo' ? 'bg-purple-50 text-purple-600' : 'bg-surface-container text-outline'}`}>
                        {post.type === 'link' ? '🔗 ' : post.type === 'photo' ? '📷 ' : '💬 '}{post.type.toUpperCase()}
                      </span>
                      {isManager && (
                        <button onClick={() => handleDeletePost(post.id)} className="w-8 h-8 rounded-xl hover:bg-error/10 text-outline hover:text-error flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {post.type === 'text' && <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{post.content}</p>}
                  {post.type === 'link' && (
                    <div className="space-y-3">
                      {post.content && <p className="text-sm text-on-surface-variant">{post.content}</p>}
                      <a href={post.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 p-4 rounded-2xl border border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5 transition-all group/link">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                          <span className="material-symbols-outlined">open_in_new</span>
                        </div>
                        <p className="text-sm font-bold text-primary truncate group-hover/link:underline">{post.url}</p>
                      </a>
                    </div>
                  )}
                  {post.type === 'photo' && (
                    <div className="space-y-3">
                      {post.image_url && <img src={post.image_url} alt={post.content || 'photo'} className="w-full max-h-80 rounded-2xl object-cover" />}
                      {post.content && <p className="text-sm text-on-surface-variant">{post.content}</p>}
                    </div>
                  )}

                  {/* ── Replies / comments ── */}
                  <div className="mt-4 pt-4 border-t border-outline-variant/10 space-y-3">
                    {(comments[post.id] || []).map(c => (
                      <div key={c.id} className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-black flex-shrink-0 overflow-hidden mt-0.5" style={{ background: selectedGroup.color }}>
                          {(() => { const av = allProfiles.find(p => p.id === c.author_id || p.full_name === c.author_name)?.avatar_url; return av ? <img src={av} alt="" className="w-full h-full object-cover" /> : (c.author_name || '?').charAt(0); })()}
                        </div>
                        <div className="flex-1 bg-surface-container-low rounded-2xl px-3 py-2">
                          <p className="text-[11px] font-black text-on-surface">{c.author_name}</p>
                          <p className="text-xs text-on-surface-variant whitespace-pre-wrap leading-relaxed">{c.content}</p>
                        </div>
                      </div>
                    ))}

                    {openComments.has(post.id) ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={commentDrafts[post.id] || ''}
                          onChange={e => setCommentDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(post); } }}
                          placeholder={tr('Write a reply…', language)}
                          className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-2xl px-4 py-2 text-xs outline-none focus:border-primary/40"
                        />
                        <button
                          onClick={() => handleAddComment(post)}
                          disabled={commentPosting === post.id || !(commentDrafts[post.id] || '').trim()}
                          className="h-8 w-8 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40"
                        >
                          {commentPosting === post.id ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-base">send</span>}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => toggleCommentBox(post.id)} className="flex items-center gap-1.5 text-[11px] font-black text-outline hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-sm">chat_bubble</span>
                        {(comments[post.id]?.length || 0) > 0 ? `${comments[post.id].length} ${tr('replies', language)}` : tr('Reply', language)}
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Assign Members Modal ── */}
      <AnimatePresence>
        {showAssignModal && assigningGroupId && isManager && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAssignModal(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white rounded-[40px] w-full max-w-md p-8 shadow-2xl max-h-[80vh] flex flex-col">
              <div className="mb-6">
                <h3 className="font-serif text-2xl font-black">{tr('Assign Members', language)}</h3>
                <p className="text-xs text-outline mt-1">
                  {isZh ? `分配到：${groups.find(g => g.id === assigningGroupId)?.name}` : `Assigning to: ${groups.find(g => g.id === assigningGroupId)?.name}`}
                </p>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
                <input
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  placeholder={tr('Search Member...', language)}
                  className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 pl-12 pr-4 outline-none focus:border-primary transition-all text-sm"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {allProfiles.filter(p => (p.full_name || '').toLowerCase().includes(assignSearch.toLowerCase())).map(p => {
                  const currentGroup = groupMembers.find(m => m.profile_id === p.id);
                  const isInThisGroup = currentGroup?.group_id === assigningGroupId;
                  return (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl hover:bg-surface-container transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-black text-sm">
                          {(p.full_name || '?').charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{p.full_name}</p>
                          <p className="text-[10px] text-outline">{currentGroup ? `${tr('In: ', language)}${groups.find(g => g.id === currentGroup.group_id)?.name || '?'}` : (tr('Unassigned', language))}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => assignMemberToGroup(p.id, isInThisGroup ? null : assigningGroupId)}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                          isInThisGroup ? 'bg-error/10 text-error hover:bg-error hover:text-white' : 'bg-primary/10 text-primary hover:bg-primary hover:text-white'
                        }`}>
                        {isInThisGroup ? (tr('Remove', language)) : (tr('Add', language))}
                      </button>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowAssignModal(false)}
                className="mt-6 w-full py-4 rounded-2xl bg-black text-white font-black uppercase tracking-widest hover:bg-primary transition-all">
                {tr('Done', language)}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Create / Edit Group Modal ── */}
      <AnimatePresence>
        {(isCreatingGroup || editingGroup) && isManager && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setIsCreatingGroup(false); setEditingGroup(null); }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white rounded-[40px] w-full max-w-md p-8 shadow-2xl space-y-6">
              <div>
                <h3 className="font-serif text-2xl font-black">{editingGroup ? (tr('Edit Group', language)) : (tr('New Group', language))}</h3>
                <p className="text-xs text-outline mt-1">{tr('Set group name and colour', language)}</p>
              </div>
              <div className="space-y-4">
                {/* Group avatar */}
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center text-white font-black text-xl shrink-0" style={{ background: groupDraft.image_url ? 'transparent' : groupDraft.color }}>
                    {groupDraft.image_url
                      ? <img src={groupDraft.image_url} alt="" className="w-full h-full object-cover" />
                      : (groupDraft.name.charAt(0) || '?')}
                  </div>
                  <div className="flex gap-2">
                    <input type="file" ref={avatarInputRef} accept="image/*" className="hidden" onChange={handleGroupAvatarUpload} />
                    <button type="button" onClick={() => avatarInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-2xl bg-surface-container text-on-surface text-xs font-bold hover:bg-surface-container-high transition-all flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                      {tr('Choose Photo', language)}
                    </button>
                    {groupDraft.image_url && (
                      <button type="button" onClick={() => setGroupDraft(p => ({ ...p, image_url: '' }))}
                        className="px-3 py-2.5 rounded-2xl bg-error/10 text-error text-xs font-bold hover:bg-error/20 transition-all">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Group Name *', language)}</label>
                  <input autoFocus value={groupDraft.name} onChange={e => setGroupDraft(p => ({ ...p, name: e.target.value }))}
                    placeholder={tr('e.g. Youth Group', language)}
                    className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Description (optional)', language)}</label>
                  <input value={groupDraft.description} onChange={e => setGroupDraft(p => ({ ...p, description: e.target.value }))}
                    placeholder={tr('Brief description', language)}
                    className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 outline-none focus:border-primary transition-all text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Leader', language)}</label>
                    <input value={groupDraft.leader_name} onChange={e => setGroupDraft(p => ({ ...p, leader_name: e.target.value }))}
                      placeholder={tr('Leader name', language)}
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 outline-none focus:border-primary transition-all text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Contact', language)}</label>
                    <input value={groupDraft.leader_contact} onChange={e => setGroupDraft(p => ({ ...p, leader_contact: e.target.value }))}
                      placeholder={tr('Phone / WeChat', language)}
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 outline-none focus:border-primary transition-all text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Meeting Time', language)}</label>
                  <input value={groupDraft.meeting_time} onChange={e => setGroupDraft(p => ({ ...p, meeting_time: e.target.value }))}
                    placeholder={tr('e.g. Fridays 7:30 PM', language)}
                    className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 outline-none focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Meeting Address', language)}</label>
                  <input value={groupDraft.meeting_address} onChange={e => setGroupDraft(p => ({ ...p, meeting_address: e.target.value }))}
                    placeholder={tr('Meeting location', language)}
                    className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 outline-none focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{tr('Color', language)}</label>
                  <div className="flex gap-2 flex-wrap">
                    {GROUP_COLORS.map(c => (
                      <button key={c} onClick={() => setGroupDraft(p => ({ ...p, color: c }))}
                        className="w-10 h-10 rounded-xl transition-all hover:scale-110 active:scale-95 relative"
                        style={{ background: c, outline: groupDraft.color === c ? `3px solid ${c}` : 'none', outlineOffset: '3px' }}>
                        {groupDraft.color === c && <span className="absolute inset-0 flex items-center justify-center text-white text-[13px]">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={editingGroup ? handleUpdateGroup : handleCreateGroup} disabled={!groupDraft.name.trim()}
                  className="flex-1 py-4 rounded-2xl text-white font-black uppercase tracking-widest shadow-lg hover:opacity-90 transition-all disabled:opacity-30"
                  style={{ background: groupDraft.color }}>
                  {editingGroup ? (tr('Save', language)) : (tr('Create Group', language))}
                </button>
                <button onClick={() => { setIsCreatingGroup(false); setEditingGroup(null); }}
                  className="px-6 py-4 rounded-2xl bg-surface-container text-outline font-black hover:bg-error/10 hover:text-error transition-all">
                  {tr('Cancel', language)}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
