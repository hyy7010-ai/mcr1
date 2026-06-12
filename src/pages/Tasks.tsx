import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { tr } from '../lib/uiText';

type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed';
  category: string;
};

// A single example task — managers add their own.
const DEFAULT_TASKS: Task[] = [
  { id: '1', title: '示例任务 (Example)', description: '这是一个示例，可编辑或删除。', dueDate: '', priority: 'medium', status: 'pending', category: 'Ministry' },
];
const OLD_TASKS_SIG = 'Prepare Prayer List|Call Elder David|Practice Guitar|Update Roster';

const EMPTY_FORM = { title: '', description: '', dueDate: '', priority: 'medium' as Task['priority'], category: 'Ministry' };

export default function Tasks() {
  const { t, language } = useLanguage();
  const { profile, church } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'completed'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(churchKey('tasks'));
      if (saved) {
        const parsed: Task[] = JSON.parse(saved);
        // Replace the old 4-task sample (if never edited) with the single example.
        setTasks(parsed.map(t => t.title).join('|') === OLD_TASKS_SIG ? DEFAULT_TASKS : parsed);
      } else {
        setTasks(DEFAULT_TASKS);
      }
    } catch {
      setTasks(DEFAULT_TASKS);
    }
  }, [activeChurchId]);

  useEffect(() => {
    localStorage.setItem(churchKey('tasks'), JSON.stringify(tasks));
  }, [tasks, activeChurchId]);

  const filteredTasks = tasks.filter(task => {
    if (activeTab === 'all') return true;
    return task.status === activeTab;
  });

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' } : t));
  };

  const handleAddTask = () => {
    if (!form.title.trim()) return;
    const newTask: Task = {
      id: Date.now().toString(),
      title: form.title.trim(),
      description: form.description.trim(),
      dueDate: form.dueDate || new Date().toISOString().split('T')[0],
      priority: form.priority,
      status: 'pending',
      category: form.category.trim() || 'General',
    };
    setTasks(prev => [...prev, newTask]);
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="flex w-full flex-col bg-surface p-8">
      <header className="mb-12">
        <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-primary mb-2">{tr('Workspace', language)}</h2>
        <h1 className="text-4xl font-serif font-black text-on-surface">{t('myTasks')}</h1>
      </header>

      <div className="flex flex-col gap-8 min-h-0">
        <div className="flex items-center gap-6 border-b border-outline-variant/20 pb-4">
          {[
            { id: 'all', label: t('allTasks') },
            { id: 'pending', label: tr('In Progress', language) },
            { id: 'completed', label: tr('Done', language) }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`text-xs font-black uppercase tracking-widest transition-all relative py-2 ${
                activeTab === tab.id ? 'text-primary' : 'text-outline hover:text-on-surface'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-12 content-start">
          <AnimatePresence>
            {filteredTasks.map(task => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                key={task.id}
                className={`group p-8 rounded-[40px] border-2 transition-all flex flex-col justify-between min-h-[280px] ${
                  task.status === 'completed'
                    ? 'bg-surface-container-low border-outline-variant/30 opacity-60'
                    : 'bg-white border-outline-variant/10 hover:border-primary shadow-sm hover:shadow-xl hover:shadow-primary/5'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between mb-6">
                    <span className="px-4 py-1.5 rounded-full bg-surface-container text-[9px] font-black uppercase tracking-widest text-outline">
                      {task.category}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        task.priority === 'high' ? 'bg-error' : task.priority === 'medium' ? 'bg-warning' : 'bg-primary'
                      }`} />
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity text-outline hover:text-error"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                  <h3 className={`text-xl font-bold mb-3 ${task.status === 'completed' ? 'line-through text-outline' : 'text-on-surface'}`}>
                    {task.title}
                  </h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed opacity-70">
                    {task.description}
                  </p>
                </div>

                <div className="mt-8 flex items-end justify-between">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-tighter text-outline opacity-40 mb-1">{tr('Due Date', language)}</span>
                    <span className="text-sm font-bold text-on-surface">{task.dueDate}</span>
                  </div>
                  <button
                    onClick={() => toggleTask(task.id)}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                      task.status === 'completed' ? 'bg-primary text-white' : 'bg-surface-container hover:bg-primary hover:text-white text-outline'
                    }`}
                  >
                    <span className="material-symbols-outlined text-2xl">
                      {task.status === 'completed' ? 'check_circle' : 'circle'}
                    </span>
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* New Task Card */}
          {showForm ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 rounded-[40px] border-2 border-primary bg-white shadow-xl flex flex-col gap-3 min-h-[280px]"
            >
              <input
                autoFocus
                placeholder={tr('Task title *', language)}
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full text-sm font-bold border-b border-outline-variant/30 pb-2 outline-none bg-transparent text-on-surface placeholder:text-outline/40"
              />
              <textarea
                placeholder={tr('Description', language)}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full text-xs border-b border-outline-variant/30 pb-2 outline-none bg-transparent text-on-surface-variant placeholder:text-outline/40 resize-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-outline block mb-1">{tr('Due Date', language)}</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="w-full text-xs outline-none bg-surface-container rounded-lg px-2 py-1 text-on-surface"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-outline block mb-1">{tr('Priority', language)}</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value as Task['priority'] }))}
                    className="w-full text-xs outline-none bg-surface-container rounded-lg px-2 py-1 text-on-surface"
                  >
                    <option value="low">{tr('Low', language)}</option>
                    <option value="medium">{tr('Medium', language)}</option>
                    <option value="high">{tr('High', language)}</option>
                  </select>
                </div>
              </div>
              <input
                placeholder={tr('Category (e.g. Ministry)', language)}
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full text-xs border-b border-outline-variant/30 pb-2 outline-none bg-transparent text-on-surface placeholder:text-outline/40"
              />
              <div className="flex gap-2 mt-auto pt-2">
                <button
                  onClick={handleAddTask}
                  disabled={!form.title.trim()}
                  className="flex-1 py-2 rounded-2xl bg-primary text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {tr('Add', language)}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                  className="flex-1 py-2 rounded-2xl bg-surface-container text-outline text-xs font-black uppercase tracking-widest"
                >
                  {tr('Cancel', language)}
                </button>
              </div>
            </motion.div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="p-8 rounded-[40px] border-2 border-dashed border-outline-variant/30 hover:border-primary flex flex-col items-center justify-center gap-4 text-outline hover:text-primary transition-all group min-h-[280px]"
            >
              <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all">
                <span className="material-symbols-outlined text-3xl">add_task</span>
              </div>
              <span className="text-xs font-black uppercase tracking-widest">{tr('New Task', language)}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
