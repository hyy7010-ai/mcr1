import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useMode } from '../contexts/ModeContext';
import { getActiveChurchId } from '../lib/permissions';
import { rosterService } from '../services/rosterService';

// ── Auto-mode "all-in-one" assistant ─────────────────────────────────────────
// When the user flips to Auto mode this IS the whole screen: just a chat box
// they can hand any task to. To keep costs at zero while pre-funding, intent
// routing is 100% local/rule-based — no paid API calls. It answers from real
// church data where it can (e.g. names off the roster), does free work (stash a
// ChatGPT-made background), and otherwise points to the right page. The hook for
// a smarter LLM brain is left for when there's a budget.

interface Msg {
  role: 'user' | 'bot';
  text: string;
  action?: { label: string; path: string };
}

interface Intent {
  keys: string[];
  reply: { zh: string; en: string };
  action?: { label: { zh: string; en: string }; path: string };
  special?: 'upload' | 'roster';
}

// Service roles, with the keywords people actually type and the label to show.
const ROLE_LABELS: { keys: string[]; en: string; zh: string }[] = [
  { keys: ['主领唱', '主唱', '主领', '领唱', 'lead singer'], en: 'Lead Singer', zh: '主领唱' },
  { keys: ['敬拜', 'worship'], en: 'Worship', zh: '敬拜' },
  { keys: ['讲道', '证道', '讲员', '讲台', 'preach'], en: 'Preaching', zh: '讲道' },
  { keys: ['招待', 'usher'], en: 'Usher', zh: '招待' },
  { keys: ['乐手', '乐队', '司琴', 'musician', 'band'], en: 'Musician', zh: '乐手' },
];

const INTENTS: Intent[] = [
  {
    keys: ['ppt', '幻灯', '投影', '做歌', '歌的', '歌词背景', '背景图', '排版', '敬拜ppt', 'slide'],
    reply: {
      zh: '好的,我来帮你做 PPT。把你在 ChatGPT 生成的背景图发给我(下面可上传),我会存进背景库;然后到「敬拜诗歌」里选歌、一键导出就行。',
      en: "Sure — let's build the PPT. Send me the background image you made in ChatGPT (upload below); I'll add it to the library, then pick songs in Songs and export in one click.",
    },
    action: { label: { zh: '去做 PPT', en: 'Open Songs' }, path: '/app/songs' },
    special: 'upload',
  },
  {
    keys: ['主唱', '主领', '领唱', '排班', '今天谁', '谁服侍', '谁讲道', '讲道', '证道', '敬拜', '招待', '乐手', '值班', 'roster', 'who leads', 'who is', 'who serves'],
    reply: { zh: '', en: '' }, // filled in live from roster data
    action: { label: { zh: '查看 / 编辑排班', en: 'Open Roster' }, path: '/app/roster' },
    special: 'roster',
  },
  {
    keys: ['周报', '报告', '月报', '总结', '汇报', 'report', 'weekly', 'summary'],
    reply: {
      zh: '周报我来汇总:本周排班、出席、奉献、代祷都会整理好。先去「数据看板」拿这周的数字,我帮你成稿。',
      en: "I'll compile the weekly report — schedule, attendance, giving and prayer. Start from the Dashboard for this week's numbers and I'll draft it.",
    },
    action: { label: { zh: '打开看板', en: 'Open Dashboard' }, path: '/app/dashboard' },
  },
  {
    keys: ['奉献', '收入', '财务', '金额', 'giving', 'finance', 'offering'],
    reply: { zh: '奉献和财务在「奉献」页,可以登记、统计本周收入。', en: 'Giving & finance live in the Giving page — record and total this week there.' },
    action: { label: { zh: '打开奉献', en: 'Open Giving' }, path: '/app/giving' },
  },
  {
    keys: ['代祷', '祷告', '祈祷', 'prayer'],
    reply: { zh: '代祷事项在「代祷墙」,可以发布和跟进。', en: 'Prayer requests live on the Prayer Wall — post and follow up there.' },
    action: { label: { zh: '打开代祷墙', en: 'Open Prayer Wall' }, path: '/app/prayer' },
  },
  {
    keys: ['名单', '会友', '成员', '联系', 'member', 'people', 'contact'],
    reply: { zh: '会友名单在「会友」页,可以查找、编辑和看关系网。', en: 'The member directory is in Members — search, edit and view relationships.' },
    action: { label: { zh: '打开会友', en: 'Open Members' }, path: '/app/members' },
  },
  {
    keys: ['任务', '待办', 'task', 'todo'],
    reply: { zh: '任务和待办在「任务」页。', en: 'Tasks & to-dos live in the Tasks page.' },
    action: { label: { zh: '打开任务', en: 'Open Tasks' }, path: '/app/tasks' },
  },
];

