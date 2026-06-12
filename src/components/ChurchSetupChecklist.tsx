import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getActiveChurchId } from '../lib/permissions';

const DISMISSED_KEY = (churchId: string) => `church_setup_dismissed_${churchId}`;

// Map local item IDs → setup_progress JSONB keys
const DB_KEY: Record<string, string> = {
  info: 'basic_info',
  group: 'first_group',
  logo: 'logo',
  invite: 'invite',
  verify: 'verification',
  bsb: 'bsb',
};

interface ChecklistItem {
  id: string;
  label: string;
  desc: string;
  icon: string;
  locked?: boolean;
}

interface ModalContent {
  id: string;
  title: string;
  body: React.ReactNode;
  onSave?: () => Promise<void>;
}

export default function ChurchSetupChecklist() {
  const { church, profile, user, updateChurch } = useAuth() as any;
  const activeChurchId = getActiveChurchId(profile, church);

  const [done, setDone] = useState<Set<string>>(() => {
    // Seed from church.setup_progress if available
    const sp = (church as any)?.setup_progress;
    if (!sp) return new Set();
    return new Set(Object.entries(DB_KEY).filter(([, dbk]) => sp[dbk] === true).map(([id]) => id));
  });
  const [dismissed, setDismissed] = useState(() =>
    activeChurchId ? !!localStorage.getItem(DISMISSED_KEY(activeChurchId)) : false
  );
  const [openModal, setOpenModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state for modals
  const [churchInfo, setChurchInfo] = useState({ address: church?.address || '', meeting_time: church?.meeting_time || '' });
  const [hasGroups, setHasGroups] = useState(false);
  const [joinCodeCopied, setJoinCodeCopied] = useState(false);

  useEffect(() => {
    if (!activeChurchId) return;
    supabase.from('church_groups').select('id').eq('church_id', activeChurchId).limit(1)
      .then(({ data }) => setHasGroups((data?.length || 0) > 0));
    // Auto-mark based on existing church data (also persists to Supabase)
    if (church?.address && church?.meeting_time) markDone('info');
    if (church?.logo_url) markDone('logo');
  }, [activeChurchId]);

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

  const isVerified = !!(church as any)?.verified;
  const items: ChecklistItem[] = [
    { id: 'info', label: '填写教会基本信息', desc: '地址 · 聚会时间', icon: 'church' },
    { id: 'group', label: '创建第一个小组', desc: '建立团契或事工小组', icon: 'groups' },
    { id: 'logo', label: '上传教会 Logo', desc: '让教会主页更完整', icon: 'add_photo_alternate' },
    { id: 'invite', label: '邀请会友加入', desc: `加入码：${church?.code || '—'}`, icon: 'person_add' },
    { id: 'verify', label: '提交认证申请', desc: '完成平台认证', icon: 'verified' },
    { id: 'bsb', label: '设置奉献账号 BSB', desc: isVerified ? '填写银行账号信息' : '需先完成认证', icon: 'account_balance', locked: !isVerified },
  ];

  const completedCount = items.filter(i => done.has(i.id)).length;
  const allDone = completedCount === items.length;

  if (dismissed) return null;

  // ── Modal content per item ──────────────────────────────────────
  const renderModalBody = () => {
    switch (openModal) {
      case 'info':
        return (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">教会地址</label>
              <input value={churchInfo.address} onChange={e => setChurchInfo(p => ({ ...p, address: e.target.value }))}
                placeholder="例：123 Church Street, Melbourne"
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">聚会时间</label>
              <input value={churchInfo.meeting_time} onChange={e => setChurchInfo(p => ({ ...p, meeting_time: e.target.value }))}
                placeholder="例：每周日上午 10:00"
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
          </div>
        );
      case 'group':
        return (
          <div className="text-center py-4">
            <span className="material-symbols-outlined text-5xl text-emerald-400 mb-4 block">groups</span>
            <p className="text-sm text-neutral-600 mb-6">{hasGroups ? '你已经创建了小组！' : '前往小组页面创建第一个团契或事工小组。'}</p>
            <a href="/app/groups" onClick={() => { markDone('group'); setOpenModal(null); }}
              className="inline-flex items-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors">
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              {hasGroups ? '查看小组' : '去创建小组'}
            </a>
          </div>
        );
      case 'logo':
        return (
          <div className="text-center py-4">
            <span className="material-symbols-outlined text-5xl text-emerald-400 mb-4 block">add_photo_alternate</span>
            <p className="text-sm text-neutral-600 mb-2">在顶部导航栏的教会名称旁边点击 Logo 图标即可上传。</p>
            <p className="text-xs text-neutral-400">支持 PNG / JPG，建议正方形图片</p>
          </div>
        );
      case 'invite':
        return (
          <div className="text-center py-6 space-y-4">
            <div className="text-6xl font-black tracking-widest text-neutral-900 font-mono">{church?.code}</div>
            <p className="text-sm text-neutral-500">把这个加入码分享给你的会友，他们在登录页面输入此码即可申请加入。</p>
            <button onClick={() => { navigator.clipboard.writeText(church?.code || ''); setJoinCodeCopied(true); setTimeout(() => setJoinCodeCopied(false), 2000); }}
              className="flex items-center gap-2 mx-auto bg-neutral-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-black transition-colors">
              <span className="material-symbols-outlined text-[16px]">{joinCodeCopied ? 'check' : 'content_copy'}</span>
              {joinCodeCopied ? '已复制！' : '复制加入码'}
            </button>
          </div>
        );
      case 'verify':
        return (
          <div className="text-center py-4 space-y-3">
            <span className="material-symbols-outlined text-5xl text-emerald-400 block">verified</span>
            <p className="text-sm text-neutral-600">认证申请功能即将上线。认证后可解锁奉献账号等高级功能。</p>
            <p className="text-xs text-neutral-400">如需加急认证，请联系平台管理员。</p>
          </div>
        );
      case 'bsb':
        return isVerified ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">BSB 号码</label>
              <input placeholder="例：062-000" className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1.5 block">账号号码</label>
              <input placeholder="例：12345678" className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <span className="material-symbols-outlined text-5xl text-neutral-300 block mb-3">lock</span>
            <p className="text-sm text-neutral-500">请先完成教会认证，才能设置奉献账号。</p>
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
        await supabase.from('churches').update({ address: churchInfo.address, meeting_time: churchInfo.meeting_time }).eq('id', activeChurchId);
        if (typeof updateChurch === 'function') updateChurch({ address: churchInfo.address, meeting_time: churchInfo.meeting_time });
        markDone('info');
      } else if (openModal === 'invite') {
        markDone('invite');
      } else if (openModal === 'verify') {
        markDone('verify');
      } else if (openModal === 'bsb' && isVerified) {
        markDone('bsb');
      }
      setOpenModal(null);
    } finally { setSaving(false); }
  };

  const canSave = (id: string | null) => {
    if (id === 'info') return !!(churchInfo.address.trim() && churchInfo.meeting_time.trim());
    if (id === 'bsb') return isVerified;
    return false;
  };
  const showSaveButton = (id: string | null) => ['info', 'bsb'].includes(id || '');

  return (
    <>
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
              <h3 className="font-black text-sm text-neutral-900">完成教会设置</h3>
              <p className="text-[10px] text-neutral-400 font-medium">{completedCount} / {items.length} 已完成</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Progress bar */}
            <div className="w-28 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <motion.div className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(completedCount / items.length) * 100}%` }}
                transition={{ duration: 0.5 }} />
            </div>
            {allDone && (
              <button onClick={() => { setDismissed(true); if (activeChurchId) localStorage.setItem(DISMISSED_KEY(activeChurchId), '1'); /* dismissed is UI-only, keep in localStorage */}}
                className="text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:text-neutral-600 transition-colors">
                关闭
              </button>
            )}
          </div>
        </div>

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
                <button onClick={() => setOpenModal(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 transition-colors">取消</button>
                {openModal === 'invite' && (
                  <button onClick={() => { markDone('invite'); setOpenModal(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                    已分享，标记完成
                  </button>
                )}
                {openModal === 'verify' && (
                  <button onClick={() => { markDone('verify'); setOpenModal(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                    已了解，标记完成
                  </button>
                )}
                {showSaveButton(openModal) && (
                  <button onClick={handleModalSave} disabled={saving || !canSave(openModal)}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40">
                    {saving ? '保存中...' : '保存'}
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
