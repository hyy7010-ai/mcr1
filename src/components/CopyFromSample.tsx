import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { isSampleChurch, copyFromSample, CopyKind, CopyResult } from '../lib/demoChurch';

/**
 * 「复制到我的教会」—— 只在参观示例教会时出现。
 *
 * 示例教会是只读的，所以这是用户把看中的结构带走的唯一出口。
 * 刻意做成显式按钮 + 二次确认：这一下是真的写进他自己教会的数据，
 * 绝不能让人以为自己还在沙盒里随便点。
 */
export default function CopyFromSample({ kind, label }: { kind: CopyKind; label?: string }) {
  const { isZh } = useLanguage();
  const { church, profile } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopyResult | null>(null);

  // 只在样板间里、且用户确实有自己的教会时才有意义
  const target = profile?.church_id;
  if (!isSampleChurch(church) || !target) return null;

  const run = async () => {
    setBusy(true); setConfirming(false);
    try { setResult(await copyFromSample(kind, target)); }
    finally { setBusy(false); }
  };

  if (result) {
    return (
      <p className={`text-[12px] font-bold whitespace-nowrap ${result.error ? 'text-error' : 'text-on-surface'}`}>
        {result.error
          ? (isZh ? `复制失败：${result.error}` : `Failed: ${result.error}`)
          : result.copied
            ? (isZh ? `✓ 已复制 ${result.copied} 项到你的教会` : `✓ Copied ${result.copied} to your church`)
            : result.total === 0
              ? (isZh ? '示例教会里还没有这类内容' : 'Nothing of this kind in the sample church yet')
              : (isZh ? '你的教会里已经有了，没有重复添加' : 'Already in your church — nothing added')}
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-on-surface">
          {isZh ? '会写进你自己的教会，确定？' : 'This writes into your own church. Sure?'}
        </span>
        <button onClick={run}
          className="px-4 py-2 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest whitespace-nowrap active:scale-95 transition-all">
          {isZh ? '确定复制' : 'Copy'}
        </button>
        <button onClick={() => setConfirming(false)}
          className="px-4 py-2 rounded-full border border-outline-variant/40 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
          {isZh ? '取消' : 'Cancel'}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={busy}
      className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-outline-variant/50 text-[11px] font-black uppercase tracking-widest whitespace-nowrap hover:border-primary hover:text-primary transition-all disabled:opacity-40"
    >
      <span className="material-symbols-outlined text-[16px]">content_copy</span>
      {label ?? (isZh ? '复制到我的教会' : 'Copy to my church')}
    </button>
  );
}
