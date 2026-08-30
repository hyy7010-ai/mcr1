import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { getActiveChurchId, isDemoChurch } from '../lib/permissions';
import { isSampleChurch } from '../lib/demoChurch';
import { logActivity } from '../services/activityService';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import ZoomEventLinks from '../components/ZoomEventLinks';
import {
  getZoomStatus, createMeeting, deleteMeeting, getStartUrl, toZoomStartTime,
  type ZoomStatus,
} from '../services/zoomService';

interface ChurchEvent {
  id: string;
  church_id: string;
  title: string;
  event_date: string;
  event_time?: string;
  category: string;
  color: string;
  description?: string;
  created_at: string;
  // Zoom 会议。start_url（主持人链接）刻意不存 —— 它带一次性 token、约两
  // 小时过期，存库既会失效又等于把主持权限摊给所有能读活动的人。
  zoom_meeting_id?: string;
  zoom_join_url?: string;
  zoom_passcode?: string;
}

const CATEGORIES = ['Service', 'Fellowship', 'Prayer', 'Youth', 'Other'];
const CATEGORY_COLORS: Record<string, string> = {
  Service: '#6366f1',
  Fellowship: '#10b981',
  Prayer: '#f59e0b',
  Youth: '#ec4899',
  Other: '#64748b',
};

