import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId, canManageChurch } from '../lib/permissions';
import { useMode } from '../contexts/ModeContext';
import { lifeService, dayKey, LifeRow } from '../services/lifeService';

/* ──────────────────────────────────────────────────────────────────────────
   首页看板 · 每日灵修与属灵指引
   紧急通知 / 灵修打卡 + 属灵热力图 / 主日签到 / 一分钟读经 / 信仰宣告
   ────────────────────────────────────────────────────────────────────────── */

type CheckinType = 'read' | 'pray' | 'devotion' | 'sunday';
interface Checkin { date: string; type: CheckinType; user_id: string }
interface Notice  { title: string; body: string; level: 'urgent' | 'info' }
interface Audio   { title: string; url: string; ref?: string }

const CREED = {
  zh: [
    '我信上帝，全能的父，创造天地的主。',
    '我信我主耶稣基督，上帝独生的子；因圣灵感孕，由童贞女马利亚所生；',
    '在本丢彼拉多手下受难，被钉于十字架，受死，埋葬；降在阴间；第三天从死里复活；',
    '升天，坐在全能父上帝的右边；将来必从那里降临，审判活人死人。',
    '我信圣灵；我信圣而公之教会；我信圣徒相通；我信罪得赦免；我信身体复活；我信永生。阿们。',
  ],
  en: [
    'I believe in God, the Father almighty, creator of heaven and earth.',
    'I believe in Jesus Christ, his only Son, our Lord, who was conceived by the Holy Spirit, born of the Virgin Mary,',
    'suffered under Pontius Pilate, was crucified, died and was buried; he descended to the dead. On the third day he rose again;',
    'he ascended into heaven, is seated at the right hand of the Father, and will come to judge the living and the dead.',
    'I believe in the Holy Spirit, the holy catholic Church, the communion of saints, the forgiveness of sins, the resurrection of the body, and the life everlasting. Amen.',
  ],
};

