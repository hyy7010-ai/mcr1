import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { lifeService, LifeRow } from '../services/lifeService';

/* ──────────────────────────────────────────────────────────────────────────
   个人中心 · 属灵成长足迹（打卡统计 / 徽章 / 我的代祷 / 我的课程）
   ────────────────────────────────────────────────────────────────────────── */

interface Checkin { date: string; type: 'read' | 'pray' | 'devotion' | 'sunday'; user_id: string }
interface Enroll  { course_id: string; user_id: string; name: string }

/** 徽章按累计次数解锁 — 门槛写在一处，方便牧者调整。 */
const BADGES: { key: string; zh: string; en: string; icon: string; need: number; of: Checkin['type'] }[] = [
  { key: 'seed',    zh: '初结果子', en: 'First Fruits',   icon: 'potted_plant',      need: 7,   of: 'read' },
  { key: 'lamp',    zh: '灯上的光', en: 'Lamp to My Feet', icon: 'wb_incandescent',  need: 30,  of: 'read' },
  { key: 'tree',    zh: '溪水旁的树', en: 'Tree by Water', icon: 'park',              need: 100, of: 'read' },
  { key: 'incense', zh: '常常祷告', en: 'Faithful Prayer', icon: 'local_fire_department', need: 30, of: 'pray' },
  { key: 'house',   zh: '主日不缺席', en: 'Never Absent',  icon: 'church',            need: 12,  of: 'sunday' },
];

export default function SpiritualFootprint() {
  const { isZh } = useLanguage();
  const { profile, church, user } = useAuth();
  const churchId = getActiveChurchId(profile, church) || '';
  const me = profile?.id || user?.id || 'me';
  const myEmail = user?.email || '';

  const [checkins, setCheckins] = useState<LifeRow<Checkin>[]>([]);
  const [enrolls, setEnrolls] = useState<LifeRow<Enroll>[]>([]);
  const [courses, setCourses] = useState<LifeRow<any>[]>([]);
  const [myPrayers, setMyPrayers] = useState<any[]>([]);

  useEffect(() => {
    if (!churchId) return;
    lifeService.list<Checkin>(churchId, 'checkin').then(r => setCheckins(r.filter(x => x.data?.user_id === me)));
    lifeService.list<Enroll>(churchId, 'enroll').then(r => setEnrolls(r.filter(x => x.data?.user_id === me)));
    lifeService.list(churchId, 'course').then(setCourses);
    supabase.from('church_prayers').select('*').eq('church_id', churchId).eq('author_email', myEmail)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMyPrayers(data || []));
  }, [churchId, me, myEmail]);

  const count = (type: Checkin['type']) => checkins.filter(c => c.data.type === type).length;

  const prayedForOthers = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem(`prayed_by_me_${churchId || 'demo'}`) || '[]') as string[]).length; }
    catch { return 0; }
  }, [churchId]);

  const stats = [
    { label: isZh ? '读经打卡' : 'Scripture', value: count('read') },
    { label: isZh ? '祷告次数' : 'Prayer',    value: count('pray') },
    { label: isZh ? '灵修天数' : 'Devotion',  value: count('devotion') },
    { label: isZh ? '主日签到' : 'Sundays',   value: count('sunday') },
  ];

  const myCourses = enrolls
    .map(e => courses.find(c => c.id === e.data.course_id))
    .filter(Boolean) as LifeRow<any>[];

  return (
    <section className="mb-8 flex flex-col gap-6">
      {/* 打卡统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className="rounded-[24px] bg-surface-container border border-outline-variant/40 px-4 py-5 text-center">
            <p className="font-serif font-black text-[30px] leading-none text-on-surface">{s.value}</p>
            <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-outline whitespace-nowrap">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 属灵徽章 */}
      <div className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6">
        <h3 className="font-serif font-black text-[20px] leading-tight text-on-surface">
          {isZh ? '属灵徽章' : 'Growth Badges'}
        </h3>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {BADGES.map(b => {
            const have = count(b.of);
            const earned = have >= b.need;
            return (
              <div key={b.key}
                className={`rounded-3xl px-3 py-5 flex flex-col items-center gap-2 border transition-all ${
                  earned ? 'bg-black text-white border-black' : 'bg-surface-container-low border-outline-variant/50'}`}>
                <span className={`material-symbols-outlined text-[26px] ${earned ? 'text-white' : 'text-outline/50'}`}
                  style={earned ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                  {b.icon}
                </span>
                <span className={`text-[12px] font-bold text-center whitespace-nowrap ${earned ? 'text-white' : 'text-on-surface/60'}`}>
                  {isZh ? b.zh : b.en}
                </span>
                <span className={`text-[10px] whitespace-nowrap ${earned ? 'text-white/60' : 'text-outline'}`}>
                  {Math.min(have, b.need)} / {b.need}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 我的代祷 */}
      <div className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif font-black text-[20px] leading-tight text-on-surface">
            {isZh ? '我的代祷' : 'My Prayers'}
          </h3>
          <p className="text-[12px] text-outline whitespace-nowrap">
            {isZh ? `已为他人代祷 ${prayedForOthers} 次` : `Prayed for others ${prayedForOthers}×`}
          </p>
        </div>
        {myPrayers.length === 0 ? (
          <p className="mt-4 text-[13px] text-outline">{isZh ? '你还没有发布代祷事项。' : 'You haven’t posted a prayer yet.'}</p>
        ) : (
          <ul className="mt-4 divide-y divide-outline-variant/40">
            {myPrayers.slice(0, 8).map(p => (
              <li key={p.id} className="py-3 flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-outline mt-0.5 shrink-0">volunteer_activism</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-on-surface line-clamp-2">{p.content}</p>
                  <p className="text-[11px] text-outline mt-0.5">
                    {p.status} · {isZh ? '代祷' : 'prayed'} {p.prayed_count || 0}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 我的课程 */}
      <div className="rounded-[28px] bg-surface-container border border-outline-variant/40 p-6">
        <h3 className="font-serif font-black text-[20px] leading-tight text-on-surface">
          {isZh ? '我报名的课程' : 'My Courses'}
        </h3>
        {myCourses.length === 0 ? (
          <p className="mt-4 text-[13px] text-outline">{isZh ? '还没有报名任何培训。' : 'No enrolments yet.'}</p>
        ) : (
          <ul className="mt-4 divide-y divide-outline-variant/40">
            {myCourses.map(c => (
              <li key={c.id} className="py-3">
                <p className="text-[15px] font-bold text-on-surface">{c.data.title}</p>
                <p className="text-[12px] text-outline">
                  {[c.data.speaker, c.data.time, c.data.place].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
