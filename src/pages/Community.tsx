import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId, canDoStaff } from '../lib/permissions';
import { useMode } from '../contexts/ModeContext';
import { lifeService, LifeRow } from '../services/lifeService';

/* ──────────────────────────────────────────────────────────────────────────
   互动社区 · 读经进度 / 培训广场 / 资源库 / 失物招领
   ────────────────────────────────────────────────────────────────────────── */

interface Course   { title: string; speaker: string; time: string; place: string; capacity: number; outline: string }
interface Enroll   { course_id: string; user_id: string; name: string }
interface Resource { cat: ResCat | 'audio'; title: string; url?: string; note?: string }
interface Lost     { kind: 'lost' | 'found' | 'share'; title: string; note: string; contact: string; resolved?: boolean }
interface Reading  { ot: number; nt: number }

type ResCat = 'prep' | 'sermon' | 'group' | 'misc';
const RES_CATS: { key: ResCat; zh: string; en: string; icon: string }[] = [
  { key: 'prep',   zh: '主日预备', en: 'Prepare', icon: 'event_available' },
  { key: 'sermon', zh: '讲道大纲', en: 'Sermons', icon: 'record_voice_over' },
  { key: 'group',  zh: '小组查经', en: 'Groups',  icon: 'diversity_3' },
  { key: 'misc',   zh: '公共资源', en: 'Library', icon: 'folder_open' },
];

const OT_CHAPTERS = 929, NT_CHAPTERS = 260;