/** 一年的日期格子（从 52 周前的周日排到今天），用于热力图。 */
function heatmapDays(): string[] {
  const out: string[] = [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // 对齐到周日
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(dayKey(d));
  return out;
}

export default function DailyDevotion() {
  const { isZh } = useLanguage();
  const { profile, church, user } = useAuth();
  const churchId = getActiveChurchId(profile, church) || '';
  const { mode } = useMode();
  const canManage = canManageChurch(profile, user) && mode !== 'Member';
  const me = profile?.id || user?.id || 'me';
  const author = { id: me, name: profile?.full_name || user?.email || '' };

  const [checkins, setCheckins] = useState<LifeRow<Checkin>[]>([]);
  const [notices, setNotices] = useState<LifeRow<Notice>[]>([]);
  const [audios, setAudios] = useState<LifeRow<Audio>[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`notice_dismissed_${me}`) || '[]'); } catch { return []; }
  });
  const [showNoticeForm, setShowNoticeForm] = useState(false);
  const [draft, setDraft] = useState<Notice>({ title: '', body: '', level: 'urgent' });
  const heatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!churchId) return;
    lifeService.list<Checkin>(churchId, 'checkin').then(setCheckins);
    lifeService.list<Notice>(churchId, 'notice').then(setNotices);
    lifeService.list<Audio>(churchId, 'resource').then(rows =>
      setAudios(rows.filter(r => (r.data as any)?.cat === 'audio')));
  }, [churchId]);

  // 热力图挂载后滚到最右（今天）
  useEffect(() => { if (heatRef.current) heatRef.current.scrollLeft = heatRef.current.scrollWidth; }, [checkins.length]);

  const mine = useMemo(() => checkins.filter(c => c.data?.user_id === me), [checkins, me]);
  const today = dayKey();

  /** date → 当天已打卡的种类集合（仅本人） */
  const byDay = useMemo(() => {
    const m = new Map<string, Set<CheckinType>>();
    mine.forEach(c => {
      if (!m.has(c.data.date)) m.set(c.data.date, new Set());
      m.get(c.data.date)!.add(c.data.type);
    });
    return m;
  }, [mine]);

  const has = (type: CheckinType, date = today) => !!byDay.get(date)?.has(type);

  const toggle = async (type: CheckinType) => {
    const existing = mine.find(c => c.data.date === today && c.data.type === type);
    if (existing) {
      setCheckins(prev => prev.filter(c => c.id !== existing.id));
      await lifeService.remove(churchId, 'checkin', existing.id);
    } else {
      const row = await lifeService.add<Checkin>(churchId, 'checkin', { date: today, type, user_id: me }, author);
      setCheckins(prev => [row, ...prev]);
    }
  };

  /** 连续打卡天数（任一种类算一天） */
  const streak = useMemo(() => {
    let n = 0;
    const d = new Date();
    // 今天没打卡不算断，从昨天继续数
    if (!byDay.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (byDay.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [byDay]);

  const days = useMemo(heatmapDays, []);
  const weeks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const liveNotices = notices.filter(n => !dismissed.includes(n.id));

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(`notice_dismissed_${me}`, JSON.stringify(next)); } catch {}
  };

  const publishNotice = async () => {
    if (!draft.title.trim()) return;
    const row = await lifeService.add<Notice>(churchId, 'notice', draft, author);
    setNotices(prev => [row, ...prev]);
    setDraft({ title: '', body: '', level: 'urgent' });
    setShowNoticeForm(false);
  };

  const CHECKS: { type: CheckinType; icon: string; zh: string; en: string }[] = [
    { type: 'read',     icon: 'menu_book',           zh: '读经', en: 'Scripture' },
    { type: 'pray',     icon: 'volunteer_activism',  zh: '祷告', en: 'Prayer' },
    { type: 'devotion', icon: 'self_improvement',    zh: '灵修', en: 'Devotion' },
  ];

  return (
    <div className="flex flex-col gap-6">

      {/* ── 紧急与重点通知 ───────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {liveNotices.map(n => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: -24, transition: { duration: 0.25 } }}
            className={`relative overflow-hidden rounded-[28px] px-6 py-5 flex items-start gap-4 ${
              n.data.level === 'urgent'
                ? 'bg-error-container border border-error/30'
                : 'bg-surface-container border border-outline-variant/40'
            }`}
          >
            <span className={`material-symbols-outlined text-[22px] mt-0.5 shrink-0 ${
              n.data.level === 'urgent' ? 'text-error' : 'text-outline'}`}>
              {n.data.level === 'urgent' ? 'priority_high' : 'campaign'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-serif font-black text-[17px] leading-snug text-on-surface">{n.data.title}</p>
              {n.data.body && <p className="mt-1 text-[14px] leading-relaxed text-on-surface/80 whitespace-pre-wrap">{n.data.body}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canManage && (
                <button
                  onClick={() => { setNotices(p => p.filter(x => x.id !== n.id)); lifeService.remove(churchId, 'notice', n.id); }}
                  aria-label={isZh ? '删除通知' : 'Delete notice'}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-outline hover:bg-black/5 active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              )}
              <button
                onClick={() => dismiss(n.id)}
                aria-label={isZh ? '我知道了' : 'Dismiss'}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-outline hover:bg-black/5 active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {canManage && (
        showNoticeForm ? (
          <div className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6 flex flex-col gap-3">
            <input
              value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
              placeholder={isZh ? '通知标题（如：主日暴雨改为线上聚会）' : 'Notice title'}
              className="w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20"
            />
            <textarea
              value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })}
              rows={3} placeholder={isZh ? '详细说明…' : 'Details…'}
              className="w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[14px] outline-none resize-none focus:ring-2 ring-primary/20"
            />
            <div className="flex flex-wrap items-center gap-2">
              {(['urgent', 'info'] as const).map(lv => (
                <button key={lv} onClick={() => setDraft({ ...draft, level: lv })}
                  className={`px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                    draft.level === lv ? 'bg-black text-white' : 'bg-surface-container-low text-outline'}`}>
                  {lv === 'urgent' ? (isZh ? '紧急' : 'Urgent') : (isZh ? '重点' : 'Highlight')}
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={() => setShowNoticeForm(false)}
                className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button onClick={publishNotice}
                className="px-5 py-2.5 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
                {isZh ? '发布' : 'Publish'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNoticeForm(true)}
            className="self-start flex items-center gap-2 px-5 py-2.5 rounded-full border border-dashed border-outline-variant text-outline text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary hover:text-primary transition-all">
            <span className="material-symbols-outlined text-[16px]">campaign</span>
            {isZh ? '发布重点通知' : 'Post a notice'}
          </button>
        )
      )}

      {/* ── 灵修打卡 + 属灵热力图 ────────────────────────────────────── */}
      <section className="rounded-[32px] bg-surface-container border border-outline-variant/40 p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-serif font-black text-[26px] leading-tight text-on-surface">
              {isZh ? '今日灵修' : 'Today’s Devotion'}
            </h3>
            <p className="mt-1 text-[13px] text-on-surface/70">
              {isZh ? '晨更、读经、祷告 — 一日三次亲近神' : 'Scripture, prayer, devotion — three ways to draw near'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-serif font-black text-[34px] leading-none text-on-surface">{streak}</p>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-outline mt-1 whitespace-nowrap">
              {isZh ? '连续天数' : 'Day streak'}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {CHECKS.map(c => {
            const on = has(c.type);
            return (
              <button key={c.type} onClick={() => toggle(c.type)}
                aria-pressed={on}
                className={`group rounded-3xl px-3 py-5 flex flex-col items-center gap-2 border transition-all active:scale-[0.97] ${
                  on ? 'bg-black text-white border-black' : 'bg-surface-container-low border-outline-variant/50 text-on-surface hover:border-primary/40'}`}>
                <span className={`material-symbols-outlined text-[26px] ${on ? 'text-white' : 'text-outline group-hover:text-primary'}`}>
                  {c.icon}
                </span>
                <span className="text-[13px] font-bold whitespace-nowrap">{isZh ? c.zh : c.en}</span>
                <span className={`text-[10px] font-black uppercase tracking-[0.14em] whitespace-nowrap ${on ? 'text-white/60' : 'text-outline'}`}>
                  {on ? (isZh ? '已打卡' : 'Done') : (isZh ? '打卡' : 'Check in')}
                </span>
              </button>
            );
          })}
        </div>

        {/* 属灵热力图 */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">
              {isZh ? '全年属灵热力图' : 'Year in devotion'}
            </p>
            <div className="flex items-center gap-1.5 text-outline">
              <span className="text-[10px] whitespace-nowrap">{isZh ? '少' : 'Less'}</span>
              {[0, 1, 2, 3].map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${heatClass(l)}`} />)}
              <span className="text-[10px] whitespace-nowrap">{isZh ? '多' : 'More'}</span>
            </div>
          </div>
          <div ref={heatRef} className="overflow-x-auto no-scrollbar -mx-1 px-1">
            <div className="flex gap-[3px] w-max">
              {weeks.map((w, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {w.map(d => {
                    const n = byDay.get(d)?.size || 0;
                    return (
                      <div key={d} title={`${d} · ${n}`}
                        className={`w-2.5 h-2.5 rounded-[3px] ${heatClass(n)} ${d === today ? 'ring-1 ring-primary ring-offset-1 ring-offset-surface-container' : ''}`} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 主日礼拜签到 ─────────────────────────────────────────────── */}
      <section className="rounded-[32px] bg-black text-white p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-black text-[24px] leading-tight">{isZh ? '主日礼拜签到' : 'Sunday Service Check-in'}</h3>
          <p className="mt-1 text-[13px] text-white/60">
            {isZh ? '到会堂了？签个到，让同工知道你在。' : 'At church today? Let the team know you’re here.'}
          </p>
        </div>
        <button onClick={() => toggle('sunday')}
          className={`shrink-0 px-7 py-3.5 rounded-full text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95 ${
            has('sunday') ? 'bg-white/15 text-white/70 border border-white/25' : 'bg-white text-black hover:bg-white/90'}`}>
          {has('sunday') ? (isZh ? '✓ 今日已签到' : '✓ Checked in') : (isZh ? '我已到达' : 'Check in')}
        </button>
      </section>

      {/* ── 一分钟读经播放器 ─────────────────────────────────────────── */}
      <MinutePlayer audios={audios} setAudios={setAudios} churchId={churchId} canManage={canManage} author={author} />

      {/* ── 信仰宣告板 ───────────────────────────────────────────────── */}
      <section className="rounded-[32px] bg-surface-container-low border border-outline-variant/40 p-6 md:p-8">
        <h3 className="font-serif font-black text-[24px] leading-tight text-on-surface">
          {isZh ? '信仰宣告' : 'What We Believe'}
        </h3>
        <p className="mt-1 text-[11px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">
          {isZh ? '使徒信经' : 'The Apostles’ Creed'}
        </p>
        <div className="mt-5 space-y-3 border-l-2 border-outline-variant pl-5">
          {(isZh ? CREED.zh : CREED.en).map((line, i) => (
            <p key={i} className="font-serif italic text-[17px] leading-relaxed text-on-surface">{line}</p>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 热力图色阶：0 无 → 3 三项全打卡 */
function heatClass(n: number) {
  if (n >= 3) return 'bg-[#2C2C2C]';
  if (n === 2) return 'bg-[#6E635B]';
  if (n === 1) return 'bg-[#BFB5AC]';
  return 'bg-surface-dim';
}

function MinutePlayer({ audios, setAudios, churchId, canManage, author }: {
  audios: LifeRow<Audio>[];
  setAudios: (f: (p: LifeRow<Audio>[]) => LifeRow<Audio>[]) => void;
  churchId: string; canManage: boolean; author: { id?: string | null; name?: string | null };
}) {
  const { isZh } = useLanguage();
  const [idx, setIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', ref: '' });
  const current = audios[idx];

  const save = async () => {
    if (!form.title.trim() || !form.url.trim()) return;
    const row = await lifeService.add<Audio>(churchId, 'resource', { ...form, cat: 'audio' } as any, author);
    setAudios(p => [row, ...p]);
    setForm({ title: '', url: '', ref: '' });
    setAdding(false);
    setIdx(0);
  };

  return (
    <section className="rounded-[32px] bg-surface-container border border-outline-variant/40 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-serif font-black text-[24px] leading-tight text-on-surface">
            {isZh ? '一分钟读经' : 'One Minute in the Word'}
          </h3>
          <p className="mt-1 text-[13px] text-on-surface/70">
            {isZh ? '通勤路上、排队时候，用耳朵领受神的话。' : 'Receive the Word by ear — on the commute, in the queue.'}
          </p>
        </div>
        {canManage && !adding && (
          <button onClick={() => setAdding(true)}
            className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
            {isZh ? '上传音频链接' : 'Add audio'}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-5 flex flex-col gap-3">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder={isZh ? '标题（如：诗篇 23 篇）' : 'Title'}
            className="bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20" />
          <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
            placeholder={isZh ? '音频链接（mp3 / m4a）' : 'Audio URL (mp3 / m4a)'}
            className="bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20" />
          <input value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })}
            placeholder={isZh ? '经文出处（选填）' : 'Reference (optional)'}
            className="bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAdding(false)}
              className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
              {isZh ? '取消' : 'Cancel'}
            </button>
            <button onClick={save}
              className="px-5 py-2.5 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
              {isZh ? '保存' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {current ? (
        <div className="mt-6">
          <p className="font-serif italic text-[19px] leading-snug text-on-surface">{current.data.title}</p>
          {current.data.ref && <p className="mt-1 text-[12px] text-outline">{current.data.ref}</p>}
          {/* 用原生 <audio>：播放/进度/音量浏览器已经做好了 */}
          <audio key={current.id} controls preload="none" src={current.data.url} className="mt-4 w-full" />
          {audios.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {audios.map((a, i) => (
                <button key={a.id} onClick={() => setIdx(i)}
                  className={`px-4 py-2 rounded-full text-[12px] whitespace-nowrap transition-all ${
                    i === idx ? 'bg-black text-white' : 'bg-surface-container-low text-on-surface/70 hover:text-on-surface'}`}>
                  {a.data.title}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-6 text-[13px] text-outline">
          {isZh ? '同工还没有上传今日音频。' : 'No audio has been posted yet.'}
        </p>
      )}
    </section>
  );
}
