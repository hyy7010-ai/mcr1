import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { onboardingService } from '../services/onboardingService';

import { applicationService } from '../services/applicationService';

export default function Login() {
  const navigate = useNavigate();
  const { session, signInAsDemo } = useAuth();
  const { t, setLanguage, language } = useLanguage();
  const [isLogin, setIsLogin] = useState(true);
  const [isRegisteringChurch, setIsRegisteringChurch] = useState(false);
  const [showPendingScreen, setShowPendingScreen] = useState(false);
  const [onboardingSuccess, setOnboardingSuccess] = useState<{ churchCode: string; staffCode: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [churchCode, setChurchCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetupOption, setShowSetupOption] = useState(true);
  const [showChurchContactModal, setShowChurchContactModal] = useState(false);
  const [contactSuccess, setContactSuccess] = useState(false);
  const [contactForm, setContactForm] = useState({
    churchName: '',
    phone: '',
    email: '',
    address: '',
    link: ''
  });

  useEffect(() => {
    if (session) {
      navigate('/app/dashboard');
    }
  }, [session, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        // Demo account bypass
        if (email.includes('@demo.com')) {
          signInAsDemo(email);
          return;
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          if (error.message.includes('Email not confirmed')) {
            setError(language.startsWith('zh') ? '请先查看您的邮箱并点击确认链接，然后才能登入。' : 'Please check your email and click the confirmation link before signing in.');
          } else {
            throw error;
          }
          return;
        }
      } else {
        // Validate church code first
        const { data: churchData, error: churchCheckError } = await supabase
          .from('churches')
          .select('id')
          .eq('code', churchCode)
          .single();

        if (churchCheckError || !churchData) {
          throw new Error(language.startsWith('zh') ? '无效的教会代码，请与管理员核实。' : 'Invalid church code. Please check with your administrator.');
        }

        // Set pending join flags to ensure association is saved to database profile after login/confirmation
        localStorage.setItem('pending_join_code', churchCode.toUpperCase());
        localStorage.setItem('pending_join_name', name);

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: name,
              church_code: churchCode,
            }
          }
        });

        if (error) throw error;
        setShowPendingScreen(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    // If joining a church, validate metadata
    if (!isLogin) {
      if (!churchCode.trim() || !name.trim()) {
        setError(language.startsWith('zh') ? '请先填写教会代码和姓名，以便我们为您分配教会。' : 'Please fill in the Church Code and your Name first so we can assign you correctly.');
        setLoading(false);
        return;
      }

      // Set pending join flags for OAuth
      localStorage.setItem('pending_join_code', churchCode.toUpperCase());
      localStorage.setItem('pending_join_name', name);

      // Check if church code exists to prevent orphaned profiles
      try {
        const { data: churchData, error: dbError } = await supabase
          .from('churches')
          .select('id')
          .eq('code', churchCode.trim())
          .maybeSingle();
        
        if (dbError || !churchData) {
          setError(language.startsWith('zh') ? '该教代码不存在，请向您的教会管理员确认。' : 'This Church Code does not exist. Please verify with your admin.');
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('Church validation failed:', err);
      }
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/app/dashboard',
          data: !isLogin ? {
            full_name: name,
            church_code: churchCode,
          } : undefined
        } as any,
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message);
    } finally {
      // Note: for OAuth, the page will redirect, so setLoading(false) might not be seen
      setLoading(false);
    }
  };

  const handleOnboarding = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    
    try {
      const result = await onboardingService.registerChurch({
        churchName: formData.get('churchName') as string,
        location: formData.get('location') as string,
        leaderName: formData.get('leaderName') as string,
        leaderRole: formData.get('leaderRole') as string,
        email: formData.get('email') as string,
        password: formData.get('password') as string,
      });
      
      setOnboardingSuccess({
        churchCode: result.churchCode,
        staffCode: result.staffCode
      });
    } catch (err: any) {
      setError(err.message || 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  if (onboardingSuccess) {
    return (
      <main className="relative flex min-h-screen w-full items-center justify-center bg-surface p-4">
        <div className="relative z-10 w-full max-w-md rounded-[40px] bg-white p-12 shadow-2xl text-center">
          <div className="mb-6 flex justify-center text-success">
            <span className="material-symbols-outlined text-[64px]">check_circle</span>
          </div>
          <h2 className="mb-2 font-serif text-2xl font-bold text-black">Church Instance Ready</h2>
          <p className="mb-8 text-sm text-outline">Check your email for confirmation.</p>
          
          <div className="mb-8 rounded-2xl bg-black/5 p-6 text-left space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-outline">Public Church Code (For Members)</p>
              <p className="text-xl font-mono font-bold text-black">{onboardingSuccess.churchCode}</p>
            </div>
          </div>
          
          <button 
            onClick={() => {
              setOnboardingSuccess(null);
              setIsLogin(true);
              setIsRegisteringChurch(false);
            }}
            className="w-full rounded-2xl bg-black py-4 font-black uppercase tracking-widest text-white hover:bg-primary transition-all"
          >
            Back to Login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('https://images.unsplash.com/photo-1548625361-ecacfa310659?q=80&w=2000&auto=format&fit=crop')",
            filter: "blur(4px)",
            transform: "scale(1.05)"
          }}
        ></div>
        <div className="absolute inset-0 bg-background/80 mix-blend-overlay"></div>
        <div className="absolute inset-0 bg-surface/20"></div>
      </div>

      <div className="relative z-10 w-full max-w-[440px] px-6">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-2xl shadow-primary/10">
          
          {showPendingScreen ? (
            <div className="flex flex-col items-center p-10 text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[40px]">how_to_reg</span>
              </div>
              <h2 className="mb-3 font-serif text-2xl font-bold text-on-surface">{t('requestSubmitted')}</h2>
              <p className="font-body text-sm text-on-surface-variant leading-relaxed mb-6">
                {t('requestSubmittedDesc')}
              </p>
              <div className="mb-8 p-4 bg-primary/5 rounded-2xl border border-primary/10 text-left">
                <div className="flex items-center gap-2 mb-2 text-primary">
                  <span className="material-symbols-outlined text-[18px]">info</span>
                  <p className="text-[10px] font-black uppercase tracking-widest">{language.startsWith('zh') ? '配置与访问提醒' : 'Config & Access Reminder'}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] text-outline leading-normal">
                    {language.startsWith('zh') 
                      ? '1. 如果您使用自己的域名（如 mcr.fliptus.com），请确保它指向正确的部署地址。预览链接是临时的。' 
                      : '1. If using your own domain (e.g. mcr.fliptus.com), ensure it points to a stable deployment. Preview links are temporary.'}
                  </p>
                  <p className="text-[10px] text-outline leading-normal">
                    {language.startsWith('zh') 
                      ? '2. 确认邮件中的链接如果指向 localhost，请在 Supabase 控制台的 Authentication > URL Configuration 中将 Site URL 设置为当前页面的域名。' 
                      : '2. If confirm links go to localhost, set "Site URL" to this domain in Supabase Dashboard (Authentication > URL Configuration).'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPendingScreen(false);
                  setIsLogin(true);
                }}
                className="w-full rounded-lg bg-primary py-3 font-button text-sm text-on-primary hover:bg-primary/90 transition-colors"
               >
                 {t('backToLogin')}
               </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center px-8 pb-4 pt-10 text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container shadow-sm border border-outline-variant/30">
                  <span className="material-symbols-outlined text-[32px] text-primary filled">
                    church
                  </span>
                </div>
                <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight text-on-surface">{t('welcome')}</h1>
                <p className="font-body text-sm text-on-surface-variant">
                  {isLogin ? (language.startsWith('zh') ? '登录您的账号' : 'Sign in to your account') : 
                   isRegisteringChurch ? (language.startsWith('zh') ? '申请为您所在的教会开通系统' : 'Apply for a new system') :
                   (language.startsWith('zh') ? '输入代码加入您的教会' : 'Enter code to join your church')}
                </p>

                {/* Removed prominent Quick Test card as per user request to merge and keep only the cleaner footer buttons */}
              </div>

              <div className="px-8 pb-8 pt-4">
                <div className="flex mb-8 border-b border-outline-variant/10">
                  <button
                    onClick={() => {
                      setIsLogin(true);
                      setIsRegisteringChurch(false);
                    }}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${isLogin ? 'text-primary border-b-2 border-primary' : 'text-outline/50 hover:text-outline'}`}
                  >
                    {t('signin')}
                  </button>
                  {showSetupOption && (
                    <button
                      onClick={() => {
                        setIsLogin(false);
                        setIsRegisteringChurch(true);
                      }}
                      className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${isRegisteringChurch ? 'text-primary border-b-2 border-primary' : 'text-outline/50 hover:text-outline'}`}
                    >
                      {language.startsWith('zh') ? '申请开通' : 'Setup System'}
                    </button>
                  )}
                </div>

                <form className="flex flex-col gap-4" onSubmit={async (e) => {
                  if (isRegisteringChurch) {
                    e.preventDefault();
                    setLoading(true);
                    setError(null);
                    try {
                      await applicationService.submitApplication({
                        church_name: contactForm.churchName,
                        leader_name: name || 'Lead Applicant',
                        email: email, 
                        phone: contactForm.phone,
                        address: contactForm.address,
                        source_link: contactForm.link
                      });
                      
                      const { error: signUpError } = await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                          emailRedirectTo: window.location.origin,
                          data: {
                            full_name: name,
                            is_manager_applicant: true 
                          }
                        }
                      });

                      if (signUpError) throw signUpError;

                      setContactSuccess(true);
                      setTimeout(() => {
                        setShowPendingScreen(true);
                        setContactSuccess(false);
                      }, 2000);
                    } catch (err: any) {
                      setError(err.message || 'Application failed');
                    } finally {
                      setLoading(false);
                    }
                  } else {
                    handleSubmit(e);
                  }
                }}>
                  {error && (
                    <div className="rounded-lg bg-error/10 p-3 text-sm text-error font-medium">
                      {error}
                    </div>
                  )}

                  {isRegisteringChurch ? (
                    <>
                      {contactSuccess ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <span className="material-symbols-outlined text-[48px] text-success mb-4">check_circle</span>
                          <h3 className="text-xl font-bold text-on-surface mb-2">{language.startsWith('zh') ? '申请已提交！' : 'Application Submitted!'}</h3>
                          <p className="text-sm text-outline">{language.startsWith('zh') ? '审核后我们会将开通信息及代码发送给您。' : 'Someone will contact you with the setup code.'}</p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-surface-container rounded-xl p-4 mb-2 border border-outline-variant/30">
                            <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-2">
                              {language.startsWith('zh') ? '管理员申请说明' : 'Manager Application'}
                            </h4>
                            <p className="text-xs text-outline leading-relaxed">
                              {language.startsWith('zh') 
                                ? '请填写您的教会信息。我们将为您创建一个独立的教会环境。审核通过后您将获得管理权限。' 
                                : 'Please provide details about your ministry. Once verified, we will create your unique environment.'}
                            </p>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant">{language.startsWith('zh') ? '教会名称' : 'Church Name'}</label>
                              <input required placeholder={language.startsWith('zh') ? '例如：恩典教会' : 'e.g. Grace Church'} value={contactForm.churchName} onChange={e => setContactForm({...contactForm, churchName: e.target.value})} className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all placeholder:text-outline/30" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant">{language.startsWith('zh') ? '负责人姓名' : 'Your Name'}</label>
                              <input required placeholder={language.startsWith('zh') ? '您的姓名' : 'Jane Doe'} value={name} onChange={e => setName(e.target.value)} className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all placeholder:text-outline/30" />
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mt-1">
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant font-bold">{language.startsWith('zh') ? '管理员邮箱' : 'Manager Email'}</label>
                              <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-lg border-2 border-primary/20 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant font-bold">{language.startsWith('zh') ? '设置密码' : 'Set Password'}</label>
                              <input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-lg border-2 border-primary/20 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all" placeholder="••••••••" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mt-1">
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant">{language.startsWith('zh') ? '联系电话' : 'Contact Phone'}</label>
                              <input required type="tel" placeholder={language.startsWith('zh') ? '您的联系电话' : 'e.g. +1...'} value={contactForm.phone} onChange={e => setContactForm({...contactForm, phone: e.target.value})} className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all placeholder:text-outline/30" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="ml-1 font-label-sm text-on-surface-variant">{language.startsWith('zh') ? '教会网址 / 链接' : 'Church Website / Link'}</label>
                              <input required placeholder={language.startsWith('zh') ? 'YouTube/官网 (无请填 n/a)' : 'YouTube/URL (or write n/a)'} value={contactForm.link} onChange={e => setContactForm({...contactForm, link: e.target.value})} className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all placeholder:text-outline/30" />
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-1.5 mt-1">
                            <label className="ml-1 font-label-sm text-on-surface-variant">{language.startsWith('zh') ? '详细地址' : 'Address'}</label>
                            <input required placeholder={language.startsWith('zh') ? '教会所在的详细地址' : '123 Grace St, City, Country'} value={contactForm.address} onChange={e => setContactForm({...contactForm, address: e.target.value})} className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all placeholder:text-outline/30" />
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {!isLogin && (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="churchCode" className="ml-1 font-label-sm text-on-surface-variant">{t('churchCode')}</label>
                            <div className="relative">
                              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                                <span className="material-symbols-outlined text-[18px]">vpn_key</span>
                              </span>
                              <input
                                type="text"
                                id="churchCode"
                                required
                                placeholder="e.g. GRACE-2024"
                                value={churchCode}
                                onChange={(e) => setChurchCode(e.target.value)}
                                className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 pl-10 pr-4 font-body text-sm text-on-surface outline-none transition-all duration-200 focus:border-primary focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="name" className="ml-1 font-label-sm text-on-surface-variant">{t('fullName')}</label>
                            <div className="relative">
                              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                                <span className="material-symbols-outlined text-[18px]">person</span>
                              </span>
                              <input
                                type="text"
                                id="name"
                                required
                                placeholder="e.g. Jane Doe"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 pl-10 pr-4 font-body text-sm text-on-surface outline-none transition-all duration-200 focus:border-primary focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="email" className="ml-1 font-label-sm text-on-surface-variant">{t('email')}</label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                            <span className="material-symbols-outlined text-[18px]">mail</span>
                          </span>
                          <input
                            type="email"
                            id="email"
                            required
                            placeholder="your@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 pl-10 pr-4 font-body text-sm text-on-surface outline-none transition-all duration-200 focus:border-primary focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="password" className="ml-1 font-label-sm text-on-surface-variant">
                          <span>{t('password')}</span>
                          {!isLogin && <span className="ml-2 text-[9px] text-outline opacity-50 uppercase tracking-tighter">(Optional for Google Join)</span>}
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                            <span className="material-symbols-outlined text-[18px]">lock</span>
                          </span>
                          <input
                            type="password"
                            id="password"
                            required={isLogin}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-lg border border-outline-variant/50 bg-surface-container py-3 pl-10 pr-4 font-body text-sm text-on-surface outline-none transition-all duration-200 focus:border-primary focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {!contactSuccess && (
                    <>
                      {!isLogin && !isRegisteringChurch ? (
                        <div className="flex flex-col gap-3 mt-2">
                          <button
                            type="button"
                            onClick={handleGoogleSignIn}
                            disabled={loading || !churchCode.trim() || !name.trim()}
                            className={`flex w-full items-center justify-center gap-3 rounded-xl border py-4 font-button text-sm shadow-md transition-all active:scale-[0.98] ${
                              !churchCode.trim() || !name.trim() 
                              ? "bg-surface-container-low border-outline-variant/10 text-outline/40 grayscale" 
                              : "bg-primary text-on-primary border-primary hover:bg-primary/90"
                            }`}
                          >
                            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 brightness-0 invert" />
                            <span className="font-bold tracking-tight">{language.startsWith('zh') ? '使用 Google 快捷加入' : 'Quick Join with Google'}</span>
                          </button>
                          
                          <div className="relative flex items-center justify-center py-2">
                             <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-outline-variant/10"></div></div>
                             <span className="relative bg-surface-container-lowest px-4 text-[9px] font-black uppercase tracking-widest text-outline/40">OR MANUAL JOIN</span>
                          </div>

                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-high py-3 font-button text-sm text-on-surface hover:bg-surface-container transition-all"
                          >
                            {loading ? 'Processing...' : (language.startsWith('zh') ? '使用邮箱密码注册' : 'Join with Email Account')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="submit"
                          disabled={loading}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3.5 font-button text-sm text-on-primary shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <span>{loading ? 'Processing...' : (isRegisteringChurch ? (language.startsWith('zh') ? '提交申请' : 'Submit Application') : t('signin'))}</span>
                          {!loading && <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
                        </button>
                      )}

                      {isLogin && (
                        <div className="mt-4 flex flex-col gap-3">
                          <div className="relative flex items-center justify-center py-2">
                             <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-outline-variant/10"></div></div>
                             <span className="relative bg-surface-container-lowest px-4 text-[10px] font-black uppercase tracking-widest text-outline/40">OR</span>
                          </div>
                          
                          <button
                            type="button"
                            onClick={handleGoogleSignIn}
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-3 rounded-xl border border-outline-variant/30 bg-white py-4 font-button text-sm text-on-surface shadow-sm transition-all hover:bg-surface-container active:scale-[0.98]"
                          >
                            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                            <span className="font-bold tracking-tight">{language.startsWith('zh') ? '使用 Google 登录' : 'Sign in with Google'}</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </form>

                <div className="mt-8 pt-6 border-t border-outline-variant/20 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setIsRegisteringChurch(false);
                    }}
                    className="w-full rounded-lg py-1 text-xs font-black uppercase tracking-widest text-outline hover:text-primary transition-all text-center opacity-60 hover:opacity-100"
                  >
                    {isLogin ? (language.startsWith('zh') ? '还没加入教会？立即申请' : 'No church? Apply now') : (language.startsWith('zh') ? '已有账号？返回登录' : 'Already have an account? Login')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 text-center">
          <div className="flex items-center gap-1.5 text-outline">
            <span className="material-symbols-outlined text-[16px]">language</span>
            <select 
              className="bg-transparent border-none text-xs font-label-sm outline-none cursor-pointer text-on-surface-variant hover:text-on-surface"
              value={localStorage.getItem('app-language') || 'system'}
              onChange={(e) => setLanguage(e.target.value as any)}
            >
              <option value="system">{t('systemLanguage')}</option>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 text-outline">
            <span className="material-symbols-outlined text-[16px]">shield</span>
            <span className="font-label-sm text-xs">{t('secureEnv')}</span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showChurchContactModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 text-left">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowChurchContactModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[40px] p-10 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-serif text-2xl font-black">{language.startsWith('zh') ? '使用指南与帮助' : 'How it works & Help'}</h3>
                <button type="button" onClick={() => setShowChurchContactModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors">
                  <span className="material-symbols-outlined text-outline">close</span>
                </button>
              </div>

              <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                <section>
                  <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-2">{language.startsWith('zh') ? '普通用户如何加入？' : 'How do users join?'}</h4>
                  <p className="text-xs text-outline leading-relaxed whitespace-pre-wrap">
                    {language.startsWith('zh') 
                      ? '1. 获取教会代码：联系您的教会管理员获取唯一的 "Church Code"。\n2. 注册账号：关闭本窗口，在下方输入代码、姓名、邮箱和密码进行注册。\n3. 等待核准：注册后您的状态为“待定”。只有管理员在后台点击“批准”后，您才能登录并使用系统。' 
                      : '1. Get Code: Contact your church staff for the unique "Church Code".\n2. Sign up: Close this modal and enter the code and your details below.\n3. Wait: You will be "Pending" initially. Access is granted once an admin approves you in the dashboard.'}
                  </p>
                </section>

                <section>
                  <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-2">{language.startsWith('zh') ? '管理员/教会如何开通？' : 'How to setup as an Admin?'}</h4>
                  <p className="text-xs text-outline leading-relaxed whitespace-pre-wrap">
                    {language.startsWith('zh') 
                      ? '请在页面上选择【开通系统】（Setup System），填写并提交您的教会信息。经核实验证后，您的教会和管理员账号将会被开通。' 
                      : 'Select the [Setup System] tab on the main page, fill out and submit your church details. Once verified, your admin account will be created.'}
                  </p>
                </section>

                <section className="p-4 bg-amber-50 rounded-2xl border border-amber-200">
                  <h4 className="text-xs font-black uppercase tracking-widest text-amber-900 mb-1">{language.startsWith('zh') ? '进不去网站？' : 'Can\'t open the site?'}</h4>
                  <p className="text-[10px] text-amber-800 leading-normal">
                    {language.startsWith('zh') 
                      ? '如果您在自己的域名下看到“拒绝连接”，通常是因为您正在访问一个过期的预览链接。请重新启动开发服务器获取最新地址。' 
                      : 'If you see "Refused to connect" on your domain, you are likely accessing a stale preview link. Please restart the dev server for a new link.'}
                  </p>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
