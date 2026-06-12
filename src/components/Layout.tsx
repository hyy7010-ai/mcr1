import { ReactNode, useState, useRef, useEffect } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMode, Mode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { isSuperAdmin, canManageChurch, canDoStaff, isDemoChurch, getActiveChurchId } from '../lib/permissions';
import { socialService, AppNotification } from '../services/socialService';
import OnboardingModal, { needsOnboarding } from './OnboardingModal';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, setMode } = useMode();
  const { t, language, setLanguage, isZh } = useLanguage();
  const { user, signOut, church, profile, updateChurch } = useAuth();
  const [isModeOpen, setIsModeOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [pendingAppsCount, setPendingAppsCount] = useState(0);
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [composeAudience, setComposeAudience] = useState<'Staff' | 'all'>('Staff');
  const [composeText, setComposeText] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => needsOnboarding(user?.id, profile?.role, profile?.onboarding_completed));
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModeOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setIsHelpOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const canManage = canManageChurch(profile, user);
  const canStaff = canDoStaff(profile, user);
  const activeChurchId = getActiveChurchId(profile, church);

  const loadNotifs = async () => {
    if (!activeChurchId) return;
    const list = await socialService.getNotifications(activeChurchId, profile?.id, profile?.role);
    setNotifs(list);
  };

  // Load notifications on mount + poll every 60s + reload when the bell opens
  useEffect(() => {
    loadNotifs();
    const id = setInterval(loadNotifs, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChurchId, profile?.id, profile?.role]);

  useEffect(() => { if (isNotifOpen) loadNotifs(); /* eslint-disable-next-line */ }, [isNotifOpen]);

  const unreadCount = notifs.filter(n => !n.read).length + pendingAppsCount;

  const handleNotifClick = async (n: AppNotification) => {
    if (!n.read && activeChurchId) {
      await socialService.markRead(n.id, activeChurchId);
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
    if (n.link) { navigate(n.link); setIsNotifOpen(false); }
  };

  const handleMarkAll = async () => {
    if (!activeChurchId) return;
    await socialService.markAllRead(activeChurchId, profile?.id, profile?.role);
    setNotifs(prev => prev.map(x => ({ ...x, read: true })));
  };

  // Managers send a message to all Staff (同工) or everyone.
  const handleSendBroadcast = async () => {
    const text = composeText.trim();
    if (!text || !activeChurchId || composeSending) return;
    setComposeSending(true);
    try {
      await socialService.addNotification({
        church_id: activeChurchId,
        recipient_id: null,
        recipient_role: composeAudience === 'Staff' ? 'Staff' : null,
        sender_id: profile?.id || null,
        sender_name: profile?.full_name || 'Manager',
        type: 'message',
        title: (profile?.full_name || 'Manager') + (isZh ? ' 发来消息' : ' sent a message'),
        body: text,
        link: null,
      });
      setComposeText('');
      setShowCompose(false);
      loadNotifs();
    } finally {
      setComposeSending(false);
    }
  };
  const isPlatformAdmin = isSuperAdmin(profile, user);
  const isDemo = isDemoChurch(church);

  useEffect(() => {
    (async () => {
      try {
        const { count } = await supabase.from('church_applications').select('*', { count: 'exact', head: true }).eq('status', 'Pending');
        setPendingAppsCount(count || 0);
      } catch {}
    })();
  }, []);
  
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !church?.id) return;
    
    setIsLogoUploading(true);
    try {
      // Handle Demo Mode
      if (isDemo) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          updateChurch({ logo_url: base64String });
          setIsLogoUploading(false);
        };
        reader.readAsDataURL(file);
        return; // Exit early as reader.onloadend will handle the rest
      }

      // Convert to base64 (max 400px wide) — no Storage bucket needed
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const maxW = 400;
            const scale = img.width > maxW ? maxW / img.width : 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = ev.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const publicUrl = base64;

      const { error: updateError } = await supabase
        .from('churches')
        .update({ logo_url: publicUrl })
        .eq('id', church.id);

      if (updateError) throw updateError;
      
      updateChurch({ logo_url: publicUrl });
    } catch (err: any) {
      console.error('Logo upload error:', err);
      alert(err.message || 'Upload failed');
    } finally {
      if (!isDemo) setIsLogoUploading(false);
    }
  };

  const modeOptions: { value: Mode; label: string; icon: string; desc: string; color: string }[] = [
    ...(canManage ? [{ value: 'Manager' as Mode, label: t('managerMode'), icon: 'admin_panel_settings', desc: 'Full access', color: 'text-primary' }] : []),
    ...(canStaff ? [{ value: 'Staff' as Mode, label: t('staffMode'), icon: 'badge', desc: 'Roster & Items', color: 'text-secondary' }] : []),
    { value: 'Member', label: t('memberMode'), icon: 'person', desc: 'Church activities', color: 'text-outline' },
  ];

  const currentModeInfo = modeOptions.find(opt => opt.value === mode) || modeOptions[0];

  const getNavItems = () => {
    if (mode === 'Member') {
      return [
        { icon: 'dashboard', label: t('dashboard'), path: '/app/dashboard' },
        { icon: 'church', label: t('aboutChurch'), path: '/app/about' },
        { icon: 'group', label: t('members'), path: '/app/members' },
        { icon: 'volunteer_activism', label: t('prayerWall'), path: '/app/prayer' },
        { icon: 'favorite', label: t('giving'), path: '/app/giving' },
        { icon: 'groups', label: t('groups'), path: '/app/groups' },
      ];
    }
    
    // Staff/Manager see similar things but permissions will differ inside pages
    const allStaffItems = [
      { icon: 'dashboard', label: t('dashboard'), path: '/app/dashboard' },
      { icon: 'church', label: t('aboutChurch'), path: '/app/about' },
      { icon: 'groups', label: t('groups'), path: '/app/groups' },
      { icon: 'group', label: t('members'), path: '/app/members' },
      { icon: 'task_alt', label: t('tasks'), path: '/app/tasks' },
      { icon: 'calendar_month', label: t('roster'), path: '/app/roster' },
      { icon: 'newspaper', label: t('bulletin') || 'Weekly Bulletin', path: '/app/bulletin' },
      { icon: 'menu_book', label: t('publications') || '免费刊物', path: '/app/publications' },
      { icon: 'music_note', label: t('worshipSongs'), path: '/app/songs' },
      { icon: 'present_to_all', label: t('readyPptLib'), path: '/app/ready' },
      { icon: 'volunteer_activism', label: t('prayerWall'), path: '/app/prayer' },
      { icon: 'favorite', label: t('giving'), path: '/app/giving' },
    ];

    // Staff mode: remove Tasks and Weekly Bulletin (management-only tools)
    const staffExclude = ['/app/tasks', '/app/bulletin'];
    const items = mode === 'Staff'
      ? allStaffItems.filter(i => !staffExclude.includes(i.path))
      : allStaffItems;

    if (mode === 'Manager') {
      items.splice(1, 0, { icon: 'smart_toy', label: 'Grace Assistant', path: '/app/ai' });
      items.splice(2, 0, { icon: 'how_to_reg', label: language.startsWith('zh') ? '成员审核' : 'Approvals', path: '/app/approvals' });
      // Activity Log is Manager-only
      items.push({ icon: 'history', label: t('activityLog') || 'Activity Log', path: '/app/activity' });
      items.push({ icon: 'build', label: language.startsWith('zh') ? '管理工具' : 'Tools', path: '/app/tools' });
    }

    if (isPlatformAdmin) {
      items.push({ icon: 'admin_panel_settings', label: isZh ? '平台管理控制台' : 'Platform Console', path: '/app/super-admin' });
    }

    return items;
  };

  const navItems = getNavItems();

  const APP_VERSION = "v2.9.0-Lyrics";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface transition-colors duration-300">
      {/* Onboarding modal for new Member/Staff users */}
      {showOnboarding && (
        <OnboardingModal onDone={() => setShowOnboarding(false)} />
      )}

      {/* Sidebar */}
      <nav className="fixed left-0 top-0 h-full w-72 flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest py-6 z-50 shadow-2xl print:hidden">
        <div className="px-6 mb-8 flex flex-col gap-1 group">
          <div 
            onClick={() => (mode === 'Manager' || isPlatformAdmin) && logoInputRef.current?.click()}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/20 transition-all overflow-hidden relative ${
              (mode === 'Manager' || isPlatformAdmin) ? 'cursor-pointer hover:scale-110 active:scale-95' : ''
            } ${isLogoUploading ? 'opacity-50' : 'bg-primary'}`}
          >
            {church?.logo_url ? (
              <img src={church.logo_url} className="w-full h-full object-cover" alt="Church Logo" />
            ) : (
              <span className="material-symbols-outlined text-white text-2xl">church</span>
            )}
            {(mode === 'Manager' || isPlatformAdmin) && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="material-symbols-outlined text-white text-lg">upload</span>
              </div>
            )}
            {isLogoUploading && (
              <div className="absolute inset-0 bg-white/20 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
          <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
          <h1 className="text-xl font-black text-on-surface tracking-tight font-serif italic hover:text-primary transition-colors line-clamp-2 cursor-default flex items-center gap-2">
            {church?.name || (isPlatformAdmin ? '平台管理控制台' : '...')}
            {isPlatformAdmin && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}
          </h1>
          <p className="text-[10px] font-black text-outline uppercase tracking-[0.2em]">{church?.church_code || (isPlatformAdmin ? 'Super Admin Console' : 'Ministry Management System')}</p>
        </div>

        {/* Custom Mode Switcher - Refined UI */}
        <div className="px-4 mb-8" ref={dropdownRef}>
           <div className="relative">
              <button 
                onClick={() => setIsModeOpen(!isModeOpen)}
                className="w-full flex items-center gap-3 bg-surface-container-low border border-outline-variant/50 p-4 rounded-[20px] transition-all hover:bg-white hover:border-primary/30 group relative z-20 shadow-sm"
              >
                 <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${
                   mode === 'Manager' ? 'bg-primary/10 text-primary' : 
                   mode === 'Staff' ? 'bg-secondary/10 text-secondary' : 'bg-surface-container-highest text-outline'
                 }`}>
                    <span className="material-symbols-outlined text-[18px]">{currentModeInfo.icon}</span>
                 </div>
                 <div className="flex-1 text-left min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-on-surface truncate">{currentModeInfo.label}</p>
                    <p className="text-[8px] font-bold text-outline uppercase opacity-40">{currentModeInfo.desc}</p>
                 </div>
                 <span className={`material-symbols-outlined text-[18px] text-outline/30 transition-transform duration-300 ${isModeOpen ? 'rotate-180' : ''}`}>expand_more</span>
              </button>

              <AnimatePresence>
                {isModeOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-white border border-outline-variant rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden z-30"
                  >
                    <div className="p-2 space-y-1">
                      {modeOptions.map(opt => (
                        <button 
                          key={opt.value}
                          onClick={() => {
                            setMode(opt.value);
                            setIsModeOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all group ${
                            mode === opt.value ? 'bg-primary/5 border border-primary/10' : 'hover:bg-surface-container'
                          }`}
                        >
                           <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                             mode === opt.value ? 'bg-primary text-white shadow-md' : 'bg-surface-container-low text-outline group-hover:bg-primary group-hover:text-white'
                           }`}>
                              <span className="material-symbols-outlined text-[18px]">{opt.icon}</span>
                           </div>
                           <div className="flex-1 text-left">
                              <p className={`text-[11px] font-black uppercase tracking-tight ${mode === opt.value ? 'text-primary' : 'text-on-surface-variant'}`}>{opt.label}</p>
                           </div>
                           {mode === opt.value && (
                             <span className="material-symbols-outlined text-primary text-[16px]">check_circle</span>
                           )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <ul className="flex flex-col gap-1.5 px-3">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={`px-4 py-3.5 flex items-center gap-4 rounded-xl transition-all relative group ${
                      isActive
                        ? 'bg-primary/5 text-primary'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeNav"
                        className="absolute left-0 top-1/4 bottom-1/4 w-1.5 bg-primary rounded-r-full shadow-[0_0_15px_rgba(var(--color-primary),0.5)]"
                      />
                    )}
                    <span className={`material-symbols-outlined text-[22px] transition-all ${isActive ? 'filled' : 'group-hover:scale-110'}`}>
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-serif font-black tracking-tight">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-auto px-2 pt-4 border-t border-outline-variant/20 shrink-0 flex gap-1">
          <a href="mailto:support@gracecommunity.com" className="flex-1 px-2 py-2 flex items-center justify-center gap-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-all group">
            <span className="material-symbols-outlined text-[16px] group-hover:text-primary transition-colors">contact_support</span>
            <span className="text-[10px] font-bold group-hover:text-primary transition-colors">{t('support')}</span>
          </a>
          <button onClick={() => signOut()} className="flex-1 px-2 py-2 flex items-center justify-center gap-1.5 rounded-lg text-error/55 hover:bg-error/5 hover:text-error transition-all group cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span className="text-[10px] font-bold">{t('logout')}</span>
          </button>
        </div>
        <div className="px-6 mt-4 flex justify-between items-center opacity-20 hover:opacity-100 transition-opacity">
           <span className="text-[8px] font-black tracking-widest uppercase">Grace CRM</span>
           <span className="text-[8px] font-black">{APP_VERSION}</span>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="ml-72 flex-1 flex flex-col min-w-0 h-full bg-surface relative">
        {/* Top Navbar */}
        <header className="shrink-0 z-40 flex w-full items-center justify-between border-b border-outline-variant/20 bg-surface/90 px-8 py-4 backdrop-blur-md">
          <div className="text-xl font-bold tracking-tight text-primary font-serif md:hidden">
            {church?.name || (isPlatformAdmin ? '平台管理控制台' : '...')}
          </div>
          <div className="hidden md:block">
             <div className="flex items-center gap-2 text-outline/50 text-[10px] font-black uppercase tracking-[0.2em]">
                <span>App</span>
                <span className="material-symbols-outlined text-[12px]">chevron_right</span>
                <span className="text-primary">{location.pathname.split('/').pop()?.toUpperCase()}</span>
             </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Search - Integrated */}
            <div className="relative hidden lg:block group">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[18px] group-focus-within:text-primary transition-colors">search</span>
              <input
                type="text"
                placeholder={t('search')}
                className="w-80 rounded-2xl border border-outline-variant/50 bg-white/50 py-2.5 pl-12 pr-4 text-sm text-on-surface placeholder:text-outline/40 focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
              />
            </div>

            {/* Language Switcher */}
            <div className="relative group">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                className="appearance-none bg-surface-container-low border border-outline-variant px-4 py-2 pr-10 rounded-xl text-[10px] font-bold tracking-widest flex items-center gap-2 cursor-pointer hover:bg-surface-container transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="en">EN</option>
                <option value="zh-CN">简体</option>
                <option value="zh-TW">繁體</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="th">ไทย</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-outline pointer-events-none">language</span>
            </div>

            <div className="flex items-center gap-2">
              <div ref={notifRef} className="relative">
                <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="relative p-2.5 text-on-surface-variant hover:bg-surface-container rounded-xl transition-colors">
                  <span className="material-symbols-outlined text-[20px]">notifications</span>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                <AnimatePresence>
                  {isNotifOpen && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute right-0 mt-2 w-80 bg-white border border-outline-variant/30 shadow-2xl rounded-2xl z-[200] overflow-hidden">
                      <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center">
                        <h3 className="font-serif font-black text-sm">{t('notifications') || 'Notifications'}</h3>
                        <div className="flex items-center gap-2">
                          {canManage && (
                            <button onClick={() => setShowCompose(v => !v)} title={isZh ? '发消息给同工' : 'Message staff'} className="text-[10px] font-black text-primary hover:underline flex items-center gap-1">
                              <span className="material-symbols-outlined text-sm">campaign</span>{isZh ? '发消息' : 'Send'}
                            </button>
                          )}
                          {notifs.some(n => !n.read) && (
                            <button onClick={handleMarkAll} className="text-[10px] font-bold text-outline hover:text-primary">{isZh ? '全部已读' : 'Mark all read'}</button>
                          )}
                        </div>
                      </div>

                      {/* Manager compose box */}
                      {showCompose && canManage && (
                        <div className="p-3 bg-surface-container-low border-b border-outline-variant/20 flex flex-col gap-2">
                          <select value={composeAudience} onChange={e => setComposeAudience(e.target.value as any)} className="text-[11px] font-bold bg-white border border-outline-variant/30 rounded-lg px-2 py-1.5 outline-none">
                            <option value="Staff">{isZh ? '发送给：同工 (Staff)' : 'To: Staff'}</option>
                            <option value="all">{isZh ? '发送给：全教会' : 'To: Everyone'}</option>
                          </select>
                          <textarea value={composeText} onChange={e => setComposeText(e.target.value)} rows={2} placeholder={isZh ? '输入消息…' : 'Type a message…'} className="text-xs bg-white border border-outline-variant/30 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 resize-none" />
                          <button onClick={handleSendBroadcast} disabled={composeSending || !composeText.trim()} className="self-end h-7 px-4 rounded-lg bg-primary text-white text-[11px] font-black disabled:opacity-40 flex items-center gap-1">
                            {composeSending ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-sm">send</span>}
                            {isZh ? '发送' : 'Send'}
                          </button>
                        </div>
                      )}

                      <div className="p-3 flex flex-col gap-1 max-h-80 overflow-y-auto">
                        {pendingAppsCount > 0 && (
                          <div className="flex items-start gap-3 p-2 mb-1 rounded-xl bg-orange-50/60">
                            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                              <span className="material-symbols-outlined text-orange-500 text-sm">approval</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-bold">{pendingAppsCount}{t('pendingApplications') || ` Pending Application${pendingAppsCount > 1 ? 's' : ''}`}</p>
                              <button onClick={() => { navigate('/app/super-admin', { state: { tab: 'applications' } }); setIsNotifOpen(false); }} className="text-[10px] text-primary font-bold mt-1 hover:underline">
                                {t('clickToReview') || 'Click to Review'}
                              </button>
                            </div>
                          </div>
                        )}
                        {notifs.length === 0 && pendingAppsCount === 0 && (
                          <div className="py-8 text-center text-outline/50">
                            <span className="material-symbols-outlined text-3xl">notifications_off</span>
                            <p className="text-[11px] font-bold mt-1">{isZh ? '暂无通知' : 'No notifications'}</p>
                          </div>
                        )}
                        {notifs.map(n => (
                          <button key={n.id} onClick={() => handleNotifClick(n)} className={`text-left flex items-start gap-3 p-2 rounded-xl transition-colors hover:bg-surface-container ${n.read ? 'opacity-60' : 'bg-primary/[0.03]'}`}>
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${n.type === 'leave' ? 'bg-amber-100 text-amber-600' : n.type === 'roster' ? 'bg-blue-100 text-blue-600' : 'bg-primary/10 text-primary'}`}>
                              <span className="material-symbols-outlined text-sm">{n.type === 'leave' ? 'event_busy' : n.type === 'roster' ? 'calendar_month' : 'mail'}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              {!n.read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1 align-middle" />}
                              <span className="text-xs font-bold">{n.title || n.body}</span>
                              {n.title && n.body && <p className="text-[11px] text-on-surface-variant leading-snug mt-0.5 line-clamp-2">{n.body}</p>}
                              <p className="text-[9px] text-outline mt-1">{new Date(n.created_at).toLocaleString()}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div ref={helpRef} className="relative">
                <button onClick={() => setIsHelpOpen(!isHelpOpen)} className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-xl transition-colors">
                  <span className="material-symbols-outlined text-[20px]">help_outline</span>
                </button>
                <AnimatePresence>
                  {isHelpOpen && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute right-0 mt-2 w-64 bg-white border border-outline-variant/30 shadow-2xl rounded-2xl z-50">
                      <div className="p-4 flex flex-col gap-3">
                        <h3 className="font-serif font-black text-sm">{isZh ? '帮助与支持' : 'Help & Support'}</h3>
                        <p className="text-xs text-outline">{isZh ? '欢迎使用 GraceFlow 系统，需要帮助吗？' : 'Welcome to Grace System. Need assistance navigating the app?'}</p>
                        <a href="mailto:support@gracecommunity.com" className="bg-surface-container-low text-center rounded-lg py-2 mt-2 text-xs font-black uppercase text-primary hover:bg-primary/10 transition-colors">{isZh ? '联系支持' : 'Contact Support'}</a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="h-8 w-px bg-outline-variant/30 mx-2"></div>

            <div 
              onClick={() => navigate('/app/profile')}
              className="flex items-center gap-3 cursor-pointer group p-1 pr-3 rounded-2xl hover:bg-surface-container transition-all"
            >
              <div className="h-9 w-9 rounded-xl border-2 border-white shadow-sm bg-primary text-white flex items-center justify-center overflow-hidden font-serif font-black uppercase text-sm group-hover:scale-105 transition-transform">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} className="h-full w-full object-cover" alt="Avatar" />
                ) : (
                  <span>{profile?.full_name?.charAt(0) || user?.user_metadata?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}</span>
                )}
              </div>
              <div className="hidden xl:block">
                 {/* @ts-ignore */}
                <p className="text-[10px] font-black text-on-surface leading-none mb-1">
                  {profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-[8px] font-bold text-outline uppercase tracking-widest leading-none text-left">
                  {user?.id === 'guest-id' ? 'DEMO MODE' : (profile?.role === 'Super Admin' || profile?.role === 'SuperAdmin' ? 'Super Admin' : mode)}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Demo church banner (not shown to Super Admins — for them it just means no church selected yet) */}
        {isDemo && !isPlatformAdmin && (
          <div className="w-full px-4 py-2 bg-warning/10 border-b border-warning/30 flex items-center gap-2 text-xs font-bold text-warning">
            <span className="material-symbols-outlined text-sm">info</span>
            演示教会 — 数据不会保存 / Demo church — changes are not saved
          </div>
        )}

        {/* Page Content */}
        <div className="flex-1 overflow-auto w-full min-h-0 bg-surface">
            <Outlet />
        </div>
      </div>
    </div>
  );
}
