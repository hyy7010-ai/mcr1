import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { DEMO_CHURCH_ID, resetDemoChurch, SeedResult } from '../lib/demoChurch';

/* ──────────────────────────────────────────────────────────────────────────
   平台管理控制台 · 示例教会（demo tenant）
   一个全平台共用、装满示例数据的教会，给新用户当「样板间」看。
   ────────────────────────────────────────────────────────────────────────── */

/** 数据库连不上时别让面板永远卡在「检查中」。 */
function withTimeout<T>(p: PromiseLike<T>, ms = 5000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const COUNTED = [
  { table: 'church_members', zh: '会友',   en: 'Members' },
  { table: 'rosters',        zh: '排班',   en: 'Roster' },
  { table: 'church_prayers', zh: '代祷',   en: 'Prayers' },
  { table: 'church_groups',  zh: '小组',   en: 'Groups' },
  { table: 'church_events',  zh: '日程',   en: 'Events' },
  { table: 'church_tasks',   zh: '任务',   en: 'Tasks' },
  { table: 'church_life',    zh: '灵修内容', en: 'Life' },
  { table: 'church_finance', zh: '财务点收', en: 'Finance' },
  { table: 'attendance_records', zh: '出勤', en: 'Attendance' },
  { table: 'church_publications', zh: '刊物', en: 'Publications' },
  { table: 'songs',          zh: '诗歌',   en: 'Songs' },
  { table: 'group_posts',    zh: '小组帖子', en: 'Posts' },
  { table: 'activity_logs',  zh: '活动日志', en: 'Activity' },
];

export default function DemoChurchPanel() {
  const { isZh } = useLanguage();
  const { visitSampleChurch } = useAuth();
  const navigate = useNavigate();

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResult[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    const { data } = await withTimeout(
      supabase.from('churches').select('id').eq('id', DEMO_CHURCH_ID).maybeSingle(),
    ).catch(() => ({ data: null }));
    setExists(!!data);

    const next: Record<string, number | null> = {};
    await Promise.all(COUNTED.map(async c => {
      const { count, error } = await withTimeout(
        supabase.from(c.table).select('*', { count: 'exact', head: true }).eq('church_id', DEMO_CHURCH_ID),
      ).catch(() => ({ count: null, error: true as any }));
      next[c.table] = error ? null : (count ?? 0);
    }));
    setCounts(next);
  };

  useEffect(() => { load(); }, []);

  const handleReset = async () => {
    setBusy(true); setResult(null); setConfirming(false);
    try {
      setResult(await resetDemoChurch());
      await load();
    } finally { setBusy(false); }
  };

  const visit = () => {
    visitSampleChurch();
    navigate('/app/dashboard');
  };

  const failures = result?.filter(r => r.error) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface-container-low rounded-[32px] border border-outline-variant/10 p-8 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-serif text-2xl font-black text-on-surface leading-tight">
              {isZh ? '示例教会' : 'Sample Church'}
            </h3>
            <p className="mt-1 text-[13px] text-on-surface/70 max-w-xl leading-relaxed">
              {isZh
                ? '全平台共用一个装满示例内容的教会，对所有人只读 —— 共用又人人可写的话，第一个删掉示例排班的人就毁了后面所有访客的样板间。用户看中哪块结构，用「复制到我的教会」带回自己教会。只有你（平台管理员）能改这里的内容。'
                : 'One shared, read-only church pre-filled with sample content. Visitors copy what they want into their own church; only platform admins can edit it here.'}
            </p>
          </div>
          <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
            exists === null ? 'bg-surface-container text-outline'
              : exists ? 'bg-black text-white'
              : 'bg-error-container text-on-error-container'
          }`}>
            {exists === null ? (isZh ? '检查中' : 'Checking')
              : exists ? (isZh ? '已就绪' : 'Ready')
              : (isZh ? '未创建' : 'Not created')}
          </span>
        </div>

        {exists === false && (
          <div className="rounded-2xl bg-error-container/60 border border-error/20 p-5 text-[13px] leading-relaxed text-on-error-container">
            {isZh
              ? '数据库里还没有这条教会记录。请先把仓库根目录的 supabase_setup_all.sql 整份粘进 Supabase 的 SQL Editor 跑一次 —— 它会建好表、建好这条记录，并开放示例教会的只读权限（只针对这一个教会，不影响其它教会的隔离）。'
              : 'The church row does not exist yet. Run supabase_setup_all.sql in Supabase first.'}
          </div>
        )}

        {/* 内容清点 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {COUNTED.map(c => (
            <div key={c.table} className="rounded-2xl bg-surface-container border border-outline-variant/10 px-4 py-4 text-center">
              <p className="font-serif font-black text-[24px] leading-none text-on-surface">
                {counts[c.table] === null ? '—' : counts[c.table] ?? '·'}
              </p>
              <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-outline whitespace-nowrap">
                {isZh ? c.zh : c.en}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={visit}
            disabled={!exists}
            className="px-6 py-3 rounded-2xl bg-black text-white text-[10px] font-black uppercase tracking-widest whitespace-nowrap disabled:opacity-40 active:scale-95 transition-all"
          >
            {isZh ? '进去看看' : 'Walk through it'}
          </button>

          {confirming ? (
            <>
              <span className="text-[13px] text-on-surface">
                {isZh ? '会清空示例教会现有内容并写回初始示例，确定？（不影响任何真实教会）' : 'This wipes the sample church and re-seeds it. Sure?'}
              </span>
              <button onClick={handleReset}
                className="px-5 py-3 rounded-2xl bg-error text-white text-[10px] font-black uppercase tracking-widest whitespace-nowrap active:scale-95 transition-all">
                {isZh ? '确定重置' : 'Yes, reset'}
              </button>
              <button onClick={() => setConfirming(false)}
                className="px-5 py-3 rounded-2xl border border-outline-variant/30 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                {isZh ? '取消' : 'Cancel'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy || !exists}
              className="px-6 py-3 rounded-2xl border border-outline-variant/30 text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:bg-black hover:text-white disabled:opacity-40 transition-all flex items-center gap-2"
            >
              {busy && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
              {busy ? (isZh ? '重置中…' : 'Resetting…') : (isZh ? '重置示例教会' : 'Reset sample church')}
            </button>
          )}

          <button onClick={load}
            className="h-11 w-11 rounded-2xl border border-outline-variant/30 flex items-center justify-center hover:bg-black hover:text-white transition-all"
            title={isZh ? '刷新计数' : 'Refresh counts'}>
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
        </div>

        {result && (
          <div className="rounded-2xl bg-surface-container border border-outline-variant/10 p-5 flex flex-col gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-outline">
              {isZh ? '重置结果' : 'Reset result'}
            </p>
            {result.map(r => (
              <p key={r.table} className={`text-[12px] font-mono ${r.error ? 'text-error' : 'text-on-surface/70'}`}>
                {r.error ? '✗' : '✓'} {r.table} — {r.error ? r.error : `${r.rows} rows`}
              </p>
            ))}
            {failures.length > 0 && (
              <p className="text-[12px] text-on-surface/70 mt-1 leading-relaxed">
                {isZh
                  ? '失败的表通常是还没建、或者 RLS 没放行 —— 把 supabase_setup_all.sql 再跑一遍就好（可重复执行）。其余表已经写入成功。'
                  : 'Failed tables are usually missing or blocked by RLS — run supabase_setup_all.sql.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
