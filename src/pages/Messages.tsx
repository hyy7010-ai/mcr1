import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { lifeService, LifeRow } from '../services/lifeService';
import { isSampleChurch, SAMPLE_CONTACTS, SAMPLE_DMS } from '../lib/demoChurch';

/* ──────────────────────────────────────────────────────────────────────────
   消息通知与私聊 · 同工联系列表 + 一对一对话
   ────────────────────────────────────────────────────────────────────────── */

interface Contact { id: string; name: string; role: string; avatar_url?: string | null }
interface DM { thread: string; from: string; from_name: string; text: string }

/** 会话 id：两个人的 id 排序后拼接，双方看到同一条线。 */
const threadOf = (a: string, b: string) => [a, b].sort().join('|');

const ROLE_GROUPS: { match: string[]; zh: string; en: string; icon: string }[] = [
  { match: ['Super Admin', 'SuperAdmin', 'Manager', 'Admin'], zh: '牧师 / 教牧', en: 'Pastors', icon: 'church' },
  { match: ['Leader'], zh: '团契长 / 小组长', en: 'Group Leaders', icon: 'diversity_3' },
  { match: ['Staff'],  zh: '关怀与辅导同工', en: 'Care Team', icon: 'volunteer_activism' },
  { match: ['Member'], zh: '弟兄姊妹', en: 'Members', icon: 'group' },
];

