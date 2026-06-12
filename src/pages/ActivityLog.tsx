import React, { useState, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { translateAction } from '../lib/valueLabels';
import { getActiveChurchId } from '../lib/permissions';
import { fetchActivities, ActivityEntry } from '../services/activityService';

function relativeTime(isoString: string, isZh: boolean): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isZh ? '刚刚' : 'Just now';
  if (mins < 60) return isZh ? `${mins} 分钟前` : `${mins} min${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isZh ? `${hours} 小时前` : `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return isZh ? '昨天' : 'Yesterday';
  return isZh ? `${days} 天前` : `${days} days ago`;
}

export default function ActivityLog() {
  const { mode } = useMode();
  const { isZh, language } = useLanguage();
  const FILTER_LABELS: Record<string, Record<string, string>> = {
    All: { 'zh-CN': '全部', 'zh-TW': '全部', ja: 'すべて', ko: '전체', th: 'ทั้งหมด' },
    Member: { 'zh-CN': '会友', 'zh-TW': '會友', ja: 'メンバー', ko: '멤버', th: 'สมาชิก' },
    Roster: { 'zh-CN': '排班', 'zh-TW': '排班', ja: 'ロスター', ko: '로스터', th: 'ตารางเวร' },
    Resource: { 'zh-CN': '资源', 'zh-TW': '資源', ja: 'リソース', ko: '자료', th: 'ทรัพยากร' },
    System: { 'zh-CN': '系统', 'zh-TW': '系統', ja: 'システム', ko: '시스템', th: 'ระบบ' },
  };
  const filterLabel = (f: string) => FILTER_LABELS[f]?.[language] || f;
  const { profile, church } = useAuth();
  const churchId = getActiveChurchId(profile, church);

  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filterKey = `activity_log_filter_${churchId || 'demo'}`;
  const [filter, setFilter] = useState(() => {
    try { return localStorage.getItem(filterKey) || 'All'; } catch { return 'All'; }
  });
  const handleSetFilter = (val: string) => {
    setFilter(val);
    try { localStorage.setItem(filterKey, val); } catch {}
  };

  useEffect(() => {
    if (mode === 'Member' || !churchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchActivities(churchId)
      .then(data => setActivities(data))
      .catch(e => setError(e?.message || 'Failed to load activity log'))
      .finally(() => setLoading(false));
  }, [churchId, mode]);

  const filteredActivities = filter === 'All'
    ? activities
    : activities.filter(a => a.type === filter);

  // Activity Log is Manager-only
  if (mode !== 'Manager') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <p className="text-on-surface-variant font-medium">
          {isZh ? '操作记录仅管理员可查看。' : 'Activity Log is available to Managers only.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-surface-container-lowest animate-in fade-in duration-500">
      <div className="mx-auto w-full max-w-5xl p-6 md:p-10 space-y-8">

        {/* Header */}
        <div className="flex items-end justify-between border-b border-outline-variant/30 pb-6">
          <div>
            <h1 className="mb-2 font-display-lg text-4xl text-on-surface">
              {isZh ? '操作记录' : 'Activity Log'}
            </h1>
            <p className="font-body-lg text-outline">
              {isZh ? '追踪管理员和工作人员的所有系统操作' : 'Track all system changes made by Managers and Staff'}
            </p>
          </div>

          <div className="flex bg-surface-container rounded-2xl p-1 shadow-sm border border-outline-variant/20">
            {['All', 'Member', 'Roster', 'Resource', 'System'].map((filterOption) => (
              <button
                key={filterOption}
                onClick={() => handleSetFilter(filterOption)}
                className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                  filter === filterOption
                    ? 'bg-primary text-white shadow-md scale-105'
                    : 'text-outline hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {filterLabel(filterOption)}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="py-20 flex flex-col items-center justify-center text-outline">
            <span className="material-symbols-outlined text-5xl mb-4 opacity-50 animate-pulse">history</span>
            <p className="font-bold">{isZh ? '加载中…' : 'Loading…'}</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="py-20 flex flex-col items-center justify-center text-red-400">
            <span className="material-symbols-outlined text-5xl mb-4 opacity-50">error</span>
            <p className="font-bold">{error}</p>
            <p className="text-sm mt-2 text-outline">
              {isZh ? '请确保已在 Supabase 中建立 activity_logs 表。' : 'Make sure the activity_logs table exists in Supabase.'}
            </p>
          </div>
        )}

        {/* Timeline */}
        {!loading && !error && (
          <div className="grid grid-cols-1 gap-4">
            {filteredActivities.map((activity) => (
              <div key={activity.id} className="flex gap-6 p-6 rounded-[32px] border border-outline-variant/10 bg-white shadow-sm hover:border-primary/20 transition-all hover:shadow-md group">

                <div className={`mt-1 h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center text-white font-black shadow-lg shadow-black/5 ${
                  activity.type === 'Resource' ? 'bg-[#ffb4ab] text-[black]' :
                  activity.type === 'Roster' ? 'bg-[#9acbfa] text-[black]' :
                  activity.type === 'Member' ? 'bg-[#c3ecd4] text-[black]' :
                  'bg-black text-white'
                }`}>
                  <span className="material-symbols-outlined text-2xl">
                    {activity.type === 'Resource' ? 'library_music' :
                     activity.type === 'Roster' ? 'calendar_month' :
                     activity.type === 'Member' ? 'group' : 'settings'}
                  </span>
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-lg font-bold text-on-surface truncate">{activity.user_name}</p>
                    <span className="px-2 py-0.5 rounded border border-outline-variant text-[9px] font-black uppercase tracking-widest text-outline">{activity.user_role}</span>
                    <div className="h-1 w-1 bg-outline-variant rounded-full"></div>
                    <p className="text-xs font-medium text-outline whitespace-nowrap">{relativeTime(activity.created_at, isZh)}</p>
                  </div>
                  <p className="text-sm text-on-surface-variant font-medium">
                    {translateAction(activity.action, language)} <span className="text-primary font-bold px-1.5 py-0.5 bg-primary/5 rounded-md ml-1">{activity.target}</span>
                  </p>
                  {activity.note && (
                    <div className="mt-3 bg-surface-container-low border border-outline-variant/20 p-3 rounded-xl">
                      <p className="font-serif italic text-sm text-on-surface-variant text-opacity-80">"{activity.note}"</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filteredActivities.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-outline">
            <span className="material-symbols-outlined text-5xl mb-4 opacity-50">history</span>
            <p className="font-bold">{isZh ? '暂无活动记录。' : 'No activity found for this filter.'}</p>
          </div>
        )}

      </div>
    </div>
  );
}
