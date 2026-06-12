import React, { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, PageOrientation, Packer, BorderStyle } from 'docx';

interface Song {
  id: string;
  title: string;
  englishTitle?: string;
  lyrics: string;
  englishLyrics?: string;
}

interface Props {
  songs: Song[];
  allSongs?: Song[];
  onClose: () => void;
}

type Layout = 'per-song-portrait' | 'per-song-landscape' | 'all-portrait';

const A4_W_PX = 794;
const A4_H_PX = 1123;
const A4_W_MM = 210;
const A4_H_MM = 297;
const MARGIN_PX = 56;

function splitSongIntoPages(
  song: Song,
  showEnglish: boolean,
  fontSize: number,
  columns: number,
  pageH: number,
  headerH: number,
  footerH: number,
): { lines: string[]; engLines: string[]; isFirst: boolean }[] {
  const usable = pageH - MARGIN_PX * 2 - footerH - headerH;
  const lineH = fontSize * 1.7 + (showEnglish ? (fontSize - 2) * 1.5 + 4 : 5);
  const titleH = fontSize + 6 + 24;
  const maxLines = Math.floor((usable - titleH) / lineH) * columns;

  const lines = (song.lyrics || '').split('\n');
  const engLines = (song.englishLyrics || '').split('\n');

  if (lines.length <= maxLines) return [{ lines, engLines, isFirst: true }];

  const chunks: { lines: string[]; engLines: string[]; isFirst: boolean }[] = [];
  let i = 0; let first = true;
  while (i < lines.length) {
    chunks.push({ lines: lines.slice(i, i + maxLines), engLines: engLines.slice(i, i + maxLines), isFirst: first });
    first = false; i += maxLines;
  }
  return chunks;
}