export default function Community() {
  const { isZh } = useLanguage();
  const { profile, church, user } = useAuth();
  const churchId = getActiveChurchId(profile, church) || '';
  const { mode } = useMode();
  const canPost = canDoStaff(profile, user) && mode !== 'Member';
  const me = profile?.id || user?.id || 'me';
  const author = { id: me, name: profile?.full_name || user?.email || '' };

  const [courses, setCourses]   = useState<LifeRow<Course>[]>([]);
  const [enrolls, setEnrolls]   = useState<LifeRow<Enroll>[]>([]);
  const [resources, setResources] = useState<LifeRow<Resource>[]>([]);
  const [lost, setLost]         = useState<LifeRow<Lost>[]>([]);
  const [reading, setReading]   = useState<LifeRow<Reading> | null>(null);
  const [resTab, setResTab]     = useState<ResCat>('prep');
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showResForm, setShowResForm] = useState(false);
  const [showLostForm, setShowLostForm] = useState(false);

  useEffect(() => {
    if (!churchId) return;
    lifeService.list<Course>(churchId, 'course').then(setCourses);
    lifeService.list<Enroll>(churchId, 'enroll').then(setEnrolls);
    lifeService.list<Resource>(churchId, 'resource').then(setResources);
    lifeService.list<Lost>(churchId, 'lostfound').then(setLost);
    lifeService.list<Reading>(churchId, 'reading').then(rows => setReading(rows[0] || null));
  }, [churchId]);

  const countFor = (courseId: string) => enrolls.filter(e => e.data.course_id === courseId).length;
  const myEnroll = (courseId: string) => enrolls.find(e => e.data.course_id === courseId && e.data.user_id === me);

  const toggleEnroll = async (course: LifeRow<Course>) => {
    const existing = myEnroll(course.id);
    if (existing) {
      setEnrolls(p => p.filter(e => e.id !== existing.id));
      await lifeService.remove(churchId, 'enroll', existing.id);
      return;
    }
    if (countFor(course.id) >= course.data.capacity) return;
    const row = await lifeService.add<Enroll>(churchId, 'enroll',
      { course_id: course.id, user_id: me, name: author.name || '' }, author);
    setEnrolls(p => [row, ...p]);
  };

  const saveReading = async (next: Reading) => {
    if (reading) {
      setReading({ ...reading, data: next });
      await lifeService.patch(churchId, 'reading', reading.id, next);
    } else {
      setReading(await lifeService.add<Reading>(churchId, 'reading', next, author));
    }
  };

  const visibleRes = useMemo(
    () => resources.filter(r => r.data?.cat === resTab),
    [resources, resTab],
  );

  return (
    <div className="mx-auto w-full max-w-5xl flex flex-col gap-8 p-6 md:p-10 pb-32 md:pb-10">

      <header>
        <h1 className="font-serif font-black text-[34px] md:text-[40px] leading-none text-on-surface">
          {isZh ? '互动社区' : 'Community'}
        </h1>
        <p className="mt-2 text-[14px] text-on-surface/70">
          {isZh ? '一同读经、一同学习、一同生活。' : 'Read together, learn together, live together.'}
        </p>
      </header>

      {/* ── 全教会读经进度 ───────────────────────────────────────────── */}
      <ReadingBoard reading={reading?.data || { ot: 0, nt: 0 }} canPost={canPost} onSave={saveReading} />

      {/* ── 学习培训与活动广场 ───────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif font-black text-[26px] leading-tight text-on-surface">
              {isZh ? '学习培训广场' : 'Training & Events'}
            </h2>
            <p className="mt-1 text-[13px] text-on-surface/70">
              {isZh ? '装备自己，才能服事别人。' : 'Be equipped, then serve.'}
            </p>
          </div>
          {canPost && (
            <button onClick={() => setShowCourseModal(true)}
              className="px-6 py-3 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap active:scale-95 transition-all">
              {isZh ? '发布活动 / 培训' : 'Post a course'}
            </button>
          )}
        </div>

        {courses.length === 0 && (
          <EmptyCard text={isZh ? '目前没有开放报名的课程。' : 'No courses open for enrolment.'} />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {courses.map(c => {
            const taken = countFor(c.id);
            const full = taken >= c.data.capacity;
            const joined = !!myEnroll(c.id);
            const pct = c.data.capacity ? Math.min(100, Math.round((taken / c.data.capacity) * 100)) : 0;
            return (
              <article key={c.id} className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6 flex flex-col gap-4">
                <div>
                  <h3 className="font-serif font-black text-[20px] leading-snug text-on-surface">{c.data.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-on-surface/70">
                    {c.data.speaker && <span className="whitespace-nowrap">🎙 {c.data.speaker}</span>}
                    {c.data.time && <span className="whitespace-nowrap">🕘 {c.data.time}</span>}
                    {c.data.place && <span className="whitespace-nowrap">📍 {c.data.place}</span>}
                  </div>
                </div>

                {c.data.outline && (
                  <p className="text-[13px] leading-relaxed text-on-surface/80 whitespace-pre-wrap">{c.data.outline}</p>
                )}

                <div>
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-[0.14em] text-outline">
                    <span className="whitespace-nowrap">{isZh ? '已报名' : 'Enrolled'}</span>
                    <span className="whitespace-nowrap">{taken} / {c.data.capacity}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-surface-dim overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${full ? 'bg-error' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleEnroll(c)}
                    disabled={full && !joined}
                    className={`flex-1 px-5 py-3 rounded-full text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95 ${
                      joined ? 'bg-surface-container-low border border-outline-variant/50 text-on-surface'
                        : full ? 'bg-surface-dim text-outline cursor-not-allowed'
                        : 'bg-black text-white'}`}>
                    {joined ? (isZh ? '取消报名' : 'Withdraw')
                      : full ? (isZh ? '名额已满' : 'Full')
                      : (isZh ? '一键报名' : 'Enrol')}
                  </button>
                  {canPost && (
                    <button onClick={() => { setCourses(p => p.filter(x => x.id !== c.id)); lifeService.remove(churchId, 'course', c.id); }}
                      aria-label={isZh ? '删除课程' : 'Delete course'}
                      className="w-11 h-11 rounded-full flex items-center justify-center text-outline hover:bg-black/5 active:scale-95 transition-all">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 四重灵修资源库 ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-serif font-black text-[26px] leading-tight text-on-surface">
            {isZh ? '灵修资源库' : 'Resource Library'}
          </h2>
          {canPost && (
            <button onClick={() => setShowResForm(v => !v)}
              className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
              {isZh ? '添加资源' : 'Add resource'}
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {RES_CATS.map(c => (
            <button key={c.key} onClick={() => setResTab(c.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all ${
                resTab === c.key ? 'bg-black text-white' : 'bg-surface-container text-on-surface/70 border border-outline-variant/40'}`}>
              <span className="material-symbols-outlined text-[16px]">{c.icon}</span>
              {isZh ? c.zh : c.en}
            </button>
          ))}
        </div>

        {showResForm && canPost && (
          <ResourceForm cat={resTab} onCancel={() => setShowResForm(false)} onSave={async d => {
            const row = await lifeService.add<Resource>(churchId, 'resource', d, author);
            setResources(p => [row, ...p]); setShowResForm(false);
          }} />
        )}

        {visibleRes.length === 0
          ? <EmptyCard text={isZh ? '这个分类下还没有资源。' : 'Nothing filed here yet.'} />
          : (
            <ul className="rounded-[28px] bg-surface-container border border-outline-variant/40 divide-y divide-outline-variant/40 overflow-hidden">
              {visibleRes.map(r => (
                <li key={r.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="material-symbols-outlined text-[20px] text-outline shrink-0">description</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-on-surface truncate">{r.data.title}</p>
                    {r.data.note && <p className="text-[12px] text-on-surface/70 truncate">{r.data.note}</p>}
                  </div>
                  {r.data.url && (
                    <a href={r.data.url} target="_blank" rel="noreferrer"
                      className="shrink-0 px-4 py-2 rounded-full border border-outline-variant/50 text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
                      {isZh ? '下载' : 'Open'}
                    </a>
                  )}
                  {canPost && (
                    <button onClick={() => { setResources(p => p.filter(x => x.id !== r.id)); lifeService.remove(churchId, 'resource', r.id); }}
                      aria-label={isZh ? '删除' : 'Delete'}
                      className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-outline hover:bg-black/5">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {/* ── 失物招领与邻里共享 ───────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif font-black text-[26px] leading-tight text-on-surface">
              {isZh ? '失物招领 · 邻里共享' : 'Lost, Found & Sharing'}
            </h2>
            <p className="mt-1 text-[13px] text-on-surface/70">
              {isZh ? '用小事见证爱心。' : 'Small things, real love.'}
            </p>
          </div>
          <button onClick={() => setShowLostForm(v => !v)}
            className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
            {isZh ? '发布一条' : 'Post'}
          </button>
        </div>

        {showLostForm && (
          <LostForm onCancel={() => setShowLostForm(false)} onSave={async d => {
            const row = await lifeService.add<Lost>(churchId, 'lostfound', d, author);
            setLost(p => [row, ...p]); setShowLostForm(false);
          }} />
        )}

        {lost.length === 0
          ? <EmptyCard text={isZh ? '暂时没有失物或共享信息。' : 'Nothing posted yet.'} />
          : (
            <div className="grid gap-3 md:grid-cols-2">
              {lost.map(l => (
                <article key={l.id} className={`rounded-[24px] border p-5 flex flex-col gap-2 ${
                  l.data.resolved ? 'bg-surface-container-low border-outline-variant/40 opacity-60' : 'bg-surface-container border-outline-variant/40'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                      l.data.kind === 'lost' ? 'bg-error-container text-on-error-container'
                        : l.data.kind === 'found' ? 'bg-black text-white'
                        : 'bg-surface-dim text-on-surface'}`}>
                      {l.data.kind === 'lost' ? (isZh ? '寻物' : 'Lost')
                        : l.data.kind === 'found' ? (isZh ? '招领' : 'Found')
                        : (isZh ? '闲置共享' : 'Share')}
                    </span>
                    <span className="text-[11px] text-outline truncate">{l.author_name}</span>
                    <div className="flex-1" />
                    <button onClick={() => {
                        const next = { ...l.data, resolved: !l.data.resolved };
                        setLost(p => p.map(x => x.id === l.id ? { ...x, data: next } : x));
                        lifeService.patch(churchId, 'lostfound', l.id, next);
                      }}
                      className="text-[10px] font-black uppercase tracking-widest text-outline hover:text-primary whitespace-nowrap">
                      {l.data.resolved ? (isZh ? '重新开启' : 'Reopen') : (isZh ? '已解决' : 'Resolved')}
                    </button>
                  </div>
                  <p className="text-[16px] font-bold text-on-surface">{l.data.title}</p>
                  {l.data.note && <p className="text-[13px] text-on-surface/80 whitespace-pre-wrap">{l.data.note}</p>}
                  {l.data.contact && <p className="text-[12px] text-outline">☎ {l.data.contact}</p>}
                </article>
              ))}
            </div>
          )}
      </section>

      {/* ── 同工发布后台 (Modal) ─────────────────────────────────────── */}
      <AnimatePresence>
        {showCourseModal && (
          <CourseModal
            onClose={() => setShowCourseModal(false)}
            onSave={async d => {
              const row = await lifeService.add<Course>(churchId, 'course', d, author);
              setCourses(p => [row, ...p]);
              setShowCourseModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 子组件 ───────────────────────────────────────────────────────────── */

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-outline-variant p-8 text-center text-[13px] text-outline">
      {text}
    </div>
  );
}

function ReadingBoard({ reading, canPost, onSave }: {
  reading: Reading; canPost: boolean; onSave: (r: Reading) => void;
}) {
  const { isZh } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reading);
  useEffect(() => setDraft(reading), [reading.ot, reading.nt]);

  const bars = [
    { label: isZh ? '旧约' : 'Old Testament', done: reading.ot, total: OT_CHAPTERS },
    { label: isZh ? '新约' : 'New Testament', done: reading.nt, total: NT_CHAPTERS },
  ];

  return (
    <section className="rounded-[32px] bg-surface-container border border-outline-variant/40 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif font-black text-[26px] leading-tight text-on-surface">
            {isZh ? '全教会读经进度' : 'Church-wide Reading'}
          </h2>
          <p className="mt-1 text-[13px] text-on-surface/70">
            {isZh ? '一年读完一遍圣经 — 我们一起走到哪里了。' : 'The Bible in a year — where we are together.'}
          </p>
        </div>
        {canPost && (
          <button onClick={() => setEditing(v => !v)}
            className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary transition-all">
            {editing ? (isZh ? '收起' : 'Close') : (isZh ? '更新进度' : 'Update')}
          </button>
        )}
      </div>

      <div className="mt-6 space-y-5">
        {bars.map(b => {
          const pct = Math.min(100, Math.round((b.done / b.total) * 100));
          return (
            <div key={b.label}>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-bold text-on-surface whitespace-nowrap">{b.label}</span>
                <span className="text-[13px] text-outline whitespace-nowrap">{b.done} / {b.total} · {pct}%</span>
              </div>
              <div className="mt-2 h-3 rounded-full bg-surface-dim overflow-hidden">
                <motion.div className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
              </div>
            </div>
          );
        })}
      </div>

      {editing && canPost && (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">{isZh ? '旧约章数' : 'OT chapters'}</span>
            <input type="number" min={0} max={OT_CHAPTERS} value={draft.ot}
              onChange={e => setDraft({ ...draft, ot: Number(e.target.value) })}
              className="w-32 bg-surface-container-low rounded-2xl px-4 py-2.5 outline-none focus:ring-2 ring-primary/20" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">{isZh ? '新约章数' : 'NT chapters'}</span>
            <input type="number" min={0} max={NT_CHAPTERS} value={draft.nt}
              onChange={e => setDraft({ ...draft, nt: Number(e.target.value) })}
              className="w-32 bg-surface-container-low rounded-2xl px-4 py-2.5 outline-none focus:ring-2 ring-primary/20" />
          </label>
          <button onClick={() => { onSave(draft); setEditing(false); }}
            className="px-6 py-3 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
            {isZh ? '保存' : 'Save'}
          </button>
        </div>
      )}
    </section>
  );
}

function CourseModal({ onClose, onSave }: { onClose: () => void; onSave: (c: Course) => void }) {
  const { isZh } = useLanguage();
  const [f, setF] = useState<Course>({ title: '', speaker: '', time: '', place: '', capacity: 20, outline: '' });
  const field = 'w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-t-[32px] md:rounded-[32px] p-6 md:p-8 flex flex-col gap-4"
      >
        <div>
          <h3 className="font-serif font-black text-[24px] leading-tight text-on-surface">
            {isZh ? '发布活动 / 培训' : 'Post a Course'}
          </h3>
          <p className="mt-1 text-[13px] text-on-surface/70">
            {isZh ? '发布后立即公示于广场，弟兄姊妹可一键报名。' : 'Published to the square immediately.'}
          </p>
        </div>

        <input className={field} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
          placeholder={isZh ? '课程标题（如：系统神学导读班）' : 'Course title'} />
        <input className={field} value={f.speaker} onChange={e => setF({ ...f, speaker: e.target.value })}
          placeholder={isZh ? '讲员' : 'Speaker'} />
        <input className={field} value={f.time} onChange={e => setF({ ...f, time: e.target.value })}
          placeholder={isZh ? '时间（如：每周三 19:30，共 8 周）' : 'Time'} />
        <input className={field} value={f.place} onChange={e => setF({ ...f, place: e.target.value })}
          placeholder={isZh ? '上课地点' : 'Location'} />
        <label className="flex items-center gap-3">
          <span className="text-[13px] text-on-surface/70 whitespace-nowrap">{isZh ? '限定名额' : 'Capacity'}</span>
          <input type="number" min={1} className={field + ' flex-1'} value={f.capacity}
            onChange={e => setF({ ...f, capacity: Math.max(1, Number(e.target.value)) })} />
        </label>
        <textarea className={field + ' resize-none'} rows={4} value={f.outline}
          onChange={e => setF({ ...f, outline: e.target.value })}
          placeholder={isZh ? '课程大纲…' : 'Outline…'} />

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose}
            className="px-6 py-3 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button onClick={() => f.title.trim() && onSave(f)}
            className="px-6 py-3 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
            {isZh ? '发布' : 'Publish'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ResourceForm({ cat, onCancel, onSave }: { cat: ResCat; onCancel: () => void; onSave: (r: Resource) => void }) {
  const { isZh } = useLanguage();
  const [f, setF] = useState<Resource>({ cat, title: '', url: '', note: '' });
  useEffect(() => setF(p => ({ ...p, cat })), [cat]);
  const field = 'w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20';
  return (
    <div className="rounded-[24px] bg-surface-container border border-outline-variant/40 p-5 flex flex-col gap-3">
      <input className={field} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
        placeholder={isZh ? '标题' : 'Title'} />
      <input className={field} value={f.url} onChange={e => setF({ ...f, url: e.target.value })}
        placeholder={isZh ? '文件 / 链接地址' : 'File or link URL'} />
      <input className={field} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}
        placeholder={isZh ? '备注（选填）' : 'Note (optional)'} />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
          {isZh ? '取消' : 'Cancel'}
        </button>
        <button onClick={() => f.title.trim() && onSave(f)} className="px-5 py-2.5 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
          {isZh ? '保存' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function LostForm({ onCancel, onSave }: { onCancel: () => void; onSave: (l: Lost) => void }) {
  const { isZh } = useLanguage();
  const [f, setF] = useState<Lost>({ kind: 'lost', title: '', note: '', contact: '' });
  const field = 'w-full bg-surface-container-low rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 ring-primary/20';
  const kinds: { k: Lost['kind']; zh: string; en: string }[] = [
    { k: 'lost',  zh: '寻物', en: 'Lost' },
    { k: 'found', zh: '招领', en: 'Found' },
    { k: 'share', zh: '闲置共享', en: 'Share' },
  ];
  return (
    <div className="rounded-[24px] bg-surface-container border border-outline-variant/40 p-5 flex flex-col gap-3">
      <div className="flex gap-2">
        {kinds.map(k => (
          <button key={k.k} onClick={() => setF({ ...f, kind: k.k })}
            className={`px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
              f.kind === k.k ? 'bg-black text-white' : 'bg-surface-container-low text-outline'}`}>
            {isZh ? k.zh : k.en}
          </button>
        ))}
      </div>
      <input className={field} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
        placeholder={isZh ? '物品 / 事项（如：黑色雨伞，主日下午遗失）' : 'What is it?'} />
      <textarea className={field + ' resize-none'} rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}
        placeholder={isZh ? '补充说明' : 'Details'} />
      <input className={field} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })}
        placeholder={isZh ? '联系方式' : 'Contact'} />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
          {isZh ? '取消' : 'Cancel'}
        </button>
        <button onClick={() => f.title.trim() && onSave(f)} className="px-5 py-2.5 rounded-full bg-black text-white text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
          {isZh ? '发布' : 'Post'}
        </button>
      </div>
    </div>
  );
}
