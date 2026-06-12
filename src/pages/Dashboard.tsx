import React, { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { UPCOMING_EVENTS, ChurchEvent } from '../constants/events';
import { motion, Reorder, useDragControls, AnimatePresence } from 'motion/react';
import { askGraceAIV2 } from '../services/geminiService';
import { isSuperAdmin, getActiveChurchId } from '../lib/permissions';
import { rosterService } from '../services/rosterService';
import { memberService } from '../services/memberService';
import { logActivity } from '../services/activityService';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay } from 'date-fns';

const verses = [
  { quote: "verse1_quote", ref: "Hebrews 11:1" },
  { quote: "verse2_quote", ref: "Ephesians 2:8-9" },
  { quote: "verse3_quote", ref: "1 Corinthians 13:8" },
  { quote: "verse4_quote", ref: "2 Corinthians 5:7" },
  { quote: "verse5_quote", ref: "John 14:27" },
  { quote: "verse6_quote", ref: "Matthew 25:21" },
];

export default function Dashboard() {
  const { mode } = useMode();
  const { t, language, isZh } = useLanguage();
  const { church, profile: currentUserProfile, user: currentUser, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const activeChurchId = getActiveChurchId(currentUserProfile, church);
  const profile = currentUserProfile;
  const _log = (action: string, target: string, _type?: string, note?: string) =>
    logActivity({ churchId: activeChurchId || '', userId: profile?.id || '', userName: profile?.full_name || 'User', userRole: profile?.role || 'Member', action, target, type: 'Resource', note });
  const [printing, setPrinting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const initialSections = useMemo(() => {
    if (mode === 'Member') return ['DailyVerse', 'MainStats'];
    if (mode === 'Staff')  return ['DailyVerse', 'MainStats', 'RosterActivity'];
    // Manager: full dashboard
    // 'RecentPulse' removed — it was placeholder/mock data
    return ['DailyVerse', 'AiAssistant', 'MainStats', 'RosterActivity'];
  }, [mode]);

  const [sections, setSections] = useState(initialSections);

  useEffect(() => {
    setSections(initialSections);
  }, [initialSections, mode]);

  const upcomingEvents = useMemo(() => {
    return UPCOMING_EVENTS.filter(e => e.status === 'Upcoming').slice(0, 3);
  }, []);

  // Manager State
  const [tasks, setTasks] = useState([
    { id: 1, title: t('followUpVisitors'), done: false },
    { id: 2, title: t('prepareSermonSlides'), done: false },
  ]);
  const [newTask, setNewTask] = useState('');
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    type: 'Service',
    date: '',
    reminder: '1 Week'
  });

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app we'd add to state/DB
    setActivities([
      { id: Date.now(), user: currentUserProfile?.full_name || 'You', action: t('scheduledAction'), target: newEvent.title, type: 'System', time: t('justNow') },
      ...activities
    ]);
    setShowAddEventModal(false);
  };

  const [pendingCount, setPendingCount] = useState(0);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<any[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    let active = true;
    async function fetchDashboardStats() {
      if (!church?.id && !isSuperAdmin(currentUserProfile, currentUser)) {
        return;
      }

      console.log('Fetching dashboard stats...', { churchId: church?.id, role: currentUserProfile?.role });
      
      try {
        setLoadingStats(true);
        
        const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

        // 1. Fetch Pending Approvals
        const fetchPending = async () => {
          let query = supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'Pending');
          if (activeChurchId) query = query.eq('church_id', activeChurchId);
          const { count, error } = await query;
          if (error) throw error;
          return count;
        };
        
        const pending = await Promise.race([fetchPending(), timeout(5000)]).catch(e => {
          console.warn('Pending fetch failed:', e);
          return 0;
        }) as number;

        if (active) setPendingCount(pending || 0);

        // 2. Fetch Birthdays
        const fetchBirthdays = async () => {
          const { data, error } = await supabase
            .from('profiles')
            .select('full_name, dob, avatar_url')
            .not('dob', 'is', null)
            .limit(50);
          if (error) return []; // dob column may not exist in all deployments
          return data;
        };

        const birthdayFolks = await Promise.race([fetchBirthdays(), timeout(5000)]).catch(e => {
          console.warn('Birthdays fetch failed:', e);
          return [];
        }) as any[];
        
        if (active) {
          const today = new Date();
          const month = today.getMonth() + 1;
          const filtered = (birthdayFolks || []).filter(p => {
            if (!p.dob) return false;
            const [, m] = p.dob.split('-').map(Number);
            return m === month;
          });
          setUpcomingBirthdays(filtered.slice(0, 3));
        }
      } catch (err) {
        console.error('Dashboard stats error:', err);
      } finally {
        if (active) setLoadingStats(false);
      }
    }
    fetchDashboardStats();
    return () => { active = false; };
  }, [church?.id, currentUserProfile?.id]);

  const [dailyVerse, setDailyVerse] = useState<{ quote: string; ref: string; isCustom?: boolean }>(verses[0]);
  const [isEditingVerse, setIsEditingVerse] = useState(false);
  const [customVerse, setCustomVerse] = useState('');
  const [customRef, setCustomRef] = useState('');

  // Sermon Edit State — persisted to localStorage
  const sermonKey = `sermon_${activeChurchId || 'demo'}`;
  const defaultSermon = {
    title: "",
    description: "",
    link: ""
  };
  const [sermon, setSermon] = useState(() => {
    try {
      const saved = localStorage.getItem(`sermon_${activeChurchId || 'demo'}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultSermon;
  });
  const [isEditingSermon, setIsEditingSermon] = useState(false);

  // Re-load sermon when church switches
  useEffect(() => {
    try {
      const saved = localStorage.getItem(sermonKey);
      setSermon(saved ? JSON.parse(saved) : defaultSermon);
    } catch {
      setSermon(defaultSermon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChurchId]);

  // Personnel & Roster Interaction State
  const [personnelSearch, setPersonnelSearch] = useState('');
  const [highlightedStaff, setHighlightedStaff] = useState<string | null>(null);
  const [dashboardStaffList, setDashboardStaffList] = useState<{ name: string; initials: string; role: string }[]>([]);
  const [dashboardAssignments, setDashboardAssignments] = useState<Record<string, { staffId: string; role: string }[]>>({});
  const [dashboardStaffById, setDashboardStaffById] = useState<Record<string, string>>({});

  // Only show full-page spinner if we don't even have a profile yet.
  if (authLoading && !currentUserProfile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if(newTask.trim()) {
      setTasks([...tasks, { id: Date.now(), title: newTask.trim(), done: false }]);
      setNewTask('');
    }
  };

  const toggleTask = (id: number) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleSaveSermon = (updates: any) => {
    const updated = { ...sermon, ...updates };
    setSermon(updated);
    try { localStorage.setItem(sermonKey, JSON.stringify(updated)); } catch {}
    setIsEditingSermon(false);
  };

  const handleSaveCustom = () => {
    if (customVerse.trim() && customRef.trim()) {
      setDailyVerse({ quote: customVerse, ref: customRef, isCustom: true });
      setIsEditingVerse(false);
    }
  };

  useEffect(() => {
    if (!activeChurchId) return;
    const monthStr = format(new Date(), 'yyyy-MM');
    Promise.all([
      memberService.getMembers(activeChurchId),
      rosterService.getRosterByMonth(activeChurchId, monthStr),
      // Fallback: fetch church members from profiles table (used when church_members table is empty)
      supabase.from('profiles').select('id, full_name, role').eq('church_id', activeChurchId),
    ]).then(([members, rosterData, profilesResult]) => {
      const profilesData = (profilesResult as any)?.data || [];
      const staffMap: Record<string, string> = {};

      // Always use profiles table as source of truth for names
      // (church_members may have local_ IDs that don't match roster staff_id UUIDs)
      const staffList = profilesData
        .filter((p: any) => p.role && p.role !== 'Pending')
        .map((p: any) => {
          const name = p.full_name || p.id;
          staffMap[p.id] = name;
          const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
          // Try to get skills/role from matching church_member
          const matched = members.find((m: any) => m.name?.toLowerCase() === name.toLowerCase());
          const role = matched ? (Array.isArray(matched.role) ? matched.role.join(' / ') : matched.role) : (p.role || '');
          return { name, initials, role };
        });

      setDashboardStaffList(staffList);
      setDashboardStaffById(staffMap);
      const asgns: Record<string, { staffId: string; role: string }[]> = {};
      rosterData.forEach((r: any) => {
        if (!asgns[r.date]) asgns[r.date] = [];
        asgns[r.date].push({ staffId: r.staff_id, role: r.role });
      });
      setDashboardAssignments(asgns);
    }).catch(() => {});
  }, [activeChurchId]);

  const [activities, setActivities] = useState([
    { id: 1, user: 'Sarah Jenkins', action: t('uploadedPpt'), target: '"10,000 Reasons"', type: 'Resource', time: '10 ' + t('minsAgo') },
    { id: 2, user: 'Mark Thompson', action: t('declinedRequest'), target: 'Oct 29th', type: 'Roster', time: '1 ' + t('hourAgo'), note: t('outOfTown') },
    { id: 3, user: 'Ps. Roland', action: t('updatedHistory'), target: 'About Page', type: 'System', time: '3 ' + t('hoursAgo') },
    { id: 4, user: 'David Chen', action: t('addedRelationship'), target: 'Mika -> Emily', type: 'Member', time: '5 ' + t('hoursAgo') },
  ]);

  // Grace AI State
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestion.trim() || aiLoading) return;
    
    setAiLoading(true);
    setAiResult(null);
    const result = await askGraceAIV2(aiQuestion, "Grace Community Church management system. Personnel: David Chen (IT), Ps. David (Lead Pastor), Sarah Michaels (Worship).", language);
    setAiResult(result);
    setAiLoading(false);
    setAiQuestion('');
  };

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      setPrinting(false);
    }, 1500);
  };

  const handleLoadMore = () => {
    setLoadingMore(true);
    setTimeout(() => {
      setLoadingMore(false);
    }, 1000);
  };

  return (
    <div className="mx-auto w-full max-w-7xl flex flex-col gap-8 p-6 md:p-10 animate-in fade-in duration-700">
      
      {/* Platform Admin Greeting */}
      {isSuperAdmin(currentUserProfile, currentUser) && (
        <div className="mb-0 p-6 rounded-[32px] bg-black text-white flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative group">
           <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[100px] rounded-full -mr-32 -mt-32"></div>
           <div className="relative z-10">
              <h2 className="text-2xl md:text-3xl font-serif font-black italic tracking-tighter">
                {isZh ? '欢迎回来，系统管理员' : 'Welcome Back, Platform Admin'}
              </h2>
              <p className="text-white/50 text-[10px] font-black uppercase tracking-[0.4em] mt-1">
                {isZh ? '您正在以超级管理员身份管理全局' : 'Global Management Controls Active'}
              </p>
           </div>
           <div className="flex gap-3 relative z-10">
              <button 
                onClick={() => navigate('/app/super-admin')}
                className="px-6 py-3 rounded-2xl bg-white text-black font-black text-[10px] uppercase tracking-widest hover:bg-primary hover:text-white transition-all shadow-xl"
              >
                {t('superAdminRole') || 'Console'}
              </button>
           </div>
        </div>
      )}

      <Reorder.Group axis="y" values={sections} onReorder={setSections} className="space-y-12">
        {sections.map(sectionId => (
          <DashboardSection 
            key={sectionId} 
            id={sectionId} 
            t={t} 
            mode={mode} 
            dailyVerse={dailyVerse} 
            setIsEditingVerse={setIsEditingVerse}
            isEditingVerse={isEditingVerse}
            setDailyVerse={setDailyVerse}
            navigate={navigate}
            personnelSearch={personnelSearch}
            setPersonnelSearch={setPersonnelSearch}
            highlightedStaff={highlightedStaff}
            setHighlightedStaff={setHighlightedStaff}
            activities={activities}
            loadingMore={loadingMore}
            handleLoadMore={handleLoadMore}
            customVerse={customVerse}
            setCustomVerse={setCustomVerse}
            customRef={customRef}
            setCustomRef={setCustomRef}
            handleSaveCustom={handleSaveCustom}
            aiQuestion={aiQuestion}
            setAiQuestion={setAiQuestion}
            aiResult={aiResult}
            aiLoading={aiLoading}
            handleAskAI={handleAskAI}
            sermon={sermon}
            isEditingSermon={isEditingSermon}
            setIsEditingSermon={setIsEditingSermon}
            handleSaveSermon={handleSaveSermon}
            pendingCount={pendingCount}
            upcomingBirthdays={upcomingBirthdays}
            loadingStats={loadingStats}
            dashboardStaffList={dashboardStaffList}
            dashboardAssignments={dashboardAssignments}
            dashboardStaffById={dashboardStaffById}
            church={church}
          />
        ))}
      </Reorder.Group>



      {/* Add Event Modal (Ported back) */}
      {showAddEventModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form 
            onSubmit={handleAddEvent}
            className="w-full max-w-md rounded-3xl border border-outline-variant bg-surface-container-lowest p-8 shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-serif text-2xl font-bold text-on-surface">{t('addNewEvent')}</h3>
              <button type="button" onClick={() => setShowAddEventModal(false)} className="material-symbols-outlined rounded-full bg-surface-container p-2 text-outline">close</button>
            </div>
            
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1">{t('eventTitle')}</label>
                <input
                  type="text"
                  required
                  value={newEvent.title}
                  onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="e.g. Church Anniversary"
                  className="rounded-2xl border border-outline-variant bg-surface p-4 text-sm outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1">{t('type')}</label>
                  <select
                    value={newEvent.type}
                    onChange={e => setNewEvent({ ...newEvent, type: e.target.value as any })}
                    className="rounded-2xl border border-outline-variant bg-surface p-4 text-sm outline-none transition-all focus:border-primary px-4"
                  >
                    <option value="Service">{t('sundayWorshipService')}</option>
                    <option value="Wedding">{t('johnMaryWedding')}</option>
                    <option value="Camp">{t('camping')}</option>
                    <option value="Festival">{t('holyCommunion')}</option>
                    <option value="Meeting">{t('meeting') || 'Meeting'}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1">{t('date')}</label>
                  <input
                    type="date"
                    required
                    value={newEvent.date}
                    onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                    className="rounded-2xl border border-outline-variant bg-surface p-4 text-sm outline-none transition-all focus:border-primary px-4"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1">{t('reminder')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {['None', '1 Week', '1 Month'].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewEvent({ ...newEvent, reminder: r })}
                      className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                        newEvent.reminder === r 
                          ? 'bg-primary text-on-primary border-primary shadow-lg shadow-primary/20' 
                          : 'bg-surface border-outline-variant text-outline hover:bg-surface-container'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-10 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddEventModal(false)}
                className="flex-1 rounded-2xl py-3 font-button text-sm text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                className="flex-[2] rounded-2xl bg-primary py-3 font-button text-sm text-on-primary shadow-xl shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98]"
              >
                {t('createEvent')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DashboardSection({
  id, t, mode, dailyVerse, setIsEditingVerse, isEditingVerse, setDailyVerse,
  navigate, personnelSearch, setPersonnelSearch, highlightedStaff, setHighlightedStaff,
  activities, loadingMore, handleLoadMore, customVerse, setCustomVerse, customRef,
  setCustomRef, handleSaveCustom, aiQuestion, setAiQuestion, aiResult, aiLoading,
  handleAskAI, sermon, isEditingSermon, setIsEditingSermon, handleSaveSermon,
  pendingCount, upcomingBirthdays, loadingStats,
  dashboardStaffList, dashboardAssignments, dashboardStaffById, church
}: any) {
  const controls = useDragControls();

  const [editSermonData, setEditSermonData] = useState(sermon);
  useEffect(() => {
    if (isEditingSermon) setEditSermonData(sermon);
  }, [isEditingSermon, sermon]);

  return (
    <Reorder.Item 
      value={id} 
      dragListener={false} 
      dragControls={controls}
      className="relative group/reorder z-0 active:z-50"
    >
      {/* Modern Drag Handle */}
      <div 
        onPointerDown={(e) => controls.start(e)}
        className="absolute -right-4 top-4 opacity-0 group-hover/reorder:opacity-100 transition-opacity cursor-grab active:cursor-grabbing w-10 h-10 bg-white rounded-xl shadow-xl flex items-center justify-center border border-outline-variant/20 hover:bg-primary hover:text-white z-50 transition-all active:scale-110"
      >
         <span className="material-symbols-outlined text-lg">drag_indicator</span>
      </div>

      {id === 'DailyVerse' && (
        <section className={`relative overflow-hidden rounded-[32px] transition-all duration-500 border border-outline-variant/10 shadow-xl shadow-primary/5 group/verse ${isEditingVerse ? 'bg-white p-6 md:p-8' : 'bg-primary-container p-5 md:p-8'}`}>
          {!isEditingVerse && <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary-container/80 via-primary-container to-primary/10"></div>}
          
          {isEditingVerse ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }}
              className="relative z-10 flex flex-col md:flex-row gap-8"
            >
               {/* Left: Custom Input */}
               <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                     <div>
                        <h3 className="text-lg font-serif font-black text-on-surface">{t('customWrite')}</h3>
                        <p className="text-[9px] font-black uppercase tracking-widest text-outline opacity-60">Personalize your message</p>
                     </div>
                     <button onClick={() => setIsEditingVerse(false)} className="md:hidden h-8 w-8 rounded-lg bg-surface-container flex items-center justify-center">
                        <span className="material-symbols-outlined text-sm">close</span>
                     </button>
                  </div>
                  <textarea 
                    className="w-full h-24 p-4 rounded-xl bg-surface-container-low border border-outline-variant/10 focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none font-spiritual-quote text-sm leading-relaxed transition-all resize-none"
                    placeholder={t('writeVersePlaceholder')}
                    value={customVerse}
                    onChange={(e) => setCustomVerse(e.target.value)}
                  />
                  <div className="flex gap-2">
                     <input 
                       type="text"
                       className="flex-1 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10 focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none font-serif italic text-xs transition-all"
                       placeholder="Reference (e.g. Psalms 23:1)"
                       value={customRef}
                       onChange={(e) => setCustomRef(e.target.value)}
                     />
                     <button 
                       onClick={handleSaveCustom}
                       disabled={!customVerse.trim() || !customRef.trim()}
                       className="px-6 rounded-xl bg-black text-white font-black text-[10px] uppercase tracking-widest hover:bg-primary transition-all disabled:opacity-20 flex items-center gap-2"
                     >
                        {t('applyCustom')}
                     </button>
                  </div>
               </div>

               {/* Divider */}
               <div className="hidden md:block w-px bg-outline-variant/20"></div>

               {/* Right: Presets */}
               <div className="flex-1">
                  <div className="flex items-center justify-between mb-4">
                     <h3 className="text-[10px] font-black uppercase tracking-widest text-outline">{t('presets')}</h3>
                     <button onClick={() => setIsEditingVerse(false)} className="hidden md:flex h-8 w-8 rounded-lg bg-surface-container hover:bg-black hover:text-white transition-all items-center justify-center group shrink-0">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                     </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-2 no-scrollbar">
                     {verses.map((v: any, i: number) => (
                       <button 
                         key={i}
                         onClick={() => {
                           setDailyVerse(v);
                           setIsEditingVerse(false);
                         }}
                         className={`p-3 rounded-xl text-left border transition-all ${dailyVerse.quote === v.quote ? 'border-primary bg-primary/5' : 'border-transparent bg-surface-container-low hover:bg-surface-container-high'}`}
                       >
                          <p className={`text-[10px] font-spiritual-quote leading-tight line-clamp-2 mb-1 ${dailyVerse.quote === v.quote ? 'text-primary' : 'text-on-surface'}`}>"{t(v.quote)}"</p>
                          <span className="text-[8px] font-serif italic text-outline opacity-60">— {v.ref}</span>
                       </button>
                     ))}
                  </div>
               </div>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }}
              className="relative z-10 flex flex-col items-center text-center"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px w-8 bg-primary/30"></span>
                <h3 className="text-[9px] uppercase tracking-[0.2em] text-primary font-black opacity-60">{t('dailyGoldenVerse')}</h3>
                <span className="h-px w-8 bg-primary/30"></span>
              </div>
              
              <p className="max-w-2xl font-spiritual-quote text-lg md:text-xl leading-snug text-on-primary-container">
                "{dailyVerse.isCustom ? dailyVerse.quote : t(dailyVerse.quote)}"
              </p>
              <p className="mt-2.5 font-serif text-sm italic text-primary/60">— {dailyVerse.ref}</p>
              
              {mode === 'Manager' && (
                <button 
                  onClick={() => setIsEditingVerse(true)}
                  className="mt-6 flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[10px] font-black uppercase tracking-widest text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                >
                  <span className="material-symbols-outlined text-sm">edit</span>
                  {t('editBtn')}
                </button>
              )}
            </motion.div>
          )}
        </section>
      )}

      {id === 'AiAssistant' && (
        <section className="rounded-[32px] bg-white p-8 border border-outline-variant/30 shadow-sm transition-all hover:shadow-xl hover:shadow-primary/5 group/ai">
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover/ai:bg-primary group-hover/ai:text-white transition-all">
                <span className="material-symbols-outlined filled">smart_toy</span>
              </div>
              <div>
                <h3 className="font-serif text-xl font-black text-on-surface">Grace Assistant</h3>
                <p className="text-[9px] font-black uppercase tracking-widest text-outline opacity-70">Church Intelligence</p>
              </div>
            </div>
          </header>

          <form onSubmit={handleAskAI} className="relative mb-6">
            <input 
              type="text"
              placeholder={t('askGrace') || "Ask about roster, members, or tasks..."}
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              className="w-full bg-surface-container-low border-2 border-transparent pl-6 pr-16 py-4 rounded-2xl focus:border-primary/30 focus:bg-white outline-none font-bold text-sm transition-all"
            />
            <button 
              type="submit"
              disabled={aiLoading || !aiQuestion.trim()}
              className="absolute right-2 top-2 bottom-2 px-4 rounded-xl bg-black text-white hover:bg-primary disabled:opacity-20 transition-all"
            >
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </form>

          <AnimatePresence mode="wait">
            {aiResult && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-5 rounded-2xl bg-primary-container/20 border border-primary/10"
              >
                <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{aiResult.message}</p>
                
                <div className="mt-4 flex flex-wrap gap-2">
                   {aiResult.suggestRosterButton && (
                     <button 
                       onClick={() => navigate('/app/roster')}
                       className="px-3 py-1.5 bg-black text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                     >
                        Roster
                     </button>
                   )}
                   {aiResult.suggestMembersButton && (
                     <button 
                       onClick={() => navigate('/app/members')}
                       className="px-3 py-1.5 bg-primary text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                     >
                        Members
                     </button>
                   )}
                   {aiResult.suggestTasksButton && (
                     <button 
                       onClick={() => navigate('/app/tasks')}
                       className="px-3 py-1.5 bg-tertiary text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                     >
                        Tasks
                     </button>
                   )}
                   <button 
                    onClick={() => navigate('/app/ai')}
                    className="ml-auto text-[9px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1"
                   >
                     {t('openFullChat') || 'Full Chat'}
                     <span className="material-symbols-outlined text-xs">open_in_new</span>
                   </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {id === 'MainStats' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className={`${mode === 'Manager' ? 'lg:col-span-7' : 'lg:col-span-12'} overflow-hidden rounded-[32px] bg-white border border-outline-variant/30 shadow-sm p-8 md:p-12 flex flex-col justify-center relative group/inner transition-all duration-500 ${isEditingSermon ? 'ring-2 ring-primary bg-primary/[0.01]' : ''}`}>
             {!isEditingSermon ? (
               <>
                 <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest">{t('latestSermon')}</span>
                       <div className="h-1 w-1 rounded-full bg-primary/30"></div>
                       <span className="text-[10px] font-bold text-outline uppercase tracking-widest">LIVE RECORDING</span>
                    </div>
                    {mode === 'Manager' && (
                      <button 
                        onClick={() => setIsEditingSermon(true)}
                        className="h-8 w-8 rounded-lg bg-surface-container hover:bg-black hover:text-white transition-all flex items-center justify-center opacity-0 group-hover/inner:opacity-100"
                      >
                         <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                    )}
                 </div>
                 <h3 className="text-4xl font-serif font-black text-on-surface mb-4 leading-tight">{sermon.title}</h3>
                 <p className="text-on-surface-variant text-base leading-relaxed mb-8 opacity-70">
                   {sermon.description}
                 </p>
                 <a 
                  href={sermon.link} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 w-fit rounded-2xl bg-black px-8 py-4 text-xs font-black uppercase tracking-widest text-white hover:bg-primary transition-all shadow-xl shadow-black/10 group"
                 >
                   <span className="material-symbols-outlined text-sm">play_circle</span>
                   {t('watchOnYoutube')}
                   <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                 </a>
               </>
             ) : (
               <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-serif font-black text-on-surface">{t('editSermon') || 'Edit Sermon Details'}</h3>
                    <button onClick={() => setIsEditingSermon(false)} className="h-8 w-8 rounded-lg bg-surface-container hover:bg-black hover:text-white transition-all flex items-center justify-center">
                       <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                  
                  <div className="space-y-1">
                     <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('sermonTitle') || 'Sermon Title'}</label>
                     <input 
                        type="text"
                        className="w-full p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 focus:border-primary outline-none font-bold text-sm"
                        value={editSermonData.title}
                        onChange={e => setEditSermonData({...editSermonData, title: e.target.value})}
                     />
                  </div>

                  <div className="space-y-1">
                     <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('description') || 'Description'}</label>
                     <textarea 
                        className="w-full h-24 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 focus:border-primary outline-none text-sm resize-none"
                        value={editSermonData.description}
                        onChange={e => setEditSermonData({...editSermonData, description: e.target.value})}
                     />
                  </div>

                  <div className="space-y-1">
                     <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('youtubeLink') || 'YouTube Link'}</label>
                     <input 
                        type="url"
                        className="w-full p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 focus:border-primary outline-none font-mono text-xs"
                        value={editSermonData.link}
                        onChange={e => setEditSermonData({...editSermonData, link: e.target.value})}
                     />
                  </div>

                  <div className="flex gap-2 pt-2">
                     <button 
                       onClick={() => setIsEditingSermon(false)}
                       className="flex-1 py-3 h-12 rounded-xl bg-surface-container text-on-surface-variant font-black text-[10px] uppercase tracking-widest transition-all"
                     >
                        {t('cancel')}
                     </button>
                     <button 
                       onClick={() => handleSaveSermon(editSermonData)}
                       className="flex-[2] py-3 h-12 rounded-xl bg-black text-white font-black text-[10px] uppercase tracking-widest hover:bg-primary transition-all shadow-xl shadow-black/10"
                     >
                        {t('saveChanges')}
                     </button>
                  </div>
               </div>
             )}
          </div>

          {mode === 'Manager' && <div className="lg:col-span-12 xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-1 gap-4">
             {/* Team Prep */}
             <div className="p-6 rounded-[28px] bg-surface-container-low border border-outline-variant/20 flex flex-col justify-center flex-1 transition-all hover:bg-surface-container-high cursor-pointer" onClick={() => navigate('/app/roster')}>
                <div className="flex items-center justify-between mb-4">
                   <div className="h-10 w-10 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary">
                      <span className="material-symbols-outlined filled">diversity_3</span>
                   </div>
                   <span className="text-[10px] font-black text-outline uppercase tracking-widest">Readiness</span>
                </div>
                <h4 className="font-bold text-on-surface text-sm mb-2">{t('teamPreparation')}</h4>
                <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                   <div className="h-full bg-secondary w-3/4 rounded-full"></div>
                </div>
                <p className="mt-2 text-[10px] font-bold text-secondary">{dashboardStaffList.length > 0 ? `${dashboardStaffList.length} ${t('members')} confirmed` : ''}</p>
             </div>

             {/* Upcoming Birthdays (New Component) */}
             <div className="p-6 rounded-[28px] bg-gradient-to-br from-[#FFF7ED] to-white border border-orange-100 flex flex-col justify-center flex-1 transition-all hover:shadow-lg">
                <div className="flex items-center justify-between mb-4">
                   <div className="h-10 w-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                      <span className="material-symbols-outlined filled">cake</span>
                   </div>
                   <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">{t('thisMonth') || 'This Month'}</span>
                </div>
                <h4 className="font-bold text-on-surface text-sm mb-3">{t('upcomingBirthdays') || 'Upcoming Birthdays'}</h4>
                <div className="flex flex-col gap-2">
                   {loadingStats ? (
                     <div className="flex justify-center p-4">
                        <div className="w-4 h-4 rounded-full border-2 border-orange-400 border-t-transparent animate-spin"></div>
                     </div>
                   ) : upcomingBirthdays.length > 0 ? upcomingBirthdays.map((p, i) => (
                      <div key={i} className="flex items-center gap-3">
                         <div className="h-6 w-6 rounded-full bg-orange-200 overflow-hidden flex items-center justify-center">
                            {p.avatar_url ? <img src={p.avatar_url} className="h-full w-full object-cover" /> : <span className="text-[10px] font-bold text-orange-800">{p.full_name?.charAt(0)}</span>}
                         </div>
                         <span className="text-xs font-medium text-on-surface line-clamp-1">{p.full_name}</span>
                         <span className="text-[10px] text-orange-400 ml-auto font-black">{p.dob ? p.dob.split('-').slice(1).join('/') : ''}</span>
                      </div>
                   )) : <p className="text-[10px] text-outline italic">No birthdays this month</p>}
                </div>
             </div>

             {/* Pending Items */}
             <div className="p-6 rounded-[28px] bg-surface-container-low border border-outline-variant/20 flex flex-col justify-center flex-1 transition-all hover:bg-surface-container-high cursor-pointer" onClick={() => navigate('/app/approvals')}>
                <div className="flex items-center justify-between mb-4">
                   <div className="h-10 w-10 rounded-xl bg-tertiary/10 flex items-center justify-center text-tertiary">
                      <span className="material-symbols-outlined filled">assignment_late</span>
                   </div>
                   <span className="text-[10px] font-black text-outline uppercase tracking-widest">Pending</span>
                </div>
                <h4 className="font-bold text-on-surface text-sm">{t('pendingItems')}</h4>
                {loadingStats ? (
                   <div className="mt-4 flex animate-pulse">
                      <div className="h-8 w-12 bg-surface-container rounded-lg"></div>
                   </div>
                 ) : (
                   <p className="text-3xl font-serif font-black text-tertiary mt-1">
                     {pendingCount} <span className="text-xs font-bold text-on-surface-variant tracking-normal">{t('actionRequired')}</span>
                   </p>
                 )}
             </div>

             {/* Sunday Worship Service */}
             {church?.meeting_time && (
             <div className="p-6 rounded-[28px] bg-black border border-white/10 flex flex-col justify-center lg:col-span-2 xl:col-span-1 min-h-[140px] transition-all hover:bg-primary group cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                   <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center text-white group-hover:bg-white/20">
                      <span className="material-symbols-outlined text-sm filled">church</span>
                   </div>
                   <span className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] group-hover:text-white/80">{t('sundayWorship')}</span>
                </div>
                <h4 className="font-serif text-lg font-black text-white leading-tight">{church?.name || ''}</h4>
                <p className="text-[10px] font-medium text-white/40 mt-1 group-hover:text-white/70">{church.meeting_time}</p>
             </div>
             )}
          </div>}
        </section>
      )}

      {id === 'RosterActivity' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
           {/* Personnel List */}
          <div className="lg:col-span-4 rounded-[32px] bg-white p-8 border border-outline-variant/30 shadow-sm flex flex-col h-[650px]">
             <header className="flex flex-col gap-6 mb-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary/10 text-secondary">
                      <span className="material-symbols-outlined filled">group</span>
                   </div>
                   <div>
                      <h3 className="font-serif text-2xl font-black text-on-surface">{t('personnel')}</h3>
                      <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-70">{t('allStaff')}</p>
                   </div>
                </div>
                <Link to="/app/roster" className="material-symbols-outlined text-outline hover:text-primary transition-colors">settings</Link>
              </div>

              <div className="relative group/search">
                 <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline/50 group-focus-within/search:text-primary transition-colors">search</span>
                 <input 
                   type="text"
                   placeholder={t('searchStaff') || 'Search staff...'}
                   value={personnelSearch}
                   onChange={(e) => setPersonnelSearch(e.target.value)}
                   className="w-full bg-surface-container-low border-2 border-transparent pl-12 pr-4 py-3 rounded-2xl focus:border-primary/30 focus:bg-white outline-none font-bold text-sm transition-all"
                 />
              </div>
            </header>
            
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
               {dashboardStaffList.length === 0 && (
                 <div className="flex flex-col items-center justify-center h-40 text-outline opacity-40">
                   <span className="material-symbols-outlined text-4xl mb-2">group</span>
                   <p className="text-xs font-bold uppercase tracking-widest">{t('noStaffData') || 'No staff data'}</p>
                 </div>
               )}
               {dashboardStaffList.filter(s => s.name.toLowerCase().includes(personnelSearch.toLowerCase()) || s.role.toLowerCase().includes(personnelSearch.toLowerCase()))
                .map((staff, i) => (
                 <button 
                  key={i} 
                  onClick={() => setHighlightedStaff(highlightedStaff === staff.name ? null : staff.name)}
                  className={`flex w-full items-center gap-4 p-4 rounded-3xl border transition-all group text-left ${highlightedStaff === staff.name ? 'border-primary bg-primary/5 shadow-lg' : 'border-outline-variant/10 hover:bg-surface-container-low'}`}
                 >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-serif font-black text-lg transition-all ${highlightedStaff === staff.name ? 'bg-primary text-white' : 'bg-surface-container text-outline group-hover:bg-primary group-hover:text-white'}`}>
                       {staff.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className={`text-sm font-bold truncate ${highlightedStaff === staff.name ? 'text-primary' : 'text-on-surface'}`}>{staff.name}</p>
                       <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-50">{staff.role}</p>
                    </div>
                 </button>
               ))}
            </div>
          </div>

          {/* Expanded Roster Table */}
          <div className="lg:col-span-8 rounded-[32px] bg-white p-8 border border-outline-variant/30 shadow-sm flex flex-col h-[650px] overflow-hidden">
            <header className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                 <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <span className="material-symbols-outlined filled">calendar_month</span>
                 </div>
                 <div>
                    <h3 className="font-serif text-2xl font-black text-on-surface">{t('serviceRoster')}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-70">Comprehensive View • Scroll for all positions</p>
                 </div>
              </div>
              <Link to="/app/roster" className="text-xs font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-2">
                {t('viewAll')}
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </Link>
            </header>

            {/* Horizontal Scroll Area */}
            <div className="overflow-x-auto rounded-3xl border border-outline-variant/10 flex-1">
              <table className="w-full text-left border-collapse min-w-[1500px]">
                <thead>
                  <tr className="bg-surface-container-low/30">
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 sticky left-0 bg-surface-container-low/90 backdrop-blur-md z-10 min-w-[120px]">Sunday</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[160px]">Preacher</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[160px]">Worship Lead</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[160px]">Piano / Keys</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[160px]">Guitars</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[150px]">Audio (Sound)</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[150px]">Media (Slides)</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[160px]">Sunday School</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[140px]">Ushering</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[140px]">Welcoming</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/10 min-w-[140px]">Kitchen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {(() => {
                    const now = new Date();
                    const sundays = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) }).filter(d => getDay(d) === 0);
                    const getNames = (dateStr: string, role: string) => {
                      const entries = (dashboardAssignments[dateStr] || []).filter(a => a.role === role);
                      if (entries.length === 0) return null;
                      return entries.map(a => dashboardStaffById[a.staffId] || a.staffId).join(', ');
                    };
                    const getRoleNames = (dateStr: string, roles: string[]) => {
                      for (const r of roles) { const n = getNames(dateStr, r); if (n) return n; }
                      return null;
                    };
                    const rows = sundays.map(d => {
                      const dateStr = format(d, 'yyyy-MM-dd');
                      const day = d.getDate();
                      const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
                      return {
                        date: format(d, 'MMM') + ' ' + day + suffix,
                        preaching: getRoleNames(dateStr, ['Preaching', 'Preacher', '讲道']),
                        worship: getRoleNames(dateStr, ['Worship', 'Worship Lead', 'Lead Singer', '敬拜']),
                        piano: getRoleNames(dateStr, ['Piano / Keys', 'Piano', 'Musician', '主唱', '乐手']),
                        guitar: getRoleNames(dateStr, ['Guitars', 'Guitar', '吉他']),
                        audio: getRoleNames(dateStr, ['Audio (Sound)', 'Audio', 'IT', '音响']),
                        media: getRoleNames(dateStr, ['Media (Slides)', 'Media', '媒体', 'PPT']),
                        ss: getRoleNames(dateStr, ['Sunday School', 'Sunday School Teacher', '儿童主日学']),
                        usher: getRoleNames(dateStr, ['Usher', 'Ushering', '招待', '接待']),
                        greeter: getRoleNames(dateStr, ['Welcoming', 'Greeter', '迎宾']),
                        kitchen: getRoleNames(dateStr, ['Kitchen', '厨房']),
                      };
                    });
                    return rows.map((row, i) => (
                    <tr key={i} className="hover:bg-primary/5 transition-colors group">
                      <td className="p-6 sticky left-0 bg-white/90 backdrop-blur-md z-10 border-r border-outline-variant/5">
                        <span className="text-sm font-black text-on-surface">{row.date}</span>
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.preaching} highlight={highlightedStaff} />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.worship} highlight={highlightedStaff} color="bg-primary" />
                      </td>
                      <td className="p-6 text-sm font-medium text-on-surface-variant">
                         <StaffChip name={row.piano} highlight={highlightedStaff} color="bg-secondary" />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.guitar} highlight={highlightedStaff} color="bg-secondary" />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.audio} highlight={highlightedStaff} color="bg-tertiary" />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.media} highlight={highlightedStaff} color="bg-tertiary" />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.ss} highlight={highlightedStaff} />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.usher} highlight={highlightedStaff} isPill />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.greeter} highlight={highlightedStaff} isPill />
                      </td>
                      <td className="p-6">
                         <StaffChip name={row.kitchen} highlight={highlightedStaff} color="bg-primary/40" />
                      </td>
                    </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {id === 'RecentPulse' && (
        <section className="rounded-[32px] bg-surface-container-lowest p-8 border border-outline-variant/30 flex flex-col">
          <header className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1.5 rounded-full bg-primary/40"></div>
              <h3 className="font-serif text-2xl font-bold text-on-surface">{t('recentActivity')}</h3>
            </div>
            <span className="text-xs font-bold text-outline tracking-widest uppercase">Sample Data</span>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            {activities.slice(0, 4).map((activity: any) => (
              <div key={activity.id} className="flex items-start gap-4 p-3 rounded-2xl transition-colors hover:bg-surface-container-low group">
                <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ring-transparent group-hover:ring-surface ${
                  activity.type === 'Resource' ? 'bg-primary' :
                  activity.type === 'Roster' ? 'bg-secondary' :
                  activity.type === 'System' ? 'bg-tertiary' : 'bg-outline-variant'
                }`}></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-on-surface truncate">{activity.user}</p>
                    <p className="text-[10px] text-outline whitespace-nowrap">{activity.time}</p>
                  </div>
                  <p className="text-sm text-on-surface-variant">
                    {activity.action} <span className="text-primary font-medium">{activity.target}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-8 pt-6 border-t border-outline-variant/10 flex justify-center">
              <button 
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/70 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? t('loading') : t('loadMore')}
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
          </div>
        </section>
      )}
    </Reorder.Item>
  );
}

function StaffChip({ name, highlight, color = "bg-black", isPill = false }: any) {
  if (!name) return <span className="text-outline/30 text-xs">—</span>;
  if (isPill) {
    return (
      <span className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${highlight === name ? 'bg-primary text-white shadow-lg scale-110' : 'bg-surface-container'}`}>{name}</span>
    );
  }
  return (
    <div className={`flex items-center gap-2 p-2 rounded-xl transition-all ${highlight === name ? 'bg-primary/20 ring-2 ring-primary scale-105' : ''}`}>
       <div className={`w-2 h-2 rounded-full ${color}`}></div>
       <span className={`text-xs font-medium leading-none ${highlight === name ? 'text-primary font-black' : 'text-on-surface-variant'}`}>{name}</span>
    </div>
  );
}



