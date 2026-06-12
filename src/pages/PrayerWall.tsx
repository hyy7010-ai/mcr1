import React, { useState, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { tValue } from '../lib/valueLabels';
import { tr } from '../lib/uiText';
import { motion, AnimatePresence } from 'motion/react';

type Visibility = 'All Church' | 'Staff' | 'Pastors Only' | 'My Eyes Only';

type Status = 'Pending Approval' | 'Published' | 'Internal';

interface PrayerRequest {
  id: string;
  content: string;
  anonymous: boolean;
  authorName: string;
  authorEmail: string;
  visibility: Visibility;
  status: Status;
  createdAt: string;
  prayedCount: number;
}

const initialRequests: PrayerRequest[] = [];

export default function PrayerWall() {
  const { mode } = useMode();
  const { t, isZh, language } = useLanguage();
  const { profile, church, user } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  const [requests, setRequests] = useState<PrayerRequest[]>([]);
  const [newPrayer, setNewPrayer] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('All Church');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Manager State — tab filter persisted to localStorage
  const tabKey = churchKey('prayer_tab_filter');
  const [activeTab, setActiveTab] = useState<'All' | 'Pending' | 'Internal'>(() => {
    const saved = localStorage.getItem(churchKey('prayer_tab_filter'));
    return (saved as any) || 'All';
  });
  const handleSetActiveTab = (tab: 'All' | 'Pending' | 'Internal') => {
    setActiveTab(tab);
    try { localStorage.setItem(tabKey, tab); } catch {}
  };
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [displayLimit, setDisplayLimit] = useState(20);

  // Map a DB row → PrayerRequest
  const fromRow = (r: any): PrayerRequest => ({
    id: r.id, content: r.content, anonymous: !!r.anonymous,
    authorName: r.author_name || 'Anonymous', authorEmail: r.author_email || '',
    visibility: r.visibility as Visibility, status: r.status as Status,
    createdAt: r.created_at ? new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    prayedCount: r.prayed_count || 0,
  });

  // Load this church's prayer requests from the DB (synced across everyone)
  useEffect(() => {
    if (!activeChurchId) return;
    setDisplayLimit(20);
    supabase.from('church_prayers').select('*').eq('church_id', activeChurchId).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setRequests(data.map(fromRow));
        else { try { const s = localStorage.getItem(churchKey('prayer_requests')); setRequests(s ? JSON.parse(s) : []); } catch { setRequests([]); } }
      });
  }, [activeChurchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrayer.trim() || !activeChurchId) return;
    setIsSubmitting(true);
    const row = {
      church_id: activeChurchId,
      content: newPrayer,
      anonymous: isAnonymous,
      author_name: profile?.full_name || user?.email?.split('@')[0] || 'Anonymous',
      author_email: user?.email || '',
      visibility,
      status: mode === 'Manager' ? 'Published' : 'Pending Approval',
      prayed_count: 0,
    };
    const { data, error } = await supabase.from('church_prayers').insert(row).select().single();
    if (!error && data) setRequests([fromRow(data), ...requests]);
    setNewPrayer('');
    setIsAnonymous(false);
    setVisibility('All Church');
    setIsSubmitting(false);
    if (mode !== 'Manager') { setJustSubmitted(true); setTimeout(() => setJustSubmitted(false), 5000); }
  };

  const handlePray = async (id: string) => {
    const req = requests.find(r => r.id === id);
    const next = (req?.prayedCount || 0) + 1;
    setRequests(requests.map(r => r.id === id ? { ...r, prayedCount: next } : r));
    await supabase.from('church_prayers').update({ prayed_count: next }).eq('id', id);
  };

  const handleUpdateStatus = async (id: string, status: Status, newVisibility?: Visibility) => {
    setRequests(requests.map(req => req.id === id ? { ...req, status, visibility: newVisibility || req.visibility } : req));
    const patch: any = { status };
    if (newVisibility) patch.visibility = newVisibility;
    await supabase.from('church_prayers').update(patch).eq('id', id);
  };

  const handleReject = async (id: string) => {
    setRequests(requests.filter(req => req.id !== id));
    await supabase.from('church_prayers').delete().eq('id', id);
  };

  const myEmail = user?.email || '';
  const memberVisibleRequests = requests.filter(req => {
    // Always show the current user's own pending requests so they know it's awaiting approval
    if (req.status === 'Pending Approval') return req.authorEmail === myEmail;
    if (req.visibility === 'Pastors Only' || req.visibility === 'Staff') return false;
    if (req.visibility === 'My Eyes Only') return false;
    return true;
  });

  const managerFilteredRequests = requests.filter(req => {
    if (activeTab === 'Pending') return req.status === 'Pending Approval';
    if (activeTab === 'Internal') return req.status === 'Internal' || req.visibility === 'Staff' || req.visibility === 'Pastors Only';
    return true; // All
  });

  const MemberView = () => (
    <div className="flex flex-1 gap-8 flex-col-reverse md:flex-row min-h-0">
      {/* Wall Canvas */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-2">
        <AnimatePresence mode="popLayout">
          {memberVisibleRequests.slice(0, displayLimit).map((req) => (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={req.id}
              className="glass-card p-6 border-l-4"
              style={{ borderLeftColor: req.status === 'Pending Approval' ? '#f59e0b' : 'var(--color-secondary)'}}
            >
              {req.status === 'Pending Approval' && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                  <span className="material-symbols-outlined text-amber-500 text-[16px]">schedule</span>
                  <span className="text-[11px] font-black text-amber-700 uppercase tracking-wider">
                    {tr('Awaiting approval — visible to everyone once approved', language)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-start mb-4">
                <div className="flex flex-col gap-1">
                  <span className="font-label-sm text-outline uppercase tracking-wider">
                    {req.anonymous ? t('anonymousUser') : req.authorName}
                  </span>
                  <span className="text-[10px] text-outline-variant">{req.createdAt}</span>
                </div>
              </div>
              <p className="font-serif text-lg text-on-surface mb-6 leading-relaxed">
                {req.content}
              </p>
              <div className="flex justify-between items-center border-t border-outline-variant/30 pt-4">
                <button 
                  onClick={() => handlePray(req.id)}
                  className="flex items-center gap-2 text-xs font-button text-on-surface hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">pray</span>
                  {t('pray')} ({req.prayedCount})
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {memberVisibleRequests.length > displayLimit && (
          <button
            onClick={() => setDisplayLimit(prev => prev + 20)}
            className="w-full py-3 rounded-xl border border-outline-variant/30 text-xs font-black uppercase tracking-widest text-outline hover:text-primary hover:border-primary transition-all"
          >
            {t('loadMore') || 'Load More'} ({memberVisibleRequests.length - displayLimit} remaining)
          </button>
        )}
      </div>

      {/* Input Sidebar */}
      <div className="w-full md:w-96 shrink-0 flex flex-col gap-6">
        <div className="glass-card p-6 border-t-4 border-primary">
          <h3 className="mb-6 font-serif text-lg font-bold border-b border-outline-variant/30 pb-4">{t('sharePrayer')}</h3>
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <textarea
              value={newPrayer}
              onChange={(e) => setNewPrayer(e.target.value)}
              placeholder={t('whatsOnYourHeart')}
              className="w-full rounded-lg border border-outline-variant bg-surface-container p-4 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none h-32"
              required
            />

            <div className="flex flex-col gap-3 border border-outline-variant/50 rounded-lg p-4 bg-surface-container-low">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="w-4 h-4 text-primary rounded border-outline-variant focus:ring-primary"
                />
                <span className="font-label-sm text-on-surface cursor-pointer">{t('postAnonymously')}</span>
              </label>

              <div className="flex flex-col gap-2 mt-2">
                <span className="font-label-sm text-outline">{t('visibility')}</span>
                <select 
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container py-2 pl-3 pr-8 font-body-md text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                >
                  <option value="All Church">{tr('All Church', language)}</option>
                  <option value="Staff">{tr('Staff', language)}</option>
                  <option value="Pastors Only">{tr('Pastors Only', language)}</option>
                  <option value="My Eyes Only">{tr('My Eyes Only', language)}</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !newPrayer.trim()}
              className="w-full bg-primary text-on-primary py-3 rounded-lg font-button shadow-md shadow-primary/10 hover:opacity-90 transition-opacity disabled:opacity-50 text-xs uppercase"
            >
              {isSubmitting ? t('preparing') : t('postPrayer')}
            </button>

            {justSubmitted && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200"
              >
                <span className="material-symbols-outlined text-amber-500 text-[20px] mt-0.5 shrink-0">schedule</span>
                <div>
                  <p className="text-[12px] font-black text-amber-800">
                    {tr('✅ Prayer submitted — awaiting approval', language)}
                  </p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    {tr('Once approved by a manager, your prayer will be visible to everyone.', language)}
                  </p>
                </div>
              </motion.div>
            )}
          </form>
        </div>
      </div>
    </div>
  );

  const ManagerView = () => (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-outline-variant/20 pb-4 overflow-x-auto no-scrollbar">
        {[
          { id: 'All', label: t('allPrayersTab'), icon: 'list_alt' },
          { id: 'Pending', label: t('pendingApprovalTab'), icon: 'notification_important', count: requests.filter(r => r.status === 'Pending Approval').length },
          { id: 'Internal', label: t('staffInternalTab'), icon: 'lock' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => handleSetActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id 
                ? 'bg-primary text-on-primary shadow-lg shadow-primary/20' 
                : 'text-outline hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === tab.id ? 'bg-on-primary text-primary' : 'bg-primary text-on-primary'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 overflow-y-auto no-scrollbar pr-2 pb-8">
        <AnimatePresence mode="popLayout">
          {managerFilteredRequests.map((req) => (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={req.id} 
              className={`p-6 rounded-[24px] bg-surface-container-lowest border-2 transition-all ${
                req.status === 'Pending Approval' ? 'border-primary/50 bg-primary/5' : 'border-outline-variant/20'
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex gap-3">
                   <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary border border-outline-variant/30">
                      <span className="material-symbols-outlined text-lg">person</span>
                   </div>
                   <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-on-surface">{req.authorName}</h4>
                        {req.anonymous && (
                          <span className="px-1.5 py-0.5 rounded bg-outline-variant/30 text-outline text-[9px] font-black uppercase tracking-tighter">{tr('Anonymous to Church', language)}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-on-surface-variant font-medium opacity-70">{req.authorEmail}</p>
                   </div>
                </div>
                <div className="text-right">
                   <p className="text-[9px] font-black text-outline uppercase mb-1">{t('visibility')}</p>
                   <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                     req.visibility === 'All Church' ? 'bg-success/10 text-success border-success/20' : 'bg-primary/10 text-primary border-primary/20'
                   }`}>
                      {tValue(req.visibility, language)}
                   </span>
                </div>
              </div>

              <div className="bg-surface-container-low/50 rounded-2xl p-5 mb-6 italic relative">
                 <span className="material-symbols-outlined absolute -top-2 -left-2 text-outline-variant opacity-20 text-4xl">format_quote</span>
                 <p className="font-serif text-base text-on-surface leading-loose relative z-10">
                   {req.content}
                 </p>
                 <div className="text-right mt-4">
                    <span className="text-[10px] font-black text-outline uppercase tracking-widest">{req.createdAt}</span>
                 </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-4 border-t border-outline-variant/10">
                 {req.status === 'Pending Approval' ? (
                   <>
                      <button
                        disabled={processingId === req.id}
                        onClick={() => { setProcessingId(req.id); handleUpdateStatus(req.id, 'Published', 'All Church'); setProcessingId(null); }}
                        className="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        {t('approve')}
                      </button>
                      <button
                        disabled={processingId === req.id}
                        onClick={() => { setProcessingId(req.id); handleUpdateStatus(req.id, 'Internal', 'Staff'); setProcessingId(null); }}
                        className="flex-1 flex items-center justify-center gap-2 bg-surface-container text-on-surface py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-high transition-all disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">lock</span>
                        {t('keepInternal')}
                      </button>
                      <button
                        disabled={processingId === req.id}
                        onClick={() => { setProcessingId(req.id); handleReject(req.id); }}
                        className="p-2.5 rounded-xl bg-error/10 text-error hover:bg-error transition-all hover:text-on-error disabled:opacity-50"
                        title={t('reject')}
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                   </>
                 ) : (
                   <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-4">
                         <div className="flex items-center gap-1.5 text-xs font-bold text-outline">
                            <span className="material-symbols-outlined text-sm">pray</span>
                            {req.prayedCount}
                         </div>
                         <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${req.status === 'Published' ? 'text-success' : 'text-primary'}`}>
                            <span className="material-symbols-outlined text-sm">{req.status === 'Published' ? 'public' : 'lock_open'}</span>
                            {req.status}
                         </div>
                      </div>
                      <button 
                        onClick={() => handleReject(req.id)}
                        className="p-2 rounded-lg text-outline-variant hover:text-error transition-colors"
                        title={t('confirmedResolved')}
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                   </div>
                 )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-surface p-6 md:p-8 overflow-hidden">
      {/* Header */}
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="mb-2 font-headline-md text-on-surface">
            {mode === 'Manager' ? t('prayerWall') : t('prayerWall')}
          </h2>
          <p className="font-label-sm text-sm text-on-surface-variant uppercase tracking-widest opacity-70">
            {mode === 'Manager' ? (tr('Pastoral Management Dashboard', language)) : t('prayerWallDesc')}
          </p>
        </div>
        {mode === 'Manager' && (
          <div className="hidden md:flex flex-col items-end gap-1">
             <span className="text-[10px] font-black text-outline uppercase tracking-tighter">{tr('Administrator View', language)}</span>
             <div className="h-1 w-20 bg-primary/30 rounded-full"></div>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {mode === 'Manager' ? (
          <React.Fragment key="manager">
            {ManagerView()}
          </React.Fragment>
        ) : (
          <React.Fragment key="member">
            {MemberView()}
          </React.Fragment>
        )}
      </AnimatePresence>
    </div>
  );
}