// Australian public holidays (fixed + computed)
function getAustralianHolidays(year: number): Record<string, string> {
  const h: Record<string, string> = {};
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = (m: number, day: number) => `${year}-${pad(m)}-${pad(day)}`;
  // Fixed holidays
  h[d(1,1)] = "New Year's Day";
  h[d(1,26)] = 'Australia Day';
  h[d(4,25)] = 'Anzac Day';
  h[d(12,25)] = 'Christmas Day';
  h[d(12,26)] = 'Boxing Day';
  // Easter (Anonymous Gregorian)
  const a = year % 19, b = Math.floor(year/100), c = year % 100;
  const dd = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), hh = (19*a+b-dd-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4;
  const l = (32+2*e+2*i-hh-k) % 7;
  const m = Math.floor((a+11*hh+22*l)/451);
  const month = Math.floor((hh+l-7*m+114)/31);
  const day = ((hh+l-7*m+114) % 31) + 1;
  const easterSun = new Date(year, month-1, day);
  const fmt = (dt: Date) => `${year}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
  h[fmt(new Date(easterSun.getTime() - 2*86400000))] = 'Good Friday';
  h[fmt(new Date(easterSun.getTime() - 86400000))] = 'Easter Saturday';
  h[fmt(easterSun)] = 'Easter Sunday';
  h[fmt(new Date(easterSun.getTime() + 86400000))] = 'Easter Monday';
  // Queen's/King's Birthday: 2nd Monday of June
  const june = new Date(year, 5, 1);
  let monCount = 0;
  for (let day2 = 1; day2 <= 30; day2++) {
    const dt = new Date(year, 5, day2);
    if (dt.getDay() === 1) { monCount++; if (monCount === 2) { h[fmt(dt)] = "King's Birthday"; break; } }
  }
  return h;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getLocalKey(churchId: string) {
  return `church_events_${churchId}`;
}

function loadLocalEvents(churchId: string): ChurchEvent[] {
  try {
    return JSON.parse(localStorage.getItem(getLocalKey(churchId)) || '[]');
  } catch {
    return [];
  }
}

function saveLocalEvents(churchId: string, events: ChurchEvent[]) {
  try {
    localStorage.setItem(getLocalKey(churchId), JSON.stringify(events));
  } catch {}
}

function formatTimeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return d.toLocaleDateString();
}

export default function Calendar() {
  const { t, isZh } = useLanguage();
  const { mode } = useMode();
  const { church, profile, user } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const isDemo = isDemoChurch(church);
  const canManage = mode === 'Manager' && !isSampleChurch(church);

  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [birthdays, setBirthdays] = useState<{ name: string; dob: string }[]>([]);

  // Load members' birthdays (from profiles.dob) to show on the calendar
  useEffect(() => {
    if (!activeChurchId || isDemoChurch(church)) { setBirthdays([]); return; }
    supabase.from('profiles').select('full_name, dob').eq('church_id', activeChurchId).not('dob', 'is', null)
      .then(({ data }) => setBirthdays((data || []).filter((p: any) => p.dob).map((p: any) => ({ name: p.full_name, dob: p.dob }))));
  }, [activeChurchId, church?.id]);

  // Generate yearly-recurring birthday events for the displayed month
  const birthdayEvents: ChurchEvent[] = birthdays.map(b => {
    const parts = (b.dob || '').split('-');
    if (parts.length < 3) return null;
    const mo = parseInt(parts[1], 10), da = parseInt(parts[2], 10);
    if (!mo || !da || mo - 1 !== currentMonth) return null;
    return {
      id: `bday-${b.name}-${mo}-${da}`, church_id: activeChurchId || '',
      title: `🎂 ${b.name}`, event_date: `${currentYear}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`,
      category: 'Birthday', color: '#ec4899', created_at: '',
    } as ChurchEvent;
  }).filter(Boolean) as ChurchEvent[];

  const allEvents = [...events, ...birthdayEvents];

  // Add event form
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    event_date: '',
    event_time: '',
    category: 'Service',
    color: '#6366f1',
    description: '',
    repeat: 'none' as 'none' | 'weekly' | 'biweekly' | 'monthly',
    repeatCount: 4,
    createZoom: false,
    zoomDuration: 90,
    zoomAutoRecord: false,
  });
  const [saving, setSaving] = useState(false);

  // ── Zoom ────────────────────────────────────────────────────────────────
  const navigate = useNavigate();
  const [zoom, setZoom] = useState<ZoomStatus | null>(null);
  const [zoomNotice, setZoomNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) { setZoom(null); return; }
    getZoomStatus().then(setZoom);
  }, [activeChurchId, isDemo]);

  /** 教会时区。没设过就退回 churches 表的默认值。 */
  const churchTimezone = (church as any)?.timezone || 'Australia/Sydney';

  useEffect(() => {
    if (!activeChurchId) return;
    fetchEvents();
  }, [activeChurchId]);

  async function fetchEvents() {
    setLoading(true);
    try {
      if (!isDemo) {
        const { data, error } = await supabase
          .from('church_events')
          .select('*')
          .eq('church_id', activeChurchId)
          .order('event_date', { ascending: true });

        if (!error && data) {
          const merged = mergeWithLocal(data as ChurchEvent[], activeChurchId!);
          setEvents(merged);
          saveLocalEvents(activeChurchId!, merged);
          setLoading(false);
          return;
        }
      }
    } catch {}
    // Fallback to localStorage
    setEvents(loadLocalEvents(activeChurchId || 'demo'));
    setLoading(false);
  }

  function mergeWithLocal(remote: ChurchEvent[], churchId: string): ChurchEvent[] {
    const local = loadLocalEvents(churchId).filter(l => l.id.startsWith('local-'));
    const all = [...remote, ...local];
    const seen = new Set<string>();
    return all.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).sort((a, b) => a.event_date.localeCompare(b.event_date));
  }

  function getRepeatDates(startDate: string, repeat: string, count: number): string[] {
    const dates: string[] = [startDate];
    const base = new Date(startDate + 'T00:00:00');
    const daysMap: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 0 };
    for (let i = 1; i < count; i++) {
      const next = new Date(base);
      if (repeat === 'monthly') {
        next.setMonth(base.getMonth() + i);
      } else {
        next.setDate(base.getDate() + daysMap[repeat] * i);
      }
      dates.push(next.toISOString().slice(0, 10));
    }
    return dates;
  }

  async function handleAddEvent() {
    if (!formData.title.trim() || !formData.event_date) return;
    setSaving(true);
    try {
      const dates = formData.repeat === 'none'
        ? [formData.event_date]
        : getRepeatDates(formData.event_date, formData.repeat, formData.repeatCount);

      // 重复活动的每一场都单独开一个 Zoom 会议 —— 会议号不同，才好按场次
      // 分别拉出席和录制。某一场建失败不连累其它场，活动照常保存。
      const meetings: (Awaited<ReturnType<typeof createMeeting>> | null)[] = [];
      if (formData.createZoom && zoom?.connected && !isDemo) {
        let failed = 0;
        for (const date of dates) {
          try {
            meetings.push(await createMeeting({
              topic: formData.title,
              startTime: toZoomStartTime(date, formData.event_time),
              duration: formData.zoomDuration,
              timezone: churchTimezone,
              agenda: formData.description,
              autoRecord: formData.zoomAutoRecord,
            }));
          } catch {
            meetings.push(null);
            failed++;
          }
        }
        if (failed) setZoomNotice(t('zoomMeetingFailed'));
      }

      const newEvents: ChurchEvent[] = dates.map((date, idx) => ({
        id: `local-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        church_id: activeChurchId || 'demo',
        title: formData.title,
        event_date: date,
        event_time: formData.event_time || undefined,
        category: formData.category,
        color: formData.color,
        description: formData.description || undefined,
        created_at: new Date().toISOString(),
        zoom_meeting_id: meetings[idx]?.meetingId,
        zoom_join_url: meetings[idx]?.joinUrl,
        zoom_passcode: meetings[idx]?.passcode ?? undefined,
      }));

      if (!isDemo && activeChurchId) {
        try {
          const toInsert = newEvents.map(e => ({
            church_id: activeChurchId,
            title: e.title,
            event_date: e.event_date,
            event_time: e.event_time,
            category: e.category,
            color: e.color,
            description: e.description,
            zoom_meeting_id: e.zoom_meeting_id,
            zoom_join_url: e.zoom_join_url,
            zoom_passcode: e.zoom_passcode,
          }));
          await supabase.from('church_events').insert(toInsert);
        } catch {}
      }

      const updated = [...events, ...newEvents].sort((a, b) => a.event_date.localeCompare(b.event_date));
      setEvents(updated);
      saveLocalEvents(activeChurchId || 'demo', updated);
      logActivity({
        churchId: activeChurchId || '',
        userId: profile?.id || '',
        userName: profile?.full_name || 'User',
        userRole: profile?.role || 'Manager',
        action: 'Added calendar event',
        target: formData.title,
        type: 'Resource',
      });
      setShowAddForm(false);
      setFormData({ title: '', event_date: '', event_time: '', category: 'Service', color: '#6366f1', description: '', repeat: 'none', repeatCount: 4, createZoom: false, zoomDuration: 90, zoomAutoRecord: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    if (!confirm('Delete this event?')) return;
    try {
      // 删活动前先取消对应的 Zoom 会议，否则那个会议会一直挂在教会账号里，
      // 而 GraceFlow 里已经没有任何入口能再找到它。
      const target = events.find(e => e.id === eventId);
      if (target?.zoom_meeting_id && !isDemo) {
        try { await deleteMeeting(target.zoom_meeting_id); } catch { /* 会议可能已在 Zoom 侧删掉 */ }
      }
      if (!isDemo && !eventId.startsWith('local-')) {
        await supabase.from('church_events').delete().eq('id', eventId);
      }
      const updated = events.filter(e => e.id !== eventId);
      setEvents(updated);
      saveLocalEvents(activeChurchId || 'demo', updated);
    } catch {}
  }

  // Calendar grid calculation
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const publicHolidays = getAustralianHolidays(currentYear);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  function getEventsForDate(dateStr: string) {
    return allEvents.filter(e => e.event_date === dateStr);
  }

  function formatDateStr(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  // ── Export to iCal (.ics) — imports into Apple Calendar, Google Calendar, Outlook ──
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const icsDateParts = (ev: ChurchEvent) => {
    const [y, m, d] = ev.event_date.split('-').map(Number);
    const tm = (ev.event_time || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (tm) {
      let h = parseInt(tm[1], 10);
      const min = parseInt(tm[2], 10);
      const ap = (tm[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return { value: `${y}${pad2(m)}${pad2(d)}T${pad2(h)}${pad2(min)}00`, allDay: false };
    }
    return { value: `${y}${pad2(m)}${pad2(d)}`, allDay: true };
  };
  const exportICS = () => {
    if (allEvents.length === 0) return;
    const n = new Date();
    const stamp = `${n.getUTCFullYear()}${pad2(n.getUTCMonth() + 1)}${pad2(n.getUTCDate())}T${pad2(n.getUTCHours())}${pad2(n.getUTCMinutes())}${pad2(n.getUTCSeconds())}Z`;
    const esc = (s: string) => (s || '').replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GraceFlow//Church Calendar//EN', 'CALSCALE:GREGORIAN'];
    allEvents.forEach(ev => {
      const { value, allDay } = icsDateParts(ev);
      lines.push('BEGIN:VEVENT', `UID:${ev.id}@graceflow`, `DTSTAMP:${stamp}`,
        allDay ? `DTSTART;VALUE=DATE:${value}` : `DTSTART:${value}`,
        `SUMMARY:${esc(ev.title)}`);
      if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'church-calendar.ics'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-end justify-between mb-10">
        <div>
          <h2 className="font-headline-md text-on-surface opacity-90">Church Calendar</h2>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-outline mt-1">
            EVENTS & SCHEDULES
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportICS}
            disabled={events.length === 0}
            title={isZh ? '下载日历 (.ics) — 可导入 Apple / Google 日历' : 'Download calendar (.ics) — import into Apple / Google Calendar'}
            className="flex items-center gap-2 rounded-full bg-surface-container-high px-5 py-2.5 text-xs font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-all shadow-sm disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            {isZh ? '导出日历' : 'Export .ics'}
          </button>
          {canManage && (
            <button
              onClick={() => { setShowAddForm(true); setFormData(f => ({ ...f, event_date: selectedDate || todayStr })); }}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-on-primary shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              {isZh ? '添加事件' : 'Add Event'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-8">
        {/* Calendar Grid */}
        <div className="flex-1 min-w-0">
          <div className="rounded-[32px] bg-surface-container-lowest border border-outline-variant/30 shadow-sm overflow-hidden">
            {/* Month Navigation */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-outline-variant/20">
              <button
                onClick={prevMonth}
                className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <div className="text-center">
                <h3 className="font-serif text-2xl font-bold text-on-surface">
                  {MONTHS[currentMonth]} {currentYear}
                </h3>
              </div>
              <button
                onClick={nextMonth}
                className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b border-outline-variant/10">
              {DAYS_OF_WEEK.map(day => (
                <div key={day} className="py-3 text-center text-[10px] font-black uppercase tracking-widest text-outline">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Cells */}
            <div className="grid grid-cols-7">
              {Array.from({ length: totalCells }).map((_, idx) => {
                const dayNum = idx - firstDayOfMonth + 1;
                const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
                const dateStr = isCurrentMonth ? formatDateStr(currentYear, currentMonth, dayNum) : '';
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                const dayEvents = isCurrentMonth ? getEventsForDate(dateStr) : [];
                const holiday = isCurrentMonth ? publicHolidays[dateStr] : null;

                return (
                  <div
                    key={idx}
                    onClick={() => isCurrentMonth && setSelectedDate(isSelected ? null : dateStr)}
                    className={`min-h-[90px] p-2 border-b border-r border-outline-variant/10 transition-all cursor-pointer group relative ${
                      !isCurrentMonth ? 'opacity-20 pointer-events-none' : ''
                    } ${holiday ? 'bg-red-50/60' : isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-low'}`}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold mb-1 transition-all ${
                      isToday
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/30'
                        : isSelected
                        ? 'bg-primary/10 text-primary'
                        : holiday
                        ? 'text-red-500'
                        : 'text-on-surface group-hover:bg-surface-container-high'
                    }`}>
                      {isCurrentMonth ? dayNum : ''}
                    </div>
                    {holiday && (
                      <p className="text-[8px] font-black text-red-400 uppercase tracking-wide truncate leading-tight mb-0.5">{holiday}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {dayEvents.slice(0, 3).map((ev, i) => (
                        <div
                          key={i}
                          className="h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: ev.color, width: dayEvents.length === 1 ? '100%' : '8px' }}
                          title={ev.title}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[8px] font-bold text-outline">+{dayEvents.length - 3}</span>
                      )}
                    </div>
                    {dayEvents.length > 0 && dayEvents.length <= 2 && (
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev, i) => (
                          <p key={i} className="text-[9px] font-bold truncate leading-tight" style={{ color: ev.color }}>
                            {ev.title}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 px-2">
            {CATEGORIES.map(cat => (
              <div key={cat} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                <span className="text-[10px] font-bold text-outline uppercase tracking-wider">{cat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side Panel */}
        <div className="xl:w-80 shrink-0">
          <AnimatePresence mode="wait">
            {selectedDate ? (
              <motion.div
                key={selectedDate}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="rounded-[32px] bg-surface-container-lowest border border-outline-variant/30 shadow-sm p-6"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-outline">Selected</p>
                    <h4 className="font-serif text-xl font-bold text-on-surface mt-0.5">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'long', month: 'long', day: 'numeric'
                      })}
                    </h4>
                  </div>
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="p-2 rounded-xl text-outline hover:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {selectedEvents.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="material-symbols-outlined text-outline text-4xl mb-3 block">event_busy</span>
                    <p className="text-sm text-outline">No events on this day</p>
                    {canManage && (
                      <button
                        onClick={() => { setShowAddForm(true); setFormData(f => ({ ...f, event_date: selectedDate })); }}
                        className="mt-4 text-xs font-bold text-primary hover:opacity-70 transition-opacity"
                      >
                        + Add Event
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedEvents.map(ev => (
                      <div
                        key={ev.id}
                        className="p-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low group relative"
                        style={{ borderLeftColor: ev.color, borderLeftWidth: '4px' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span
                              className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-2"
                              style={{ backgroundColor: ev.color + '20', color: ev.color }}
                            >
                              {ev.category}
                            </span>
                            <p className="font-bold text-sm text-on-surface truncate">{ev.title}</p>
                            {ev.event_time && (
                              <p className="text-[11px] text-outline mt-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">schedule</span>
                                {ev.event_time}
                              </p>
                            )}
                            {ev.description && (
                              <p className="text-[11px] text-on-surface-variant mt-2 leading-relaxed">{ev.description}</p>
                            )}
                            {ev.zoom_meeting_id && (
                              <ZoomEventLinks
                                meetingId={ev.zoom_meeting_id}
                                joinUrl={ev.zoom_join_url}
                                passcode={ev.zoom_passcode}
                                topic={ev.title}
                                canHost={canManage}
                                sdkReady={!!zoom?.sdkConfigured}
                              />
                            )}
                          </div>
                          {canManage && (
                            <button
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-outline hover:text-error hover:bg-error/10 transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {canManage && (
                      <button
                        onClick={() => { setShowAddForm(true); setFormData(f => ({ ...f, event_date: selectedDate })); }}
                        className="w-full py-3 rounded-2xl border-2 border-dashed border-outline-variant/40 text-xs font-bold text-outline hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-sm">add</span>
                        Add another event
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-[32px] bg-surface-container-lowest border border-outline-variant/30 shadow-sm p-6"
              >
                <div className="text-center py-12">
                  <span className="material-symbols-outlined text-outline text-5xl mb-4 block">calendar_month</span>
                  <p className="text-sm font-bold text-on-surface mb-1">Select a Date</p>
                  <p className="text-xs text-outline">Click on any date to see events</p>
                </div>

                {/* Upcoming Events */}
                {events.filter(e => e.event_date >= todayStr).slice(0, 5).length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-4">Upcoming</p>
                    <div className="space-y-2">
                      {events.filter(e => e.event_date >= todayStr).slice(0, 5).map(ev => (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedDate(ev.event_date)}
                          className="p-3 rounded-xl bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors flex items-center gap-3"
                        >
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-on-surface truncate">{ev.title}</p>
                            <p className="text-[10px] text-outline">
                              {new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {ev.event_time && ` • ${ev.event_time}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Add Event Modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => e.target === e.currentTarget && setShowAddForm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-serif text-xl font-bold text-on-surface">{t('addEvent')}</h3>
                <button onClick={() => setShowAddForm(false)} className="p-2 rounded-xl text-outline hover:bg-surface-container transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('eventTitle')}</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                    placeholder={t('eventTitlePlaceholder')}
                    className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('dateLabel')}</label>
                    <input
                      type="date"
                      value={formData.event_date}
                      onChange={e => setFormData(f => ({ ...f, event_date: e.target.value }))}
                      className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('timeLabel')}</label>
                    <input
                      type="time"
                      value={formData.event_time}
                      onChange={e => setFormData(f => ({ ...f, event_time: e.target.value }))}
                      className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-4 text-sm focus:border-primary outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('categoryLabel')}</label>
                  <select
                    value={formData.category}
                    onChange={e => {
                      const cat = e.target.value;
                      setFormData(f => ({ ...f, category: cat, color: CATEGORY_COLORS[cat] || f.color }));
                    }}
                    className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all"
                  >
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{t('cat_' + cat.toLowerCase().replace(' ', '')) || cat}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('colorLabel')}</label>
                  <div className="flex items-center gap-3">
                    {Object.values(CATEGORY_COLORS).map(c => (
                      <button
                        key={c}
                        onClick={() => setFormData(f => ({ ...f, color: c }))}
                        className={`w-8 h-8 rounded-full transition-all ${formData.color === c ? 'ring-2 ring-offset-2 ring-on-surface scale-110' : 'opacity-60 hover:opacity-100'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={formData.color}
                      onChange={e => setFormData(f => ({ ...f, color: e.target.value }))}
                      className="w-8 h-8 rounded-full border-2 border-outline-variant cursor-pointer overflow-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">重复 (Repeat)</label>
                  <div className="flex gap-2 flex-wrap">
                    {(['none','weekly','biweekly','monthly'] as const).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setFormData(f => ({ ...f, repeat: opt }))}
                        className={`px-4 py-2 rounded-2xl text-xs font-bold border transition-all ${formData.repeat === opt ? 'bg-primary text-white border-primary' : 'border-outline-variant text-outline hover:border-primary'}`}
                      >
                        {{ none: '不重复', weekly: '每周', biweekly: '每两周', monthly: '每月' }[opt]}
                      </button>
                    ))}
                  </div>
                  {formData.repeat !== 'none' && (
                    <div className="mt-3 flex items-center gap-3">
                      <label className="text-[10px] uppercase font-bold tracking-widest text-outline">重复次数</label>
                      <input
                        type="number"
                        min={2}
                        max={52}
                        value={formData.repeatCount}
                        onChange={e => setFormData(f => ({ ...f, repeatCount: Math.max(2, parseInt(e.target.value) || 2) }))}
                        className="w-20 rounded-2xl border border-outline-variant bg-surface-container py-2 px-3 text-sm focus:border-primary outline-none"
                      />
                      <span className="text-xs text-outline">次</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline block mb-2">{t('descriptionLabel')}</label>
                  <textarea
                    value={formData.description}
                    onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder={t('optionalDetails')}
                    className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all resize-none"
                  />
                </div>

                {/* Zoom：只在教会真的连了 Zoom 时才出现。没连就完全不显示，
                    而不是给一个点了没反应的勾选框。 */}
                {zoom?.connected && !isDemo && (
                  <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.createZoom}
                        onChange={e => setFormData(f => ({ ...f, createZoom: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-black cursor-pointer"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                          <span className="material-symbols-outlined text-[16px] text-primary">videocam</span>
                          {t('zoomCreateMeeting')}
                        </span>
                        <span className="block text-[11px] text-on-surface-variant mt-1 leading-relaxed">
                          {t('zoomCreateMeetingHint')}
                        </span>
                      </span>
                    </label>

                    {formData.createZoom && (
                      <div className="mt-4 pl-7 space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] uppercase font-bold tracking-widest text-outline whitespace-nowrap">
                            {t('zoomDuration')}
                          </label>
                          <input
                            type="number"
                            min={15}
                            max={600}
                            step={15}
                            value={formData.zoomDuration}
                            onChange={e => setFormData(f => ({
                              ...f, zoomDuration: Math.max(15, parseInt(e.target.value) || 15),
                            }))}
                            className="w-24 rounded-2xl border border-outline-variant bg-surface-container py-2 px-3 text-sm focus:border-primary outline-none"
                          />
                        </div>

                        {/* 免费账号没有云录制，勾了也不会生效 —— 干脆不给这个选项 */}
                        {zoom.planType !== 'basic' && (
                          <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.zoomAutoRecord}
                              onChange={e => setFormData(f => ({ ...f, zoomAutoRecord: e.target.checked }))}
                              className="w-4 h-4 rounded accent-black cursor-pointer"
                            />
                            <span className="text-sm text-on-surface">{t('zoomAutoRecord')}</span>
                          </label>
                        )}

                        {zoom.planType === 'basic' && (
                          <p className="text-[11px] text-amber-800 bg-amber-500/10 rounded-xl p-3 leading-relaxed">
                            {t('zoomBasicWarning')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {zoomNotice && (
                  <p className="text-[11px] text-error bg-error/10 rounded-xl p-3 leading-relaxed">
                    {zoomNotice}
                  </p>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-3 text-sm font-bold text-outline hover:text-on-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddEvent}
                  disabled={saving || !formData.title.trim() || !formData.event_date}
                  className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                  ) : t('addEvent')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