export default function Messages() {
  const { isZh } = useLanguage();
  const { profile, church, user } = useAuth();
  const churchId = getActiveChurchId(profile, church) || '';
  const me = profile?.id || user?.id || '';
  const author = { id: me, name: profile?.full_name || user?.email || '' };

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [msgs, setMsgs] = useState<LifeRow<DM>[]>([]);
  const [open, setOpen] = useState<Contact | null>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!churchId) return;
    // 示例教会没有登录账号，联系人和往来消息都用常量 —— 四个角色分组都占上，
    // 分组标题才不会是空的。
    if (isSampleChurch(church)) {
      setContacts(SAMPLE_CONTACTS);
      setMsgs(Object.entries(SAMPLE_DMS).flatMap(([cid, list]) =>
        list.map((m, i) => ({
          id: `demo-dm-${cid}-${i}`,
          church_id: churchId,
          kind: 'dm' as const,
          created_at: new Date(Date.now() - (list.length - i) * 6e5).toISOString(),
          author_name: null,
          author_id: null,
          data: {
            thread: threadOf(me, cid),
            from: m.from === 'me' ? me : cid,
            from_name: m.from === 'me' ? (author.name || '我') : (SAMPLE_CONTACTS.find(c => c.id === cid)?.name || ''),
            text: m.text,
          },
        })),
      ).reverse());
      return;
    }
    supabase.from('profiles').select('*').eq('church_id', churchId).then(({ data }) => {
      setContacts((data || [])
        .filter((p: any) => p.id !== me && p.role !== 'Pending')
        .map((p: any) => ({ id: p.id, name: p.full_name || '—', role: p.role || 'Member', avatar_url: p.avatar_url })));
    });
    lifeService.list<DM>(churchId, 'dm').then(setMsgs);
  }, [churchId, me]);

  // 打开会话后轮询新消息（60s，和通知铃一致）
  useEffect(() => {
    if (!open || !churchId) return;
    const id = setInterval(() => lifeService.list<DM>(churchId, 'dm').then(setMsgs), 60000);
    return () => clearInterval(id);
  }, [open, churchId]);

  const thread = open ? threadOf(me, open.id) : '';
  const convo = useMemo(
    () => msgs.filter(m => m.data.thread === thread).slice().reverse(),
    [msgs, thread],
  );

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [convo.length, open?.id]);

  const send = async () => {
    const body = text.trim();
    if (!body || !open) return;
    setText('');
    const row = await lifeService.add<DM>(churchId, 'dm',
      { thread, from: me, from_name: author.name || '', text: body }, author);
    setMsgs(p => [row, ...p]);
  };

  const lastOf = (c: Contact) => {
    const t = threadOf(me, c.id);
    return msgs.find(m => m.data.thread === t)?.data.text;
  };

  const filtered = contacts.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  /* ── 对话详情 ────────────────────────────────────────────────────── */
  if (open) {
    return (
      <div className="flex flex-col h-[100dvh] md:h-full bg-surface">
        <header className="shrink-0 flex items-center gap-3 px-4 md:px-8 py-4 border-b border-outline-variant/40 bg-surface-container-lowest">
          <button onClick={() => setOpen(null)} aria-label={isZh ? '返回' : 'Back'}
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-on-surface hover:bg-black/5 active:scale-95 transition-all">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <Avatar c={open} />
          <div className="min-w-0">
            <p className="font-serif font-black text-[18px] leading-tight text-on-surface truncate">{open.name}</p>
            <p className="text-[11px] text-outline truncate">{roleLabel(open.role, isZh)}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex flex-col gap-3">
          {convo.length === 0 && (
            <p className="m-auto text-center text-[13px] text-outline max-w-xs">
              {isZh ? '这里是你们之间的私密交通。愿主的话语在其中。' : 'A private space. Speak freely.'}
            </p>
          )}
          {convo.map(m => {
            const mine = m.data.from === me;
            return (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className={`max-w-[80%] px-4 py-3 rounded-[20px] text-[15px] leading-relaxed whitespace-pre-wrap ${
                  mine ? 'self-end bg-black text-white rounded-br-md'
                       : 'self-start bg-surface-container border border-outline-variant/40 text-on-surface rounded-bl-md'}`}>
                {m.data.text}
              </motion.div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 flex items-end gap-2 px-4 md:px-8 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-outline-variant/40 bg-surface-container-lowest">
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1} placeholder={isZh ? '写点什么…' : 'Write a message…'}
            className="flex-1 resize-none bg-surface-container-low rounded-3xl px-5 py-3.5 text-[15px] outline-none focus:ring-2 ring-primary/20 max-h-32"
          />
          <button onClick={send} aria-label={isZh ? '发送' : 'Send'}
            className="shrink-0 w-12 h-12 rounded-full bg-black text-white flex items-center justify-center active:scale-95 transition-all">
            <span className="material-symbols-outlined text-[20px]">send</span>
          </button>
        </div>
      </div>
    );
  }

  /* ── 联系列表 ────────────────────────────────────────────────────── */
  return (
    <div className="mx-auto w-full max-w-3xl flex flex-col gap-6 p-6 md:p-10 pb-32 md:pb-10">
      <header>
        <h1 className="font-serif font-black text-[34px] md:text-[40px] leading-none text-on-surface">
          {isZh ? '消息' : 'Messages'}
        </h1>
        <p className="mt-2 text-[14px] text-on-surface/70">
          {isZh ? '找牧长、找同工，一对一交通。' : 'Reach a pastor or a co-worker, one to one.'}
        </p>
      </header>

      <input
        value={q} onChange={e => setQ(e.target.value)}
        placeholder={isZh ? '搜索姓名…' : 'Search a name…'}
        className="w-full bg-surface-container rounded-full px-5 py-3.5 text-[15px] border border-outline-variant/40 outline-none focus:ring-2 ring-primary/20"
      />

      {ROLE_GROUPS.map(g => {
        const list = filtered.filter(c => g.match.includes(c.role));
        if (!list.length) return null;
        return (
          <section key={g.zh}>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[18px] text-outline">{g.icon}</span>
              <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">
                {isZh ? g.zh : g.en}
              </h2>
            </div>
            <ul className="rounded-[28px] bg-surface-container border border-outline-variant/40 divide-y divide-outline-variant/40 overflow-hidden">
              {list.map(c => (
                <li key={c.id}>
                  <button onClick={() => setOpen(c)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface-container-low transition-colors">
                    <Avatar c={c} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold text-on-surface truncate">{c.name}</p>
                      <p className="text-[12px] text-outline truncate">{lastOf(c) || roleLabel(c.role, isZh)}</p>
                    </div>
                    <span className="material-symbols-outlined text-[18px] text-outline shrink-0">chevron_right</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div className="rounded-[24px] border border-dashed border-outline-variant p-8 text-center text-[13px] text-outline">
          {isZh ? '没有找到联系人。' : 'No contacts found.'}
        </div>
      )}
    </div>
  );
}

function Avatar({ c }: { c: Contact }) {
  if (c.avatar_url) {
    return <img src={c.avatar_url} alt="" className="w-11 h-11 rounded-2xl object-cover shrink-0" />;
  }
  return (
    <div className="w-11 h-11 rounded-2xl bg-surface-dim flex items-center justify-center shrink-0">
      <span className="font-serif font-black text-[16px] text-on-surface">{(c.name || '?').trim().charAt(0)}</span>
    </div>
  );
}

function roleLabel(role: string, isZh: boolean) {
  const g = ROLE_GROUPS.find(x => x.match.includes(role));
  return g ? (isZh ? g.zh : g.en) : role;
}
