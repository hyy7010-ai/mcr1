import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  getZoomStatus, connectZoom, disconnectZoom, type ZoomStatus,
} from '../services/zoomService';

/**
 * 「管理工具 → 集成」里的 Zoom 连接卡片。
 *
 * 每个教会在自己的 Zoom 后台建一个 Server-to-Server OAuth 内部应用，把三串
 * 凭证填在这里。凭证提交给 Edge Function，由它先向 Zoom 换一次 token 验证
 * 有效再落库 —— 填错要当场知道，而不是等到主日早上开会议时才发现。
 *
 * 这个组件从头到尾读不到 client_secret：状态走 zoom_integration_status()
 * RPC，只回连接状态和脱敏后的 client_id。
 */
export default function ZoomIntegrationCard() {
  const { t } = useLanguage();

  const [status, setStatus] = useState<ZoomStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState({
    accountId: '', clientId: '', clientSecret: '',
    sdkClientId: '', sdkClientSecret: '',
  });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setStatus(await getZoomStatus());
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleConnect() {
    setError(null);
    setSaving(true);
    try {
      const res = await connectZoom({
        accountId: form.accountId.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
        sdkClientId: form.sdkClientId.trim() || undefined,
        sdkClientSecret: form.sdkClientSecret.trim() || undefined,
      });
      // 提交后立刻清空密钥字段：这一页可能在投影仪或共享屏幕上开着
      setForm({ accountId: '', clientId: '', clientSecret: '', sdkClientId: '', sdkClientSecret: '' });
      setShowForm(false);
      flash(t('zoomConnectSuccess'));
      await refresh();
      if (res.planType === 'basic') flash(t('zoomBasicWarning'));
    } catch (e: any) {
      setError(e?.message || t('zoomConnectFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('zoomDisconnectConfirm'))) return;
    setSaving(true);
    try {
      await disconnectZoom();
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }

  const connected = !!status?.connected;
  const canSubmit = form.accountId.trim() && form.clientId.trim() && form.clientSecret.trim();

  return (
    <div className="bg-white border border-outline-variant/30 p-8 rounded-[32px] shadow-sm max-w-3xl">
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[28px] mt-0.5">videocam</span>
          <div>
            <h3 className="text-lg font-bold flex items-center gap-3 flex-wrap">
              {t('zoomIntegration')}
              <span
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                  connected
                    ? 'bg-emerald-500/10 text-emerald-700'
                    : 'bg-surface-dim text-outline'
                }`}
              >
                {connected ? t('zoomConnected') : t('zoomNotConnected')}
              </span>
            </h3>
            <p className="text-sm text-on-surface-variant mt-1 max-w-md">
              {t('zoomIntegrationDesc')}
            </p>
          </div>
        </div>

        {connected && !showForm && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 rounded-full bg-white border border-outline-variant/30 text-sm font-bold hover:bg-surface-container-low transition-all whitespace-nowrap"
            >
              {t('zoomReconnect')}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={saving}
              className="px-5 py-2.5 rounded-full bg-white border border-error/30 text-error text-sm font-bold hover:bg-error/5 transition-all whitespace-nowrap disabled:opacity-50"
            >
              {t('zoomDisconnect')}
            </button>
          </div>
        )}
      </div>

      {/* 已连接：账号概况 */}
      {connected && !showForm && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={t('zoomClientId')} value={status?.clientIdMasked || '—'} />
            <Field label="Zoom" value={status?.zoomUserEmail || '—'} />
            <Field
              label={t('zoomLastVerified')}
              value={status?.lastVerifiedAt
                ? new Date(status.lastVerifiedAt).toLocaleString()
                : '—'}
            />
          </div>

          {status?.planType === 'basic' && (
            <Notice tone="warn" icon="info">{t('zoomBasicWarning')}</Notice>
          )}

          {/* Meeting SDK 没配就说清楚少了什么功能，而不是让页内开会静默不可用 */}
          {!status?.sdkConfigured && (
            <Notice tone="muted" icon="dock_to_right">{t('zoomSdkNotConfigured')}</Notice>
          )}

          {status?.status === 'error' && status.lastError && (
            <Notice tone="error" icon="error">{status.lastError}</Notice>
          )}
        </div>
      )}

      {/* 未连接：入口按钮 */}
      {!connected && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-full bg-black text-white text-[12px] font-black uppercase tracking-widest hover:bg-primary transition-all active:scale-95 whitespace-nowrap"
        >
          {t('zoomConnect')}
        </button>
      )}

      {/* 凭证表单 */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-4">
              <button
                onClick={() => setShowGuide((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showGuide ? 'expand_less' : 'help'}
                </span>
                {t('zoomSetupGuide')}
              </button>

              {showGuide && (
                <ol className="space-y-2 bg-surface-container-low rounded-2xl p-5 text-sm text-on-surface list-decimal list-inside">
                  {['zoomStep1', 'zoomStep2', 'zoomStep3', 'zoomStep4', 'zoomStep5'].map((k) => (
                    <li key={k} className="leading-relaxed">{t(k)}</li>
                  ))}
                </ol>
              )}

              <Input
                label={t('zoomAccountId')} value={form.accountId}
                onChange={(v) => setForm((f) => ({ ...f, accountId: v }))}
              />
              <Input
                label={t('zoomClientId')} value={form.clientId}
                onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
              />
              <Input
                label={t('zoomClientSecret')} value={form.clientSecret} secret
                onChange={(v) => setForm((f) => ({ ...f, clientSecret: v }))}
              />

              <div className="pt-2 border-t border-outline-variant/20">
                <p className="text-[10px] font-black uppercase tracking-widest text-outline mt-4 mb-1">
                  {t('zoomSdkCredentials')}
                </p>
                <p className="text-sm text-on-surface-variant mb-4">{t('zoomSdkDesc')}</p>
                <div className="space-y-4">
                  <Input
                    label={t('zoomSdkClientId')} value={form.sdkClientId}
                    onChange={(v) => setForm((f) => ({ ...f, sdkClientId: v }))}
                  />
                  <Input
                    label={t('zoomSdkClientSecret')} value={form.sdkClientSecret} secret
                    onChange={(v) => setForm((f) => ({ ...f, sdkClientSecret: v }))}
                  />
                </div>
              </div>

              {error && <Notice tone="error" icon="error">{error}</Notice>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleConnect}
                  disabled={!canSubmit || saving}
                  className="px-6 py-3 rounded-full bg-black text-white text-[12px] font-black uppercase tracking-widest hover:bg-primary transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {saving ? t('zoomTesting') : t('zoomConnect')}
                </button>
                <button
                  onClick={() => { setShowForm(false); setError(null); }}
                  className="px-6 py-3 rounded-full bg-white border border-outline-variant/30 text-[12px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap"
                >
                  {t('cancel') || 'Cancel'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 text-sm font-bold text-emerald-700"
          >
            {toast}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-2xl bg-surface-container-low">
      <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-1">{label}</p>
      <p className="text-sm font-bold text-on-surface break-all">{value}</p>
    </div>
  );
}

function Input({
  label, value, onChange, secret,
}: {
  label: string; value: string; onChange: (v: string) => void; secret?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-outline">{label}</span>
      <div className="relative mt-1.5">
        <input
          type={secret && !reveal ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // 密钥字段关掉一切自动填充/拼写检查 —— 别让浏览器把 Zoom 密钥
          // 当成密码存进密码管理器，或者送去拼写检查服务
          autoComplete={secret ? 'new-password' : 'off'}
          spellCheck={false}
          className="w-full px-4 py-3 pr-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
            aria-label={reveal ? 'Hide' : 'Show'}
          >
            <span className="material-symbols-outlined text-[20px]">
              {reveal ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        )}
      </div>
    </label>
  );
}

function Notice({
  tone, icon, children,
}: {
  tone: 'warn' | 'error' | 'muted'; icon: string; children: React.ReactNode;
}) {
  const tones = {
    warn: 'bg-amber-500/10 text-amber-800',
    error: 'bg-error/10 text-error',
    muted: 'bg-surface-container-low text-on-surface-variant',
  };
  return (
    <div className={`flex items-start gap-2.5 p-4 rounded-2xl text-sm leading-relaxed ${tones[tone]}`}>
      <span className="material-symbols-outlined text-[20px] shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
