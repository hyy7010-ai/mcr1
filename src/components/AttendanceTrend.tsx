import { useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * 主日聚会人数走势 —— 52 周折线。
 *
 * 手写 SVG 而不是引 recharts：这里只要一条平滑曲线 + 点击选点，
 * 不需要坐标轴、图例、tooltip。recharts 虽然已在依赖里，但从未被引用过，
 * 一旦 import 就会给这个 chunk 多加一百多 KB，为一条 sparkline 不值得。
 */
export default function AttendanceTrend({
  points,
}: {
  points: { date: string; headcount: number }[];
}) {
  const { isZh } = useLanguage();
  // 只取最近 52 周，按时间正序（第 1 周最早）
  const data = useMemo(
    () => points.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-52),
    [points],
  );
  const [sel, setSel] = useState<number | null>(null);
  const active = sel ?? data.length - 1;

  if (data.length < 2) return null;

  const W = 560, H = 120, PAD = 6;
  const max = Math.max(...data.map(d => d.headcount));
  const min = Math.min(...data.map(d => d.headcount));
  const span = Math.max(1, max - min);
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);

  // Catmull-Rom → 三次贝塞尔。控制点公式：
  //   c1 = p1 + (p2 - p0) / 6 ，c2 = p2 - (p3 - p1) / 6
  // 上一版把索引搞混了，画出来是锯齿。
  const pts = data.map((d, i) => ({ x: x(i), y: y(d.headcount) }));
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const path = pts.reduce((acc, p, i) => {
    if (i === 0) return `M${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    const p0 = at(i - 2), p1 = at(i - 1), p2 = p, p3 = at(i + 1);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    return `${acc} C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }, '');

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    setSel(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
  };

  return (
    <section className="rounded-[32px] bg-surface-container border border-outline-variant/40 p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-serif font-black text-[24px] leading-tight text-on-surface">
            <span className="material-symbols-outlined text-[24px]">trending_up</span>
            {isZh ? '主日聚会人数走势' : 'Sunday Attendance Trend'}
          </h3>
          <p className="mt-1 text-[13px] text-on-surface/70">
            {isZh ? `${data.length} 周年度出勤数据` : `${data.length} weeks of attendance`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-outline whitespace-nowrap">
            {isZh ? '当前选中' : 'Selected week'}
          </p>
          <p className="mt-1 text-[15px] text-on-surface whitespace-nowrap">
            {isZh ? `第 ${active + 1} 周: ` : `Week ${active + 1}: `}
            <b className="font-serif font-black text-[26px]">{data[active].headcount}</b>
            {isZh ? ' 人' : ''}
          </p>
          <p className="text-[11px] text-outline">{data[active].date}</p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-5 w-full h-[120px] cursor-pointer touch-none"
        role="slider"
        tabIndex={0}
        aria-label={isZh ? '主日人数走势，用左右方向键切换周次' : 'Attendance trend, use arrow keys'}
        aria-valuemin={1}
        aria-valuemax={data.length}
        aria-valuenow={active + 1}
        aria-valuetext={`${data[active].date}: ${data[active].headcount}`}
        onClick={e => pick(e.clientX, e.currentTarget)}
        onPointerMove={e => e.buttons === 1 && pick(e.clientX, e.currentTarget)}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); setSel(Math.max(0, active - 1)); }
          if (e.key === 'ArrowRight') { e.preventDefault(); setSel(Math.min(data.length - 1, active + 1)); }
        }}
      >
        <defs>
          <linearGradient id="attn-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C8C7C" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#7C8C7C" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 上下参考线 */}
        <line x1={PAD} x2={W - PAD} y1={y(max)} y2={y(max)} stroke="#D1CAC3" strokeWidth="1" strokeDasharray="3 4" />
        <line x1={PAD} x2={W - PAD} y1={y(min)} y2={y(min)} stroke="#D1CAC3" strokeWidth="1" strokeDasharray="3 4" />

        <path d={`${path} L${x(data.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`} fill="url(#attn-fill)" />
        <path d={path} fill="none" stroke="#5F7061" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* 选中点 */}
        <line x1={x(active)} x2={x(active)} y1={y(data[active].headcount)} y2={H - PAD} stroke="#5F7061" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
        <circle cx={x(active)} cy={y(data[active].headcount)} r="5" fill="#5F7061" stroke="#fff" strokeWidth="2" />
      </svg>

      <p className="mt-3 text-center text-[12px] text-outline">
        💡 {isZh
          ? `点击折线图的不同位置可查看全年 1–${data.length} 周的具体人数走势`
          : `Click anywhere on the line to inspect weeks 1–${data.length}`}
      </p>
    </section>
  );
}
