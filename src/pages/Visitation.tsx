import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId, canDoStaff } from '../lib/permissions';
import { useMode } from '../contexts/ModeContext';
import { lifeService, LifeRow } from '../services/lifeService';
import { isSampleChurch, SAMPLE_VISITS } from '../lib/demoChurch';

/* ──────────────────────────────────────────────────────────────────────────
   探访关怀 · 申请家访 → 同工跟进 → 完成回报
   ────────────────────────────────────────────────────────────────────────── */

type Status = 'requested' | 'scheduled' | 'visited';

interface Visit {
  name: string; contact: string; address: string;
  reason: string;        // 探访缘由
  needs: string;         // 身体 / 生活需要
  spiritual: string;     // 属灵状况
  status: Status;
  assignee?: string;
  log?: { at: string; by: string; text: string }[];
}

const STAGES: { key: Status; zh: string; en: string; icon: string }[] = [
  { key: 'requested', zh: '待安排', en: 'Requested', icon: 'pending' },
  { key: 'scheduled', zh: '已安排', en: 'Scheduled', icon: 'event' },
  { key: 'visited',   zh: '已探访', en: 'Visited',   icon: 'task_alt' },
];

export default function Visitation() {
  const { isZh } = useLanguage();
  const { profile, church, user } = useAuth();
  const churchId = getActiveChurchId(profile, church) || '';
  const { mode } = useMode();
  const readOnly = isSampleChurch(church);
  // isStaff 决定的是**视野**（看全部探访 + 同工才该看的需要/属灵状况），
  // 不是能不能改。之前把 readOnly 并进来，参观样板间的同工被降级成会友，
  // 只看得到自己发起的 —— 一条都没有，页面就空了。写入另用 canEdit。
  const isStaff = canDoStaff(profile, user) && mode !== 'Member';
  const canEdit = isStaff && !readOnly;
  const me = profile?.id || user?.id || 'me';
  const author = { id: me, name: profile?.full_name || user?.email || '' };

  const [visits, setVisits] = useState<LifeRow<Visit>[]>([]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!churchId) return;
    // 示例教会用常量，不依赖数据库和「填充示例内容」
    if (readOnly) {
      setVisits(SAMPLE_VISITS.map((v, i) => ({
        id: `demo-visit-${i}`, church_id: churchId, kind: 'visit' as const,
        author_id: me, author_name: v.by,
        created_at: new Date(Date.now() - (i + 1) * 1728e5).toISOString(),
        data: { name: v.name, contact: v.contact, address: v.address, reason: v.reason,
                needs: v.needs, spiritual: v.spiritual, status: v.status as Status, log: v.log },
      })));
      return;
    }
    lifeService.list<Visit>(churchId, 'visit').then(setVisits);
  }, [churchId, readOnly]);

  // 会员只看自己发起的；同工看全部。
  const mine = isStaff ? visits : visits.filter(v => v.author_id === me);
  const shown = filter === 'all' ? mine : mine.filter(v => v.data.status === filter);

  const update = async (row: LifeRow<Visit>, patch: Partial<Visit>) => {
    const next = { ...row.data, ...patch };
    setVisits(p => p.map(v => v.id === row.id ? { ...v, data: next } : v));
    await lifeService.patch(churchId, 'visit', row.id, next);
  };

  const addNote = async (row: LifeRow<Visit>) => {
    const text = note.trim();
    if (!text) return;
    const log = [...(row.data.log || []), { at: new Date().toISOString(), by: author.name || '', text }];
    setNote(''); setNoteFor(null);
    await update(row, { log });
  };

  return (
    <div className="mx-auto w-full max-w-4xl flex flex-col gap-6 p-6 md:p-10 pb-32 md:pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif font-black text-[34px] md:text-[40px] leading-none text-on-surface">
            {isZh ? '探访关怀' : 'Visitation & Care'}
          </h1>
          <p className="mt-2 text-[14px] text-on-surface/70 max-w-md">
            {isZh ? '主动寻找，爱心寻访 — 不漏掉任何一只小羊。' : 'Go and look for them — not one sheep left behind.'}
          </p>
        </div>
        {!readOnly && (
          <button onClick={() => setShowForm(true)}
            className="px-6 py-3 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap active:scale-95 transition-all">
            {isZh ? '发起探访申请' : 'Request a visit'}
          </button>
        )}
      </header>

      {/* 进度概览 */}
      {isStaff && (
        <div className="grid grid-cols-3 gap-3">
          {STAGES.map(s => (
            <div key={s.key} className="rounded-[24px] bg-surface-container border border-outline-variant/40 px-4 py-5 text-center">
              <p className="font-serif font-black text-[28px] leading-none text-on-surface">
                {mine.filter(v => v.data.status === s.key).length}
              </p>
              <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-outline whitespace-nowrap">
                {isZh ? s.zh : s.en}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {([{ key: 'all' as const, zh: '全部', en: 'All' }, ...STAGES]).map((s: any) => (
          <button key={s.key} onClick={() => setFilter(s.key)}
            className={`px-5 py-2.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all ${
              filter === s.key ? 'bg-black text-white' : 'bg-surface-container text-on-surface/70 border border-outline-variant/40'}`}>
            {isZh ? s.zh : s.en}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="rounded-[24px] border border-dashed border-outline-variant p-10 text-center text-[13px] text-outline">
          {isZh ? '目前没有探访记录。' : 'No visitation records yet.'}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {shown.map(v => (
          <article key={v.id} className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-serif font-black text-[20px] leading-snug text-on-surface">{v.data.name}</h3>
                <p className="mt-1 text-[12px] text-outline">
                  {[v.data.contact, v.data.address].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                v.data.status === 'visited' ? 'bg-black text-white'
                  : v.data.status === 'scheduled' ? 'bg-surface-dim text-on-surface'
                  : 'bg-error-container text-on-error-container'}`}>
                {isZh ? STAGES.find(s => s.key === v.data.status)?.zh : STAGES.find(s => s.key === v.data.status)?.en}
              </span>
            </div>

            <dl className="grid gap-2 text-[13px]">
              {v.data.reason && <Row label={isZh ? '缘由' : 'Reason'} value={v.data.reason} />}
              {isStaff && v.data.needs && <Row label={isZh ? '生活需要' : 'Practical needs'} value={v.data.needs} />}
              {isStaff && v.data.spiritual && <Row label={isZh ? '属灵状况' : 'Spiritual state'} value={v.data.spiritual} />}
            </dl>

            {!!v.data.log?.length && (
              <ul className="border-l-2 border-outline-variant pl-4 space-y-2">
                {v.data.log.map((l, i) => (
                  <li key={i} className="text-[13px]">
                    <span className="text-outline">{new Date(l.at).toLocaleDateString()} · {l.by}</span>
                    <p className="text-on-surface whitespace-pre-wrap">{l.text}</p>
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {STAGES.map(s => (
                  <button key={s.key} onClick={() => update(v, { status: s.key })}
                    className={`px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                      v.data.status === s.key ? 'bg-black text-white' : 'bg-surface-container-low text-outline hover:text-on-surface'}`}>
                    {isZh ? s.zh : s.en}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={() => { setNoteFor(noteFor === v.id ? null : v.id); setNote(''); }}
                  className="px-4 py-2 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
                  {isZh ? '加跟进' : 'Add note'}
                </button>
              </div>
            )}

            {noteFor === v.id && (
              <div className="flex flex-col gap-2">
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                  placeholder={isZh ? '探访跟进记录…' : 'Follow-up note…'}
                  className="w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[14px] outline-none resize-none focus:ring-2 ring-primary/20" />
                <button onClick={() => addNote(v)}
                  className="self-end px-5 py-2.5 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
                  {isZh ? '保存' : 'Save'}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      <AnimatePresence>
        {showForm && (
          <VisitForm isStaff={isStaff} onClose={() => setShowForm(false)} onSave={async d => {
            const row = await lifeService.add<Visit>(churchId, 'visit', d, author);
            setVisits(p => [row, ...p]);
            setShowForm(false);
          }} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col md:flex-row md:gap-3">
      <dt className="md:w-24 shrink-0 mb-0.5 md:mb-0 text-[11px] font-black uppercase tracking-[0.14em] text-outline pt-0.5 whitespace-nowrap">{label}</dt>
      <dd className="flex-1 text-on-surface whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

function VisitForm({ isStaff, onClose, onSave }: {
  isStaff: boolean; onClose: () => void; onSave: (v: Visit) => void;
}) {
  const { isZh } = useLanguage();
  const [f, setF] = useState<Visit>({
    name: '', contact: '', address: '', reason: '', needs: '', spiritual: '', status: 'requested',
  });
  const field = 'w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm md:p-6">
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-t-[32px] md:rounded-[32px] p-6 md:p-8 flex flex-col gap-4">
        <div>
          <h3 className="font-serif font-black text-[24px] leading-tight text-on-surface">
            {isZh ? '发起探访申请' : 'Request a Visit'}
          </h3>
          <p className="mt-1 text-[13px] text-on-surface/70">
            {isZh ? '同工会尽快与你联系，安排上门或电话探访。' : 'A co-worker will reach out to arrange it.'}
          </p>
        </div>

        <input className={field} value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
          placeholder={isZh ? '关怀对象姓名' : 'Who is this for?'} />
        <input className={field} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })}
          placeholder={isZh ? '联系电话' : 'Phone'} />
        <input className={field} value={f.address} onChange={e => setF({ ...f, address: e.target.value })}
          placeholder={isZh ? '地址（选填）' : 'Address (optional)'} />
        <textarea className={field + ' resize-none'} rows={3} value={f.reason}
          onChange={e => setF({ ...f, reason: e.target.value })}
          placeholder={isZh ? '探访缘由（如：住院、久未聚会、家中有难处…）' : 'Why a visit?'} />

        {isStaff && (
          <>
            <textarea className={field + ' resize-none'} rows={2} value={f.needs}
              onChange={e => setF({ ...f, needs: e.target.value })}
              placeholder={isZh ? '身体 / 生活需要（同工填写）' : 'Practical needs (staff)'} />
            <textarea className={field + ' resize-none'} rows={2} value={f.spiritual}
              onChange={e => setF({ ...f, spiritual: e.target.value })}
              placeholder={isZh ? '属灵状况（同工填写）' : 'Spiritual state (staff)'} />
          </>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose}
            className="px-6 py-3 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button onClick={() => f.name.trim() && onSave(f)}
            className="px-6 py-3 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
            {isZh ? '提交申请' : 'Submit'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
