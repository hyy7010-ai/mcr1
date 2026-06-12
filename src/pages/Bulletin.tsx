import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getActiveChurchId } from '../lib/permissions';
import { analyzeBulletinImage } from '../services/geminiService';

// ─── Print CSS (fallback if popup blocked) ────────────────────────────────────
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #bulletin-front { visibility: visible !important; position: fixed !important; left: 0 !important; top: 0 !important; box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; transform: none !important; }
  #bulletin-front * { visibility: visible !important; }
  .print-hidden { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
}
@page { margin: 0; size: A5 portrait; }
`;

// ─── Types ────────────────────────────────────────────────────────────────────
type TemplateId = 'classic' | 'modern' | 'trifold' | 'elegant' | 'newsletter';

interface SavedTemplate {
  id: string;
  name: string;
  snapshot: BulletinDoc;
  createdAt: string;
}
type PageSize   = 'A5' | 'A4' | 'A5L' | 'A4L';

interface SectionFlags {
  cover: boolean; orderOfWorship: boolean; schedule: boolean;
  announcements: boolean; prayerStats: boolean; spiritualGrowth: boolean; photos: boolean;
}
interface ScheduleRow  { time: string; activity: string; leader: string; }
interface HymnItem     { title: string; }
interface PhotoItem    { url: string; caption: string; }
interface ActivityItem { name: string; time: string; location: string; }

type SectionPage = 'front' | 'back';

interface BulletinDoc {
  template: TemplateId; pageSize: PageSize; accentColor: string; fontFamily: string;
  sections: SectionFlags;
  sectionPages: Record<keyof SectionFlags, SectionPage>;
  churchName: string; logoUrl: string; coverPhotoUrl: string;
  date: string; issueNo: string; meetingTime: string;
  address: string; phone: string; website: string;
  sermonTitle: string; preacher: string; scripture: string; scriptureText: string;
  hymns: HymnItem[]; sermonPoints: string[]; hasSermonNotes: boolean;
  schedule: ScheduleRow[];
  announcements: string[]; activities: ActivityItem[]; specialEvents: string[]; recruitment: string[];
  offering: string; attendance: string; missionOffering: string; prayerRequests: string[];
  dailyReading: string; memoryVerse: string; pastorMessage: string;
  photos: PhotoItem[];
}

function makeDefaultDoc(zh: boolean): BulletinDoc {
  return {
    template: 'classic', pageSize: 'A5', accentColor: '#2563EB', fontFamily: 'Georgia, "Times New Roman", serif',
    sections: { cover: true, orderOfWorship: true, schedule: true, announcements: true, prayerStats: true, spiritualGrowth: false, photos: true },
    sectionPages: { cover: 'front', orderOfWorship: 'front', schedule: 'front', announcements: 'back', prayerStats: 'back', spiritualGrowth: 'back', photos: 'back' },
    churchName: zh ? '教会名称' : 'Church Name', logoUrl: '', coverPhotoUrl: '',
    date: zh
      ? new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    issueNo: '', meetingTime: zh ? '主日崇拜 10:00 AM' : 'Sunday Service 10:00 AM',
    address: '', phone: '', website: '',
    sermonTitle: zh ? '讲道题目' : 'Sermon Title',
    preacher: zh ? '讲员' : 'Preacher',
    scripture: zh ? '经文' : 'Scripture', scriptureText: '',
    hymns: zh
      ? [{ title: '诗歌 1' }, { title: '诗歌 2' }, { title: '诗歌 3' }]
      : [{ title: 'Hymn 1' }, { title: 'Hymn 2' }, { title: 'Hymn 3' }],
    sermonPoints: zh
      ? ['第一点', '第二点', '第三点']
      : ['Point 1', 'Point 2', 'Point 3'],
    hasSermonNotes: true,
    schedule: zh ? [
      { time: '10:00', activity: '宣召', leader: '主礼' },
      { time: '10:05', activity: '敬拜', leader: '领诗' },
      { time: '10:20', activity: '读经', leader: '主礼' },
      { time: '10:30', activity: '证道', leader: '讲员' },
      { time: '11:15', activity: '奉献', leader: '司事' },
      { time: '11:20', activity: '报告', leader: '主礼' },
      { time: '11:30', activity: '祝福礼成', leader: '主礼' },
    ] : [
      { time: '10:00', activity: 'Call to Worship',   leader: 'Emcee' },
      { time: '10:05', activity: 'Praise & Worship',  leader: 'Worship' },
      { time: '10:20', activity: 'Scripture Reading', leader: 'Emcee' },
      { time: '10:30', activity: 'Sermon',            leader: 'Pastor' },
      { time: '11:15', activity: 'Offering',          leader: 'Usher' },
      { time: '11:20', activity: 'Announcements',     leader: 'Emcee' },
      { time: '11:30', activity: 'Benediction',       leader: 'Emcee' },
    ],
    announcements: zh ? ['公告一', '公告二'] : ['Announcement 1', 'Announcement 2'],
    activities: [{ name: zh ? '祷告会' : 'Prayer Meeting', time: 'Wed 8:00 PM', location: zh ? '教会' : 'Church' }],
    specialEvents: [], recruitment: [],
    offering: '', attendance: '', missionOffering: '',
    prayerRequests: zh
      ? ['为弟兄姐妹祷告', '为宣教士祷告']
      : ['Pray for members', 'Pray for missionaries'],
    dailyReading: zh ? '创世记 1-3（周一）...' : 'Genesis 1-3 (Mon)...', memoryVerse: '', pastorMessage: '',
    photos: [],
  };
}
const DEFAULT_DOC = makeDefaultDoc(true); // fallback used only before language is known

// ─── Page sizes ───────────────────────────────────────────────────────────────
const PAGE_W: Record<PageSize, string> = { A5: '148mm', A4: '210mm', A5L: '210mm', A4L: '297mm' };
const PAGE_H: Record<PageSize, string> = { A5: '210mm', A4: '297mm', A5L: '148mm', A4L: '210mm' };
const PAGE_P: Record<PageSize, string> = { A5: '10mm', A4: '15mm', A5L: '10mm', A4L: '15mm' };

// ─── Templates ───────────────────────────────────────────────────────────────
const TEMPLATES: { id: TemplateId; name: string; nameEn: string; desc: string; icon: string }[] = [
  { id: 'classic',    name: '经典竖版',  nameEn: 'Classic',    desc: 'Clean single column',       icon: 'article'      },
  { id: 'modern',     name: '现代杂志',  nameEn: 'Magazine',   desc: 'Bold photo cover header',   icon: 'newspaper'    },
  { id: 'elegant',    name: '优雅双栏',  nameEn: 'Elegant',    desc: 'Two column with sidebar',   icon: 'view_column'  },
  { id: 'newsletter', name: '简报风格',  nameEn: 'Newsletter', desc: 'Newsletter with sections',  icon: 'feed'         },
  { id: 'trifold',    name: '三折横版',  nameEn: 'Tri-fold',   desc: 'Landscape 3-panel fold',    icon: 'view_week'    },
];

const SECTION_DEFS: { key: keyof SectionFlags; icon: string; zh: string; en: string; desc: string }[] = [
  { key: 'cover',          icon: 'church',       zh: '封面信息',   en: 'Cover',           desc: 'Name, sermon, time' },
  { key: 'orderOfWorship', icon: 'music_note',   zh: '崇拜程序',   en: 'Order of Worship',desc: 'Hymns & sermon outline' },
  { key: 'schedule',       icon: 'schedule',     zh: '时间表',     en: 'Schedule',        desc: 'Service order & leaders' },
  { key: 'announcements',  icon: 'campaign',     zh: '教会公告',   en: 'Announcements',   desc: 'Events & notices' },
  { key: 'prayerStats',    icon: 'favorite',     zh: '报告与代祷', en: 'Prayer & Stats',  desc: 'Attendance & prayer' },
  { key: 'spiritualGrowth',icon: 'auto_stories', zh: '灵修资源',   en: 'Devotional',      desc: 'Daily reading & verse' },
  { key: 'photos',         icon: 'photo_library',zh: '照片',       en: 'Photos',          desc: 'Church photos' },
];

const ACCENT_COLORS = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#DB2777','#374151'];

const FONTS: { label: string; labelZh: string; value: string; preview: string }[] = [
  { label: 'Sans',    labelZh: '现代无衬线', value: '"Helvetica Neue", Arial, sans-serif',           preview: 'Aa' },
  { label: 'Serif',   labelZh: '经典衬线',   value: 'Georgia, "Times New Roman", serif',             preview: 'Aa' },
  { label: 'Elegant', labelZh: '优雅衬线',   value: '"Palatino Linotype", Palatino, serif',          preview: 'Aa' },
  { label: 'Mono',    labelZh: '等宽字体',   value: '"Courier New", Courier, monospace',             preview: 'Aa' },
];

// ─── Editable component ───────────────────────────────────────────────────────
function E({ value, onChange, className = '', multi = false, ph = '', style }: {
  value: string; onChange: (v: string) => void; className?: string; multi?: boolean; ph?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current && ref.current !== document.activeElement) ref.current.innerText = value || '';
  }, [value]);
  const props: any = {
    ref, contentEditable: true, suppressContentEditableWarning: true, spellCheck: false,
    'data-ph': ph || '…',
    onBlur: (e: any) => onChange(e.currentTarget.innerText.trim()),
    className: `outline-none cursor-text min-w-[2em] inline-block rounded px-0.5
      empty:before:content-[attr(data-ph)] empty:before:text-gray-300/70
      hover:bg-black/5 focus:bg-blue-50 focus:ring-1 focus:ring-blue-300 transition-colors ${className}`,
    style: { minHeight: '1em', ...style } as React.CSSProperties,
  };
  return multi ? <div {...props} /> : <span {...props} />;
}

// ─── Section heading helper ───────────────────────────────────────────────────
function SH({ zh, en, isZh, accent }: { zh: string; en: string; isZh: boolean; accent?: string }) {
  return (
    <div style={{ borderBottom: `2px solid ${accent || '#e5e7eb'}`, paddingBottom: '3px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: '3px', height: '14px', background: accent || '#9ca3af', borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontSize: '9px', fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent || '#6b7280' }}>
        {isZh ? zh : en}
      </span>
    </div>
  );
}

// ─── Shared section renderers ─────────────────────────────────────────────────
function SecOrder({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="崇拜程序" en="Order of Worship" isZh={isZh} accent={accent} />
      <div style={{ marginBottom: '8px' }}>
        <p style={{ fontSize: '9px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>{isZh ? '诗歌' : 'Hymns'}</p>
        {doc.hymns.map((h, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '1px 0' }}>
            <span style={{ color: '#d1d5db', fontSize: '10px', width: '14px' }}>{i + 1}.</span>
            <E value={h.title} onChange={v => { const n = [...doc.hymns]; n[i] = { title: v }; update('hymns', n); }} />
            <button onClick={() => update('hymns', doc.hymns.filter((_, j) => j !== i))} className="print-hidden opacity-30 hover:opacity-100 transition-opacity ml-auto" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        ))}
        <button onClick={() => update('hymns', [...doc.hymns, { title: '' }])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none', marginTop: '2px' }}>+ {isZh ? '添加诗歌' : 'Add Hymn'}</button>
      </div>
      <div>
        <p style={{ fontSize: '9px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>{isZh ? '讲道大纲' : 'Sermon Outline'}</p>
        {doc.sermonPoints.map((pt, i) => (
          <div key={i} style={{ display: 'flex', gap: '6px', fontSize: '12px', marginBottom: '3px' }}>
            <span style={{ color: accent, fontWeight: 700, fontSize: '10px', marginTop: '1px', width: '14px', flexShrink: 0 }}>{i + 1}.</span>
            <E value={pt} onChange={v => { const n = [...doc.sermonPoints]; n[i] = v; update('sermonPoints', n); }} multi className="flex-1" />
            <button onClick={() => update('sermonPoints', doc.sermonPoints.filter((_, j) => j !== i))} className="print-hidden opacity-30 hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        ))}
        <button onClick={() => update('sermonPoints', [...doc.sermonPoints, ''])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none', marginTop: '2px' }}>+ {isZh ? '添加要点' : 'Add Point'}</button>
        {doc.hasSermonNotes && (
          <div style={{ marginTop: '8px', border: '1px dashed #e5e7eb', borderRadius: '6px', padding: '6px 8px' }}>
            <p style={{ fontSize: '9px', color: '#d1d5db', marginBottom: '10px' }}>{isZh ? '笔记 Notes' : 'Notes'}</p>
            {[1,2,3].map(i => <div key={i} style={{ borderBottom: '1px solid #f3f4f6', height: '18px' }} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SecSchedule({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="崇拜时间表" en="Service Schedule" isZh={isZh} accent={accent} />
      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>
            <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 4px 2px 0', width: '36px', fontSize: '9px' }}>{isZh ? '时间' : 'Time'}</th>
            <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 4px', fontSize: '9px' }}>{isZh ? '项目' : 'Item'}</th>
            <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 0 2px 4px', width: '40px', fontSize: '9px' }}>{isZh ? '负责' : 'Leader'}</th>
            <th className="print-hidden" style={{ width: '16px' }} />
          </tr>
        </thead>
        <tbody>
          {doc.schedule.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
              <td style={{ padding: '2px 4px 2px 0', color: '#6b7280' }}><E value={row.time} onChange={v => { const n = [...doc.schedule]; n[i] = { ...row, time: v }; update('schedule', n); }} /></td>
              <td style={{ padding: '2px 4px', fontWeight: 500 }}><E value={row.activity} onChange={v => { const n = [...doc.schedule]; n[i] = { ...row, activity: v }; update('schedule', n); }} /></td>
              <td style={{ padding: '2px 0 2px 4px', color: '#9ca3af' }}><E value={row.leader} onChange={v => { const n = [...doc.schedule]; n[i] = { ...row, leader: v }; update('schedule', n); }} /></td>
              <td className="print-hidden"><button onClick={() => update('schedule', doc.schedule.filter((_, j) => j !== i))} className="opacity-30 hover:opacity-100 transition-opacity" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => update('schedule', [...doc.schedule, { time: '', activity: '', leader: '' }])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none', marginTop: '4px' }}>+ {isZh ? '添加行' : 'Add Row'}</button>
    </div>
  );
}

function SecAnnouncements({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="教会公告" en="Announcements" isZh={isZh} accent={accent} />
      {doc.announcements.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', fontSize: '12px', marginBottom: '4px' }}>
          <span style={{ color: accent, flexShrink: 0, marginTop: '1px' }}>•</span>
          <E value={a} onChange={v => { const n = [...doc.announcements]; n[i] = v; update('announcements', n); }} multi className="flex-1" />
          <button onClick={() => update('announcements', doc.announcements.filter((_, j) => j !== i))} className="print-hidden opacity-30 hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      ))}
      <button onClick={() => update('announcements', [...doc.announcements, ''])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none', marginBottom: '4px' }}>+ {isZh ? '添加公告' : 'Add'}</button>
      {doc.activities.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <p style={{ fontSize: '9px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>{isZh ? '本周活动' : 'This Week'}</p>
          {doc.activities.map((a, i) => (
            <div key={i} style={{ fontSize: '11px', display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '2px', alignItems: 'center' }}>
              <E value={a.name} onChange={v => { const n = [...doc.activities]; n[i] = { ...a, name: v }; update('activities', n); }} style={{ fontWeight: 600 }} />
              <E value={a.time} onChange={v => { const n = [...doc.activities]; n[i] = { ...a, time: v }; update('activities', n); }} style={{ color: '#6b7280' }} />
              <E value={a.location} onChange={v => { const n = [...doc.activities]; n[i] = { ...a, location: v }; update('activities', n); }} style={{ color: '#9ca3af' }} />
              <button onClick={() => update('activities', doc.activities.filter((_, j) => j !== i))} className="print-hidden opacity-30 hover:opacity-100 transition-opacity" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => update('activities', [...doc.activities, { name: '', time: '', location: '' }])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none' }}>+ {isZh ? '添加活动' : 'Add Activity'}</button>
      {doc.specialEvents.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: '4px', fontSize: '11px', marginBottom: '2px' }}>
          <span style={{ color: '#f59e0b' }}>★</span>
          <E value={ev} onChange={v => { const n = [...doc.specialEvents]; n[i] = v; update('specialEvents', n); }} multi className="flex-1" />
        </div>
      ))}
      <button onClick={() => update('specialEvents', [...doc.specialEvents, ''])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none' }}>+ {isZh ? '特别预告' : 'Special Event'}</button>
    </div>
  );
}

function SecPrayer({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="报告与代祷" en="Prayer & Stats" isZh={isZh} accent={accent} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginBottom: '8px' }}>
        {[
          { l: isZh ? '出席' : 'Attendance', f: 'attendance' as const },
          { l: isZh ? '奉献' : 'Offering',   f: 'offering' as const },
          { l: isZh ? '宣教' : 'Mission',    f: 'missionOffering' as const },
        ].map(({ l, f }) => (
          <div key={f} style={{ background: '#f9fafb', borderRadius: '6px', padding: '4px', textAlign: 'center' }}>
            <p style={{ fontSize: '8px', color: '#9ca3af', marginBottom: '2px' }}>{l}</p>
            <E value={doc[f]} onChange={v => update(f, v)} className="text-center block font-bold" ph="0" style={{ fontSize: '13px', fontWeight: 700, display: 'block', textAlign: 'center' }} />
          </div>
        ))}
      </div>
      {doc.prayerRequests.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: '4px', fontSize: '11px', marginBottom: '3px' }}>
          <span style={{ fontSize: '10px', flexShrink: 0 }}>🙏</span>
          <E value={r} onChange={v => { const n = [...doc.prayerRequests]; n[i] = v; update('prayerRequests', n); }} multi className="flex-1" />
          <button onClick={() => update('prayerRequests', doc.prayerRequests.filter((_, j) => j !== i))} className="print-hidden opacity-30 hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: '#ef4444', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      ))}
      <button onClick={() => update('prayerRequests', [...doc.prayerRequests, ''])} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none', marginTop: '2px' }}>+ {isZh ? '添加代祷' : 'Add Prayer'}</button>
    </div>
  );
}

function SecDevotional({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="灵修资源" en="Devotional" isZh={isZh} accent={accent} />
      <div style={{ marginBottom: '6px' }}>
        <p style={{ fontSize: '9px', color: '#9ca3af', marginBottom: '2px' }}>{isZh ? '每日读经' : 'Daily Reading'}</p>
        <E value={doc.dailyReading} onChange={v => update('dailyReading', v)} multi style={{ fontSize: '11px' }} />
      </div>
      {doc.memoryVerse && (
        <div style={{ background: `${accent}10`, borderLeft: `3px solid ${accent}`, padding: '6px 8px', borderRadius: '0 6px 6px 0', marginBottom: '6px' }}>
          <p style={{ fontSize: '9px', color: accent, fontWeight: 700, marginBottom: '2px' }}>{isZh ? '金句' : 'Memory Verse'}</p>
          <E value={doc.memoryVerse} onChange={v => update('memoryVerse', v)} multi style={{ fontSize: '11px', fontStyle: 'italic' }} />
        </div>
      )}
      <button onClick={() => update('memoryVerse', doc.memoryVerse ? '' : '...')} className="print-hidden" style={{ fontSize: '9px', color: accent, cursor: 'pointer', background: 'none', border: 'none' }}>{doc.memoryVerse ? (isZh ? '移除金句' : 'Remove') : `+ ${isZh ? '金句' : 'Memory Verse'}`}</button>
    </div>
  );
}

function SecPhotos({ doc, update, isZh, accent }: { doc: BulletinDoc; update: any; isZh: boolean; accent: string }) {
  const photoRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginBottom: '14px' }}>
      <SH zh="照片" en="Photos" isZh={isZh} accent={accent} />
      <input ref={photoRef} type="file" accept="image/*" multiple className="print-hidden hidden" onChange={e => {
        Array.from(e.target.files || []).forEach(f => {
          const r = new FileReader(); r.onload = ev => update('photos', [...doc.photos, { url: ev.target?.result as string, caption: '' }]); r.readAsDataURL(f);
        });
      }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {doc.photos.map((p, i) => (
          <div key={i} style={{ position: 'relative' }} className="group">
            <img src={p.url} alt={p.caption} style={{ width: '100%', height: '70px', objectFit: 'cover', borderRadius: '6px' }} />
            <E value={p.caption} onChange={v => { const n = [...doc.photos]; n[i] = { ...p, caption: v }; update('photos', n); }} style={{ fontSize: '9px', textAlign: 'center', color: '#6b7280', display: 'block', marginTop: '2px' }} ph="Caption" />
          </div>
        ))}
        <button onClick={() => photoRef.current?.click()} className="print-hidden" style={{ height: '70px', border: '2px dashed #e5e7eb', borderRadius: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', cursor: 'pointer', background: 'none', fontSize: '10px', gap: '2px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_photo_alternate</span>
          {isZh ? '添加照片' : 'Add Photo'}
        </button>
      </div>
    </div>
  );
}

// ─── Cover helpers ────────────────────────────────────────────────────────────
function CoverPhotoUpload({ doc, update }: { doc: BulletinDoc; update: any }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" className="print-hidden hidden" onChange={e => {
        const f = e.target.files?.[0]; if (!f) return;
        const r = new FileReader(); r.onload = ev => update('coverPhotoUrl', ev.target?.result as string); r.readAsDataURL(f);
      }} />
      {doc.coverPhotoUrl
        ? <img src={doc.coverPhotoUrl} alt="cover" onClick={() => ref.current?.click()} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }} title="Click to change" />
        : <button onClick={() => ref.current?.click()} className="print-hidden" style={{ width: '100%', height: '100%', border: '2px dashed rgba(255,255,255,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', background: 'none', gap: '4px', fontSize: '11px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>add_photo_alternate</span>
            Add cover photo
          </button>
      }
    </>
  );
}

function LogoUpload({ doc, update, style }: { doc: BulletinDoc; update: any; style?: React.CSSProperties }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" className="print-hidden hidden" onChange={e => {
        const f = e.target.files?.[0]; if (!f) return;
        const r = new FileReader(); r.onload = ev => update('logoUrl', ev.target?.result as string); r.readAsDataURL(f);
      }} />
      {doc.logoUrl
        ? <img src={doc.logoUrl} alt="logo" onClick={() => ref.current?.click()} style={{ height: '40px', objectFit: 'contain', cursor: 'pointer', ...style }} title="Click to change" />
        : <button onClick={() => ref.current?.click()} className="print-hidden" style={{ height: '40px', width: '40px', borderRadius: '50%', border: '2px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', cursor: 'pointer', background: 'none', flexShrink: 0, ...style }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_photo_alternate</span>
          </button>
      }
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Bulletin() {
  const { profile, church } = useAuth();
  const { isZh } = useLanguage();
  const churchId = getActiveChurchId(profile, church) || 'default';
  const storageKey = `bulletin_v3_${churchId}`;

  const [doc, setDoc] = useState<BulletinDoc>(() => {
    try {
      const s = localStorage.getItem(storageKey);
      if (s) {
        const parsed = JSON.parse(s);
        // Ensure sectionPages is always present (backwards compat)
        return { ...DEFAULT_DOC, ...parsed, sectionPages: { ...DEFAULT_DOC.sectionPages, ...(parsed.sectionPages || {}) } };
      }
      // First time: use language-appropriate defaults from context
      return makeDefaultDoc(isZh);
    } catch { return DEFAULT_DOC; }
  });
  const savedTemplatesKey = `bulletin_saved_tpl_${churchId}`;
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [panel, setPanel] = useState<'sections' | 'templates' | 'style'>('sections');
  const [zoom, setZoom] = useState(0.5);
  const [currentPage] = useState<'front' | 'back'>('front'); // kept for TS compat, no longer toggled
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem(`bulletin_saved_tpl_${churchId}`) || '[]'); }
    catch { return []; }
  });
  const [namingId, setNamingId] = useState<string | null>(null); // id being renamed inline
  const [nameInput, setNameInput] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  const dragStorageKey = `bulletin_drag_${churchId}`;
  const [freeDrag, setFreeDrag] = useState(false);
  const [blockPositions, setBlockPositions] = useState<Record<string, {x: number; y: number}>>(() => {
    try { return JSON.parse(localStorage.getItem(`${dragStorageKey}_pos`) || '{}'); } catch { return {}; }
  });
  const [blockSizes, setBlockSizes] = useState<Record<string, {w: number; h: number}>>(() => {
    try { return JSON.parse(localStorage.getItem(`${dragStorageKey}_sizes`) || '{}'); } catch { return {}; }
  });

  // Persist blockPositions and blockSizes whenever they change
  useEffect(() => {
    try { localStorage.setItem(`${dragStorageKey}_pos`, JSON.stringify(blockPositions)); } catch {}
  }, [blockPositions, dragStorageKey]);
  useEffect(() => {
    try { localStorage.setItem(`${dragStorageKey}_sizes`, JSON.stringify(blockSizes)); } catch {}
  }, [blockSizes, dragStorageKey]);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Default stacked positions for each section (in px relative to canvas)
  const DEFAULT_BLOCK_POSITIONS: Record<string, {x: number; y: number}> = {
    cover: { x: 8, y: 8 }, orderOfWorship: { x: 8, y: 100 }, schedule: { x: 8, y: 200 },
    announcements: { x: 8, y: 300 }, prayerStats: { x: 8, y: 400 }, spiritualGrowth: { x: 8, y: 500 }, photos: { x: 8, y: 580 },
  };

  const toggleFreeDrag = () => {
    setFreeDrag(prev => {
      if (!prev) {
        // Initialize positions if not set yet
        setBlockPositions(bp => {
          const init: Record<string, {x: number; y: number}> = {};
          Object.entries(DEFAULT_BLOCK_POSITIONS).forEach(([k, v]) => { init[k] = bp[k] ?? v; });
          return init;
        });
      }
      return !prev;
    });
  };

  const moveBlock = useCallback((id: string, pos: {x: number; y: number}) => {
    setBlockPositions(prev => ({ ...prev, [id]: pos }));
  }, []);

  const resetDragPositions = () => { setBlockPositions({ ...DEFAULT_BLOCK_POSITIONS }); setBlockSizes({}); };
  const resizeBlock = useCallback((id: string, size: {w: number; h: number}) => {
    setBlockSizes(prev => ({ ...prev, [id]: size }));
  }, []);

  useEffect(() => {
    const s = document.createElement('style'); s.id = 'bul-print'; s.textContent = PRINT_CSS;
    document.head.appendChild(s);
    return () => document.getElementById('bul-print')?.remove();
  }, []);

  const update = useCallback(<K extends keyof BulletinDoc>(k: K, v: BulletinDoc[K]) =>
    setDoc(prev => ({ ...prev, [k]: v })), []);
  const toggleSection = useCallback((k: keyof SectionFlags) =>
    setDoc(prev => ({ ...prev, sections: { ...prev.sections, [k]: !prev.sections[k] } })), []);

  const toggleSectionPage = useCallback((k: keyof SectionFlags) =>
    setDoc(prev => ({
      ...prev,
      sectionPages: {
        ...prev.sectionPages,
        [k]: (prev.sectionPages?.[k] || 'front') === 'front' ? 'back' : 'front',
      }
    })), []);

  const saveDoc = () => {
    localStorage.setItem(storageKey, JSON.stringify(doc));
    setSavedMsg(isZh ? '已保存 ✓' : 'Saved ✓');
    setTimeout(() => setSavedMsg(''), 2000);
  };

  const persistTemplates = (list: SavedTemplate[]) => {
    setSavedTemplates(list);
    localStorage.setItem(savedTemplatesKey, JSON.stringify(list));
  };

  const addTemplate = () => {
    const newTpl: SavedTemplate = {
      id: Date.now().toString(),
      name: isZh ? `自定义模板 ${savedTemplates.length + 1}` : `Custom ${savedTemplates.length + 1}`,
      snapshot: { ...doc },
      createdAt: new Date().toLocaleDateString(),
    };
    const updated = [...savedTemplates, newTpl];
    persistTemplates(updated);
    // Immediately enter rename mode for the new one
    setNamingId(newTpl.id);
    setNameInput(newTpl.name);
    setPanel('templates');
  };

  const loadTemplate = (tpl: SavedTemplate) => {
    setDoc({ ...DEFAULT_DOC, ...tpl.snapshot });
  };

  const deleteTemplate = (id: string) => {
    persistTemplates(savedTemplates.filter(t => t.id !== id));
  };

  const commitRename = (id: string) => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      persistTemplates(savedTemplates.map(t => t.id === id ? { ...t, name: trimmed } : t));
    }
    setNamingId(null);
  };

  const handlePrint = () => {
    saveDoc();
    const frontEl = document.getElementById('bulletin-front');
    const backEl  = document.getElementById('bulletin-back');
    if (!frontEl) { window.print(); return; }

    const wasHidden = backEl ? backEl.style.display === 'none' : false;
    if (backEl && wasHidden) backEl.style.display = 'block';
    const frontInner = frontEl.innerHTML;
    const backInner  = backEl ? backEl.innerHTML : '';
    if (backEl && wasHidden) backEl.style.display = 'none';

    const isTrifold   = doc.template === 'trifold';
    const isLandscape = isTrifold || doc.pageSize === 'A5L' || doc.pageSize === 'A4L';
    const pageSize    = isTrifold ? 'A5 landscape'
      : doc.pageSize === 'A5L' ? 'A5 landscape'
      : doc.pageSize === 'A4L' ? 'A4 landscape'
      : `${doc.pageSize} portrait`;
    const pageW       = isTrifold ? '297mm' : PAGE_W[doc.pageSize];
    const pageH       = isTrifold ? '210mm' : PAGE_H[doc.pageSize];

    // Build a CLEAN inline style for each page (no min-height — fixed exact size)
    const pgInlineStyle = [
      `width:${pageW}`, `height:${pageH}`, `overflow:hidden`,
      `background:white`, `font-size:12px`, `line-height:1.6`,
      `font-family:${doc.fontFamily}`, `box-sizing:border-box`,
      `position:relative`,
    ].join(';');

    const pw = window.open('', '_blank', 'width=960,height=780');
    if (!pw) { window.print(); return; }

    pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@page { size:${pageSize}; margin:0; }
* { box-sizing: border-box; }
/* Screen: side-by-side nice preview */
body { margin:0; padding:28px 0; background:#d1d5db; display:flex; flex-direction:column; align-items:center; gap:20px; }
.notice { background:#fef3c7; border:2px solid #f59e0b; border-radius:10px; padding:14px 20px; font-size:13px; font-weight:bold; color:#92400e; text-align:center; width:${pageW}; line-height:1.8; font-family:system-ui,sans-serif; }
.pg { width:${pageW}; height:${pageH}; overflow:hidden; box-shadow:0 6px 28px rgba(0,0,0,0.18); flex-shrink:0; }
/* Print: strict exact-size pages */
@media print {
  @page { size:${pageSize}; margin:0; }
  body { margin:0; padding:0; background:white; display:block; }
  .notice { display:none !important; }
  .pg { width:${pageW}!important; height:${pageH}!important; overflow:hidden!important; box-shadow:none!important; margin:0!important; break-after:page; page-break-after:always; }
  .pg:last-of-type { break-after:auto; page-break-after:auto; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
}
[contenteditable] { outline:none!important; cursor:default!important; }
.print-hidden { display:none!important; }
[data-ph]:empty::before { display:none!important; }
</style></head><body>
<div class="notice">⚠️ ${isZh
  ? `打印时请选择：纸张 = <b>${pageSize.replace('portrait','纵向').replace('landscape','横向').toUpperCase()}</b>，边距 = <b>无</b>`
  : `In print dialog → More settings: Paper = <b>${pageSize}</b>, Margins = <b>None</b>`
}</div>
<div class="pg"><div style="${pgInlineStyle}">${frontInner}</div></div>
${backInner ? `<div class="pg"><div style="${pgInlineStyle}">${backInner}</div></div>` : ''}
<script>window.onload=function(){setTimeout(function(){window.print();},700);};<\/script>
</body></html>`);
    pw.document.close();
  };

  // Compress image to max 1400px wide before sending to Gemini (much faster upload + analysis)
  const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      // PDFs: just read as-is (can't canvas-resize a PDF)
      const r = new FileReader(); r.onload = ev => resolve(ev.target?.result as string); r.onerror = reject; r.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1400;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82)); // JPEG at 82% quality
    };
    img.onerror = reject;
    img.src = url;
  });

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Check API key before calling AI
    if (!import.meta.env.VITE_GEMINI_API_KEY) {
      alert(isZh ? '请先配置 Gemini API Key / Please configure your Gemini API Key first' : 'Please configure your Gemini API Key first (VITE_GEMINI_API_KEY)');
      if (scanRef.current) scanRef.current.value = '';
      return;
    }

    setIsProcessing(true);
    try {
      const b64 = await Promise.all(files.map(compressImage));
      const result = await analyzeBulletinImage(b64);
      if (result) setDoc(prev => ({ ...prev, ...result }));
    } catch (err: any) {
      const msg = err?.message || String(err) || 'Unknown error';
      console.error('AI scan error:', err);
      alert(isZh ? `AI扫描失败：${msg}\n\n请检查：\n1. 图片格式是否为 JPG/PNG\n2. 文件大小是否过大（建议 <5MB）\n3. 网络连接是否正常` : `AI scan failed: ${msg}\n\nTips:\n1. Use JPG/PNG images\n2. File size < 5MB\n3. Check network connection`);
    }
    finally { setIsProcessing(false); if (scanRef.current) scanRef.current.value = ''; }
  };

  const acc = doc.accentColor;
  const w   = doc.template === 'trifold' ? '297mm' : PAGE_W[doc.pageSize];
  const h   = doc.template === 'trifold' ? '210mm' : PAGE_H[doc.pageSize];
  const pad = PAGE_P[doc.pageSize] || '10mm';

  const sectionProps = { doc, update, isZh, accent: acc };

  // ── Draggable + Resizable block wrapper (free layout mode) ──────────────
  const DB = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => {
    const pos  = blockPositions[id] ?? DEFAULT_BLOCK_POSITIONS[id] ?? { x: 0, y: 0 };
    const size = blockSizes[id] ?? { w: 0, h: 0 };
    const dragging = useRef(false);
    const resizing = useRef<string | null>(null); // 'se'|'sw'|'ne'|'nw'|'e'|'w'|'s'|'n'
    const origin   = useRef({ mx: 0, my: 0, ox: 0, oy: 0, ow: 0, oh: 0 });
    const blockRef = useRef<HTMLDivElement>(null);

    // ── Drag ──
    const handleDragDown = (e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      dragging.current = true;
      origin.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y, ow: size.w, oh: size.h };
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const dx = (ev.clientX - origin.current.mx) / zoom;
        const dy = (ev.clientY - origin.current.my) / zoom;
        moveBlock(id, { x: origin.current.ox + dx, y: origin.current.oy + dy });
      };
      const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    };

    // ── Resize ──
    const handleResizeDown = (e: React.MouseEvent, dir: string) => {
      e.preventDefault(); e.stopPropagation();
      resizing.current = dir;
      const currentW = blockRef.current?.offsetWidth  ?? 160;
      const currentH = blockRef.current?.offsetHeight ?? 80;
      origin.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y, ow: currentW, oh: currentH };
      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const dx = (ev.clientX - origin.current.mx) / zoom;
        const dy = (ev.clientY - origin.current.my) / zoom;
        const d = resizing.current;
        let newW = origin.current.ow, newH = origin.current.oh, newX = origin.current.ox, newY = origin.current.oy;
        if (d.includes('e')) newW = Math.max(80, origin.current.ow + dx);
        if (d.includes('w')) { newW = Math.max(80, origin.current.ow - dx); newX = origin.current.ox + (origin.current.ow - newW); }
        if (d.includes('s')) newH = Math.max(40, origin.current.oh + dy);
        if (d.includes('n')) { newH = Math.max(40, origin.current.oh - dy); newY = origin.current.oy + (origin.current.oh - newH); }
        resizeBlock(id, { w: newW, h: newH });
        if (d.includes('w') || d.includes('n')) moveBlock(id, { x: newX, y: newY });
      };
      const onUp = () => { resizing.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    };

    const resizeHandle = (dir: string, style: React.CSSProperties) => (
      <div onMouseDown={e => handleResizeDown(e, dir)} style={{
        position: 'absolute', width: 10, height: 10, background: acc,
        borderRadius: '50%', zIndex: 30, cursor: `${dir}-resize`, ...style,
      }} />
    );

    return (
      <div ref={blockRef} style={{
        position: 'absolute', left: pos.x, top: pos.y, zIndex: 20,
        width:  size.w > 0 ? size.w : undefined,
        height: size.h > 0 ? size.h : undefined,
        minWidth: '80px', overflow: size.h > 0 ? 'hidden' : 'visible',
      }}>
        {/* Drag handle header */}
        <div onMouseDown={handleDragDown} style={{
          background: `${acc}18`, border: `1.5px dashed ${acc}`, borderRadius: '4px 4px 0 0',
          padding: '2px 8px', fontSize: '8px', color: acc, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', cursor: 'grab',
          letterSpacing: '0.06em', lineHeight: '14px',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: '11px' }}>⠿</span>{label}</span>
          <span style={{ fontSize: '9px', opacity: 0.5 }}>{size.w > 0 ? `${Math.round(size.w)}×${Math.round(size.h)}px` : ''}</span>
        </div>
        {/* Content */}
        <div style={{ border: `1.5px dashed ${acc}`, borderTop: 'none', borderRadius: '0 0 4px 4px', background: 'white', padding: '4px', height: size.h > 0 ? size.h - 20 : undefined, overflow: size.h > 0 ? 'hidden' : 'visible' }}>
          {children}
        </div>
        {/* Resize handles */}
        {resizeHandle('se', { right: -5, bottom: -5 })}
        {resizeHandle('sw', { left: -5,  bottom: -5 })}
        {resizeHandle('ne', { right: -5, top: 16    })}
        {resizeHandle('nw', { left: -5,  top: 16    })}
        {resizeHandle('e',  { right: -5, top: '50%', marginTop: -5 })}
        {resizeHandle('w',  { left: -5,  top: '50%', marginTop: -5 })}
        {resizeHandle('s',  { bottom: -5, left: '50%', marginLeft: -5 })}
      </div>
    );
  };

  // Which sections are on / on front / on back
  const on      = (k: keyof SectionFlags) => doc.sections[k];
  const onFront = (k: keyof SectionFlags) => doc.sections[k] && (doc.sectionPages?.[k] ?? 'front') === 'front';
  const onBack  = (k: keyof SectionFlags) => doc.sections[k] && (doc.sectionPages?.[k] ?? 'front') === 'back';

  // ── Template renderers ────────────────────────────────────────────────────
  const renderCanvas = () => {
    const baseStyle: React.CSSProperties = {
      width: w, height: h, overflow: 'hidden', background: 'white',
      boxShadow: '0 4px 40px rgba(0,0,0,0.12)',
      fontSize: '12px', lineHeight: '1.6',
      fontFamily: doc.fontFamily,
    };

    switch (doc.template) {

      // ── CLASSIC ──────────────────────────────────────────────────────────
      case 'classic': return (
        <div id="bulletin-front" style={{ ...baseStyle, padding: pad }}>
          {onFront('cover') && (
            <div style={{ textAlign: 'center', borderBottom: `2px solid ${acc}`, paddingBottom: '12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><LogoUpload doc={doc} update={update} /></div>
              <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '0.05em' }}><E value={doc.churchName} onChange={v => update('churchName', v)} /></div>
              <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px', letterSpacing: '0.1em' }}><E value={doc.date} onChange={v => update('date', v)} />{doc.issueNo && <span style={{ marginLeft: '8px' }}>No. <E value={doc.issueNo} onChange={v => update('issueNo', v)} /></span>}</div>
              <div style={{ margin: '10px auto', maxWidth: '80%', border: `1px solid ${acc}30`, borderRadius: '8px', padding: '8px 12px', background: `${acc}05` }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: acc }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} /></div>
                <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                  <E value={doc.preacher} onChange={v => update('preacher', v)} /> · <E value={doc.scripture} onChange={v => update('scripture', v)} />
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#6b7280' }}><E value={doc.meetingTime} onChange={v => update('meetingTime', v)} /></div>
              {doc.address && <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}><E value={doc.address} onChange={v => update('address', v)} /></div>}
            </div>
          )}
          {onFront('orderOfWorship') && <SecOrder {...sectionProps} />}
          {onFront('schedule') && <SecSchedule {...sectionProps} />}
          {onFront('announcements') && <SecAnnouncements {...sectionProps} />}
          {onFront('prayerStats') && <SecPrayer {...sectionProps} />}
          {onFront('spiritualGrowth') && <SecDevotional {...sectionProps} />}
          {onFront('photos') && <SecPhotos {...sectionProps} />}
        </div>
      );

      // ── MAGAZINE ─────────────────────────────────────────────────────────
      case 'modern': return (
        <div id="bulletin-front" style={{ ...baseStyle, overflow: 'hidden' }}>
          {onFront('cover') && (
            <div style={{ position: 'relative', height: '90mm', background: acc, overflow: 'hidden' }}>
              <CoverPhotoUpload doc={doc} update={update} />
              {doc.coverPhotoUrl && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.75))' }} />}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 14px', color: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <LogoUpload doc={doc} update={update} style={{ height: '28px', filter: 'brightness(0) invert(1)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.9 }}><E value={doc.churchName} onChange={v => update('churchName', v)} className="text-white" /></span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: 900, lineHeight: 1.2 }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} className="text-white" /></div>
                <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '3px' }}>
                  <E value={doc.preacher} onChange={v => update('preacher', v)} className="text-white/80" /> · <E value={doc.scripture} onChange={v => update('scripture', v)} className="text-white/80" />
                </div>
              </div>
              <div style={{ position: 'absolute', top: '10px', right: '10px', textAlign: 'right', color: 'white', opacity: 0.85 }}>
                <div style={{ fontSize: '10px' }}><E value={doc.date} onChange={v => update('date', v)} className="text-white" /></div>
                <div style={{ fontSize: '10px' }}><E value={doc.meetingTime} onChange={v => update('meetingTime', v)} className="text-white" /></div>
              </div>
            </div>
          )}
          <div style={{ padding: pad }}>
            {onFront('orderOfWorship') && <SecOrder {...sectionProps} />}
            {onFront('schedule') && <SecSchedule {...sectionProps} />}
            {onFront('announcements') && <SecAnnouncements {...sectionProps} />}
            {onFront('prayerStats') && <SecPrayer {...sectionProps} />}
            {onFront('spiritualGrowth') && <SecDevotional {...sectionProps} />}
            {onFront('photos') && <SecPhotos {...sectionProps} />}
          </div>
        </div>
      );

      // ── ELEGANT two-column ────────────────────────────────────────────────
      case 'elegant': return (
        <div id="bulletin-front" style={{ ...baseStyle }}>
          {onFront('cover') && (
            <div style={{ background: `linear-gradient(135deg, ${acc} 0%, ${acc}cc 100%)`, padding: '12px 14px', color: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LogoUpload doc={doc} update={update} style={{ height: '36px', filter: 'brightness(0) invert(1)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: 900 }}><E value={doc.churchName} onChange={v => update('churchName', v)} className="text-white" /></div>
                <div style={{ fontSize: '9px', opacity: 0.8, letterSpacing: '0.1em' }}><E value={doc.date} onChange={v => update('date', v)} className="text-white" /> · <E value={doc.meetingTime} onChange={v => update('meetingTime', v)} className="text-white" /></div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, maxWidth: '40%' }}>
                <div style={{ fontSize: '13px', fontWeight: 700 }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} className="text-white" /></div>
                <div style={{ fontSize: '9px', opacity: 0.8 }}><E value={doc.preacher} onChange={v => update('preacher', v)} className="text-white" /> · <E value={doc.scripture} onChange={v => update('scripture', v)} className="text-white" /></div>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '55% 45%', gap: '0', padding: '0' }}>
            <div style={{ padding: pad, borderRight: `1px solid ${acc}20` }}>
              {onFront('orderOfWorship') && <SecOrder {...sectionProps} />}
              {onFront('schedule') && <SecSchedule {...sectionProps} />}
              {onFront('photos') && <SecPhotos {...sectionProps} />}
            </div>
            <div style={{ padding: pad, background: '#fafafa' }}>
              {onFront('announcements') && <SecAnnouncements {...sectionProps} />}
              {onFront('prayerStats') && <SecPrayer {...sectionProps} />}
              {onFront('spiritualGrowth') && <SecDevotional {...sectionProps} />}
            </div>
          </div>
        </div>
      );

      // ── NEWSLETTER ───────────────────────────────────────────────────────
      case 'newsletter': return (
        <div id="bulletin-front" style={{ ...baseStyle, padding: pad }}>
          {onFront('cover') && (
            <div style={{ borderBottom: `3px solid ${acc}`, paddingBottom: '10px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: acc, marginBottom: '2px' }}>{isZh ? '教会周报' : 'WEEKLY BULLETIN'}</div>
                <div style={{ fontSize: '20px', fontWeight: 900, lineHeight: 1.1 }}><E value={doc.churchName} onChange={v => update('churchName', v)} /></div>
                <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '3px' }}><E value={doc.date} onChange={v => update('date', v)} /> · <E value={doc.meetingTime} onChange={v => update('meetingTime', v)} /></div>
              </div>
              <div style={{ flexShrink: 0 }}><LogoUpload doc={doc} update={update} style={{ height: '44px' }} /></div>
            </div>
          )}
          {onFront('cover') && (
            <div style={{ background: acc, color: 'white', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px' }}>
              <div style={{ fontSize: '8px', opacity: 0.8, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '3px' }}>{isZh ? '本周信息' : 'THIS WEEK\'S MESSAGE'}</div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} className="text-white" /></div>
              <div style={{ fontSize: '10px', opacity: 0.85, marginTop: '2px' }}><E value={doc.preacher} onChange={v => update('preacher', v)} className="text-white" /> · <E value={doc.scripture} onChange={v => update('scripture', v)} className="text-white" /></div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              {onFront('orderOfWorship') && <SecOrder {...sectionProps} />}
              {onFront('prayerStats') && <SecPrayer {...sectionProps} />}
              {onFront('photos') && <SecPhotos {...sectionProps} />}
            </div>
            <div>
              {onFront('schedule') && <SecSchedule {...sectionProps} />}
              {onFront('announcements') && <SecAnnouncements {...sectionProps} />}
              {onFront('spiritualGrowth') && <SecDevotional {...sectionProps} />}
            </div>
          </div>
        </div>
      );

      // ── TRIFOLD landscape ─────────────────────────────────────────────────
      case 'trifold': return (
        <div id="bulletin-front" style={{ ...baseStyle, width: '297mm', height: '210mm', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
          {/* Panel 1 - Cover */}
          <div style={{ padding: '10mm', background: acc, color: 'white', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
            {doc.coverPhotoUrl && <img src={doc.coverPhotoUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }} />}
            <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <LogoUpload doc={doc} update={update} style={{ height: '36px', filter: 'brightness(0) invert(1)', marginBottom: '10px' }} />
                <div style={{ fontSize: '22px', fontWeight: 900, lineHeight: 1.1, marginBottom: '6px' }}><E value={doc.churchName} onChange={v => update('churchName', v)} className="text-white" /></div>
                <div style={{ fontSize: '10px', opacity: 0.8 }}><E value={doc.date} onChange={v => update('date', v)} className="text-white" /></div>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: '10px' }}>
                <div style={{ fontSize: '8px', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{isZh ? '本周信息' : "THIS WEEK'S MESSAGE"}</div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} className="text-white" /></div>
                <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}><E value={doc.preacher} onChange={v => update('preacher', v)} className="text-white" /></div>
                <div style={{ fontSize: '10px', opacity: 0.7 }}><E value={doc.scripture} onChange={v => update('scripture', v)} className="text-white" /></div>
              </div>
              <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '8px' }}>
                <E value={doc.meetingTime} onChange={v => update('meetingTime', v)} className="text-white" />
                {doc.address && <><br /><E value={doc.address} onChange={v => update('address', v)} className="text-white" /></>}
              </div>
            </div>
            <button onClick={() => { const ref = document.createElement('input'); ref.type='file'; ref.accept='image/*'; ref.onchange = (e: any) => { const f = e.target.files?.[0]; if(f){const r=new FileReader();r.onload=ev=>update('coverPhotoUrl',ev.target?.result as string);r.readAsDataURL(f);}};ref.click();}} className="print-hidden" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2, background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '4px', color: 'white', fontSize: '9px', padding: '2px 6px', cursor: 'pointer' }}>
              📷 {isZh ? '背景图' : 'BG Photo'}
            </button>
          </div>
          {/* Panel 2 - Order & Schedule */}
          <div style={{ padding: '10mm', borderLeft: `2px solid ${acc}20`, borderRight: `2px solid ${acc}20` }}>
            {on('orderOfWorship') && <SecOrder {...sectionProps} />}
            {on('schedule') && <SecSchedule {...sectionProps} />}
            {on('prayerStats') && <SecPrayer {...sectionProps} />}
          </div>
          {/* Panel 3 - Announcements */}
          <div style={{ padding: '10mm' }}>
            {on('announcements') && <SecAnnouncements {...sectionProps} />}
            {on('spiritualGrowth') && <SecDevotional {...sectionProps} />}
            {on('photos') && <SecPhotos {...sectionProps} />}
          </div>
        </div>
      );

      default: return null;
    }
  };

  // ── BACK PAGE renderer ─────────────────────────────────────────────────────
  const renderBackCanvas = () => {
    const baseStyle: React.CSSProperties = {
      width: w, height: h, overflow: 'hidden', background: 'white',
      boxShadow: '0 4px 40px rgba(0,0,0,0.12)',
      fontSize: '12px', lineHeight: '1.6',
      fontFamily: doc.fontFamily,
    };
    const fontFamily = doc.fontFamily;

    // ── Trifold back: 3 landscape panels ──────────────────────────────────────
    if (doc.template === 'trifold') {
      return (
        <div id="bulletin-back" style={{ ...baseStyle, width: '297mm', height: '210mm', overflow: 'hidden', fontFamily, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
          {/* Back cover panel */}
          <div style={{ padding: '10mm', background: `${acc}12`, borderRight: `2px solid ${acc}20`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '8px', fontWeight: 900, color: acc, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '6px' }}>{isZh ? '联系我们' : 'Contact Us'}</div>
              <div style={{ fontSize: '16px', fontWeight: 900, marginBottom: '8px' }}><E value={doc.churchName} onChange={v => update('churchName', v)} /></div>
              {doc.address && <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>📍 <E value={doc.address} onChange={v => update('address', v)} /></div>}
              {doc.phone && <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>📞 <E value={doc.phone} onChange={v => update('phone', v)} /></div>}
              {doc.website && <div style={{ fontSize: '10px', color: acc }}>🌐 <E value={doc.website} onChange={v => update('website', v)} /></div>}
            </div>
            {on('spiritualGrowth') && <SecDevotional {...sectionProps} />}
          </div>
          {/* Centre panel */}
          <div style={{ padding: '10mm', borderRight: `2px solid ${acc}20` }}>
            {on('announcements') && <SecAnnouncements {...sectionProps} />}
          </div>
          {/* Right panel */}
          <div style={{ padding: '10mm' }}>
            {on('prayerStats') && <SecPrayer {...sectionProps} />}
            {on('photos') && <SecPhotos {...sectionProps} />}
          </div>
        </div>
      );
    }

    // ── Portrait back: accent header + 2-col body + contact footer ────────────
    return (
      <div id="bulletin-back" style={{ ...baseStyle, fontFamily }}>
        {/* Header strip */}
        <div style={{ background: acc, padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'white', fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em' }}>
            <E value={doc.churchName} onChange={v => update('churchName', v)} className="text-white" />
          </span>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '9px' }}>
            <E value={doc.date} onChange={v => update('date', v)} className="text-white" />
          </span>
        </div>
        {/* Two-column content — shows all sections assigned to back page */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: pad, paddingBottom: '6px', gap: '12px' }}>
          <div style={{ borderRight: `1px solid ${acc}20`, paddingRight: '10px' }}>
            {onBack('orderOfWorship') && <SecOrder {...sectionProps} />}
            {onBack('schedule') && <SecSchedule {...sectionProps} />}
            {onBack('announcements') && <SecAnnouncements {...sectionProps} />}
            {onBack('spiritualGrowth') && <SecDevotional {...sectionProps} />}
          </div>
          <div>
            {onBack('prayerStats') && <SecPrayer {...sectionProps} />}
            {onBack('photos') && <SecPhotos {...sectionProps} />}
          </div>
        </div>
        {/* Contact footer */}
        {(doc.address || doc.phone || doc.website) && (
          <div style={{ margin: `0 ${pad}`, borderTop: `1px solid ${acc}25`, paddingTop: '6px', paddingBottom: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {doc.address && <span style={{ fontSize: '9px', color: '#9ca3af' }}>📍 <E value={doc.address} onChange={v => update('address', v)} /></span>}
            {doc.phone && <span style={{ fontSize: '9px', color: '#9ca3af' }}>📞 <E value={doc.phone} onChange={v => update('phone', v)} /></span>}
            {doc.website && <span style={{ fontSize: '9px', color: acc }}>🌐 <E value={doc.website} onChange={v => update('website', v)} /></span>}
          </div>
        )}
      </div>
    );
  };

  // ── FREE-DRAG CANVAS ────────────────────────────────────────────────────────
  const renderFreeDragCanvas = () => {
    const mmToPx = 3.7795275591;
    const wPx = Math.round((doc.pageSize === 'A4' || doc.pageSize === 'A4L' ? 210 : 148) * mmToPx);
    const hPx = Math.round((doc.pageSize === 'A4' || doc.pageSize === 'A4L' ? 297 : 210) * mmToPx);
    return (
      <div ref={canvasRef} id="bulletin-front" style={{
        width: wPx, height: hPx, background: 'white', position: 'relative', overflow: 'hidden',
        boxShadow: '0 4px 40px rgba(0,0,0,0.12)', fontFamily: doc.fontFamily, fontSize: '12px', lineHeight: '1.6',
      }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(37,99,235,0.04) 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,rgba(37,99,235,0.04) 20px)`, pointerEvents: 'none', zIndex: 1 }} />
        {doc.sections.cover && <DB id="cover" label={isZh ? '封面信息' : 'Cover'}>
          <div style={{ textAlign: 'center', borderBottom: `2px solid ${acc}`, paddingBottom: '8px', minWidth: '200px' }}>
            <div style={{ fontSize: '16px', fontWeight: 900 }}><E value={doc.churchName} onChange={v => update('churchName', v)} /></div>
            <div style={{ fontSize: '9px', color: '#9ca3af' }}><E value={doc.date} onChange={v => update('date', v)} /></div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: acc, marginTop: '4px' }}><E value={doc.sermonTitle} onChange={v => update('sermonTitle', v)} /></div>
            <div style={{ fontSize: '9px', color: '#6b7280' }}><E value={doc.preacher} onChange={v => update('preacher', v)} /> · <E value={doc.scripture} onChange={v => update('scripture', v)} /></div>
            <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px' }}><E value={doc.meetingTime} onChange={v => update('meetingTime', v)} /></div>
          </div>
        </DB>}
        {doc.sections.orderOfWorship && <DB id="orderOfWorship" label={isZh ? '崇拜程序' : 'Order of Worship'}><SecOrder {...sectionProps} /></DB>}
        {doc.sections.schedule && <DB id="schedule" label={isZh ? '时间表' : 'Schedule'}><SecSchedule {...sectionProps} /></DB>}
        {doc.sections.announcements && <DB id="announcements" label={isZh ? '教会公告' : 'Announcements'}><SecAnnouncements {...sectionProps} /></DB>}
        {doc.sections.prayerStats && <DB id="prayerStats" label={isZh ? '报告与代祷' : 'Prayer & Stats'}><SecPrayer {...sectionProps} /></DB>}
        {doc.sections.spiritualGrowth && <DB id="spiritualGrowth" label={isZh ? '灵修资源' : 'Devotional'}><SecDevotional {...sectionProps} /></DB>}
        {doc.sections.photos && <DB id="photos" label={isZh ? '照片' : 'Photos'}><SecPhotos {...sectionProps} /></DB>}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-gray-50 print:block print:h-auto print:bg-white">
      {/* ── SIDEBAR ── */}
      <div className="w-64 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col print:hidden" style={{ boxShadow: '2px 0 8px rgba(0,0,0,0.04)' }}>
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-serif font-black text-xl">{isZh ? '每周周报' : 'Weekly Bulletin'}</h2>
          <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">BULLETIN EDITOR</p>
        </div>

        <div className="flex border-b border-gray-100 text-[10px] font-black uppercase tracking-widest">
          {(['sections', 'templates', 'style'] as const).map(p => (
            <button key={p} onClick={() => setPanel(p)} className={`flex-1 py-2.5 transition-colors text-[9px] ${panel === p ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-50'}`}>
              {p === 'sections' ? (isZh ? '栏目' : 'Sections') : p === 'templates' ? (isZh ? '模板' : 'Templates') : (isZh ? '样式' : 'Style')}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {panel === 'sections' && (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 px-1 pb-1">
                {isZh ? '点击开关 · 箭头可移至正/背面' : 'Toggle on/off · Arrow = move front/back'}
              </p>
              {SECTION_DEFS.map(s => {
                const isOn = doc.sections[s.key];
                const page = doc.sectionPages?.[s.key] || 'front';
                return (
                  <div key={s.key} className={`flex items-center gap-1 rounded-2xl overflow-hidden border transition-all ${isOn ? 'border-transparent' : 'border-gray-100'}`}
                    style={isOn ? { background: doc.accentColor + '15' } : {}}>
                    {/* Main toggle */}
                    <button onClick={() => toggleSection(s.key)}
                      className={`flex-1 flex items-center gap-2.5 p-3 text-left transition-all ${isOn ? 'text-gray-800' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                      <span className="material-symbols-outlined text-[17px]" style={isOn ? { color: doc.accentColor } : {}}>{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate">{isZh ? s.zh : s.en}</p>
                        <p className="text-[9px] truncate text-gray-400">{isZh ? (page === 'front' ? '📄 正面' : '📄 背面') : (page === 'front' ? '📄 Front' : '📄 Back')}</p>
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOn ? '' : 'bg-gray-200'}`} style={isOn ? { background: doc.accentColor } : {}} />
                    </button>
                    {/* Move to front/back button */}
                    {isOn && (
                      <button
                        onClick={() => toggleSectionPage(s.key)}
                        title={page === 'front' ? (isZh ? '移到背面' : 'Move to Back') : (isZh ? '移到正面' : 'Move to Front')}
                        className="px-2 py-3 text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-all flex-shrink-0 h-full flex items-center"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {page === 'front' ? 'arrow_forward' : 'arrow_back'}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {panel === 'templates' && (
            <>
              <div className="mb-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">{isZh ? '纸张大小' : 'Page Size'}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: 'A5',  zh: 'A5 竖', en: 'A5 Portrait' },
                    { id: 'A4',  zh: 'A4 竖', en: 'A4 Portrait' },
                    { id: 'A5L', zh: 'A5 横', en: 'A5 Landscape' },
                    { id: 'A4L', zh: 'A4 横', en: 'A4 Landscape' },
                  ] as { id: PageSize; zh: string; en: string }[]).map(sz => (
                    <button key={sz.id} onClick={() => update('pageSize', sz.id)}
                      className={`py-2 rounded-xl text-[11px] font-bold transition-all ${doc.pageSize === sz.id ? 'text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                      style={doc.pageSize === sz.id ? { background: doc.accentColor } : {}}>
                      {isZh ? sz.zh : sz.en}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1 mt-2">{isZh ? '模板风格' : 'Layout'}</p>
              {TEMPLATES.map(t => (
                <button key={t.id} onClick={() => update('template', t.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all ${doc.template === t.id ? 'text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                  style={doc.template === t.id ? { background: doc.accentColor } : {}}>
                  <span className="material-symbols-outlined text-[17px]">{t.icon}</span>
                  <div>
                    <p className="text-[11px] font-bold">{isZh ? t.name : t.nameEn}</p>
                    <p className={`text-[9px] ${doc.template === t.id ? 'text-white/60' : 'text-gray-400'}`}>{t.desc}</p>
                  </div>
                  {doc.template === t.id && <span className="material-symbols-outlined text-[14px] ml-auto">check</span>}
                </button>
              ))}

              {/* ── Saved custom templates ── */}
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                    {isZh ? '我的模板' : 'My Templates'}
                  </p>
                  <button onClick={addTemplate}
                    className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg transition-colors text-white"
                    style={{ background: doc.accentColor }}
                    title={isZh ? '保存当前排版为新模板' : 'Save current layout as template'}>
                    <span className="material-symbols-outlined text-[12px]">add</span>
                    {isZh ? '保存当前' : 'Save current'}
                  </button>
                </div>

                {savedTemplates.length === 0 && (
                  <p className="text-[10px] text-gray-300 text-center py-3 bg-gray-50 rounded-xl">
                    {isZh ? '点击 + 保存当前排版' : 'Click + to save layout'}
                  </p>
                )}

                {savedTemplates.map(tpl => (
                  <div key={tpl.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group mb-1.5">
                    <span className="material-symbols-outlined text-[15px] text-gray-300 flex-shrink-0">bookmark</span>

                    {namingId === tpl.id ? (
                      <input
                        autoFocus
                        value={nameInput}
                        onChange={e => setNameInput(e.target.value)}
                        onBlur={() => commitRename(tpl.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(tpl.id); if (e.key === 'Escape') setNamingId(null); }}
                        className="flex-1 text-[11px] font-bold bg-white border border-blue-300 rounded px-1.5 py-0.5 outline-none"
                      />
                    ) : (
                      <button onClick={() => loadTemplate(tpl)} className="flex-1 text-left min-w-0">
                        <p className="text-[11px] font-bold text-gray-700 truncate">{tpl.name}</p>
                        <p className="text-[9px] text-gray-400">{tpl.createdAt}</p>
                      </button>
                    )}

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={() => { setNamingId(tpl.id); setNameInput(tpl.name); }}
                        className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-blue-100 hover:text-blue-600 flex items-center justify-center transition-colors"
                        title={isZh ? '重命名' : 'Rename'}>
                        <span className="material-symbols-outlined text-[11px]">edit</span>
                      </button>
                      <button onClick={() => deleteTemplate(tpl.id)}
                        className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-colors"
                        title={isZh ? '删除' : 'Delete'}>
                        <span className="material-symbols-outlined text-[11px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'style' && (
            <div className="space-y-5">
              {/* ── Font ── */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">{isZh ? '字体风格' : 'Font Style'}</p>
                <div className="grid grid-cols-2 gap-2">
                  {FONTS.map(f => (
                    <button key={f.value} onClick={() => update('fontFamily', f.value)}
                      className={`p-3 rounded-2xl text-left transition-all border ${doc.fontFamily === f.value ? 'border-transparent text-white' : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100'}`}
                      style={doc.fontFamily === f.value ? { background: doc.accentColor } : {}}>
                      <span style={{ fontFamily: f.value, fontSize: '18px', lineHeight: 1, display: 'block', marginBottom: '3px', fontWeight: 700 }}>{f.preview}</span>
                      <span className="text-[9px] font-bold">{isZh ? f.labelZh : f.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* ── Accent Color ── */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">{isZh ? '主题色' : 'Accent Color'}</p>
                {/* Color swatches in 2 rows of 4 */}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {ACCENT_COLORS.map(c => (
                    <button key={c} onClick={() => update('accentColor', c)}
                      className="relative h-10 rounded-xl transition-all hover:scale-105 active:scale-95"
                      style={{ background: c, outline: doc.accentColor === c ? `3px solid ${c}` : 'none', outlineOffset: '2px' }}>
                      {doc.accentColor === c && (
                        <span className="absolute inset-0 flex items-center justify-center text-white text-[13px]">✓</span>
                      )}
                    </button>
                  ))}
                </div>
                {/* Custom color row */}
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                  <input type="color" value={doc.accentColor} onChange={e => update('accentColor', e.target.value)}
                    className="h-8 w-8 rounded-lg cursor-pointer border-0 bg-transparent p-0" />
                  <div className="flex-1">
                    <p className="text-[9px] font-bold text-gray-500">{isZh ? '自定义颜色' : 'Custom Color'}</p>
                    <p className="text-[9px] font-mono text-gray-400">{doc.accentColor.toUpperCase()}</p>
                  </div>
                  {/* Current color preview pill */}
                  <div className="w-16 h-5 rounded-full" style={{ background: doc.accentColor }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-100 space-y-2">
          <button onClick={() => scanRef.current?.click()} disabled={isProcessing}
            className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest bg-gray-50 rounded-xl text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            <span className="material-symbols-outlined text-[14px]">{isProcessing ? 'hourglass_empty' : 'document_scanner'}</span>
            {isProcessing ? (isZh ? 'AI识别中...' : 'Scanning...') : (isZh ? 'AI扫描旧周报' : 'AI Scan')}
          </button>
          <button onClick={saveDoc}
            className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest bg-gray-50 rounded-xl text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[14px]">{savedMsg ? 'check_circle' : 'save'}</span>
            {savedMsg || (isZh ? '保存模板' : 'Save Template')}
          </button>
          <button onClick={handlePrint}
            className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-white rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg"
            style={{ background: doc.accentColor, boxShadow: `0 4px 12px ${doc.accentColor}40` }}>
            <span className="material-symbols-outlined text-[14px]">print</span>
            {isZh ? '打印周报' : 'Print Bulletin'}
          </button>
        </div>
      </div>

      {/* ── CANVAS AREA ── */}
      <div className="flex-1 overflow-auto flex flex-col print:p-0 print:block">

        {/* AI Import Banner */}
        <div className="print:hidden px-6 py-4 bg-gradient-to-r from-violet-50 to-blue-50 border-b border-violet-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-violet-600 text-[20px]">auto_awesome</span>
            </div>
            <div>
              <p className="text-sm font-bold text-violet-900">{isZh ? '📄 AI 复刻你的旧周报' : '📄 AI Replicate Your Bulletin'}</p>
              <p className="text-[11px] text-violet-500">{isZh ? '上传图片或 PDF，AI 自动提取内容并生成模版' : 'Upload image or PDF — AI extracts and builds your template'}</p>
            </div>
          </div>
          <button
            onClick={() => scanRef.current?.click()}
            disabled={isProcessing}
            className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-2xl text-white text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg"
            style={{ background: isProcessing ? '#a78bfa' : 'linear-gradient(135deg, #7c3aed, #2563eb)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}
          >
            <span className="material-symbols-outlined text-[16px]">{isProcessing ? 'hourglass_empty' : 'upload_file'}</span>
            {isProcessing ? (isZh ? 'AI 识别中...' : 'Scanning...') : (isZh ? '上传旧周报' : 'Upload Bulletin')}
          </button>
        </div>

        <div className="flex items-center justify-between px-6 py-2 bg-white border-b border-gray-100 print:hidden sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-gray-400">💡 {isZh ? '点击任意文字编辑 · 悬停行显示 × 删除' : 'Click to edit · Hover row to see × delete'}</p>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-gray-200 text-gray-400">
              {doc.template === 'trifold' ? (isZh ? 'A5 横版 297×210mm' : 'A5 Landscape 297×210mm')
                : doc.pageSize === 'A5'  ? (isZh ? 'A5 竖版 148×210mm' : 'A5 Portrait 148×210mm')
                : doc.pageSize === 'A4'  ? (isZh ? 'A4 竖版 210×297mm' : 'A4 Portrait 210×297mm')
                : doc.pageSize === 'A5L' ? (isZh ? 'A5 横版 210×148mm' : 'A5 Landscape 210×148mm')
                :                          (isZh ? 'A4 横版 297×210mm' : 'A4 Landscape 297×210mm')}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Zoom controls */}
            <div className="flex items-center gap-2">
              {/* Free drag toggle */}
              <button
                onClick={toggleFreeDrag}
                title={isZh ? '自由拖动区块' : 'Free drag blocks'}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black transition-all border ${freeDrag ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'}`}
              >
                <span className="material-symbols-outlined text-[14px]">open_with</span>
                {isZh ? '自由排版' : 'Free Layout'}
              </button>
              {freeDrag && (
                <button onClick={resetDragPositions} className="text-[10px] text-orange-500 hover:text-orange-700 border border-orange-200 rounded px-2 py-0.5 transition-colors">
                  {isZh ? '重置位置' : 'Reset Pos'}
                </button>
              )}
              <div className="w-px h-4 bg-gray-200 mx-1" />
              <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(1)))} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold transition-colors">−</button>
              <span className="text-[11px] font-mono font-bold text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(1)))} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold transition-colors">＋</button>
              <button onClick={() => setZoom(0.5)} className="text-[10px] text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-0.5 transition-colors">{isZh ? '重置' : 'Reset'}</button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-8 flex justify-center bg-gray-100 print:p-0 print:bg-white print:block" style={{ alignItems: 'flex-start' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: freeDrag ? 'none' : 'transform 0.15s ease' }} className="print:!transform-none">
            {freeDrag ? (
              /* Free layout: single draggable canvas */
              <div>
                <div style={{ textAlign: 'center', marginBottom: '8px', fontSize: '10px', fontWeight: 900, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  ✦ {isZh ? '自由排版模式 — 拖动区块到任意位置' : 'Free Layout — drag blocks anywhere'}
                </div>
                {renderFreeDragCanvas()}
              </div>
            ) : (
              /* Normal template layout */
              <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '8px', fontSize: '10px', fontWeight: 900, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {isZh ? '📄 正面' : '📄 Front'}
                  </div>
                  {renderCanvas()}
                </div>
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '8px', fontSize: '10px', fontWeight: 900, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {isZh ? '📄 背面' : '📄 Back'}
                  </div>
                  {renderBackCanvas()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={scanRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleScan} />
    </div>
  );
}
