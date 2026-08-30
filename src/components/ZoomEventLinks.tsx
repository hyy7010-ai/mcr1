import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { getStartUrl } from '../services/zoomService';

/**
 * 日历活动卡片上的 Zoom 一行：加入 / 页内加入 / 主持人开始 / 复制链接。
 *
 * 会众用 joinUrl（存在库里，人人可见）；主持人链接则每次现取 —— 它带一次性
 * token 且约两小时过期，存库既会失效，又等于把主持权限交给任何能读活动的人。
 */
export default function ZoomEventLinks({
  meetingId, joinUrl, passcode, topic, canHost, sdkReady,
}: {
  meetingId: string;
  joinUrl?: string;
  passcode?: string;
  topic?: string;
  canHost: boolean;
  /** Meeting SDK 凭证配了才显示「在此加入」 */
  sdkReady: boolean;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  async function handleHost() {
    // 必须先同步开一个空窗口再异步填 URL。等 await 回来才 window.open，
    // 浏览器会把它当成非用户手势触发的弹窗直接拦掉。
    const win = window.open('', '_blank');
    setStarting(true);
    try {
      const { startUrl } = await getStartUrl(meetingId);
      if (win) win.location.href = startUrl;
      else window.location.href = startUrl; // 弹窗被拦就在当前标签页开
    } catch {
      win?.close();
    } finally {
      setStarting(false);
    }
  }

  function handleCopy() {
    const text = passcode
      ? `${joinUrl}\n${t('zoomPasscode')}: ${passcode}`
      : joinUrl || '';
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const inAppHref = `/app/meeting/${meetingId}?pwd=${encodeURIComponent(passcode || '')}` +
    `&topic=${encodeURIComponent(topic || '')}`;

  return (
    <div className="mt-3 pt-3 border-t border-outline-variant/20">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined text-[14px] text-primary">videocam</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-outline">
          {t('zoomMeetingId')} {formatMeetingId(meetingId)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {joinUrl && (
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all whitespace-nowrap"
          >
            {t('zoomJoin')}
          </a>
        )}

        {sdkReady && (
          <button
            onClick={() => navigate(inAppHref)}
            className="px-3 py-1.5 rounded-full bg-white border border-outline-variant/30 text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap"
          >
            {t('zoomJoinInApp')}
          </button>
        )}

        {canHost && (
          <button
            onClick={handleHost}
            disabled={starting}
            className="px-3 py-1.5 rounded-full bg-white border border-outline-variant/30 text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap disabled:opacity-50"
          >
            {t('zoomHostStart')}
          </button>
        )}

        {joinUrl && (
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-full bg-white border border-outline-variant/30 text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap"
          >
            {copied ? t('zoomLinkCopied') : t('zoomCopyLink')}
          </button>
        )}
      </div>

      {passcode && (
        <p className="text-[10px] text-outline mt-2">
          {t('zoomPasscode')}: <span className="font-mono font-bold text-on-surface">{passcode}</span>
        </p>
      )}
    </div>
  );
}

/**
 * 按 Zoom 自己的写法分组会议号：11 位 3-4-4，10 位 3-3-4。
 * 每三位切一刀会得到「876 543 210 98」这种谁也认不出来的东西。
 */
function formatMeetingId(id: string): string {
  const d = id.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}
