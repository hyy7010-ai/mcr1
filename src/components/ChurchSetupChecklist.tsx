import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { getActiveChurchId } from '../lib/permissions';

// Local bilingual strings — keeps the checklist self-contained without bloating
// the central translation dictionary.
const STRINGS = {
  zh: {
    cardTitle: '完成教会设置', completed: '已完成', close: '关闭', skip: '跳过', cancel: '取消',
    congratsTitle: '教会设置全部完成！🎉', congratsDesc: '你的教会已准备就绪，随时可以关闭此卡片。',
    notifText: '认证已通过 🎉 现在可以设置奉献账号了', notifAction: '立即设置',
    save: '保存', saving: '保存中...', submitting: '提交中...', submitVerify: '提交认证申请',
    markShared: '已分享，标记完成',
    items: {
      info: { label: '填写教会基本信息', desc: '地址 · 电话 · 网站 · 聚会时间' },
      group: { label: '创建第一个小组', desc: '小组名 · 颜色 · 聚会地点' },
      logo: { label: '上传教会 Logo', desc: '让教会主页更完整' },
      invite: { label: '邀请会友加入', descTpl: (c: string) => `加入码：${c}` },
      verify: { label: '提交认证申请', desc: '完成平台认证' },
      bsb: { label: '设置奉献账号 BSB', descOn: '填写银行账号信息', descOff: '需先完成认证' },
    },
    info: { address: '教会地址', phone: '联系电话', website: '官方网站', meetingTime: '聚会时间',
      addressPh: '例：123 Church St, Melbourne', phonePh: '例：+61 3 9999 0000', websitePh: '例：https://yourchurch.org', meetingTimePh: '例：每周日上午 10:00' },
    group: { name: '小组名称', namePh: '例：青年团契', color: '小组颜色', location: '聚会地点', locationPh: '例：副堂 B203' },
    logo: { line1: '在顶部导航栏的教会名称旁边点击 Logo 图标即可上传。', line2: '支持 PNG / JPG，建议正方形图片' },
    invite: { desc: '把这个加入码分享给你的会友，他们在登录页面输入此码即可申请加入。', copy: '复制加入码', copied: '已复制！' },
    verify: {
      doneTitle: '你的教会已通过认证 🎉', doneDesc: '奉献账号等高级功能已解锁。',
      pendingTitle: '认证申请已提交，等待平台审核', pendingDesc: '审核通过后你会在仪表盘收到通知。',
      intro: '提交认证后，平台将核实你的教会信息。认证通过可解锁奉献账号等高级功能。',
      contactName: '负责人姓名', contactNamePh: '例：陈牧师', contactPhone: '联系电话', contactPhonePh: '例：+61 ...',
      note: '备注（选填）', notePh: '教会注册号、所属宗派等可帮助核实的信息' },
    bsb: { accountName: '账户名称', accountNamePh: '例：Grace Church Inc', bsb: 'BSB 号码', bsbPh: '例：062-000',
      accountNumber: '账号号码', accountNumberPh: '例：12345678', locked: '请先完成教会认证，才能设置奉献账号。' },
  },
  en: {
    cardTitle: 'Complete Church Setup', completed: 'done', close: 'Close', skip: 'Skip', cancel: 'Cancel',
    congratsTitle: 'Church setup complete! 🎉', congratsDesc: 'Your church is ready. You can close this card anytime.',
    notifText: 'Verified 🎉 You can now set up your giving account', notifAction: 'Set up now',
    save: 'Save', saving: 'Saving...', submitting: 'Submitting...', submitVerify: 'Submit application',
    markShared: 'Shared, mark done',
    items: {
      info: { label: 'Church basic info', desc: 'Address · Phone · Website · Service time' },
      group: { label: 'Create first group', desc: 'Name · Color · Location' },
      logo: { label: 'Upload church logo', desc: 'Complete your church page' },
      invite: { label: 'Invite members', descTpl: (c: string) => `Join code: ${c}` },
      verify: { label: 'Submit for verification', desc: 'Complete platform verification' },
      bsb: { label: 'Set up giving account', descOn: 'Enter bank account details', descOff: 'Verify church first' },
    },
    info: { address: 'Church Address', phone: 'Phone', website: 'Website', meetingTime: 'Service Time',
      addressPh: 'e.g. 123 Church St, Melbourne', phonePh: 'e.g. +61 3 9999 0000', websitePh: 'e.g. https://yourchurch.org', meetingTimePh: 'e.g. Sunday 10:00 AM' },
    group: { name: 'Group Name', namePh: 'e.g. Youth Fellowship', color: 'Group Color', location: 'Meeting Location', locationPh: 'e.g. Hall B203' },
    logo: { line1: 'Click the logo icon next to your church name in the top nav to upload.', line2: 'PNG / JPG supported, square image recommended' },
    invite: { desc: 'Share this join code with your members. They enter it on the login page to apply.', copy: 'Copy join code', copied: 'Copied!' },
    verify: {
      doneTitle: 'Your church is verified 🎉', doneDesc: 'Advanced features like giving accounts are unlocked.',
      pendingTitle: 'Application submitted, pending review', pendingDesc: "You'll get a dashboard notification once approved.",
      intro: 'After submitting, the platform will verify your church info. Verification unlocks advanced features.',
      contactName: 'Contact Name', contactNamePh: 'e.g. Pastor Chen', contactPhone: 'Phone', contactPhonePh: 'e.g. +61 ...',
      note: 'Note (optional)', notePh: 'Registration number, denomination, etc.' },
    bsb: { accountName: 'Account Name', accountNamePh: 'e.g. Grace Church Inc', bsb: 'BSB Number', bsbPh: 'e.g. 062-000',
      accountNumber: 'Account Number', accountNumberPh: 'e.g. 12345678', locked: 'Please verify your church first before setting up the giving account.' },
  },
};