export default function LyricsSheetModal({ songs: initialSongs, allSongs = [], onClose }: Props) {
  const [layout, setLayout] = useState<Layout>('per-song-portrait');
  const [columns, setColumns] = useState(1);
  const [fontSize, setFontSize] = useState(12);
  const [showEnglish, setShowEnglish] = useState(true);
  const [showHeader, setShowHeader] = useState(true);
  const [sheetTitle, setSheetTitle] = useState('');
  const [selectedSongs, setSelectedSongs] = useState<Song[]>(initialSongs);
  const [isExporting, setIsExporting] = useState(false);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  const isLandscape = layout === 'per-song-landscape';
  const allOnOne = layout === 'all-portrait';
  const pageW = isLandscape ? A4_H_PX : A4_W_PX;
  const pageH = isLandscape ? A4_W_PX : A4_H_PX;
  const previewScale = isLandscape ? 0.41 : 0.43;

  const headerH = showHeader ? 54 : 0;
  const footerH = 30;

  // Song picker: show all allSongs, with search, checkboxes
  const pickerFiltered = allSongs.filter(s =>
    s.title.toLowerCase().includes(pickerSearch.toLowerCase()) ||
    (s.englishTitle || '').toLowerCase().includes(pickerSearch.toLowerCase())
  );

  const togglePickSong = (song: Song) => {
    const already = selectedSongs.find(s => s.id === song.id);
    if (already) {
      setSelectedSongs(prev => prev.filter(s => s.id !== song.id));
    } else {
      setSelectedSongs(prev => [...prev, song]);
    }
  };

  const removeSong = (id: string) => setSelectedSongs(prev => prev.filter(s => s.id !== id));
  const moveSong = (id: string, dir: -1 | 1) => {
    setSelectedSongs(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  // ── Build pages ───────────────────────────────────────────────────────────
  const buildPages = (): { items: { song: Song; lines: string[]; engLines: string[]; isFirst: boolean }[] }[] => {
    if (allOnOne) {
      // ALL songs on ONE single A4 page — user adjusts font size to fit
      const allItems = selectedSongs.map(song => ({
        song,
        lines: (song.lyrics || '').split('\n'),
        engLines: (song.englishLyrics || '').split('\n'),
        isFirst: true,
      }));
      return [{ items: allItems }];
    } else {
      const result: { items: { song: Song; lines: string[]; engLines: string[]; isFirst: boolean }[] }[] = [];
      for (const song of selectedSongs) {
        const chunks = splitSongIntoPages(song, showEnglish, fontSize, columns, pageH, headerH, footerH);
        chunks.forEach(c => result.push({ items: [{ song, ...c }] }));
      }
      return result;
    }
  };

  const pages = buildPages();

  // ── Render A4 page ────────────────────────────────────────────────────────
  const renderPageContent = (
    pageItems: { song: Song; lines: string[]; engLines: string[]; isFirst: boolean }[],
    pageNum: number,
    totalPages: number,
  ) => (
    <div style={{
      width: pageW, height: pageH, background: '#fff',
      boxSizing: 'border-box', padding: `${MARGIN_PX}px`,
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Georgia", "Times New Roman", serif',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Header */}
      {showHeader && (
        <div style={{
          borderBottom: '2px solid #111', paddingBottom: 10, marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0,
        }}>
          <div style={{ fontSize: sheetTitle ? 17 : 13, fontWeight: 800, letterSpacing: 0.5, color: '#111' }}>
            {sheetTitle || '敬拜歌词单'}
          </div>
          <div style={{ fontSize: 9, color: '#999', letterSpacing: 0.5 }}>
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      )}

      {/* Songs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {pageItems.map(({ song, lines, engLines, isFirst }, i) => (
          <div key={`${song.id}-${i}`} style={{ marginBottom: i < pageItems.length - 1 ? 14 : 0 }}>
            {isFirst ? (
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                marginBottom: 6, paddingBottom: 5,
                borderBottom: '1px solid #ddd', flexShrink: 0,
              }}>
                <span style={{ fontSize: fontSize + 3, fontWeight: 800, color: '#111' }}>{song.title}</span>
                {song.englishTitle && showEnglish && (
                  <span style={{ fontSize: fontSize - 1, color: '#aaa', fontStyle: 'italic' }}>{song.englishTitle}</span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: fontSize - 2, color: '#bbb', fontStyle: 'italic', marginBottom: 4 }}>
                {song.title} (续)
              </div>
            )}

            {/* Lyrics in columns */}
            <div style={{ columnCount: columns, columnGap: 28 }}>
              {lines.map((line, li) => (
                <div key={li} style={{ breakInside: 'avoid', marginBottom: (showEnglish && engLines[li]?.trim()) ? 1 : 3 }}>
                  <div style={{ fontSize, lineHeight: 1.7, color: line.trim() ? '#1a1a1a' : 'transparent' }}>
                    {line || '　'}
                  </div>
                  {showEnglish && engLines[li]?.trim() && (
                    <div style={{ fontSize: fontSize - 2, lineHeight: 1.5, color: '#888', fontStyle: 'italic', marginBottom: 2 }}>
                      {engLines[li]}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {allOnOne && i < pageItems.length - 1 && (
              <div style={{ borderBottom: '1px dashed #e0e0e0', marginTop: 10 }} />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid #eee', paddingTop: 5, marginTop: 'auto',
        display: 'flex', justifyContent: 'space-between',
        fontSize: 8, color: '#ccc', letterSpacing: 0.3, flexShrink: 0,
      }}>
        <span style={{ fontStyle: 'italic' }}>
          {pageItems.filter(p => p.isFirst).map(p => p.song.title).join(' · ')}
        </span>
        {totalPages > 1 && <span>{pageNum} / {totalPages}</span>}
      </div>
    </div>
  );

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    if (!previewRef.current) return;
    setIsExporting(true);
    try {
      const pageEls = previewRef.current.querySelectorAll<HTMLElement>('.lyric-a4-page');
      const pdf = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
      const pdfW = isLandscape ? A4_H_MM : A4_W_MM;
      const pdfH = isLandscape ? A4_W_MM : A4_H_MM;
      for (let i = 0; i < pageEls.length; i++) {
        if (i > 0) pdf.addPage([A4_W_MM, A4_H_MM], isLandscape ? 'landscape' : 'portrait');
        const el = pageEls[i];
        const prev = el.style.transform;
        el.style.transform = 'none';
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        el.style.transform = prev;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, pdfH);
      }
      pdf.save(`歌词单_${new Date().toISOString().split('T')[0]}.pdf`);
    } finally { setIsExporting(false); }
  }, [isLandscape, pages]);

  // ── Export Word ───────────────────────────────────────────────────────────
  const exportWord = useCallback(async () => {
    setIsExporting(true);
    try {
      const children: any[] = [];
      if (sheetTitle) children.push(new Paragraph({ text: sheetTitle, heading: HeadingLevel.TITLE }));
      selectedSongs.forEach((song, idx) => {
        if (idx > 0 && !allOnOne) children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
        children.push(new Paragraph({
          children: [new TextRun({ text: song.title, bold: true, size: (fontSize + 4) * 2 })],
          spacing: { after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        }));
        const lines = (song.lyrics || '').split('\n');
        const engLines = (song.englishLyrics || '').split('\n');
        lines.forEach((line, li) => {
          children.push(new Paragraph({ children: [new TextRun({ text: line, size: fontSize * 2 })], spacing: { after: showEnglish && engLines[li] ? 0 : 60 } }));
          if (showEnglish && engLines[li]) children.push(new Paragraph({ children: [new TextRun({ text: engLines[li], italics: true, size: (fontSize - 2) * 2, color: '888888' })], spacing: { after: 60 } }));
        });
        if (allOnOne && idx < selectedSongs.length - 1) children.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.DASHED, size: 4, color: 'DDDDDD' } }, spacing: { before: 120, after: 120 } }));
      });
      const doc = new Document({
        sections: [{ properties: { page: { size: { orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `歌词单_${new Date().toISOString().split('T')[0]}.docx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { setIsExporting(false); }
  }, [selectedSongs, isLandscape, allOnOne, fontSize, showEnglish, sheetTitle]);

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!previewRef.current) return;
    const pageEls = previewRef.current.querySelectorAll<HTMLElement>('.lyric-a4-page');
    let html = '';
    pageEls.forEach(el => { const clone = el.cloneNode(true) as HTMLElement; clone.style.transform = 'none'; clone.style.marginBottom = '0'; html += `<div class="page">${clone.outerHTML}</div>`; });
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html><head><title>歌词单</title><style>*{box-sizing:border-box;margin:0;padding:0}@page{size:${isLandscape ? 'A4 landscape' : 'A4 portrait'};margin:0}body{background:white}.page{page-break-after:always;width:100vw;height:100vh}.page:last-child{page-break-after:avoid}</style></head><body>${html}</body></html>`);
    w.document.close(); setTimeout(() => w.print(), 400);
  }, [isLandscape, pages]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="bg-white rounded-3xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden"
          style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.25)' }}
        >
          {/* ── Top Bar ── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <span className="material-symbols-outlined text-white text-[18px]">description</span>
              </div>
              <div>
                <h2 className="text-base font-black tracking-tight text-neutral-900">歌词单</h2>
                <p className="text-[10px] text-neutral-400 font-medium">{selectedSongs.length} 首歌 · 预览即所得</p>
              </div>
              <div className="h-7 w-px bg-neutral-100 mx-1" />
              <input
                value={sheetTitle} onChange={e => setSheetTitle(e.target.value)}
                placeholder="输入标题（可选）"
                className="text-sm font-medium bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-1.5 w-40 placeholder:text-neutral-300 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
              />
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-neutral-500 text-[16px]">close</span>
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* ── Left Sidebar ── */}
            <div className="w-56 shrink-0 border-r border-neutral-100 flex flex-col overflow-y-auto bg-neutral-50/50">
              <div className="p-4 space-y-5">

                {/* Layout */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-2.5">排版方式</p>
                  <div className="space-y-1.5">
                    {([
                      ['per-song-portrait', '每首一页·竖向', 'description'],
                      ['per-song-landscape', '每首一页·横向', 'crop_landscape'],
                      ['all-portrait', '所有歌词·竖向', 'article'],
                    ] as [Layout, string, string][]).map(([val, label, icon]) => (
                      <button key={val} onClick={() => setLayout(val)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-all text-left ${
                          layout === val ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' : 'bg-white text-neutral-500 hover:bg-neutral-100 border border-neutral-200'
                        }`}>
                        <span className="material-symbols-outlined text-[15px] shrink-0">{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Columns */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-2.5">分栏</p>
                  <div className="flex gap-1.5">
                    {[1, 2].map(col => (
                      <button key={col} onClick={() => setColumns(col)}
                        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-[10px] font-black transition-all ${
                          columns === col ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' : 'bg-white text-neutral-400 border border-neutral-200 hover:border-neutral-300'
                        }`}>
                        {/* Column icon */}
                        <div className={`flex gap-0.5 ${columns === col ? 'opacity-100' : 'opacity-50'}`}>
                          {Array.from({ length: col }).map((_, i) => (
                            <div key={i} className={`rounded-sm ${columns === col ? 'bg-white/70' : 'bg-neutral-400'}`}
                              style={{ width: col === 1 ? 16 : 10, height: 14 }} />
                          ))}
                        </div>
                        {col === 1 ? '单栏' : '双栏'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font size */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-2.5">字号 · {fontSize}PT</p>
                  <div className="bg-white border border-neutral-200 rounded-xl p-3">
                    <input type="range" min={9} max={18} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full accent-emerald-500" />
                    <div className="flex justify-between text-[9px] text-neutral-400 mt-1 font-medium"><span>小</span><span>大</span></div>
                  </div>
                </div>

                {/* Options */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-2.5">显示选项</p>
                  <div className="space-y-1.5">
                    {[
                      { active: showEnglish, toggle: () => setShowEnglish(!showEnglish), icon: 'translate', label: '显示英文歌词' },
                      { active: showHeader, toggle: () => setShowHeader(!showHeader), icon: 'title', label: '显示页眉' },
                    ].map(({ active, toggle, icon, label }) => (
                      <button key={label} onClick={toggle}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                          active ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-neutral-500 border border-neutral-200 hover:bg-neutral-50'
                        }`}>
                        <span className="material-symbols-outlined text-[14px]">{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Song list */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400">已选歌曲</p>
                    {allSongs.length > 0 && (
                      <button onClick={() => setShowSongPicker(!showSongPicker)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                          showSongPicker ? 'bg-emerald-500 text-white' : 'bg-white border border-neutral-200 text-neutral-500 hover:border-emerald-300 hover:text-emerald-600'
                        }`}>
                        <span className="material-symbols-outlined text-[12px]">{showSongPicker ? 'close' : 'add'}</span>
                        {showSongPicker ? '完成' : '添加歌曲'}
                      </button>
                    )}
                  </div>

                  {/* Song Picker */}
                  <AnimatePresence>
                    {showSongPicker && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mb-3"
                      >
                        <div className="bg-white border border-emerald-200 rounded-2xl shadow-lg shadow-emerald-500/10 overflow-hidden">
                          {/* Search box */}
                          <div className="px-3 pt-3 pb-2">
                            <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2">
                              <span className="material-symbols-outlined text-neutral-400 text-[14px]">search</span>
                              <input
                                value={pickerSearch}
                                onChange={e => setPickerSearch(e.target.value)}
                                placeholder="搜索歌曲..."
                                className="flex-1 text-[11px] bg-transparent outline-none font-medium text-neutral-700 placeholder:text-neutral-400"
                                autoFocus
                              />
                              {pickerSearch && (
                                <button onClick={() => setPickerSearch('')}>
                                  <span className="material-symbols-outlined text-neutral-400 text-[12px]">close</span>
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Song list with checkboxes */}
                          <div className="max-h-48 overflow-y-auto px-2 pb-2">
                            {pickerFiltered.length === 0 ? (
                              <p className="text-[10px] text-neutral-400 text-center py-3">没有找到歌曲</p>
                            ) : pickerFiltered.map(s => {
                              const isSelected = !!selectedSongs.find(ss => ss.id === s.id);
                              return (
                                <button key={s.id} onClick={() => togglePickSong(s)}
                                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                                    isSelected ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-neutral-50 text-neutral-700'
                                  }`}>
                                  <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                                    isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300'
                                  }`}>
                                    {isSelected && <span className="material-symbols-outlined text-white text-[10px]">check</span>}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-semibold truncate">{s.title}</div>
                                    {s.englishTitle && <div className="text-[9px] text-neutral-400 truncate">{s.englishTitle}</div>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {/* Summary */}
                          <div className="px-3 py-2 border-t border-neutral-100 text-[9px] text-neutral-400 font-medium">
                            已选 {selectedSongs.length} 首 · 共 {allSongs.length} 首
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Selected songs reorder list */}
                  <div className="space-y-1">
                    {selectedSongs.map((s, i) => (
                      <motion.div key={s.id} layout
                        className="flex items-center gap-2 group bg-white border border-neutral-100 rounded-xl px-2.5 py-2 hover:border-neutral-200 transition-all">
                        <span className="w-4 h-4 rounded-full bg-neutral-100 text-[8px] font-black flex items-center justify-center shrink-0 text-neutral-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-[11px] font-semibold text-neutral-700 truncate">{s.title}</span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button onClick={() => moveSong(s.id, -1)} disabled={i === 0}
                            className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-neutral-100 disabled:opacity-20">
                            <span className="material-symbols-outlined text-[11px] text-neutral-400">arrow_upward</span>
                          </button>
                          <button onClick={() => moveSong(s.id, 1)} disabled={i === selectedSongs.length - 1}
                            className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-neutral-100 disabled:opacity-20">
                            <span className="material-symbols-outlined text-[11px] text-neutral-400">arrow_downward</span>
                          </button>
                          <button onClick={() => removeSong(s.id)}
                            className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-red-50">
                            <span className="material-symbols-outlined text-[11px] text-red-400">close</span>
                          </button>
                        </div>
                      </motion.div>
                    ))}
                    {selectedSongs.length === 0 && (
                      <div className="text-center py-4 text-[10px] text-neutral-400">
                        点击「添加歌曲」选择歌曲
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Preview ── */}
            <div className="flex-1 overflow-auto bg-[#E8E8E8] p-8"
              style={{ backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
              <div ref={previewRef} className="flex flex-col items-center gap-10">
                {pages.map((page, pi) => (
                  <div key={pi} className="relative">
                    {pages.length > 1 && (
                      <div className="absolute -top-6 left-0 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                        第 {pi + 1} 页
                      </div>
                    )}
                    <div
                      className="lyric-a4-page"
                      style={{
                        width: pageW, height: pageH,
                        transform: `scale(${previewScale})`,
                        transformOrigin: 'top center',
                        marginBottom: `${-(pageH * (1 - previewScale)) + 32}px`,
                        boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
                        borderRadius: 2,
                      }}
                    >
                      {renderPageContent(page.items, pi + 1, pages.length)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Bottom Bar ── */}
          <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-neutral-100 shrink-0">
            <div className="text-[10px] text-neutral-400 font-medium">
              {pages.length} 页 · {selectedSongs.length} 首歌
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 transition-colors">取消</button>
              <button onClick={handlePrint}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-neutral-800 text-white hover:bg-neutral-700 transition-all shadow-lg shadow-neutral-800/20">
                <span className="material-symbols-outlined text-[15px]">print</span>打印
              </button>
              <button onClick={exportWord} disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50">
                <span className="material-symbols-outlined text-[15px]">description</span>下载 Word
              </button>
              <button onClick={exportPDF} disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50">
                {isExporting
                  ? <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
                  : <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>}
                下载 PDF
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
