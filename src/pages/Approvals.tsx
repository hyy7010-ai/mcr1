import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { tr } from '../lib/uiText';
import { supabase } from '../lib/supabase';
import { logActivity } from '../services/activityService';
import { getActiveChurchId } from '../lib/permissions';
import { QRCodeSVG } from 'qrcode.react';

interface PendingRequest {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  created_at: string;
  role: string;
}

export default function Approvals() {
  const { language, isZh } = useLanguage();
  const { profile, church, updateChurch } = useAuth();
  const [allMembers, setAllMembers] = useState<PendingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'All' | 'Pending' | 'Manager' | 'Staff' | 'Group' | 'Member'>('Pending');
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [customCodes, setCustomCodes] = useState({
    code: '',
    staff: '',
    member: ''
  });
  const [showJoinQR, setShowJoinQR] = useState<'Main' | 'Staff' | 'Member' | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState('Member');
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => {
    if (church) {
      setCustomCodes({
        code: church.code || '',
        staff: church.staff_join_code || '',
        member: church.member_join_code || ''
      });
    }
  }, [church]);

  const t = (key: string) => {
    const translations: any = {
      title: tr('Member Management', language),
      subtitle: tr('Manage church members and membership applications', language),
      noRequests: tr('No matching members found', language),
      approve: tr('Approve & Assign Role', language),
      update: tr('Update Role', language),
      reject: tr('Remove / Reject', language),
      searchHint: tr('Search name or email...', language),
      roleAssign: tr('Member Role', language),
      manager: tr('Manager', language),
      staff: tr('Staff', language),
      group: tr('Group', language),
      member: tr('Member', language),
      groupLeader: tr('Group Leader', language),
      groupMember: tr('Group Member', language),
      pending: tr('Pending', language),
      all: tr('All', language),
      success: tr('Role updated successfully', language),
      rejected: tr('Removed successfully', language),
      churchCode: tr('Join Codes', language),
      mainCode: tr('Standard Code', language),
      staffCode: tr('Staff Code', language),
      memberCode: tr('Member Code', language),
      copy: tr('Copy', language),
      close: tr('Close', language),
    };
    return translations[key] || key;
  };

  const isFetchingRef = React.useRef(false);

  const fetchData = async () => {
    // Super Admin might not have a church_id in their profile if they switched, 
    // but the 'church' object from AuthContext should be respected.
    const targetChurchId = profile?.church_id || church?.id;
    if (!targetChurchId) {
      if (profile) setIsLoading(false);
      return;
    }
    
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, created_at, role, group_role')
        .eq('church_id', targetChurchId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAllMembers(data || []);
      
      const hasPending = (data || []).some(m => m.role === 'Pending');
      if (hasPending) setActiveTab('Pending');
      else if (activeTab === 'Pending') setActiveTab('All');
      
    } catch (err) {
      console.error('Error fetching members:', err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (profile?.church_id || church?.id) {
      fetchData();
    }
  }, [profile?.church_id, church?.id]);

  const handleUpdateRole = async (id: string, name: string, role: string, groupRole?: string | null) => {
    setProcessingId(id);
    try {
      // group_role is an INDEPENDENT add-on (e.g. someone can be 管理员 AND 小组长).
      const payload: any = { role };
      if (groupRole !== undefined) payload.group_role = groupRole;
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', id);

      if (error) throw error;

      setAllMembers(prev => prev.map(r => r.id === id ? { ...r, role, ...(groupRole !== undefined ? { group_role: groupRole } : {}) } : r));
      localStorage.removeItem(`profile_${id}`);
      const activeChurchId = getActiveChurchId(profile, church);
      const isPending = allMembers.find(m => m.id === id)?.role === 'Pending';
      logActivity({ churchId: activeChurchId || church?.id || '', userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: isPending ? `Approved member as ${role}` : `Changed role to ${role}`, target: name, type: 'Member' });
    } catch (err: any) {
      alert((tr('Error: ', language)) + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(tr('Are you sure you want to remove/reject this member?', language))) return;
    setProcessingId(id);
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setAllMembers(prev => prev.filter(r => r.id !== id));
    } catch (err: any) {
      alert((tr('Error: ', language)) + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Apply one role to every selected member in a single batch.
  const handleBulkApply = async () => {
    if (selectedIds.size === 0) return;
    setBulkProcessing(true);
    const ids = Array.from(selectedIds);
    try {
      // 小组长 is an add-on: set group_role and leave the primary role untouched.
      const payload = bulkRole === 'Group Leader' ? { group_role: 'Group Leader' } : { role: bulkRole };
      const { error } = await supabase.from('profiles').update(payload).in('id', ids);
      if (error) throw error;
      setAllMembers(prev => prev.map(r => ids.includes(r.id) ? { ...r, ...payload } : r));
      ids.forEach(id => localStorage.removeItem(`profile_${id}`));
      const activeChurchId = getActiveChurchId(profile, church);
      logActivity({ churchId: activeChurchId || church?.id || '', userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: `Bulk set ${ids.length} member(s) to ${bulkRole}`, target: `${ids.length} members`, type: 'Member' });
      setSelectedIds(new Set());
    } catch (err: any) {
      alert((tr('Error: ', language)) + err.message);
    } finally {
      setBulkProcessing(false);
    }
  };

  const filteredMembers = allMembers.filter(r => {
    const matchesSearch = (r.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (r.email || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === 'All' ||
                       (activeTab === 'Group' ? (r.group_role === 'Group Leader' || r.role === 'Group Leader') : r.role === activeTab);
    return matchesSearch && matchesTab;
  });

  const handleSaveCodes = async () => {
    const targetChurchId = profile?.church_id || church?.id;
    if (!targetChurchId) {
      alert(tr('Error: Target church ID missing.', language));
      return;
    }
    if (!customCodes.code.trim()) {
      alert(tr('Church code cannot be empty.', language));
      return;
    }

    setProcessingId('saving-codes');
    try {
      // Race against a 10s timeout so the button never stays stuck
      const updatePromise = supabase
        .from('churches')
        .update({
          code: customCodes.code.trim().toUpperCase(),
          staff_join_code: customCodes.staff.trim().toUpperCase() || null,
          member_join_code: customCodes.member.trim().toUpperCase() || null,
        })
        .eq('id', targetChurchId)
        .select();

      const timeoutPromise = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(tr('Request timed out. Check network or RLS permissions.', language))), 10000)
      );

      const { data, error } = await Promise.race([updatePromise, timeoutPromise]) as any;

      if (error) throw error;
      if (!data || data.length === 0) throw new Error(tr('Blocked by database policy (RLS). Contact your platform admin.', language));

      setIsEditingCode(false);
      // Soft refresh: update context instead of hard reload
      if (updateChurch) updateChurch({
        code: customCodes.code.trim().toUpperCase(),
        staff_join_code: customCodes.staff.trim().toUpperCase() || null,
        member_join_code: customCodes.member.trim().toUpperCase() || null,
      });
      // Also update localStorage cache so PendingApproval can find the code instantly
      try {
        const cached = localStorage.getItem('all_churches_cache');
        if (cached) {
          const list = JSON.parse(cached);
          const updated = list.map((c: any) =>
            c.id === targetChurchId
              ? { ...c, code: customCodes.code.trim().toUpperCase(), staff_join_code: customCodes.staff.trim().toUpperCase() || null, member_join_code: customCodes.member.trim().toUpperCase() || null }
              : c
          );
          localStorage.setItem('all_churches_cache', JSON.stringify(updated));
        }
      } catch {}
      alert(tr('Join codes updated!', language));
    } catch (err: any) {
      const isZh = language.startsWith('zh');
      const msg = err?.message || '';
      // A unique-constraint hit means the code is already taken by another church.
      if (err?.code === '23505' || /duplicate key|churches_code_key/i.test(msg)) {
        const which = /staff_join_code/i.test(msg) ? (isZh ? '同工码' : 'Staff code')
          : /member_join_code/i.test(msg) ? (isZh ? '会友码' : 'Member code')
          : (isZh ? '普通教会码' : 'Church code');
        alert(isZh
          ? `${which}已被其它教会占用了,请换一个不一样的码(可以加几位数字让它更独特)。`
          : `${which} is already used by another church. Pick a different one.`);
      } else {
        alert((tr('Error: ', language)) + msg);
      }
    } finally {
      setProcessingId(null);
    }
  };

  const copyCode = () => {
    if (church?.code) {
      navigator.clipboard.writeText(church.code);
      alert(tr('Join code copied to clipboard', language));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 font-sans">
      <header className="space-y-8">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 opacity-60">
              <span className="material-symbols-outlined text-outline text-lg">church</span>
              <span className="text-xs font-black uppercase tracking-[0.2em] text-outline truncate">{church?.name || (tr('Loading...', language))}</span>
            </div>
            <h1 className="text-5xl font-serif font-black text-on-surface tracking-tight leading-tight">{t('title')}</h1>
            <p className="text-outline mt-2 text-lg font-medium max-w-xl leading-relaxed opacity-70">{t('subtitle')}</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 xl:w-auto w-full">
            {/* Quick Stats Summary Card */}
            <div className="grid grid-cols-2 gap-3 sm:w-64">
              <div className="bg-white border border-outline-variant/10 rounded-[32px] p-4 shadow-sm flex flex-col justify-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-outline/50 mb-1">{tr('TOTAL', language)}</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-black text-on-surface leading-none">{allMembers.length}</span>
                  <span className="material-symbols-outlined text-primary text-xl mb-0.5">groups</span>
                </div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-[32px] p-4 shadow-sm flex flex-col justify-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-900/40 mb-1">{tr('PENDING', language)}</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-black text-amber-600 leading-none">
                    {allMembers.filter(m => m.role === 'Pending').length}
                  </span>
                  <span className="material-symbols-outlined filled text-amber-500 text-xl mb-0.5">notifications_active</span>
                </div>
              </div>
            </div>

            {/* Codes Card */}
            <div className="flex-1 min-w-[320px] bg-on-surface p-6 rounded-[40px] text-surface shadow-2xl relative overflow-hidden group">
              {/* Background Accent */}
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000" />
              
              <div className="relative z-10 flex flex-col h-full justify-between gap-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-surface/60">
                    <span className="material-symbols-outlined text-lg">vpn_key</span>
                    <span className="text-[10px] font-black uppercase tracking-widest">{t('churchCode')}</span>
                  </div>
                  <button 
                    onClick={() => setIsEditingCode(true)}
                    className="h-8 px-3 rounded-full bg-surface/10 hover:bg-surface/20 text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">settings</span>
                    {tr('Manage', language)}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="group/code cursor-pointer" onClick={() => setShowJoinQR('Main')}>
                      <p className="text-[9px] font-black uppercase tracking-tight text-surface/40 mb-1">{t('mainCode')}</p>
                      <div className="flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                        <span className="text-3xl font-mono font-black tracking-[0.2em]">{church?.code || '---'}</span>
                        <span className="material-symbols-outlined text-sm opacity-30">qr_code_2</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 border-l border-surface/10 pl-6">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-tight text-surface/40 mb-1">{t('staffCode')}</p>
                      <div className="flex items-center justify-between group/s cursor-pointer" onClick={() => setShowJoinQR('Staff')}>
                        <span className="text-sm font-mono font-black tracking-widest text-primary-fixed">{church?.staff_join_code || '---'}</span>
                        <span className="material-symbols-outlined text-xs opacity-0 group-hover/s:opacity-100 transition-opacity">open_in_new</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-tight text-surface/40 mb-1">{t('memberCode')}</p>
                      <div className="flex items-center justify-between group/m cursor-pointer" onClick={() => setShowJoinQR('Member')}>
                        <span className="text-sm font-mono font-black tracking-widest text-secondary-fixed">{church?.member_join_code || '---'}</span>
                        <span className="material-symbols-outlined text-xs opacity-0 group-hover/m:opacity-100 transition-opacity">open_in_new</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-surface/5">
                  <div className="h-6 w-6 rounded-full bg-surface/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-xs text-surface/60">person</span>
                  </div>
                  <span className="text-[10px] font-bold text-surface/40 uppercase tracking-widest">
                    {isZh ? '主管理员：' : tr('Admin:', language)}
                    <span className="text-surface/80 ml-1">
                      {/* Main admin = the founder: the earliest-joined Manager who created this church */}
                      {[...allMembers]
                        .filter(m => m.role === 'Manager')
                        .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())[0]?.full_name || '...'}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col lg:flex-row items-center gap-6 pt-4">
          <div className="flex bg-surface-container-low p-1.5 rounded-[24px] w-full lg:w-auto overflow-x-auto no-scrollbar shadow-inner border border-outline-variant/10">
            {(['Pending', 'Manager', 'Staff', 'Group', 'Member', 'All'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 lg:flex-none px-6 py-3 rounded-[18px] text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap flex items-center justify-center gap-2 ${
                  activeTab === tab 
                    ? 'bg-white text-primary shadow-lg shadow-black/[0.05] -translate-y-0.5' 
                    : 'text-outline hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {tab === 'Pending' ? t('pending') : tab === 'All' ? t('all') : tab === 'Group' ? t('groupLeader') : t(tab.toLowerCase())}
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                   activeTab === tab ? 'bg-primary/10 text-primary' : 'bg-outline/10 text-outline opacity-60'
                }`}>
                  {allMembers.filter(m => {
                    if (tab === 'All') return true;
                    if (tab === 'Group') return m.group_role === 'Group Leader' || m.role === 'Group Leader';
                    return m.role === tab;
                  }).length}
                </span>
              </button>
            ))}
          </div>

          <div className="relative group w-full lg:flex-1 lg:max-w-md">
            <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-outline/40 group-focus-within:text-primary transition-colors">search_insights</span>
            <input 
              type="text"
              placeholder={t('searchHint')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-outline-variant/10 rounded-[24px] py-4 pl-14 pr-6 text-sm font-medium focus:border-primary/40 focus:ring-4 focus:ring-primary/5 outline-none transition-all shadow-sm"
            />
          </div>
        </div>
      </header>

      {/* Bulk action bar — multi-select role change */}
      {!isLoading && filteredMembers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6 bg-white border border-outline-variant/10 rounded-[24px] px-5 py-3 shadow-sm">
          <button
            onClick={() => {
              const allSel = filteredMembers.every(m => selectedIds.has(m.id));
              setSelectedIds(allSel ? new Set() : new Set(filteredMembers.map(m => m.id)));
            }}
            className="flex items-center gap-2 text-xs font-black text-primary hover:opacity-70 transition-opacity"
          >
            <span className="material-symbols-outlined text-lg">
              {filteredMembers.length > 0 && filteredMembers.every(m => selectedIds.has(m.id)) ? 'check_box' : 'check_box_outline_blank'}
            </span>
            {isZh ? '全选' : 'Select all'}
          </button>
          <span className="text-xs font-bold text-outline">
            {selectedIds.size > 0
              ? (isZh ? `已选 ${selectedIds.size} 人` : `${selectedIds.size} selected`)
              : (isZh ? '勾选成员可批量设置角色（含小组长）' : 'Tick members to bulk-assign a role')}
          </span>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <select
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value)}
                className="bg-surface-container-low border border-outline-variant/20 rounded-2xl px-4 py-2 text-xs font-black outline-none focus:border-primary/40"
              >
                <option value="Manager">{tr('Manager', language)}</option>
                <option value="Staff">{tr('Staff', language)}</option>
                <option value="Group Leader">{tr('Group Leader', language)}</option>
                <option value="Group Member">{tr('Group Member', language)}</option>
                <option value="Member">{tr('Member', language)}</option>
              </select>
              <button
                onClick={handleBulkApply}
                disabled={bulkProcessing}
                className="h-9 px-5 rounded-2xl bg-primary text-white text-xs font-black flex items-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {bulkProcessing ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-sm">done_all</span>}
                {tr('Apply to', language)} {selectedIds.size}
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="h-9 px-3 rounded-2xl text-outline hover:bg-surface-container text-xs font-bold transition-all">
                {tr('Clear', language)}
              </button>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin"></div>
        </div>
      ) : filteredMembers.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-surface-container-lowest rounded-[48px] py-32 px-10 text-center border border-outline-variant/10 shadow-sm relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          <div className="relative z-10 max-w-sm mx-auto">
            <div className="w-24 h-24 bg-surface-container rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-inner rotate-3">
              <span className="material-symbols-outlined text-5xl text-outline/20">person_search</span>
            </div>
            <h3 className="text-2xl font-serif font-black text-on-surface mb-2">{tr('No matches found', language)}</h3>
            <p className="text-outline text-sm font-medium opacity-60 leading-relaxed">
              {tr('No church members or pending applications match your criteria.', language)}
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <AnimatePresence mode="popLayout">
            {filteredMembers.map((req) => (
              <RequestCard
                key={req.id}
                request={req}
                t={t}
                isProcessing={processingId === req.id}
                onUpdateRole={handleUpdateRole}
                onRemove={handleRemove}
                selected={selectedIds.has(req.id)}
                onToggleSelect={toggleSelect}
                isZh={isZh}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      {/* Codes Edit Modal */}
      <AnimatePresence>
        {isEditingCode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsEditingCode(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white p-10 rounded-[48px] shadow-2xl relative z-10 max-w-lg w-full overflow-hidden"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="h-12 w-12 rounded-[20px] bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-2xl">passkey</span>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-on-surface font-serif">{tr('Manage Join Codes', language)}</h3>
                  <p className="text-xs text-outline font-medium">{tr('Fast join codes for different roles', language)}</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('mainCode')}</label>
                  <p className="text-[10px] text-outline/60 italic ml-1 mb-2">{tr('Members joining with this code require manual approval.', language)}</p>
                  <input 
                    type="text" 
                    value={customCodes.code}
                    onChange={e => setCustomCodes({...customCodes, code: e.target.value.toUpperCase()})}
                    className="w-full bg-surface-container rounded-2xl py-4 px-6 text-lg font-mono font-black tracking-widest focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-outline/20"
                    placeholder="CHURCH123"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">{t('staffCode')} <span className="text-outline/40 normal-case font-normal">(6-8位)</span></label>
                    <input
                      type="text"
                      value={customCodes.staff}
                      onChange={e => setCustomCodes({...customCodes, staff: e.target.value.toUpperCase().slice(0, 8)})}
                      maxLength={8}
                      className="w-full bg-primary/5 rounded-2xl py-4 px-6 font-mono font-black tracking-widest focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-primary/20"
                      placeholder="STAFF123"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-secondary ml-1">{t('memberCode')} <span className="text-outline/40 normal-case font-normal">(6-8位)</span></label>
                    <input
                      type="text"
                      value={customCodes.member}
                      onChange={e => setCustomCodes({...customCodes, member: e.target.value.toUpperCase().slice(0, 8)})}
                      maxLength={8}
                      className="w-full bg-secondary/5 rounded-2xl py-4 px-6 font-mono font-black tracking-widest focus:ring-2 focus:ring-secondary outline-none transition-all placeholder:text-secondary/20"
                      placeholder="MEMBER123"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex gap-3 items-start">
                   <span className="material-symbols-outlined text-amber-600 text-lg">info</span>
                   <p className="text-[10px] text-amber-700 font-medium leading-relaxed">
                     {isZh 
                       ? '同工码和会友码是极高权限的代码。任何人输入这些码都会直接获得相应的权限，请务必妥善保存并仅分发给受信任的人选。'
                       : 'Staff & Member codes grant direct permissions. Anyone with these codes bypassing approval. Please only share with trusted people.'}
                   </p>
                </div>
              </div>

              <div className="flex gap-4 mt-10">
                <button 
                  onClick={() => setIsEditingCode(false)}
                  className="flex-1 px-8 py-4 rounded-3xl text-sm font-black uppercase tracking-widest text-outline hover:bg-surface-container transition-all"
                >
                  {tr('Cancel', language)}
                </button>
                <button 
                  onClick={handleSaveCodes}
                  disabled={processingId === 'saving-codes'}
                  className="flex-[2] bg-primary text-on-primary px-8 py-4 rounded-3xl text-sm font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                >
                  {processingId === 'saving-codes' ? '...' : (tr('Save Codes', language))}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Join QR Modal */}
      <AnimatePresence>
        {showJoinQR && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowJoinQR(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white p-10 rounded-[48px] shadow-2xl relative z-10 flex flex-col items-center gap-6 max-w-sm w-full"
            >
              <div className="text-center space-y-2">
                <h3 className="font-serif text-2xl font-black text-on-surface">{church?.name}</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-outline">
                  {showJoinQR === 'Main' ? t('mainCode') : showJoinQR === 'Staff' ? t('staffCode') : t('memberCode')}
                </p>
              </div>
              
              <div className={`p-6 rounded-[32px] border-2 ${
                showJoinQR === 'Main' ? 'bg-amber-50 border-amber-100' : 
                showJoinQR === 'Staff' ? 'bg-primary/5 border-primary/10' : 
                'bg-secondary/5 border-secondary/10'
              }`}>
                <QRCodeSVG 
                  value={
                    showJoinQR === 'Main' ? (church?.code || '') : 
                    showJoinQR === 'Staff' ? (church?.staff_join_code || '') : 
                    (church?.member_join_code || '')
                  } 
                  size={220} 
                />
              </div>

              <div className="text-center">
                <p className={`text-3xl font-mono font-black tracking-[0.2em] ${
                  showJoinQR === 'Main' ? 'text-amber-900' : 
                  showJoinQR === 'Staff' ? 'text-primary' : 
                  'text-secondary'
                }`}>
                  {showJoinQR === 'Main' ? (church?.code || '---') : 
                   showJoinQR === 'Staff' ? (church?.staff_join_code || '---') : 
                   (church?.member_join_code || '---')}
                </p>
                <p className="text-outline text-xs mt-4 font-medium px-6">
                  {tr('Scan this code to quickly join the church', language)}
                </p>
              </div>

              <button 
                onClick={() => setShowJoinQR(null)}
                className="w-full bg-on-surface text-surface py-4 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all text-sm"
              >
                {t('close')}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RequestCard({ request, t, isProcessing, onUpdateRole, onRemove, selected, onToggleSelect, isZh }: any) {
  // Primary role (single) + an INDEPENDENT 小组长 add-on, so someone can be e.g. 管理员 AND 小组长.
  const initialPrimary = request.role === 'Pending'
    ? 'Member'
    : (request.role === 'Group Leader' ? 'Member' : request.role);
  const origGroupLeader = request.group_role === 'Group Leader' || request.role === 'Group Leader';
  const [selectedRole, setSelectedRole] = useState(initialPrimary);
  const [isGroupLeader, setIsGroupLeader] = useState(origGroupLeader);
  const isChanged = selectedRole !== request.role || isGroupLeader !== origGroupLeader;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`group relative bg-white rounded-[40px] p-8 border transition-all flex flex-col gap-8 shadow-sm hover:shadow-2xl hover:shadow-black/[0.05] hover:-translate-y-1 ${
        selected ? 'border-primary ring-4 ring-primary/10' : request.role === 'Pending' ? 'border-amber-200 ring-4 ring-amber-500/5' : 'border-outline-variant/10'
      }`}
    >
      {/* Multi-select checkbox */}
      {onToggleSelect && (
        <button
          onClick={() => onToggleSelect(request.id)}
          className={`absolute top-5 left-5 z-10 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${selected ? 'bg-primary text-white' : 'bg-surface-container border border-outline-variant/30 text-transparent hover:border-primary/40'}`}
          title={tr('Select', 'en')}
        >
          <span className="material-symbols-outlined text-base">check</span>
        </button>
      )}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-5">
          <div className={`h-16 w-16 rounded-[24px] flex items-center justify-center font-serif font-black text-2xl shadow-inner ${
            request.role === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-primary/5 text-primary'
          }`}>
            {request.full_name?.charAt(0) || 'U'}
          </div>
          <div className="min-w-0">
            <h4 className="font-serif font-black text-xl text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
              {request.full_name || 'Anonymous'}
            </h4>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-[10px] font-black uppercase tracking-widest ${request.role === 'Pending' ? 'text-amber-600' : 'text-primary/60'}`}>
                {t(request.role.toLowerCase().replace(' ', '')) || request.role}
              </span>
              {(request.group_role === 'Group Leader' && request.role !== 'Group Leader') && (
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">
                  + {t('groupLeader')}
                </span>
              )}
              {request.role === 'Pending' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              )}
            </div>
          </div>
        </div>
        
        <button 
          onClick={() => onRemove(request.id)}
          className="h-10 w-10 rounded-full flex items-center justify-center text-outline/30 hover:bg-error/10 hover:text-error transition-all"
        >
          <span className="material-symbols-outlined text-xl">delete</span>
        </button>
      </div>

      <div className="bg-surface-container-low rounded-[24px] p-4 space-y-2 border border-outline-variant/5 shadow-inner">
        <div className="flex items-center gap-3 text-xs font-medium text-outline">
          <span className="material-symbols-outlined text-sm opacity-40">mail</span>
          <span className="truncate">{request.email}</span>
        </div>
        {request.phone && (
          <div className="flex items-center gap-3 text-xs font-medium text-outline">
            <span className="material-symbols-outlined text-sm opacity-40">call</span>
            <span>{request.phone}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-outline/40 ml-1">
          {t('roleAssign')}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {[
            { id: 'Manager', label: t('manager'), icon: 'admin_panel_settings' },
            { id: 'Staff', label: t('staff'), icon: 'badge' },
            { id: 'Group Member', label: t('groupMember'), icon: 'group' },
            { id: 'Member', label: t('member'), icon: 'person' }
          ].map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRole(role.id)}
              className={`p-3 rounded-[16px] text-xs font-bold text-left px-5 flex items-center gap-3 transition-all border ${
                selectedRole === role.id
                  ? 'bg-primary/5 border-primary/20 text-primary shadow-sm'
                  : 'bg-white border-transparent text-outline hover:bg-surface-container/50'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${selectedRole === role.id ? 'opacity-100' : 'opacity-20'}`}>
                {role.icon}
              </span>
              <span className="flex-1">{role.label}</span>
              {selectedRole === role.id && (
                <span className="material-symbols-outlined text-sm">check_circle</span>
              )}
            </button>
          ))}
        </div>

        {/* Independent 小组长 add-on — can be combined with ANY primary role above */}
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-outline/40 ml-1 mt-4">
          {isZh ? '附加身份' : 'Add-on'}
        </p>
        <button
          onClick={() => setIsGroupLeader((v: boolean) => !v)}
          className={`p-3 rounded-[16px] text-xs font-bold text-left px-5 flex items-center gap-3 transition-all border ${
            isGroupLeader
              ? 'bg-amber-500/5 border-amber-500/30 text-amber-700 shadow-sm'
              : 'bg-white border-transparent text-outline hover:bg-surface-container/50'
          }`}
        >
          <span className={`material-symbols-outlined text-lg ${isGroupLeader ? 'opacity-100' : 'opacity-20'}`}>supervisor_account</span>
          <span className="flex-1">{t('groupLeader')}{isZh ? '（可与上面任意角色并存）' : ' (combinable)'}</span>
          <span className={`material-symbols-outlined text-base ${isGroupLeader ? 'text-amber-600' : 'opacity-20'}`}>
            {isGroupLeader ? 'check_box' : 'check_box_outline_blank'}
          </span>
        </button>
      </div>

      <div className="pt-2">
        <button 
          disabled={isProcessing || (!isChanged && request.role !== 'Pending')}
          onClick={() => onUpdateRole(request.id, request.full_name, selectedRole, isGroupLeader ? 'Group Leader' : null)}
          className={`w-full text-white text-xs font-black uppercase tracking-widest py-4 rounded-2xl shadow-xl transition-all disabled:opacity-20 disabled:grayscale ${
            request.role === 'Pending' ? 'bg-amber-600 shadow-amber-600/20' : 'bg-on-surface shadow-black/10'
          } ${isChanged || request.role === 'Pending' ? 'hover:scale-[1.02] active:scale-95' : ''}`}
        >
          {isProcessing ? '...' : (request.role === 'Pending' ? t('approve') : t('update'))}
        </button>
      </div>
    </motion.div>
  );
}
