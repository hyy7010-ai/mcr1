import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { Html5Qrcode } from 'html5-qrcode';
import { applicationService } from '../services/applicationService';

export default function PendingApproval() {
  const { signOut, user, profile, refreshProfile, church } = useAuth();
  const { language, isZh } = useLanguage();
  const [checking, setChecking] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  // Google users with no church can either join an existing one OR register a
  // brand-new church (which files an application for the platform owner).
  const [joinMode, setJoinMode] = useState<'join' | 'register'>('join');
  const [newChurchName, setNewChurchName] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regDone, setRegDone] = useState(false);

  const handleRegisterChurch = async () => {
    if (!newChurchName.trim() || regSubmitting) return;
    setRegSubmitting(true);
    setError(null);
    try {
      await applicationService.submitApplication({
        church_name: newChurchName.trim(),
        leader_name: profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Applicant',
        email: user?.email || '',
        phone: '',
      });
      setRegDone(true);
    } catch (err: any) {
      setError(err?.message || (isZh ? '提交失败,请重试' : 'Failed to submit, please try again'));
    } finally {
      setRegSubmitting(false);
    }
  };
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-reader-pending";

  const isAuthorized = profile?.role === 'Manager' || profile?.role === 'Super Admin' || profile?.role === 'Admin' || profile?.role === 'Member' || profile?.role === 'Staff';
  const hasChurch = !!profile?.church_id;

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await refreshProfile();
    } finally {
      setTimeout(() => setChecking(false), 800);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || !user) return;

    setJoining(true);
    setError(null);
    try {
      // ── 1. Resolve church + the role this code grants, via RPC ───────────
      // The churches table is no longer publicly readable, so we ask a SECURITY
      // DEFINER function. It matches the code against the main / staff / member
      // codes server-side and returns the correct role (Staff/Member/Pending).
      const { data: codeRows } = await supabase.rpc('validate_church_code', { p_code: code });
      const targetChurch: any = Array.isArray(codeRows) ? codeRows[0] : codeRows;
      const role: string = targetChurch?.role || 'Pending';

      if (!targetChurch) {
        throw new Error(isZh
          ? `无效的加入码"${code}"，请检查并重试`
          : `Invalid code "${code}". Please check and try again.`);
      }

      // ── 2. Update profile ────────────────────────────────────────────────
      const { error: pErr } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: profile?.full_name || user.user_metadata?.full_name || 'New Member',
          church_id: targetChurch.id,
          role: role,
          updated_at: new Date().toISOString()
        });

      if (pErr) throw pErr;

      // ── 3. Clear cache and refresh ────────────────────────────────────────
      localStorage.removeItem(`profile_${user.id}`);
      localStorage.removeItem('pending_join_code');
      localStorage.removeItem('pending_join_name');
      await refreshProfile();

      setJoining(false);
      // Always show pending screen — manager must approve before entry

    } catch (err: any) {
      console.error('Join error:', err);
      setError(err.message || (isZh ? '加入失败，请重试' : 'Failed to join, please try again'));
      setJoining(false);
    }
  };

  useEffect(() => {
    if (showScanner) {
      const html5QrCode = new Html5Qrcode(scannerContainerId);
      scannerRef.current = html5QrCode;

      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          setJoinCode(decodedText.toUpperCase());
          setShowScanner(false);
          // Stop scanner
          html5QrCode.stop().then(() => {
            scannerRef.current = null;
          }).catch(err => console.error(err));
        },
        () => {} // Quiet during scan
      ).catch(err => {
        console.error("Scanner start error:", err);
        setError(isZh ? "无法访问摄像头" : "Unable to access camera");
        setShowScanner(false);
      });
    } else if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        scannerRef.current = null;
      }).catch(err => console.error(err));
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(err => console.error(err));
      }
    };
  }, [showScanner, isZh]);

  useEffect(() => {
    // Poll for status change every 10 seconds if they have a church but are pending
    let interval: any;
    if (hasChurch && profile?.role === 'Pending') {
      interval = setInterval(async () => {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user?.id)
          .maybeSingle();
        
        if (data && data.role !== 'Pending') {
          await refreshProfile();
          window.location.href = '/app/dashboard';
        }
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [hasChurch, profile?.role, user?.id]);

  if (isAuthorized && hasChurch) return null;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-surface p-6 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[48px] p-10 md:p-12 shadow-2xl text-center border border-outline-variant/10 relative overflow-hidden"
      >
        {(checking || joining) && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        <div className="mb-10 flex justify-center">
          <div className="relative">
            <div className={`absolute inset-0 rounded-full blur-3xl animate-pulse ${hasChurch ? 'bg-amber-500/20' : 'bg-primary/20'}`}></div>
            <div className={`relative h-24 w-24 rounded-[32px] flex items-center justify-center text-white shadow-2xl transition-colors duration-500 ${hasChurch ? 'bg-amber-500' : 'bg-primary'}`}>
              <span className="material-symbols-outlined text-[48px]">{hasChurch ? 'shield_person' : 'church'}</span>
            </div>
          </div>
        </div>

        <h1 className="font-serif text-3xl font-black text-on-surface mb-4 tracking-tight">
          {hasChurch 
            ? (isZh ? '等待管理员审核' : 'Awaiting Approval') 
            : (isZh ? '加入您的教会' : 'Join Your Church')}
        </h1>
        
        <div className="space-y-6 mb-10">
          <p className="text-on-surface-variant text-sm leading-relaxed px-4">
            {hasChurch 
              ? (isZh 
                  ? '您的入会申请已提交。请联系您的教会管理员进行审核。审核通过后您将获得完整访问权限。' 
                  : 'Your request has been submitted to the church. Please contact your administrator to approve your access.') 
              : (isZh 
                  ? '您已通过 Google 成功登录，但尚未关联至具体教会。请输入您的教会加入码 (Join Code) 以申请加入。' 
                  : 'You have logged in via Google but haven\'t joined a church yet. Please enter your Church Join Code to request access.')}
          </p>

          {!hasChurch ? (
            regDone ? (
              <div className="p-6 rounded-3xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                <span className="material-symbols-outlined text-emerald-500 text-4xl">mark_email_read</span>
                <p className="text-sm font-black text-emerald-900">{isZh ? '申请已提交!' : 'Application submitted!'}</p>
                <p className="text-xs text-emerald-700/80 leading-relaxed">
                  {isZh ? '我们已收到你的新教会申请,平台管理员审核通过后会通知你。' : "We've received your new-church application. The platform admin will review and notify you."}
                </p>
              </div>
            ) : (
            <>
              {/* Join existing church  ·  Register a new one */}
              <div className="flex gap-1 p-1 bg-surface-container rounded-2xl">
                <button
                  type="button"
                  onClick={() => { setJoinMode('join'); setError(null); }}
                  className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${joinMode === 'join' ? 'bg-white text-primary shadow-sm' : 'text-outline/50'}`}
                >
                  {isZh ? '加入教会' : 'Join'}
                </button>
                <button
                  type="button"
                  onClick={() => { setJoinMode('register'); setError(null); }}
                  className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${joinMode === 'register' ? 'bg-white text-primary shadow-sm' : 'text-outline/50'}`}
                >
                  {isZh ? '注册新教会' : 'Register'}
                </button>
              </div>

              {joinMode === 'join' ? (
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="relative group">
                <input
                  type="text"
                  placeholder={isZh ? "请输入教会加入码" : "Enter Church Join Code"}
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                  className="w-full bg-surface-container rounded-2xl py-4 px-6 text-center text-xl font-mono font-black tracking-[0.2em] border-2 border-transparent focus:border-primary outline-none transition-all placeholder:text-outline/40 placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl text-primary hover:bg-primary/10 transition-colors"
                  title={isZh ? "扫码加入" : "Scan to Join"}
                >
                  <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
                </button>
                {error && <p className="mt-2 text-[10px] text-error font-bold">{error}</p>}
              </div>
              <button
                type="submit"
                disabled={!joinCode.trim() || joining}
                className="w-full bg-primary text-white font-black uppercase tracking-widest py-4 rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 disabled:scale-100"
              >
                {isZh ? '申请加入' : 'Request to Join'}
              </button>
            </form>
              ) : (
            <form onSubmit={e => { e.preventDefault(); handleRegisterChurch(); }} className="space-y-4">
              <input
                type="text"
                placeholder={isZh ? '新教会名称' : 'New church name'}
                value={newChurchName}
                onChange={e => setNewChurchName(e.target.value)}
                className="w-full bg-surface-container rounded-2xl py-4 px-6 text-center text-base font-bold border-2 border-transparent focus:border-primary outline-none transition-all placeholder:text-outline/40 placeholder:font-sans"
              />
              <p className="text-[10px] text-outline/60 leading-relaxed px-2">
                {isZh ? `将以 ${user?.email} 的名义提交申请,平台管理员审核通过后开通。` : `We'll file the application as ${user?.email}. The platform admin approves it.`}
              </p>
              {error && <p className="text-[10px] text-error font-bold">{error}</p>}
              <button
                type="submit"
                disabled={!newChurchName.trim() || regSubmitting}
                className="w-full bg-primary text-white font-black uppercase tracking-widest py-4 rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 disabled:scale-100"
              >
                {regSubmitting ? (isZh ? '提交中…' : 'Submitting…') : (isZh ? '提交注册申请' : 'Submit Application')}
              </button>
            </form>
              )}
            </>
            )
          ) : (
            <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200 shadow-inner flex items-center justify-center gap-3">
               <div className="text-left">
                 <p className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 mb-1 leading-none">{isZh ? '已申请教会' : 'Applied to Church'}</p>
                 <p className="text-sm font-bold text-amber-900 leading-tight">{church?.name || '...'}</p>
               </div>
               <div className="h-8 w-px bg-amber-200"></div>
               <button onClick={handleRefresh} className="p-2 hover:bg-amber-500/10 rounded-lg transition-colors text-amber-600">
                  <span className={`material-symbols-outlined text-lg ${checking ? 'animate-spin' : ''}`}>sync</span>
               </button>
            </div>
          )}
          
          <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/10 text-center">
             <p className="text-[10px] font-black uppercase tracking-[0.2em] text-outline mb-1">
               {isZh ? '当前账号' : 'Authenticated as'}
             </p>
             <p className="text-xs font-bold text-on-surface truncate">{user?.email}</p>
          </div>
        </div>

        <button 
          onClick={() => signOut()}
          className="w-full text-outline font-black uppercase tracking-widest py-4 text-[10px] hover:text-error transition-all cursor-pointer opacity-60 hover:opacity-100 flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">logout</span>
          {isZh ? '退出登录 / 切换账号' : 'Sign Out / Switch Account'}
        </button>
      </motion.div>

      {/* QR Scanner Modal */}
      <AnimatePresence>
        {showScanner && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowScanner(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white p-6 rounded-[32px] w-full max-w-sm relative z-10 overflow-hidden"
            >
              <div className="text-center mb-6">
                <h3 className="font-serif text-xl font-black text-on-surface">{isZh ? '扫描教会二维码' : 'Scan Church QR'}</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-outline mt-1">{isZh ? '对准教会加入码二维码' : 'Align with the Church QR Code'}</p>
              </div>

              <div className="relative aspect-square rounded-2xl overflow-hidden bg-black mb-6">
                <div id={scannerContainerId} className="w-full h-full"></div>
                <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none flex items-center justify-center">
                  <div className="w-full h-full border-2 border-primary/50 relative">
                    <motion.div 
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="absolute top-0 left-0 right-0 h-1 bg-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.5)]"
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowScanner(false)}
                className="w-full bg-surface-container text-on-surface font-black uppercase tracking-widest py-4 rounded-2xl active:scale-95 transition-all"
              >
                {isZh ? '取消扫描' : 'Cancel Scan'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
