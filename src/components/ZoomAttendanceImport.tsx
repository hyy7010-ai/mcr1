import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import {
  getParticipants, matchParticipants, ZoomError, ZOOM_ERRORS,
  type MatchedParticipant,
} from '../services/zoomService';

interface MeetingOption {
  id: string;
  title: string;
  meetingId: string;
  time?: string;
}

/**
 * 从 Zoom 参会名单导入线上出席。
 *
 * 刻意做成「拉取 → 人工核对 → 确认」三步，而不是一键写库：Zoom 上的名字是
 * 各人自己填的昵称，免费账号还拿不到邮箱，全自动匹配一定会安静地记错人。
 * 默认只勾上匹配成功的，没匹配上的原样列出来让点名的人自己判断。
 */
export default function ZoomAttendanceImport({
  churchId, serviceDate, members, onImport, onClose, planType,
}: {
  churchId: string;
  serviceDate: string;
  members: { id: string; name: string; email?: string | null }[];
  onImport: (memberIds: string[], unmatched: { name: string; duration: number }[]) => void;
  onClose: () => void;
  planType: string | null;
}) {
  const { t } = useLanguage();

  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [rows, setRows] = useState<MatchedParticipant[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 找出这一天挂了 Zoom 会议的活动
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('church_events')
          .select('id,title,event_time,zoom_meeting_id')
          .eq('church_id', churchId)
          .eq('event_date', serviceDate)
          .not('zoom_meeting_id', 'is', null);

        const opts: MeetingOption[] = (data || []).map((e: any) => ({
          id: e.id, title: e.title, meetingId: e.zoom_meeting_id, time: e.event_time,
        }));
        setMeetings(opts);
        // 只有一场就别让人再点一次
        if (opts.length === 1) void fetchFor(opts[0].meetingId);
        else setLoading(false);
      } catch (e: any) {
        setError(e?.message || 'Failed');
        setLoading(false);
      }
    })();
  }, [churchId, serviceDate]);

  async function fetchFor(mid: string) {
    setMeetingId(mid);
    setLoading(true);
    setError(null);
    try {
      const { participants } = await getParticipants(mid);
      const matched = matchParticipants(participants, members);
      setRows(matched);
      // 默认只勾匹配上的。没匹配上的留给人工判断，不替他做决定。
      setPicked(new Set(matched.filter(r => r.memberId).map(r => r.memberId!)));
    } catch (e: any) {
      if (e instanceof ZoomError && e.code === ZOOM_ERRORS.NOT_CONNECTED) {
        setError(t('zoomNotConnectedHint'));
      } else {
        setError(e?.message || 'Failed');
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle(memberId: string) {
    setPicked(prev => {
      const next = new Set(prev);
      next.has(memberId) ? next.delete(memberId) : next.add(memberId);
      return next;
    });
  }

  function confirm() {
    const unmatched = (rows || [])
      .filter(r => !r.memberId)
      .map(r => ({ name: r.name, duration: r.duration }));
    onImport([...picked], unmatched);
  }

  const matchedCount = rows?.filter(r => r.memberId).length ?? 0;
  const unmatchedCount = (rows?.length ?? 0) - matchedCount;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full sm:max-w-2xl bg-surface-container rounded-t-[32px] sm:rounded-[32px] shadow-xl max-h-[92vh] flex flex-col"
      >
        <div className="p-6 md:p-8 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-headline-md text-on-surface">{t('zoomImportAttendance')}</h3>
              <p className="text-sm text-on-surface-variant mt-1">{serviceDate}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-outline hover:bg-surface-container-low transition-all"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 pb-2 no-scrollbar">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-[10px] font-black uppercase tracking-widest text-outline animate-pulse">
                {t('zoomLoadingParticipants')}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-error/10 text-error text-sm leading-relaxed">
              <span className="material-symbols-outlined text-[20px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* 这一天没有线上会议 */}
          {!loading && !error && meetings.length === 0 && (
            <p className="text-center text-sm text-on-surface-variant py-16">
              {t('zoomNoMeetingsThatDay')}
            </p>
          )}

          {/* 多场会议 → 先选一场 */}
          {!loading && !error && !rows && meetings.length > 1 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-3">
                {t('zoomSelectMeeting')}
              </p>
              {meetings.map(m => (
                <button
                  key={m.id}
                  onClick={() => fetchFor(m.meetingId)}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-surface-container-low border-2 border-transparent hover:border-primary/30 transition-all text-left"
                >
                  <span className="material-symbols-outlined text-primary">videocam</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{m.title}</p>
                    <p className="text-[11px] text-outline">{m.time || ''} · {m.meetingId}</p>
                  </div>
                  <span className="material-symbols-outlined text-outline">chevron_right</span>
                </button>
              ))}
            </div>
          )}

          {/* 核对名单 */}
          {!loading && !error && rows && (
            <div className="space-y-4">
              {rows.length === 0 ? (
                <p className="text-center text-sm text-on-surface-variant py-12 leading-relaxed">
                  {t('zoomNoParticipants')}
                </p>
              ) : (
                <>
                  <div className="p-4 rounded-2xl bg-surface-container-low">
                    <p className="text-sm font-bold text-on-surface mb-1">{t('zoomMatchReview')}</p>
                    <p className="text-[12px] text-on-surface-variant leading-relaxed">
                      {t('zoomMatchReviewDesc')}
                    </p>
                    {/* 免费账号没有邮箱字段，匹配质量必然下降，先说清楚 */}
                    {planType === 'basic' && (
                      <p className="text-[12px] text-amber-800 mt-2 leading-relaxed">
                        {t('zoomBasicNoEmail')}
                      </p>
                    )}
                    <p className="text-[10px] font-black uppercase tracking-widest text-outline mt-3">
                      {matchedCount} {t('zoomMatchedLabel')} · {unmatchedCount} {t('zoomUnmatched')}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    {rows.map((r, i) => {
                      const on = !!r.memberId && picked.has(r.memberId);
                      return (
                        <button
                          key={`${r.name}-${i}`}
                          type="button"
                          disabled={!r.memberId}
                          onClick={() => r.memberId && toggle(r.memberId)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                            !r.memberId
                              ? 'border-transparent bg-surface-container-low opacity-60 cursor-default'
                              : on
                                ? 'border-emerald-400/40 bg-emerald-50 text-emerald-800'
                                : 'border-transparent bg-surface-container-low hover:border-outline-variant/30'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-[20px] ${
                            !r.memberId ? 'text-outline/30' : on ? 'text-emerald-500' : 'text-outline/30'
                          }`}>
                            {!r.memberId ? 'help' : on ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate">
                              {r.memberName || r.name}
                            </p>
                            <p className="text-[10px] text-outline truncate">
                              {r.memberName && r.memberName !== r.name && `Zoom: ${r.name} · `}
                              {r.matchedBy === 'email' ? t('zoomMatchedByEmail')
                                : r.matchedBy === 'name' ? t('zoomMatchedByName')
                                : t('zoomUnmatched')}
                            </p>
                          </div>
                          <span className="text-[10px] font-black text-outline whitespace-nowrap">
                            {r.duration} {t('zoomOnlineMinutes')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 pt-4 shrink-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-full bg-white border border-outline-variant/30 text-[12px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all whitespace-nowrap"
          >
            {t('cancel') || 'Cancel'}
          </button>
          <button
            onClick={confirm}
            disabled={!rows || picked.size === 0}
            className="flex-1 py-3 rounded-full bg-black text-white text-[12px] font-black uppercase tracking-widest hover:bg-primary transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {t('zoomImportConfirm')} {picked.size > 0 && `(${picked.size})`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