const DISMISSED_KEY = (churchId: string) => `church_setup_dismissed_${churchId}`;
const VERIFIED_NOTIF_KEY = (churchId: string) => `church_verified_notif_dismissed_${churchId}`;

// Map local item IDs → setup_progress JSONB keys
const DB_KEY: Record<string, string> = {
  info: 'basic_info',
  group: 'first_group',
  logo: 'logo',
  invite: 'invite',
  verify: 'verification',
  bsb: 'bsb',
};

const GROUP_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#DB2777', '#374151',
];

interface ChecklistItem {
  id: string;
  label: string;
  desc: string;
  icon: string;
  locked?: boolean;
}

export default function ChurchSetupChecklist() {
  const { church, profile, updateChurch } = useAuth() as any;
  const { isZh } = useLanguage();
  const L = isZh ? STRINGS.zh : STRINGS.en;
  const activeChurchId = getActiveChurchId(profile, church);

  const [done, setDone] = useState<Set<string>>(() => {
    const sp = (church as any)?.setup_progress;
    if (!sp) return new Set();
    return new Set(Object.entries(DB_KEY).filter(([, dbk]) => sp[dbk] === true).map(([id]) => id));
  });
  const [dismissed, setDismissed] = useState(() =>
    activeChurchId ? !!localStorage.getItem(DISMISSED_KEY(activeChurchId)) : false
  );
  const [verifiedNotifDismissed, setVerifiedNotifDismissed] = useState(() =>
    activeChurchId ? !!localStorage.getItem(VERIFIED_NOTIF_KEY(activeChurchId)) : false
  );
  const [openModal, setOpenModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state — church info
  const [churchInfo, setChurchInfo] = useState({
    location: church?.location || church?.address || '',
    phone: church?.phone || '',
    website: church?.website || '',
    meeting_time: church?.meeting_time || '',
  });

  // Form state — group creation
  const [groupForm, setGroupForm] = useState({
    name: '',
    color: GROUP_COLORS[0],
    meeting_address: '',
  });

  const [joinCodeCopied, setJoinCodeCopied] = useState(false);

  // Form state — verification application
  const [verifyForm, setVerifyForm] = useState({
    contact_name: church?.verification_contact || '',
    contact_phone: church?.phone || '',
    note: '',
  });
  const verifyStatus = (church as any)?.verification_status || 'none';

  // Form state — BSB / bank account
  const [bsbForm, setBsbForm] = useState({
    bsb: church?.bsb || '',
    account_number: church?.account_number || '',
    account_name: church?.account_name || '',
  });

  const isVerified = !!(church as any)?.verified;

  // Show verification notification when church becomes verified and BSB not yet done
  const showVerifiedNotif = isVerified && !done.has('bsb') && !verifiedNotifDismissed;

  const markDone = useCallback(async (id: string) => {
    setDone(prev => { const next = new Set(prev); next.add(id); return next; });
    if (!activeChurchId) return;
    const dbKey = DB_KEY[id];
    if (!dbKey) return;
    const current = (church as any)?.setup_progress || {};
    await supabase.from('churches')
      .update({ setup_progress: { ...current, [dbKey]: true } })
      .eq('id', activeChurchId);
    if (typeof updateChurch === 'function') {
      updateChurch({ setup_progress: { ...current, [dbKey]: true } });
    }
  }, [activeChurchId, church, updateChurch]);

  useEffect(() => {
    if (!activeChurchId) return;
    supabase.from('church_groups').select('id').eq('church_id', activeChurchId).limit(1)
      .then(({ data }) => { if ((data?.length || 0) > 0) markDone('group'); });
    if ((church?.location || church?.address) && church?.meeting_time) markDone('info');
    if (church?.logo_url) markDone('logo');
  }, [activeChurchId]);

  const items: ChecklistItem[] = [
    { id: 'info', label: L.items.info.label, desc: L.items.info.desc, icon: 'church' },
    { id: 'group', label: L.items.group.label, desc: L.items.group.desc, icon: 'groups' },
    { id: 'logo', label: L.items.logo.label, desc: L.items.logo.desc, icon: 'add_photo_alternate' },
    { id: 'invite', label: L.items.invite.label, desc: L.items.invite.descTpl(church?.code || '—'), icon: 'person_add' },
    { id: 'verify', label: L.items.verify.label, desc: L.items.verify.desc, icon: 'verified' },
    { id: 'bsb', label: L.items.bsb.label, desc: isVerified ? L.items.bsb.descOn : L.items.bsb.descOff, icon: 'account_balance', locked: !isVerified },
  ];

  const completedCount = items.filter(i => done.has(i.id)).length;
  const allDone = completedCount === items.length;

  if (dismissed) return null;

  // ── Modal body per item ───────────────────────────────────────────
  const renderModalBody = () => {
    switch (openModal) {
      case 'info':
        return (
          <div className="space-y-4">
            {[
              { label: L.info.address, field: 'location', placeholder: L.info.addressPh },
              { label: L.info.phone, field: 'phone', placeholder: L.info.phonePh },
              { label: L.info.website, field: 'website', placeholder: L.info.websitePh },
              { label: L.info.meetingTime, field: 'meeting_time', placeholder: L.info.meetingTimePh },
            ].map(({ label, field, placeholder }) => (
              <div key={field}>
                <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{label}</label>
                <input
                  value={(churchInfo as any)[field]}
                  onChange={e => setChurchInfo(p => ({ ...p, [field]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            ))}
          </div>
        );

      case 'group':
        return (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.group.name}</label>
              <input
                value={groupForm.name}
                onChange={e => setGroupForm(p => ({ ...p, name: e.target.value }))}
                placeholder={L.group.namePh}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.group.color}</label>
              <div className="flex gap-2 flex-wrap">
                {GROUP_COLORS.map(c => (
                  <button key={c} onClick={() => setGroupForm(p => ({ ...p, color: c }))}
                    className={`w-8 h-8 rounded-xl transition-all ${groupForm.color === c ? 'ring-2 ring-offset-2 ring-neutral-800 scale-110' : 'hover:scale-105'}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.group.location}</label>
              <input
                value={groupForm.meeting_address}
                onChange={e => setGroupForm(p => ({ ...p, meeting_address: e.target.value }))}
                placeholder={L.group.locationPh}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
        );

      case 'logo':
        return (
          <div className="text-center py-4">
            <span className="material-symbols-outlined text-5xl text-emerald-400 mb-4 block">add_photo_alternate</span>
            <p className="text-sm text-neutral-600 mb-2">{L.logo.line1}</p>
            <p className="text-xs text-neutral-400">{L.logo.line2}</p>
          </div>
        );

      case 'invite':
        return (
          <div className="text-center py-6 space-y-4">
            <div className="text-6xl font-black tracking-widest text-neutral-900 font-mono">{church?.code}</div>
            <p className="text-sm text-neutral-500">{L.invite.desc}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(church?.code || ''); setJoinCodeCopied(true); setTimeout(() => setJoinCodeCopied(false), 2000); }}
              className="flex items-center gap-2 mx-auto bg-neutral-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-black transition-colors">
              <span className="material-symbols-outlined text-[16px]">{joinCodeCopied ? 'check' : 'content_copy'}</span>
              {joinCodeCopied ? L.invite.copied : L.invite.copy}
            </button>
          </div>
        );

      case 'verify':
        if (isVerified) {
          return (
            <div className="text-center py-6 space-y-3">
              <span className="material-symbols-outlined filled text-5xl text-emerald-500 block">verified</span>
              <p className="text-sm font-bold text-emerald-700">{L.verify.doneTitle}</p>
              <p className="text-xs text-neutral-400">{L.verify.doneDesc}</p>
            </div>
          );
        }
        if (verifyStatus === 'pending') {
          return (
            <div className="text-center py-6 space-y-3">
              <span className="material-symbols-outlined text-5xl text-amber-500 block">hourglass_top</span>
              <p className="text-sm font-bold text-amber-700">{L.verify.pendingTitle}</p>
              <p className="text-xs text-neutral-400">{L.verify.pendingDesc}</p>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            <p className="text-xs text-neutral-500 bg-neutral-50 rounded-xl px-4 py-3">{L.verify.intro}</p>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.verify.contactName}</label>
              <input value={verifyForm.contact_name}
                onChange={e => setVerifyForm(p => ({ ...p, contact_name: e.target.value }))}
                placeholder={L.verify.contactNamePh}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.verify.contactPhone}</label>
              <input value={verifyForm.contact_phone}
                onChange={e => setVerifyForm(p => ({ ...p, contact_phone: e.target.value }))}
                placeholder={L.verify.contactPhonePh}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.verify.note}</label>
              <textarea value={verifyForm.note}
                onChange={e => setVerifyForm(p => ({ ...p, note: e.target.value }))}
                placeholder={L.verify.notePh}
                rows={3}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 resize-none" />
            </div>
          </div>
        );

      case 'bsb':
        return isVerified ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.bsb.accountName}</label>
              <input value={bsbForm.account_name}
                onChange={e => setBsbForm(p => ({ ...p, account_name: e.target.value }))}
                placeholder={L.bsb.accountNamePh}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.bsb.bsb}</label>
              <input value={bsbForm.bsb}
                onChange={e => setBsbForm(p => ({ ...p, bsb: e.target.value }))}
                placeholder={L.bsb.bsbPh} inputMode="numeric"
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">{L.bsb.accountNumber}</label>
              <input value={bsbForm.account_number}
                onChange={e => setBsbForm(p => ({ ...p, account_number: e.target.value }))}
                placeholder={L.bsb.accountNumberPh} inputMode="numeric"
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <span className="material-symbols-outlined text-5xl text-neutral-300 block mb-3">lock</span>
            <p className="text-sm text-neutral-500">{L.bsb.locked}</p>
          </div>
        );

      default: return null;
    }
  };

  const handleModalSave = async () => {
    if (!openModal) return;
    setSaving(true);
    try {
      if (openModal === 'info' && activeChurchId) {
        await supabase.from('churches').update({
          location: churchInfo.location,
          phone: churchInfo.phone,
          website: churchInfo.website,
          meeting_time: churchInfo.meeting_time,
        }).eq('id', activeChurchId);
        if (typeof updateChurch === 'function') updateChurch({ ...churchInfo });
        await markDone('info');
      } else if (openModal === 'group' && activeChurchId && groupForm.name.trim()) {
        await supabase.from('church_groups').insert({
          church_id: activeChurchId,
          name: groupForm.name.trim(),
          color: groupForm.color,
          meeting_address: groupForm.meeting_address.trim(),
          description: '',
        });
        await markDone('group');
      } else if (openModal === 'verify' && activeChurchId) {
        await supabase.from('churches').update({
          verification_status: 'pending',
          verification_contact: verifyForm.contact_name,
          verification_note: verifyForm.note,
        }).eq('id', activeChurchId);
        if (typeof updateChurch === 'function') updateChurch({ verification_status: 'pending', verification_contact: verifyForm.contact_name });
        await markDone('verify');
      } else if (openModal === 'bsb' && isVerified && activeChurchId) {
        await supabase.from('churches').update({
          bsb: bsbForm.bsb.trim(),
          account_number: bsbForm.account_number.trim(),
          account_name: bsbForm.account_name.trim(),
        }).eq('id', activeChurchId);
        if (typeof updateChurch === 'function') updateChurch({ ...bsbForm });
        await markDone('bsb');
      }
      setOpenModal(null);
    } finally { setSaving(false); }
  };

  const canSave = (id: string | null) => {
    if (id === 'info') return !!(churchInfo.location.trim() && churchInfo.meeting_time.trim());
    if (id === 'group') return !!groupForm.name.trim();
    if (id === 'bsb') return isVerified;
    if (id === 'verify') return !isVerified && verifyStatus !== 'pending' && !!verifyForm.contact_name.trim();
    return false;
  };
  // verify only shows the save (submit) button when it's still actionable
  const showSaveButton = (id: string | null) => {
    if (id === 'verify') return !isVerified && verifyStatus !== 'pending';
    return ['info', 'group', 'bsb'].includes(id || '');
  };

  return (
    <>
      {/* Verification notification banner */}
      <AnimatePresence>
        {showVerifiedNotif && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-3 flex items-center gap-3 bg-emerald-500 text-white px-5 py-3.5 rounded-2xl shadow-lg shadow-emerald-500/30"
          >
            <span className="material-symbols-outlined text-[20px]">verified</span>
            <p className="flex-1 text-sm font-bold">{L.notifText}</p>
            <button
              onClick={() => { setOpenModal('bsb'); setVerifiedNotifDismissed(true); if (activeChurchId) localStorage.setItem(VERIFIED_NOTIF_KEY(activeChurchId), '1'); }}
              className="text-[11px] font-black uppercase tracking-widest bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors">
              {L.notifAction}
            </button>
            <button
              onClick={() => { setVerifiedNotifDismissed(true); if (activeChurchId) localStorage.setItem(VERIFIED_NOTIF_KEY(activeChurchId), '1'); }}
              className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-[28px] bg-white border border-neutral-100 shadow-sm overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/25">
              <span className="material-symbols-outlined text-white text-[18px]">checklist</span>
            </div>
            <div>
              <h3 className="font-black text-sm text-neutral-900">{L.cardTitle}</h3>
              <p className="text-[10px] text-neutral-400 font-medium">{completedCount} / {items.length} {L.completed}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-28 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <motion.div className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(completedCount / items.length) * 100}%` }}
                transition={{ duration: 0.5 }} />
            </div>
            {allDone && (
              <button onClick={() => { setDismissed(true); if (activeChurchId) localStorage.setItem(DISMISSED_KEY(activeChurchId), '1'); }}
                className="text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:text-neutral-600 transition-colors">
                {L.close}
              </button>
            )}
          </div>
        </div>

        {/* Congratulations banner */}
        {allDone && (
          <div className="mx-4 mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-emerald-500 text-[28px]">celebration</span>
            <div>
              <p className="text-sm font-black text-emerald-800">{L.congratsTitle}</p>
              <p className="text-xs text-emerald-600">{L.congratsDesc}</p>
            </div>
          </div>
        )}

        {/* Items grid */}
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2">
          {items.map(item => {
            const isDone = done.has(item.id);
            return (
              <button key={item.id}
                onClick={() => !item.locked && setOpenModal(item.id)}
                disabled={item.locked}
                className={`flex items-center gap-3 p-3 rounded-2xl text-left transition-all ${
                  isDone ? 'bg-emerald-50 border border-emerald-100' :
                  item.locked ? 'bg-neutral-50 border border-neutral-100 opacity-50 cursor-not-allowed' :
                  'bg-neutral-50 border border-neutral-100 hover:border-emerald-300 hover:bg-emerald-50'
                }`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isDone ? 'bg-emerald-500' : item.locked ? 'bg-neutral-200' : 'bg-white border border-neutral-200'}`}>
                  {isDone
                    ? <span className="material-symbols-outlined text-white text-[16px]">check</span>
                    : item.locked
                      ? <span className="material-symbols-outlined text-neutral-400 text-[16px]">lock</span>
                      : <span className="material-symbols-outlined text-neutral-500 text-[16px]">{item.icon}</span>
                  }
                </div>
                <div className="min-w-0">
                  <div className={`text-[11px] font-bold truncate ${isDone ? 'text-emerald-700 line-through' : 'text-neutral-700'}`}>{item.label}</div>
                  <div className="text-[9px] text-neutral-400 truncate">{item.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Modal */}
      <AnimatePresence>
        {openModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setOpenModal(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
                <h3 className="font-black text-base text-neutral-900">
                  {items.find(i => i.id === openModal)?.label}
                </h3>
                <button onClick={() => setOpenModal(null)} className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center transition-colors">
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">close</span>
                </button>
              </div>
              <div className="px-6 py-5">{renderModalBody()}</div>
              <div className="px-6 pb-5 flex justify-end gap-2">
                <button onClick={() => setOpenModal(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 transition-colors">
                  {done.has(openModal!) ? L.close : L.skip}
                </button>
                {openModal === 'invite' && (
                  <button onClick={() => { markDone('invite'); setOpenModal(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                    {L.markShared}
                  </button>
                )}
                {showSaveButton(openModal) && (
                  <button onClick={handleModalSave} disabled={saving || !canSave(openModal)}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40">
                    {saving ? (openModal === 'verify' ? L.submitting : L.saving) : openModal === 'verify' ? L.submitVerify : L.save}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
