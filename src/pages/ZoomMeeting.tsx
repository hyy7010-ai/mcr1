import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getSdkSignature, ZoomError, ZOOM_ERRORS } from '../services/zoomService';

/**
 * 页内 Zoom 会议（Meeting SDK Component View）。
 *
 * 为什么从 Zoom 的 CDN 动态加载而不是 npm 安装：
 *   @zoom/meetingsdk 到 6.2.0 为止 peerDependencies 仍然钉死 react@18.2.0，
 *   本项目是 React 19，`npm ci`（部署流水线用的正是它）会直接 ERESOLVE 失败。
 *   要装就得全局加 legacy-peer-deps，等于为一个功能改动整条部署管线。
 *   CDN 版是自带依赖的独立构建，运行时才拉取：主包体积不变，CI 不受影响，
 *   而且反正没网也开不了 Zoom 会。
 *
 * 签名由 Edge Function 用 Meeting SDK 密钥服务端签发。主持人权限（role=1）
 * 由服务端按调用者角色判定，前端请求什么都不作数。
 */

const SDK_VERSION = '6.2.0';
const SDK_SRC = `https://source.zoom.us/zoom-meeting-embedded-${SDK_VERSION}.min.js`;

/** GraceFlow 的语言码 → Zoom SDK 的语言码。泰语 SDK 不支持，退回英文。 */
const SDK_LANG: Record<string, string> = {
  'en': 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
  'ja': 'jp-JP', 'ko': 'ko-KO', 'th': 'en-US',
};

function loadSdk(): Promise<any> {
  const w = window as any;
  if (w.ZoomMtgEmbedded) return Promise.resolve(w.ZoomMtgEmbedded);

  return new Promise((resolve, reject) => {
    // 用户可能进出会议好几次，脚本只注入一次
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => w.ZoomMtgEmbedded
      ? resolve(w.ZoomMtgEmbedded)
      : reject(new Error('Zoom SDK loaded but ZoomMtgEmbedded is missing'));

    script.addEventListener('load', onLoad);
    script.addEventListener('error', () => reject(new Error('Could not load the Zoom Meeting SDK')));

    if (!existing) {
      script.src = SDK_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export default function ZoomMeeting() {
  const { meetingNumber = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { mode } = useMode();
  const { t, language } = useLanguage();

  const rootRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<any>(null);
  const [phase, setPhase] = useState<'joining' | 'joined' | 'error'>('joining');
  const [error, setError] = useState<string | null>(null);

  const passcode = params.get('pwd') || '';
  const topic = params.get('topic') || '';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [ZoomMtgEmbedded, sig] = await Promise.all([
          loadSdk(),
          // 只有管理员会拿到主持人角色 —— 服务端会重新裁决
          getSdkSignature(meetingNumber, mode === 'Manager' ? 1 : 0),
        ]);
        if (cancelled || !rootRef.current) return;

        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;

        client.init({
          zoomAppRoot: rootRef.current,
          language: SDK_LANG[language] ?? 'en-US',
          // Chrome 的媒体栈时不时会变，patchJsMedia 让 SDK 自己兜住这些差异
          patchJsMedia: true,
          customize: {
            video: { isResizable: true, viewSizes: { default: { width: 1000, height: 600 } } },
          },
        });

        await client.join({
          signature: sig.signature,
          sdkKey: sig.sdkKey,
          meetingNumber,
          password: passcode,
          userName: profile?.full_name || 'GraceFlow',
        });

        if (!cancelled) setPhase('joined');
      } catch (e: any) {
        if (cancelled) return;
        setPhase('error');
        if (e instanceof ZoomError && e.code === ZOOM_ERRORS.SDK_NOT_CONFIGURED) {
          setError(t('zoomSdkNotConfigured'));
        } else if (e instanceof ZoomError && e.code === ZOOM_ERRORS.NOT_CONNECTED) {
          setError(t('zoomNotConnectedHint'));
        } else {
          setError(e?.message || 'Failed to join');
        }
      }
    })();

    return () => {
      cancelled = true;
      // 离开路由必须显式收掉会议，否则麦克风和摄像头会一直亮着
      try { clientRef.current?.leaveMeeting(); } catch {}
    };
  }, [meetingNumber, language]);

  return (
    <div className="flex w-full flex-col bg-surface min-h-full">
      <div className="p-6 md:p-8 flex items-center justify-between gap-4 border-b border-outline-variant/10">
        <div className="min-w-0">
          <h2 className="font-headline-md text-on-surface truncate">
            {topic || t('zoomJoinInApp')}
          </h2>
          <p className="font-label-sm text-sm text-on-surface-variant uppercase tracking-widest opacity-70">
            {t('zoomMeetingId')} {meetingNumber}
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="shrink-0 px-6 py-3 rounded-full bg-white border border-outline-variant/30 text-[12px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap"
        >
          {t('zoomLeaveMeeting')}
        </button>
      </div>

      <div className="flex-1 p-6 md:p-8">
        {phase === 'joining' && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest text-outline animate-pulse">
              {t('zoomJoining')}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="max-w-lg mx-auto text-center p-8 rounded-[32px] bg-surface-container-low">
            <span className="material-symbols-outlined text-5xl text-error mb-3">videocam_off</span>
            <p className="text-sm text-on-surface leading-relaxed">{error}</p>
          </div>
        )}

        {/* SDK 把会议界面挂进这个容器。它必须始终留在 DOM 里 —— 加入过程中
            就被条件渲染掉的话，init 拿到的 zoomAppRoot 会失效。 */}
        <div ref={rootRef} className={phase === 'joined' ? 'flex justify-center' : 'hidden'} />
      </div>
    </div>
  );
}
