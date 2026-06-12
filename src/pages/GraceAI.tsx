import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { askGraceAIV2 } from '../services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { memberService } from '../services/memberService';
import { rosterService } from '../services/rosterService';

interface ChatMessage {
  q: string;
  a: string;
  action?: {
    label: string;
    path: string;
  };
}

interface Conversation {
  id: string;
  title: string;
  history: ChatMessage[]; // newest-first
  updatedAt: number;
}

const GraceAI: React.FC = () => {
  const { t, language, isZh } = useLanguage();
  const { church, profile } = useAuth();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);

  // ── Persisted conversations (survive page switches & reloads) ────────────────
  const storageKey = `grace_chats_${church?.id || 'demo'}_${profile?.id || 'anon'}`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [showChatList, setShowChatList] = useState(false);

  const newConversation = (): Conversation => ({ id: `${Date.now()}`, title: '', history: [], updatedAt: Date.now() });

  // Load saved conversations on mount / when church/user changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: Conversation[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          setConversations(parsed);
          setActiveId(parsed[0].id);
          return;
        }
      }
    } catch {}
    const fresh = newConversation();
    setConversations([fresh]);
    setActiveId(fresh.id);
  }, [storageKey]);

  // Persist whenever conversations change
  useEffect(() => {
    if (conversations.length) {
      try { localStorage.setItem(storageKey, JSON.stringify(conversations)); } catch {}
    }
  }, [conversations, storageKey]);

  const activeConversation = conversations.find(c => c.id === activeId) || conversations[0];
  const history = activeConversation?.history || [];

  // Auto-scroll to the newest message (bottom) when the conversation changes.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, loading, activeId]);

  const startNewChat = () => {
    const fresh = newConversation();
    setConversations(prev => [fresh, ...prev]);
    setActiveId(fresh.id);
    setShowChatList(false);
    setNetworkError(null);
  };

  const deleteChat = (id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const fresh = newConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!church?.id) return;

      const [m, l, r, mgrs] = await Promise.all([
        memberService.getMembers(church.id),
        memberService.getMemberLinks(church.id),
        rosterService.getAllRoster(church.id),
        supabase.from('profiles').select('full_name, role').eq('church_id', church.id).eq('role', 'Manager')
      ]);

      if (m) setMembers(m);
      if (l) setLinks(l);
      if (r) setRoster(r);
      if (mgrs.data) setManagers(mgrs.data);
    };
    fetchData();
  }, [church?.id]);

  const [networkError, setNetworkError] = useState<string | null>(null);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setNetworkError(null);

    const managerNames = managers.map(m => m.full_name).join(', ') || 'No managers data yet';

    // Create condensed context
    const membersData = members.map(m => ({
      name: m.name,
      status: m.status,
      friends: links.filter(l => l.source_id === m.id || l.target_id === m.id)
                    .map(l => {
                      const otherId = l.source_id === m.id ? l.target_id : l.source_id;
                      return members.find(mem => mem.id === otherId)?.name || 'Unknown';
                    })
    }));

    const rosterData = roster.map(r => ({
      date: r.date,
      person: r.profiles?.full_name || 'Assigned Member',
      role: r.role
    }));

    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

    const dynamicContext = `System: GraceFlow.
    Today's date: ${todayISO} (${weekday}).
    Current Church: ${church?.name || 'Unknown'}.
    Current User: ${profile?.full_name || 'Guest'} (${profile?.role || 'Unknown role'}).
    Managers: ${managerNames}.
    Features: Roster, Members, Tasks, Giving, Prayer Wall.

    IMPORTANT: Answer factually using ONLY the CHURCH DATA below. When asked who serves in a
    role for a given week/date (e.g. "who leads worship this week"), look up the matching entry in
    the Service Schedule by date (closest upcoming Sunday to today's date) and the role, then state
    the exact person's name. Roster roles are in English (Worship=敬拜, Lead Singer=主领唱,
    Preaching=讲道, Usher=招待, Musician=乐手). If the data has no match, say so plainly.

    CHURCH DATA:
    Members & Relationships: ${JSON.stringify(membersData)}
    Service Schedule (Roster) [{date, person, role}]: ${JSON.stringify(rosterData)}`;

    const askedQuestion = question;
    const convId = activeId;
    setLoading(true);
    setQuestion('');
    try {
      const result = await askGraceAIV2(
        askedQuestion,
        dynamicContext,
        language,
        history
      );

      setConversations(prev => prev.map(c => c.id === convId ? {
        ...c,
        title: c.title || askedQuestion.slice(0, 24),
        history: [{ q: askedQuestion, a: result.message, action: result.action }, ...c.history],
        updatedAt: Date.now(),
      } : c));
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setQuestion(askedQuestion);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-8 pt-10 pb-6 border-b border-outline-variant/10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-3xl bg-primary flex items-center justify-center text-white shadow-xl shadow-primary/20">
              <span className="material-symbols-outlined filled text-3xl">smart_toy</span>
            </div>
            <div>
              <h1 className="text-3xl font-serif font-black text-on-surface tracking-tight">{t('graceAssistant') || 'Grace Assistant'}</h1>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-outline opacity-60">{isZh ? 'AI 教会智能助手' : 'AI Church Intelligence'}</p>
            </div>
          </div>

          {/* Conversation controls */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChatList(v => !v)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-outline-variant/20 text-xs font-bold text-on-surface hover:border-primary transition-all shadow-sm max-w-[180px]"
              >
                <span className="material-symbols-outlined text-[18px]">history</span>
                <span className="truncate">{activeConversation?.title || (isZh ? '新对话' : 'New chat')}</span>
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
              <AnimatePresence>
                {showChatList && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowChatList(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute right-0 top-full mt-2 w-72 max-h-80 overflow-y-auto no-scrollbar bg-white rounded-3xl shadow-2xl border border-outline-variant/20 p-2 z-50"
                    >
                      <p className="text-[9px] font-black uppercase tracking-widest text-outline px-3 py-2">{isZh ? '历史对话' : 'Chat history'}</p>
                      {conversations.map(c => (
                        <div
                          key={c.id}
                          onClick={() => { setActiveId(c.id); setShowChatList(false); }}
                          className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl cursor-pointer transition-all ${c.id === activeId ? 'bg-primary/10' : 'hover:bg-surface-container'}`}
                        >
                          <span className="text-xs font-bold text-on-surface truncate">{c.title || (isZh ? '新对话' : 'New chat')}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                            className="opacity-0 group-hover:opacity-100 text-outline hover:text-error transition-all shrink-0"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-on-surface text-white text-xs font-bold hover:bg-primary transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {isZh ? '新建' : 'New'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-8 gap-8">
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-4 space-y-6 no-scrollbar">
            {history.length === 0 && !loading && (
               <motion.div
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20"
               >
                  <span className="material-symbols-outlined text-[80px] mb-4">auto_awesome</span>
                  <h2 className="text-xl font-serif font-bold mb-2">{t('howCanIHelp') || 'How can I help you today?'}</h2>
                  <p className="max-w-xs text-sm">{t('askAbout') || 'Ask about church personnel, service schedules, or theological insights.'}</p>
               </motion.div>
            )}

            {/* Oldest → newest (newest stays at the bottom) */}
            {[...history].reverse().map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="flex justify-end">
                  <div className="bg-surface-container-high px-6 py-3 rounded-2xl rounded-tr-none max-w-[80%] border border-outline-variant/10">
                    <p className="text-sm font-medium text-on-surface">{item.q}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined filled text-xl">smart_toy</span>
                  </div>
                  <div className="flex flex-col gap-3 max-w-[85%]">
                    <div className="bg-white px-6 py-4 rounded-3xl rounded-tl-none border border-primary/10 shadow-sm">
                      <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{item.a}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.action && (
                        <button
                          onClick={() => navigate(item.action!.path)}
                          className="flex items-center gap-2 px-6 py-3 bg-on-surface text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl active:scale-95 group"
                        >
                          <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">
                            {item.action.path.includes('roster') ? 'calendar_month' :
                             item.action.path.includes('members') ? 'groups' :
                             item.action.path.includes('tasks') ? 'assignment' : 'arrow_forward'}
                          </span>
                          {item.action.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Thinking indicator — at the bottom, under the latest question */}
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined filled text-xl">smart_toy</span>
                </div>
                <div className="bg-white px-6 py-4 rounded-3xl rounded-tl-none border border-primary/10 shadow-sm flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                  <span className="text-sm text-outline font-medium">{isZh ? 'Grace 正在思考…' : 'Grace is thinking…'}</span>
                </div>
              </motion.div>
            )}
          {networkError && (
            <div className="flex gap-4 items-start p-4 rounded-2xl bg-error/10 border border-error/20">
              <span className="material-symbols-outlined text-error">error</span>
              <p className="text-sm text-error">{networkError}</p>
            </div>
          )}
        </div>

        <form onSubmit={handleAsk} className="relative">
          <div className="absolute -top-12 left-0 right-0 flex gap-2 overflow-x-auto no-scrollbar">
            {['checkRoster', 'memberStats', 'prayerList'].map(qKey => (
              <button
                key={qKey}
                type="button"
                onClick={() => setQuestion(t(qKey))}
                className="whitespace-nowrap px-4 py-1.5 rounded-full bg-white border border-outline-variant/20 text-[10px] font-black uppercase tracking-widest text-outline hover:border-primary hover:text-primary transition-all shadow-sm"
              >
                {t(qKey)}
              </button>
            ))}
          </div>
          <input
            type="text"
            enterKeyHint="send"
            className="w-full bg-white border-2 border-outline-variant/20 rounded-[32px] py-6 px-8 pr-20 text-md font-medium focus:border-primary focus:ring-8 focus:ring-primary/5 transition-all outline-none shadow-xl"
            placeholder={t('askGrace') || "Ask Grace Assistant..."}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="absolute right-4 top-4 bottom-4 px-8 rounded-2xl bg-black text-white hover:bg-primary transition-all disabled:opacity-20 shadow-lg shadow-black/10 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-2xl">arrow_upward</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default GraceAI;
