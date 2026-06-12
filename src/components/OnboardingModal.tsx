import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getActiveChurchId } from '../lib/permissions';
import { memberService, Member } from '../services/memberService';
import { supabase } from '../lib/supabase';
import { tValue, MINISTRY_SKILLS } from '../lib/valueLabels';

// Skill list is shared with the Members page (MINISTRY_SKILLS) so the two stay in sync.
const SKILL_ICON: Record<string, string> = {
  'Sunday School Teacher': 'school',
  'Worship': 'music_note',
  'Lead Singer': 'record_voice_over',
  'Backing Vocal': 'mic',
  'Usher': 'person_pin',
  'Giving': 'volunteer_activism',
  'Assistant Teacher': 'menu_book',
  'Kitchen': 'restaurant',
  'Cleaning': 'cleaning_services',
  'Preaching': 'campaign',
  'IT': 'terminal',
  'Musician': 'piano',
  'Piano': 'piano',
  'Custom': 'add',
};

const CHRISTIAN_YEAR_OPTIONS = ['< 1', '1', '2', '3', '4', '5', '6–10', '10–20', '20+'];

const ONBOARDING_KEY = (uid: string) => `onboarding_done_${uid}`;

interface Props {
  onDone: () => void;
}

export default function OnboardingModal({ onDone }: Props) {
  const { user, profile, church } = useAuth();
  const { isZh, language } = useLanguage();
  // Same set as the Members page: base skills + this church's custom roster roles.
  // Keep "Custom" (the + tile) last, after any custom roles like Piano.
  const displaySkills = (() => {
    const base = MINISTRY_SKILLS.filter(s => s !== 'Custom');
    const roles = ((church as any)?.roster_roles || []).filter((r: string) => r !== 'Custom');
    return [...Array.from(new Set([...base, ...roles])), 'Custom'];
  })();
  const activeChurchId = getActiveChurchId(profile, church) || profile?.church_id || null;

  const [step, setStep] = useState(1); // 1: basic info, 2: referral, 3: ministry, 4: group
  const [saving, setSaving] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState(profile?.full_name || user?.user_metadata?.full_name || '');
  const [christianYears, setChristianYears] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [dob, setDob] = useState('');

  const calcAge = (dobStr: string): number | undefined => {
    if (!dobStr) return undefined;
    const birth = new Date(dobStr);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 0 ? age : undefined;
  };
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState('');
  const [referrals, setReferrals] = useState<string[]>([]);
  const [referralQuery, setReferralQuery] = useState('');
  const [memberSuggestions, setMemberSuggestions] = useState<Member[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const referralRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    memberService.getMembers(activeChurchId).then(m => setAllMembers(m));
    if (activeChurchId) {
      supabase.from('church_groups').select('*').eq('church_id', activeChurchId).order('created_at')
        .then(({ data }) => setAvailableGroups(data || []));
    }
  }, [activeChurchId]);

  useEffect(() => {
    if (!referralQuery.trim()) { setMemberSuggestions([]); return; }
    const q = referralQuery.toLowerCase();
    setMemberSuggestions(allMembers.filter(m => m.name.toLowerCase().includes(q)).slice(0, 6));
  }, [referralQuery, allMembers]);

  const toggleSkill = useCallback((skill: string) => {
    setSelectedSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  }, []);

  const addReferral = (name: string) => {
    if (!referrals.includes(name)) setReferrals(prev => [...prev, name]);
    setReferralQuery('');
    setMemberSuggestions([]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (!activeChurchId) return;
    setSaving(true);
    try {
      const initials = name.trim().split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      const newMember: Omit<Member, 'id'> = {
        church_id: activeChurchId,
        name: name.trim(),
        initials,
        role: selectedSkills,
        family: 'Church Core',
        joined: new Date().getFullYear().toString(),
        status: 'Member',
        age: calcAge(dob),
        dob: dob || undefined,
        jobTitle: jobTitle || undefined,
        christianYears: christianYears || undefined,
        referral_source: referrals.join(', '),
        friends_with: referrals.map(rn => allMembers.find(m => m.name === rn)?.id).filter(Boolean) as string[],
        skills: selectedSkills,
        email: email || user?.email || '',
        phone: phone || '',
      };
      // Upsert: update existing member record if email matches, otherwise insert
      const existingMember = allMembers.find(m => m.email && m.email === (email || user?.email));
      let added: Member;
      if (existingMember) {
        added = await memberService.updateMember(existingMember.id, {
          name: newMember.name,
          initials: newMember.initials,
          role: newMember.role,
          skills: newMember.skills,
          phone: newMember.phone,
          dob: newMember.dob,
          age: newMember.age,
          jobTitle: newMember.jobTitle,
          christianYears: newMember.christianYears,
        });
      } else {
        added = await memberService.addMember(newMember);
      }

      // Create member links for referrals
      for (const rName of referrals) {
        const refMember = allMembers.find(m => m.name === rName);
        if (refMember) {
          await memberService.upsertMemberLink({
            church_id: activeChurchId,
            source_id: added.id,
            target_id: refMember.id,
            type: 'Invited',
          });
        }
      }

      // Assign to selected group
      if (selectedGroupId && activeChurchId && user?.id) {
        await supabase.from('church_group_members')
          .delete().eq('profile_id', user.id).eq('church_id', activeChurchId);
        await supabase.from('church_group_members')
          .insert({ church_id: activeChurchId, group_id: selectedGroupId, profile_id: user.id });
      }

      if (user?.id) localStorage.setItem(ONBOARDING_KEY(user.id), '1');
      onDone();
    } catch (err) {
      console.error('Onboarding save error:', err);
      // Still mark as done to not block the user
      if (user?.id) localStorage.setItem(ONBOARDING_KEY(user.id), '1');
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    if (user?.id) localStorage.setItem(ONBOARDING_KEY(user.id), '1');
    onDone();
  };

  const stepTitles = isZh
    ? ['基本信息', '认识谁？', '服侍项目', '加入小组']
    : ['Basic Info', 'Connections', 'Ministry', 'My Group'];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
      />

      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 200 }}
        className="relative w-full max-w-2xl bg-white rounded-[48px] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-10 pt-10 pb-6 border-b border-gray-100">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="font-serif text-3xl font-black text-gray-900">
                {isZh ? '👋 欢迎加入！' : '👋 Welcome!'}
              </h2>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400 mt-1">
                {isZh ? '填写您的基本信息，方便管理员认识您' : 'Help your church team get to know you'}
              </p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className="flex items-center gap-2">
                <button
                  onClick={() => s < step && setStep(s)}
                  className={`flex items-center gap-1.5 transition-all ${s <= step ? 'opacity-100' : 'opacity-30'}`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                      s < step ? 'bg-green-500 text-white' :
                      s === step ? 'bg-black text-white' :
                      'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {s < step ? '✓' : s}
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest hidden sm:block ${s === step ? 'text-black' : 'text-gray-400'}`}>
                    {stepTitles[s - 1]}
                  </span>
                </button>
                {s < 4 && <div className={`h-px w-8 transition-colors ${s < step ? 'bg-green-300' : 'bg-gray-100'}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-10 py-8 max-h-[60vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ── Step 1: Basic Info ── */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                {/* Name */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {isZh ? '您的名字 *' : 'Your Name *'}
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">person</span>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={isZh ? '例：张小明' : 'e.g. John Doe'}
                      className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Age (auto-calculated from birthday) */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '年龄' : 'Age'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">cake</span>
                      <div className="w-full bg-gray-100 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl font-bold text-base text-gray-500 select-none">
                        {calcAge(dob) !== undefined ? calcAge(dob) : <span className="text-gray-300">{isZh ? '由生日自动计算' : 'Auto from birthday'}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Years as Christian */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '信主几年了' : 'Years in Faith'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">auto_stories</span>
                      <select
                        value={christianYears}
                        onChange={e => setChristianYears(e.target.value)}
                        className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-10 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all appearance-none cursor-pointer"
                      >
                        <option value="">{isZh ? '选择...' : 'Select...'}</option>
                        {CHRISTIAN_YEAR_OPTIONS.map(y => (
                          <option key={y} value={y}>{y} {isZh ? '年' : 'yr'}</option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none text-[18px]">expand_more</span>
                    </div>
                  </div>

                  {/* Birthday */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '生日' : 'Birthday'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">calendar_today</span>
                      <input
                        type="date"
                        value={dob}
                        onChange={e => setDob(e.target.value)}
                        className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                      />
                    </div>
                  </div>

                  {/* Job Title */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '职业' : 'Job Title'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">work</span>
                      <input
                        value={jobTitle}
                        onChange={e => setJobTitle(e.target.value)}
                        placeholder={isZh ? '例：软件工程师' : 'e.g. Engineer'}
                        className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '电话' : 'Phone'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">call</span>
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="+61 4xx xxx xxx"
                        className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {isZh ? '邮件' : 'Email'}
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">alternate_email</span>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Referral / Connections ── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  {isZh
                    ? '是谁带您来教会的？或者您认识哪些弟兄姐妹？这有助于建立会友关系网络。'
                    : 'Who brought you to church, or who do you know here? This helps build the community network.'}
                </p>

                {/* Selected referrals */}
                {referrals.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {referrals.map(r => (
                      <span key={r} className="flex items-center gap-1.5 bg-black text-white text-xs font-bold px-3 py-1.5 rounded-full">
                        {r}
                        <button onClick={() => setReferrals(prev => prev.filter(x => x !== r))} className="opacity-60 hover:opacity-100 transition-opacity">×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Search input */}
                <div className="relative" ref={referralRef}>
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">group</span>
                  <input
                    value={referralQuery}
                    onChange={e => setReferralQuery(e.target.value)}
                    placeholder={isZh ? "搜索会友姓名..." : "Search member name..."}
                    className="w-full bg-gray-50 border-2 border-transparent pl-12 pr-5 py-4 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-base transition-all"
                  />
                  {memberSuggestions.length > 0 && (
                    <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-10">
                      {memberSuggestions.map(m => (
                        <button key={m.id} onClick={() => addReferral(m.name)}
                          className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left">
                          <div className="w-8 h-8 rounded-full bg-black text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">{m.initials}</div>
                          <div>
                            <p className="font-bold text-sm">{m.name}</p>
                            <p className="text-[10px] text-gray-400 uppercase tracking-widest">{m.status}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {referrals.length === 0 && (
                  <p className="text-[10px] text-gray-300 text-center py-4 font-bold uppercase tracking-widest">
                    {isZh ? '（可以跳过，之后再填）' : '(You can skip this and fill it later)'}
                  </p>
                )}
              </motion.div>
            )}

            {/* ── Step 3: Ministry Skills ── */}
            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                  {isZh ? '您参与哪些服侍项目？（可多选）' : 'Which ministries are you involved in? (select all that apply)'}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {displaySkills.map(skill => {
                    const isSelected = selectedSkills.includes(skill);
                    return (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => toggleSkill(skill)}
                        className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                          isSelected
                            ? 'border-black bg-black text-white'
                            : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[22px] mb-2">{SKILL_ICON[skill] || 'star'}</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-center leading-tight">
                          {tValue(skill, language)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Custom "Other" skill */}
                <div className="mt-4 flex gap-2">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-[20px]">add_circle</span>
                    <input
                      value={customSkill}
                      onChange={e => setCustomSkill(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customSkill.trim() && !selectedSkills.includes(customSkill.trim())) {
                          setSelectedSkills(prev => [...prev, customSkill.trim()]);
                          setCustomSkill('');
                        }
                      }}
                      placeholder={isZh ? '其他服侍（自定义）...' : 'Other ministry (custom)...'}
                      className="w-full bg-gray-50 border-2 border-transparent pl-11 pr-4 py-3 rounded-2xl focus:border-black focus:bg-white outline-none font-bold text-sm transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = customSkill.trim();
                      if (trimmed && !selectedSkills.includes(trimmed)) {
                        setSelectedSkills(prev => [...prev, trimmed]);
                        setCustomSkill('');
                      }
                    }}
                    className="px-5 py-3 rounded-2xl bg-black text-white text-[11px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-95"
                  >
                    {isZh ? '添加' : 'Add'}
                  </button>
                </div>
                {/* Show custom skills as tags */}
                {selectedSkills.filter(s => !displaySkills.includes(s)).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedSkills.filter(s => !displaySkills.includes(s)).map(s => (
                      <span key={s} className="flex items-center gap-1.5 bg-black text-white text-xs font-bold px-3 py-1.5 rounded-full">
                        {s}
                        <button onClick={() => setSelectedSkills(prev => prev.filter(x => x !== s))} className="opacity-60 hover:opacity-100 transition-opacity">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
            {/* ── Step 4: Choose Group ── */}
            {step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  {isZh ? '请选择你要加入的小组。加入后你可以在小组页面看到组内的分享内容。' : 'Choose the group you\'d like to join. You\'ll see group posts and connect with members there.'}
                </p>
                {availableGroups.length === 0 ? (
                  <div className="py-12 text-center">
                    <span className="material-symbols-outlined text-5xl text-gray-200 block mb-3">group</span>
                    <p className="text-sm text-gray-400 font-bold">{isZh ? '暂时没有小组，管理员会稍后将你分配到小组' : 'No groups yet — your manager will assign you later'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {availableGroups.map(g => (
                      <button key={g.id} onClick={() => setSelectedGroupId(selectedGroupId === g.id ? null : g.id)}
                        className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedGroupId === g.id ? 'border-black bg-black text-white' : 'border-gray-100 bg-gray-50 hover:border-gray-300'}`}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-lg mb-3"
                          style={{ background: selectedGroupId === g.id ? 'rgba(255,255,255,0.2)' : g.color }}>
                          {g.name.charAt(0)}
                        </div>
                        <p className="font-black text-sm">{g.name}</p>
                        {g.description && <p className={`text-[10px] mt-0.5 ${selectedGroupId === g.id ? 'text-white/60' : 'text-gray-400'}`}>{g.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-gray-300 text-center font-bold uppercase tracking-widest">
                  {isZh ? '（可以跳过，管理员会帮你分配）' : '(Optional — your manager can also assign you)'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-10 py-6 border-t border-gray-100 flex items-center justify-between gap-4">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              {isZh ? '上一步' : 'Back'}
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => {
                if (step === 1 && !name.trim()) return;
                setStep(s => s + 1);
              }}
              disabled={step === 1 && !name.trim()}
              className="flex items-center gap-2 bg-black text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-30 active:scale-95"
            >
              {isZh ? '下一步' : 'Next'}
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 bg-black text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-30 active:scale-95"
            >
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{isZh ? '保存中...' : 'Saving...'}</>
              ) : (
                <><span className="material-symbols-outlined text-[18px]">check_circle</span>{isZh ? '完成加入' : 'Join Now'}</>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export const needsOnboarding = (userId: string | undefined, role: string | undefined) => {
  if (!userId) return false;
  if (!role || role === 'Pending' || role === 'Super Admin' || role === 'SuperAdmin') return false;
  return !localStorage.getItem(ONBOARDING_KEY(userId));
};
