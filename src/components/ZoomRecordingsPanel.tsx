import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import {
  listRecordings, ZoomError, ZOOM_ERRORS, type ZoomRecording,
} from '../services/zoomService';

/**
 * Zoom 云录制归档面板。
 *
 * 归档 = 在 church_publications 里插一行指向 Zoom 播放页，**不搬运文件**。
 * 一场主日的录像动辄好几个 G，往 Supabase Storage 搬既撑爆免费额度，也让
 * 归档从「点一下」变成「等十分钟」。Zoom 那边本来就存着，链接过去就好。
 */
export default function ZoomRecordingsPanel({
  churchId, createdBy, onArchived, onClose,
}: {
  churchId: string;
  createdBy: string;
  onArchived: (pub: any) => void;
  onClose: () => void;
}) {
  const { t, isZh } = useLanguage();

  const [recordings, setRecordings] = useState<ZoomRecording[]>([]);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // 默认拉最近 90 天。Zoom 的 recordings 端点单次查询最长跨度就是一个月，
      // 所以按月分三段拉再合并，而不是丢一个超范围的区间过去被它拒掉。
      const now = new Date();
      const chunks: { from: string; to: string }[] = [];
      for (let i = 0; i < 3; i++) {
        const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
        chunks.push({ from: iso(from), to: iso(to > now ? now : to) });
      }

      const results = await Promise.all(
        chunks.map(c => listRecordings(c).catch(() => ({ meetings: [] as ZoomRecording[] }))),
      );
      const all = results.flatMap(r => r.meetings);
      // 同一场会议可能横跨两个查询区间，按 uuid 去重
      const seen = new Set<string>();
      setRecordings(
        all.filter(m => (seen.has(m.uuid) ? false : (seen.add(m.uuid), true)))
           .sort((a, b) => b.startTime.localeCompare(a.startTime)),
      );

      // 已经归档过的标出来，免得管理员重复点（库里有唯一索引兜底，但界面
      // 应该先一步说清楚）
      const { data } = await supabase
        .from('church_publications')
        .select('external_id')
        .eq('church_id', churchId)
        .eq('source', 'zoom');
      setArchived(new Set((data || []).map((r: any) => r.external_id)));
    } catch (e: any) {
      if (e instanceof ZoomError && e.code === ZOOM_ERRORS.NO_CLOUD_RECORDING) {
        setError(t('zoomNoCloudRecording'));
      } else if (e instanceof ZoomError && e.code === ZOOM_ERRORS.NOT_CONNECTED) {
        setError(t('zoomNotConnectedHint'));
      } else {
        setError(e?.message || 'Failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function archive(rec: ZoomRecording) {
    const video = rec.files.find(f => f.fileType === 'MP4') || rec.files[0];
    if (!video) return;

    setBusy(rec.uuid);
    try {
      const passNote = rec.playPasscode
        ? `\n${t('zoomPasscode')}: ${rec.playPasscode}`
        : '';
      const { data, error: dbErr } = await supabase
        .from('church_publications')
        .insert({
          church_id: churchId,
          title: rec.topic,
          description: `${new Date(rec.startTime).toLocaleString()} · ${rec.duration} min${passNote}`,
          category: 'Sermon',
          // 用 share_url 而不是单文件的 play_url：分享页在 Zoom 侧统一处理
          // 密码和权限，直链遇到受保护的录制会直接 403。
          file_url: rec.shareUrl || video.playUrl,
          file_name: `${rec.topic}.mp4`,
          file_size: video.fileSize,
          created_by: createdBy,
          source: 'zoom',
          external_id: rec.uuid,
        })
        .select()
        .single();

      if (dbErr) throw dbErr;
      setArchived(prev => new Set([...prev, rec.uuid]));
      onArchived(data);
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full sm:max-w-2xl bg-surface-container rounded-t-[32px] sm:rounded-[32px] shadow-xl max-h-[92vh] flex flex-col"
      >
        <div className="p-6 md:p-8 pb-4 shrink-0 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-headline-md text-on-surface">{t('zoomRecordings')}</h3>
            <p className="text-sm text-on-surface-variant mt-1">{t('zoomRecordingsDesc')}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-full text-outline hover:bg-surface-container-low transition-all disabled:opacity-40"
              aria-label={t('zoomRefreshRecordings')}
            >
              <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`}>refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-outline hover:bg-surface-container-low transition-all"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 pb-6 no-scrollbar">
          {loading && (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-amber-500/10 text-amber-800 text-sm leading-relaxed">
              <span className="material-symbols-outlined text-[20px] shrink-0">info</span>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && recordings.length === 0 && (
            <p className="text-center text-sm text-on-surface-variant py-16">{t('zoomNoRecordings')}</p>
          )}

          {!loading && !error && recordings.length > 0 && (
            <div className="space-y-2">
              {recordings.map(rec => {
                const done = archived.has(rec.uuid);
                return (
                  <div
                    key={rec.uuid}
                    className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-primary">smart_display</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{rec.topic}</p>
                      <p className="text-[11px] text-outline">
                        {new Date(rec.startTime).toLocaleString()} · {rec.duration} min
                        {' · '}{formatSize(rec.totalSize, isZh)}
                        {rec.playPasscode && ` · 🔒`}
                      </p>
                    </div>
                    <button
                      onClick={() => archive(rec)}
                      disabled={done || busy === rec.uuid}
                      className={`shrink-0 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                        done
                          ? 'bg-emerald-500/10 text-emerald-700 cursor-default'
                          : 'bg-black text-white hover:bg-primary active:scale-95 disabled:opacity-50'
                      }`}
                    >
                      {done ? t('zoomRecordingExists')
                        : busy === rec.uuid ? '…'
                        : t('zoomArchiveRecording')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatSize(bytes: number, isZh: boolean) {
  if (!bytes) return isZh ? '未知大小' : 'unknown size';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