const AutoAssistant: React.FC = () => {
  const { isZh } = useLanguage();
  const { profile, church } = useAuth();
  const { setAssistMode } = useMode();
  const navigate = useNavigate();
  const activeChurchId = getActiveChurchId(profile, church);

  const [input, setInput] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [roster, setRoster] = useState<any[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([{
    role: 'bot',
    text: isZh
      ? '我是你的全能助手。把任何事交给我:做 PPT、排班、周报、查名单… 直接说就行。\n\n例如:「帮我做这 3 首歌的 PPT」「今天主唱是谁」「周报帮我做好」。'
      : "I'm your all-in-one assistant. Hand me anything — make a PPT, schedule, weekly report, look up members. Just ask.\n\nTry: \"Make a PPT for these 3 songs\", \"Who leads worship today?\", \"Draft the weekly report\".",
  }]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the roster once so we can answer "who leads today" with a real name.
  useEffect(() => {
    const cid = activeChurchId || church?.id;
    if (!cid) return;
    rosterService.getAllRoster(cid).then(r => { if (Array.isArray(r)) setRoster(r); }).catch(() => {});
  }, [activeChurchId, church?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, showUpload]);

  const matchIntent = (text: string): Intent | null => {
    const q = text.toLowerCase();
    return INTENTS.find(it => it.keys.some(k => q.includes(k.toLowerCase()))) || null;
  };

  // Answer roster questions with the actual person's name from the data.
  const answerRoster = (text: string): string => {
    if (!roster.length) {
      return isZh ? '排班表里还没有数据。先去「服侍排班」排一下班,我就能告诉你谁服侍了。'
                  : "No roster data yet — set it up in Roster and I'll tell you who's serving.";
    }
    const q = text.toLowerCase();
    const todayISO = new Date().toISOString().split('T')[0];
    const dates = Array.from(new Set(roster.map(r => r.date))).sort();
    const upcoming = dates.filter(d => d >= todayISO);
    const targetDate = upcoming[0] || dates[dates.length - 1];
    const onDate = roster.filter(r => r.date === targetDate);
    const nameOf = (r: any) => r.profiles?.full_name || (isZh ? '(未指定)' : '(unassigned)');
    const whenZh = targetDate === todayISO ? '今天' : (upcoming.length ? '本周' : '最近一次');
    const whenEn = targetDate === todayISO ? 'today' : (upcoming.length ? 'this week' : 'the latest service');

    const role = ROLE_LABELS.find(rl => rl.keys.some(k => q.includes(k.toLowerCase())));
    if (role) {
      const names = onDate.filter(r => (r.role || '').toLowerCase() === role.en.toLowerCase()).map(nameOf);
      if (!names.length) {
        return isZh ? `${whenZh}(${targetDate})还没有排${role.zh}。` : `No ${role.en} assigned for ${whenEn} (${targetDate}).`;
      }
      return isZh ? `${whenZh}(${targetDate})的${role.zh}是 ${names.join('、')}。`
                  : `${role.en} for ${whenEn} (${targetDate}): ${names.join(', ')}.`;
    }
    // No specific role asked → list everyone serving on that date.
    if (!onDate.length) return isZh ? `${targetDate} 还没有排班。` : `No roster for ${targetDate}.`;
    const lines = onDate.map(r => {
      const rl = ROLE_LABELS.find(x => x.en.toLowerCase() === (r.role || '').toLowerCase());
      return `· ${rl ? (isZh ? rl.zh : rl.en) : r.role}:${nameOf(r)}`;
    });
    return (isZh ? `${whenZh}(${targetDate})的服侍安排:\n` : `Roster for ${whenEn} (${targetDate}):\n`) + lines.join('\n');
  };

  const send = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text) return;
    setInput('');
    const intent = matchIntent(text);
    let botText: string;
    if (intent?.special === 'roster') {
      botText = answerRoster(text);
    } else if (intent) {
      botText = isZh ? intent.reply.zh : intent.reply.en;
    } else {
      botText = isZh
        ? '我可以帮你:做 PPT、排班/查主唱、周报、奉献、代祷、会友名单、任务。试着说说看要做哪一样?'
        : 'I can help with: PPT, scheduling/lead singer, weekly report, giving, prayer, members, tasks. Which one?';
    }
    const botMsg: Msg = {
      role: 'bot',
      text: botText,
      action: intent?.action ? { label: isZh ? intent.action.label.zh : intent.action.label.en, path: intent.action.path } : undefined,
    };
    setMsgs(prev => [...prev, { role: 'user', text }, botMsg]);
    if (intent?.special === 'upload') setShowUpload(true);
  };

  // Save a ChatGPT-made background straight into the PPT background library
  // (same localStorage key Songs reads), then offer to jump there.
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      try {
        const key = `custom_bgs_${activeChurchId || 'demo'}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        const item = { id: `upload-${Date.now()}`, label: isZh ? '我上传的背景' : 'My upload', url };
        localStorage.setItem(key, JSON.stringify([...(Array.isArray(existing) ? existing : []), item]));
      } catch {}
      setShowUpload(false);
      setMsgs(prev => [...prev, {
        role: 'bot',
        text: isZh ? '✅ 背景图已存进背景库,去「敬拜诗歌」选歌,在主题里就能选到它,再一键导出。' : '✅ Saved to your background library. Open Songs, pick it under Theme, and export.',
        action: { label: isZh ? '去做 PPT' : 'Open Songs', path: '/app/songs' },
      }]);
    };
    reader.readAsDataURL(file);
  };

  // Going to a page means leaving Auto mode so the user actually lands there.
  const go = (path: string) => { setAssistMode('manual'); navigate(path); };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[170] bg-surface flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 w-full max-w-3xl mx-auto flex items-center justify-between px-6 py-5 border-b border-outline-variant/15">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined filled text-2xl">auto_awesome</span>
          </div>
          <div>
            <h2 className="text-lg font-serif font-black text-on-surface leading-tight">{isZh ? '全能助手' : 'All-in-one Assistant'}</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-outline/60">{isZh ? '自动式 · 帮你把事做完' : 'Auto · gets it done'}</p>
          </div>
        </div>
        <button
          onClick={() => setAssistMode('manual')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-container border border-outline-variant/40 text-[10px] font-black uppercase tracking-widest text-outline hover:text-on-surface hover:border-outline transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">tune</span>
          {isZh ? '手动模式' : 'Manual'}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar w-full max-w-3xl mx-auto px-6 py-5 space-y-4">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-2'}>
            {m.role === 'user' ? (
              <div className="bg-surface-container-high px-5 py-2.5 rounded-2xl rounded-tr-none max-w-[85%] text-sm font-medium text-on-surface">{m.text}</div>
            ) : (
              <>
                <div className="bg-white px-5 py-3.5 rounded-2xl rounded-tl-none border border-primary/10 shadow-sm max-w-[90%] text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{m.text}</div>
                {m.action && (
                  <button
                    onClick={() => go(m.action!.path)}
                    className="self-start flex items-center gap-2 px-5 py-2.5 bg-on-surface text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all shadow-lg active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    {m.action.label}
                  </button>
                )}
              </>
            )}
          </div>
        ))}

        {/* Image dropzone for ChatGPT-made backgrounds */}
        {showUpload && (
          <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-5 text-center">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <span className="material-symbols-outlined text-3xl text-primary/70">add_photo_alternate</span>
            <p className="text-xs font-bold text-on-surface mt-1">{isZh ? '上传 ChatGPT 生成的背景图' : 'Upload your ChatGPT background'}</p>
            <button onClick={() => fileRef.current?.click()} className="mt-3 px-5 py-2 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 active:scale-95">
              {isZh ? '选择图片' : 'Choose image'}
            </button>
          </div>
        )}
      </div>

      {/* Quick prompts + input */}
      <div className="shrink-0 w-full max-w-3xl mx-auto px-6 pb-6 pt-2 border-t border-outline-variant/15">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
          {(isZh
            ? ['帮我做这 3 首歌的 PPT', '今天主唱是谁', '周报帮我做好']
            : ['Make a PPT for these songs', 'Who leads today?', 'Draft the weekly report']
          ).map(q => (
            <button key={q} onClick={() => send(q)} className="whitespace-nowrap px-4 py-1.5 rounded-full bg-white border border-outline-variant/20 text-[10px] font-black tracking-wide text-outline hover:border-primary hover:text-primary transition-all shadow-sm">
              {q}
            </button>
          ))}
        </div>
        <form onSubmit={e => { e.preventDefault(); send(); }} className="relative">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            enterKeyHint="send"
            placeholder={isZh ? '把事情交给我…' : 'Hand me a task…'}
            className="w-full bg-white border-2 border-outline-variant/20 rounded-2xl py-4 px-5 pr-14 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none shadow-sm"
          />
          <button type="submit" disabled={!input.trim()} className="absolute right-2 top-2 bottom-2 px-4 rounded-xl bg-black text-white hover:bg-primary transition-all disabled:opacity-20 flex items-center">
            <span className="material-symbols-outlined">arrow_upward</span>
          </button>
        </form>
        <p className="text-[8px] text-outline/40 text-center mt-2 uppercase tracking-widest">{isZh ? '本地免费处理 · 更强 AI 智能后续开启' : 'Free local routing · smarter AI coming soon'}</p>
      </div>
    </motion.div>
  );
};

export default AutoAssistant;
