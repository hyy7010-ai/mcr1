import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { resolveSlideColors, PPT_TEXT_SHADOW, PREVIEW_TEXT_SHADOW } from '../lib/pptTheme';

const DEFAULT_PPT_CATEGORIES = ['本周', '主日学', '敬拜', '讲道'];

interface PPTItem {
  id: string;
  name: string;
  type: 'weekly' | 'song' | 'sermon';
  date: string;
  size: string;
  songCount?: number;
  preacher?: string;
  title?: string;
}

const INITIAL_PPT_LIBRARY: PPTItem[] = [
  { id: 'p1', name: 'Ready_PPT_Sunday_Worship_2024-05-01', type: 'weekly', date: '2024-05-01', songCount: 4, size: '4.2MB' },
  { id: 'p2', name: 'Amazing_Grace_Standard', type: 'song', date: '2024-04-28', title: '奇异恩典', size: '1.1MB' },
  { id: 'p3', name: 'Sermon_Living_By_Faith', type: 'sermon', date: '2024-05-01', preacher: 'Ps. David', size: '2.8MB' },
  { id: 'p4', name: 'Ready_PPT_Youth_Night_2024-04-26', type: 'weekly', date: '2024-04-26', songCount: 3, size: '3.5MB' },
  { id: 'p5', name: 'How_Great_Is_Our_God_V2', type: 'song', date: '2024-04-20', title: '我神真伟大', size: '1.2MB' },
  { id: 'p6', name: 'Sermon_The_Power_of_Prayer', type: 'sermon', date: '2024-04-24', preacher: 'Ps. Sarah', size: '2.1MB' },
];

export default function ReadyPPT() {
  const { t, isZh } = useLanguage();
  const { mode } = useMode();
  const { profile, church, user } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const isManager = mode === 'Manager';
  // Church-specific localStorage key helper
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  const [search, setSearch] = useState('');
  const [library, setLibrary] = useState<any[]>([]);

  // ── Customizable categories (tabs), stored per church ───────────────────────
  const [categories, setCategories] = useState<string[]>(() => {
    try { const s = localStorage.getItem(`ppt_categories_${activeChurchId || 'demo'}`); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_PPT_CATEGORIES;
  });
  const [activeCategory, setActiveCategory] = useState<string>('__all__');
  const persistCategories = (cats: string[]) => {
    setCategories(cats);
    try { localStorage.setItem(`ppt_categories_${activeChurchId || 'demo'}`, JSON.stringify(cats)); } catch {}
  };
  const addCategory = () => {
    const name = window.prompt(isZh ? '新分类名称（例如：主日学、敬拜、讲道）' : 'New category name');
    const v = (name || '').trim();
    if (v && !categories.includes(v)) persistCategories([...categories, v]);
  };
  const removeCategory = (c: string) => {
    if (!window.confirm(isZh ? `删除分类「${c}」？（里面的文件会移到「未分类」）` : `Delete category "${c}"?`)) return;
    persistCategories(categories.filter(x => x !== c));
    if (activeCategory === c) setActiveCategory('__all__');
  };

  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState<string>('');

  // Reload library whenever the active church changes — fully isolated per church
  const reloadLibrary = React.useCallback(async () => {
    const allItems: any[] = [];

    // 0. Supabase-synced items (visible to ALL church members)
    if (activeChurchId && activeChurchId !== 'demo-church-id') {
      try {
        const { data } = await supabase.from('church_ppt_library').select('*').eq('church_id', activeChurchId).order('created_at', { ascending: false });
        (data || []).forEach((row: any) => allItems.push({
          id: row.id, name: row.name, type: row.file_url ? 'file' : 'song', category: row.category || '',
          date: (row.created_at || '').split('T')[0], size: row.file_size || '', fileUrl: row.file_url || null,
          songData: row.song_data ? (() => { try { return JSON.parse(row.song_data); } catch { return null; } })() : null,
        }));
      } catch (e) { console.error('Error loading church_ppt_library', e); }
    }

    // 1. Also merge localStorage items not yet in Supabase (local-only fallback)
    // Deduplicate by both id AND name to prevent duplicates when SQL-inserted items have different IDs
    try {
      const existingIds = new Set(allItems.map((a: any) => a.id));
      const existingNames = new Set(allItems.map((a: any) => (a.name || '').toLowerCase().trim()));
      const songPPTs = JSON.parse(localStorage.getItem(churchKey('ready_ppt_songs')) || '[]');
      songPPTs.forEach((item: any) => {
        const name = (item.name || item.songTitle || '').toLowerCase().trim();
        if (!existingIds.has(item.id) && !existingNames.has(name)) allItems.push({ ...item, category: item.category || '敬拜' });
      });
    } catch (e) { console.error('Error loading ready_ppt_songs', e); }

    try {
      const existingIds = new Set(allItems.map((a: any) => a.id));
      const existingNames = new Set(allItems.map((a: any) => (a.name || '').toLowerCase().trim()));
      const syncData = JSON.parse(localStorage.getItem(churchKey('ppt_library_sync')) || '[]');
      syncData.forEach((item: any) => {
        const name = (item.name || '').toLowerCase().trim();
        if (!existingIds.has(item.id) && !existingNames.has(name)) allItems.push({ ...item, category: item.category || '本周' });
      });
    } catch (e) { console.error('Error loading ppt_library_sync', e); }

    setLibrary(allItems);
  }, [activeChurchId]);

  React.useEffect(() => { reloadLibrary(); }, [reloadLibrary]);

  // ── Auto-migrate localStorage PPTs to Supabase (one-time, silent) ────────────
  React.useEffect(() => {
    if (!activeChurchId || activeChurchId === 'demo-church-id') return;
    const migrate = async () => {
      try {
        // Get all IDs already in Supabase
        const { data: existing } = await supabase
          .from('church_ppt_library').select('id').eq('church_id', activeChurchId);
        const existingIds = new Set((existing || []).map((r: any) => r.id));

        const rows: any[] = [];
        // Collect from ready_ppt_songs
        try {
          const local = JSON.parse(localStorage.getItem(churchKey('ready_ppt_songs')) || '[]');
          local.forEach((item: any) => {
            if (!existingIds.has(item.id)) rows.push({
              id: item.id, church_id: activeChurchId,
              name: item.songTitle || item.name || 'Song PPT',
              category: '敬拜', file_url: '', file_size: '~1MB',
              song_data: item.songData ? JSON.stringify(item.songData) : null,
              created_by: item.createdBy || '',
            });
          });
        } catch {}
        // Collect from ppt_library_sync
        try {
          const local = JSON.parse(localStorage.getItem(churchKey('ppt_library_sync')) || '[]');
          local.forEach((item: any) => {
            if (!existingIds.has(item.id) && !rows.find(r => r.id === item.id)) rows.push({
              id: item.id, church_id: activeChurchId,
              name: item.name || 'PPT',
              category: item.category || '本周', file_url: item.fileUrl || '', file_size: item.size || '',
              song_data: item.songData ? JSON.stringify(item.songData) : null,
              created_by: '',
            });
          });
        } catch {}

        if (rows.length > 0) {
          await supabase.from('church_ppt_library').upsert(rows, { onConflict: 'id' });
          reloadLibrary(); // refresh so others see it
        }
      } catch (e) { console.warn('PPT migration skipped:', e); }
    };
    migrate();
  }, [activeChurchId]);

  // ── Real file upload → Supabase Storage + DB row (synced) ───────────────────
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeChurchId) return;
    setIsUploading(false);
    setNoti(isZh ? '上传中…' : 'Uploading…');
    try {
      const id = crypto.randomUUID();
      const ext = (file.name.split('.').pop() || 'pptx');
      const path = `ppt/${activeChurchId}/${id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('publications').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('publications').getPublicUrl(path);
      const sizeMB = (file.size / 1024 / 1024).toFixed(1) + 'MB';
      await supabase.from('church_ppt_library').insert({
        id, church_id: activeChurchId, name: file.name, category: uploadCategory || '',
        file_url: urlData.publicUrl, file_size: sizeMB, source: 'upload',
        created_by: profile?.full_name || user?.email || 'Manager',
      });
      await reloadLibrary();
      setNoti(isZh ? '✅ 已上传' : '✅ Uploaded');
    } catch (err: any) {
      console.error('PPT upload failed', err);
      setNoti((isZh ? '上传失败：' : 'Upload failed: ') + (err?.message || ''));
    }
    setTimeout(() => setNoti(null), 2500);
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [noti, setNoti] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PPTItem | null>(null);
  
  // Background selection state
  const BACKGROUND_OPTIONS = [
    { id: 'emerald', label: t('bgEmerald') || '森林深绿', color: '064E3B', url: null },
    { id: 'light', label: t('bgLight') || '圣洁光芒', url: 'https://images.unsplash.com/photo-1510531704581-5b2870972060?auto=format&fit=crop&q=80&w=2560' },
    { id: 'peace', label: t('bgPeace') || '宁静时刻', url: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&q=80&w=2560' },
    { id: 'cross', label: t('bgCross') || '福音之光', url: 'https://images.unsplash.com/photo-1445053023192-8d45cb66099d?auto=format&fit=crop&q=80&w=2560' },
    { id: 'mountain', label: t('bgMountain') || '群山呼唤', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=2560' },
    { id: 'ai', label: t('aiGenerate') || 'AI 生成', isAi: true, color: '1F2937' }
  ];
  const [selectedBg, setSelectedBg] = useState(BACKGROUND_OPTIONS[0]);
  const [customBgs, setCustomBgs] = useState<any[]>([]);
  const [isGeneratingAiBg, setIsGeneratingAiBg] = useState(false);
  const [isAiPromptOpen, setIsAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  const allBgOptions = [...BACKGROUND_OPTIONS, ...customBgs];

  const handleAiBgGen = () => {
    setIsGeneratingAiBg(true);
    // Using Pollinations AI with ultra-HD enhancements
    const seed = Math.floor(Math.random() * 1000000);
    const promptValue = aiPrompt.trim() || 'sacred holy light, ethereal atmosphere';
    
    // Professional photography and high-end church media style enforcement
    const styleEnhancer = "Professional 8k photography, hyper-realistic, extremely high detail, sharp focus, high-end Christian worship background, majestic soft volumetric lighting, cinematic atmosphere, clean and elegant composition, deep rich colors, high dynamic range, masterwork, no artifacts, crystal clear, 16:9 aspect ratio";
    
    const encodedPrompt = encodeURIComponent(`${promptValue}, ${styleEnhancer}`);
    const aiUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=3840&height=2160&nologo=true&enhance=true&seed=${seed}`;
    
    setTimeout(() => {
      setIsGeneratingAiBg(false);
      const newAiBg = { 
        id: `ai-${Date.now()}`, 
        label: aiPrompt ? `AI: ${aiPrompt.substring(0, 10)}...` : t('aiBgGenerated'), 
        url: aiUrl,
        isAiResult: true
      };
      setCustomBgs(prev => [...prev, newAiBg]);
      setSelectedBg(newAiBg);
      setIsAiPromptOpen(false);
      setAiPrompt('');
      setNoti(`✨ ${t('aiBgGenerated')}`);
      setTimeout(() => setNoti(null), 2000);
    }, 2500);
  };

  const filteredLibrary = library.filter(item => {
    const matchesCat = activeCategory === '__all__' || (item.category || '') === activeCategory;
    const matchesSearch = (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
                         (item.title && item.title.toLowerCase().includes(search.toLowerCase())) ||
                         (item.preacher && item.preacher.toLowerCase().includes(search.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleDelete = async (id: string) => {
    const item = library.find(p => p.id === id);
    setLibrary(library.filter(p => p.id !== id));
    // Uploaded files → remove DB row + storage object
    if (item?.type === 'file') {
      try { await supabase.from('church_ppt_library').delete().eq('id', id); } catch {}
      try {
        const m = (item.fileUrl || '').match(/\/publications\/(ppt\/.+)$/);
        if (m) await supabase.storage.from('publications').remove([m[1]]);
      } catch {}
    }
    // Generated PPTs → remove from localStorage
    try {
      const songKey = churchKey('ready_ppt_songs');
      const songPPTs: any[] = JSON.parse(localStorage.getItem(songKey) || '[]');
      localStorage.setItem(songKey, JSON.stringify(songPPTs.filter((p: any) => p.id !== id)));
    } catch {}
    try {
      const libKey = churchKey('ppt_library_sync');
      const libSync: any[] = JSON.parse(localStorage.getItem(libKey) || '[]');
      localStorage.setItem(libKey, JSON.stringify(libSync.filter((p: any) => p.id !== id)));
    } catch {}
    setNoti(t('fileRemoved') || "文件已移除");
    setTimeout(() => setNoti(null), 2000);
  };

  const startEditing = (item: PPTItem) => {
    setEditingId(item.id);
    setEditName(item.name);
  };

  const saveName = () => {
    if (editingId) {
      setLibrary(library.map(p => p.id === editingId ? { ...p, name: editName } : p));
      setEditingId(null);
      setNoti(t('filenameUpdated') || "文件名已更新");
      setTimeout(() => setNoti(null), 2000);
    }
  };

  const handleManualUpload = (type: 'weekly' | 'song' | 'sermon') => {
    const newName = type === 'weekly' ? `Manual_Weekly_${new Date().toLocaleDateString()}` : 
                    type === 'song' ? 'Manual_Song_Upload' : 'Sermon_Handout_Upload';
    const newItem: PPTItem = {
      id: `m-${Date.now()}`,
      name: newName,
      type,
      date: new Date().toISOString().split('T')[0],
      size: '1.5MB'
    };
    setLibrary([newItem, ...library]);
    setIsUploading(false);
    setNoti(t('successfullyUploaded') || `成功上传了一个 ${type} 资源`);
    setTimeout(() => setNoti(null), 2000);
  };

  // Pre-fetch an external image URL as base64 (for PPT embedding)
  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    if (!url || url.startsWith('data:')) return url || null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Failed to fetch image as base64:', url, e);
      return null;
    }
  };

  const handleDownload = (item: PPTItem & { songData?: any }) => {
    setNoti(`⏳ 正在生成 ${item.name}...`);

    (async () => {
      try {
        const { default: pptxgen } = await import('pptxgenjs');
        let pres = new pptxgen();
        pres.layout = 'LAYOUT_16x9';

        const titleFont = "Microsoft YaHei";
        const bodyFont = "Microsoft YaHei";

        const sd = (item as any).songData;

        if (sd) {
          const lps = sd.linesPerSlide || 2;

          // Collect all background URLs that need pre-fetching
          const songsArr: any[] = sd.songs && Array.isArray(sd.songs) ? sd.songs : [sd];
          const bgUrlCache = new Map<string, string>();
          const urlsToFetch = new Set<string>();
          songsArr.forEach((song: any) => {
            const bg = song.bg || sd.globalBg || selectedBg;
            if (bg?.url && !bg.url.startsWith('data:')) urlsToFetch.add(bg.url);
          });
          // Also check globalBg
          const globalBg = sd.globalBg || selectedBg;
          if (globalBg?.url && !globalBg.url.startsWith('data:')) urlsToFetch.add(globalBg.url);

          await Promise.all(Array.from(urlsToFetch).map(async (url) => {
            const b64 = await fetchImageAsBase64(url);
            if (b64) bgUrlCache.set(url, b64);
          }));

          const makeSlideBg = (bg: any, overlay: boolean) => (s: any) => {
            if (bg?.url) {
              const cached = bgUrlCache.get(bg.url);
              if (cached) {
                s.background = { data: cached };
              } else if (bg.url.startsWith('data:')) {
                s.background = { data: bg.url };
              } else {
                s.background = { path: bg.url.split('?')[0] };
              }
            } else {
              s.background = { color: bg?.color || '064E3B' };
            }
            if (overlay) {
              s.addShape(pres.ShapeType.rect, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 55 }, line: { type: 'none' },
              });
            }
          };

          const generateSongSlides = (song: any, isMultiple: boolean) => {
            const activeBg = song.bg || sd.globalBg || selectedBg;
            // Auto-adapt text color + overlay to the background so the .pptx matches preview.
            const colors = resolveSlideColors(
              activeBg,
              song.lyricColor || sd.lyricColor || '#FFFFFF',
              song.translationColor || sd.translationColor || '#A7F3D0',
            );
            const songLc = colors.lc.replace('#', '');
            const songTc = colors.tc.replace('#', '');
            const songLps = song.linesPerSlide || lps;
            const setSlideBg = makeSlideBg(activeBg, colors.overlay);

            // Song separator slide (if multiple songs)
            if (isMultiple) {
              let sep = pres.addSlide();
              setSlideBg(sep);
              sep.addText("SONG", {
                x: 0, y: 1.0, w: "100%", align: "center", fontFace: bodyFont, fontSize: 14, color: "A7F3D0", bold: true, charSpacing: 10
              });
              sep.addText(song.title || '', {
                x: 0, y: 2.2, w: "100%", h: 1.5,
                align: "center", fontFace: titleFont, fontSize: 64, color: "FFFFFF", bold: true,
                shadow: PPT_TEXT_SHADOW
              });
              sep.addShape(pres.ShapeType.rect, { x: 4.25, y: 4.2, w: 1.5, h: 0.05, fill: { color: "A7F3D0" } });
            }

            // Cover slide
            let cover = pres.addSlide();
            setSlideBg(cover);
            cover.addText(song.title || item.name, {
              x: 0, y: 1.5, w: "100%", h: 2,
              align: "center", fontFace: titleFont, fontSize: 48, color: songLc, bold: true,
              shadow: PPT_TEXT_SHADOW
            });
            if (song.englishTitle) {
              cover.addText(song.englishTitle, {
                x: 0, y: 3.5, w: "100%", h: 1,
                align: "center", fontFace: bodyFont, fontSize: 24, color: songTc,
                shadow: PPT_TEXT_SHADOW
              });
            }

            const lyricsLines = (song.lyrics || '').split('\n').filter((l: string) => l.trim());
            const englishLines = (song.englishLyrics || '').split('\n').filter((l: string) => l.trim());

            for (let i = 0; i < lyricsLines.length; i += songLps) {
              let lSlide = pres.addSlide();
              setSlideBg(lSlide);
              let currentY = 1.0;
              for (let j = 0; j < songLps; j++) {
                const idx = i + j;
                if (lyricsLines[idx]) {
                  lSlide.addText(lyricsLines[idx], {
                    x: 0, y: currentY, w: "100%", h: 0.8,
                    align: "center", fontFace: titleFont, fontSize: 36, color: songLc, bold: true,
                    shadow: PPT_TEXT_SHADOW
                  });
                  currentY += 0.8;
                  if (englishLines[idx]) {
                    lSlide.addText(englishLines[idx], {
                      x: 0, y: currentY, w: "100%", h: 0.6,
                      align: "center", fontFace: bodyFont, fontSize: 24, color: songTc, italic: true,
                      shadow: PPT_TEXT_SHADOW
                    });
                    currentY += 0.8;
                  }
                }
              }
            }
          };

          const isMultiple = songsArr.length > 1;
          songsArr.forEach((song: any) => generateSongSlides(song, isMultiple));
        } else {
          // Generic fallback for items without stored song data
          const bg = selectedBg;
          const colors = resolveSlideColors(bg, '#FFFFFF', '#A7F3D0');
          const b64 = bg.url ? await fetchImageAsBase64(bg.url) : null;
          const setSlideBg = (s: any) => {
            if (b64) s.background = { data: b64 };
            else if (bg.url?.startsWith('data:')) s.background = { data: bg.url };
            else if (bg.url) s.background = { path: bg.url.split('?')[0] };
            else s.background = { color: bg.color || '064E3B' };
            if (colors.overlay) {
              s.addShape(pres.ShapeType.rect, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 55 }, line: { type: 'none' },
              });
            }
          };

          let slide = pres.addSlide();
          setSlideBg(slide);
          slide.addText(item.title || item.name, {
            x: 0, y: 1.5, w: "100%", h: 2,
            align: "center", fontFace: titleFont, fontSize: 48, color: colors.lc.replace('#', ''), bold: true,
            shadow: PPT_TEXT_SHADOW
          });
          if (item.preacher) {
            slide.addText(item.preacher, {
              x: 0, y: 3.5, w: "100%", h: 1,
              align: "center", fontFace: bodyFont, fontSize: 24, color: colors.tc.replace('#', ''),
              shadow: PPT_TEXT_SHADOW
            });
          }
        }

        await pres.writeFile({ fileName: `${item.name}.pptx` });
        setNoti("✅ 下载已开始");
      } catch (err) {
        console.error("PPT generation error:", err);
        setNoti("❌ 生成失败，请重试");
      }
      setTimeout(() => setNoti(null), 3000);
    })();
  };

  return (
    <div className="p-8 md:p-12 max-w-7xl mx-auto w-full min-h-full pb-32">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
             <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]"></div>
             <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.5em] font-sans">Resources Cloud Repository</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-[64px] font-serif font-black text-[#2C2C2C] tracking-tighter leading-none">
              Ready <span className="text-emerald-500/80 italic font-medium">PPT</span> Library
            </h1>
            <p className="text-sm text-outline/40 max-w-lg font-medium leading-relaxed">
              {t('readyPptDesc')}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6">
           <div className="flex items-center gap-4 bg-white p-3 pl-6 rounded-[28px] border border-[#E5E0DA]/50 shadow-xl shadow-black/[0.02] w-full sm:w-96 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
              <span className="material-symbols-outlined text-outline/30 text-[20px]">search_insight</span>
              <input 
                type="text" 
                placeholder={t('searchFiles')}
                className="w-full bg-transparent border-none outline-none text-xs font-bold p-1 focus:ring-0"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
           <button 
             onClick={() => { setUploadCategory(activeCategory !== '__all__' ? activeCategory : (categories[0] || '')); setIsUploading(true); }}
             className="h-16 w-16 rounded-[24px] bg-black text-white flex items-center justify-center hover:bg-emerald-600 hover:rotate-90 transition-all shadow-2xl shadow-black/10 shrink-0"
           >
              <span className="material-symbols-outlined text-3xl">add</span>
           </button>
        </div>
      </div>

      {/* Customizable category tabs */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
        <button
          onClick={() => setActiveCategory('__all__')}
          className={`px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest transition-all ${activeCategory === '__all__' ? 'bg-black text-white shadow-lg' : 'bg-white text-outline/50 border border-[#E5E0DA]/50 hover:text-on-surface'}`}
        >
          {isZh ? '全部' : 'All'}
        </button>
        {categories.map(c => (
          <div key={c} className="relative group/tab">
            <button
              onClick={() => setActiveCategory(c)}
              className={`px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest transition-all ${activeCategory === c ? 'bg-emerald-600 text-white shadow-lg' : 'bg-white text-outline/50 border border-[#E5E0DA]/50 hover:text-on-surface'}`}
            >
              {c}
            </button>
            {isManager && (
              <button
                onClick={(e) => { e.stopPropagation(); removeCategory(c); }}
                title={isZh ? '删除分类' : 'Remove category'}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-all shadow"
              >×</button>
            )}
          </div>
        ))}
        {isManager && (
          <button
            onClick={addCategory}
            className="px-4 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest text-emerald-600 border-2 border-dashed border-emerald-300/60 hover:bg-emerald-50 transition-all flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>{isZh ? '分类' : 'Category'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5">
        <AnimatePresence mode="popLayout">
          {filteredLibrary.length > 0 ? (
            filteredLibrary.map((item) => {
              const songTitle = (item as any).songTitle || item.title || '';
              const displayName = songTitle || item.name;
              const bgUrl = (item as any).songData?.bg?.url;
              const bgColor = (item as any).songData?.bg?.color;
              const typeColor = item.type === 'weekly' ? '#059669' : item.type === 'song' ? '#059669' : '#D97706';
              const typeIcon = item.type === 'weekly' ? 'auto_awesome_motion' : item.type === 'song' ? 'music_note' : 'edit_document';

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ y: -6, scale: 1.02 }}
                  onClick={() => item.type === 'file' ? window.open(item.fileUrl, '_blank') : setPreviewItem(item)}
                  className="group relative bg-white rounded-[28px] border border-[#E5E0DA]/30 overflow-hidden hover:shadow-2xl hover:border-emerald-400/40 transition-all duration-300 flex flex-col cursor-pointer"
                >
                  {/* Thumbnail area */}
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    {bgUrl ? (
                      <img src={bgUrl} alt="bg" className="w-full h-full object-cover" referrerPolicy="no-referrer"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"
                        style={{ backgroundColor: bgColor ? `#${bgColor}` : '#064E3B' }}>
                        {songTitle && (
                          <span className="text-white/60 font-serif font-black text-sm text-center px-3 line-clamp-2">{songTitle}</span>
                        )}
                      </div>
                    )}
                    {/* Category chip — shows which tab this PPT belongs to */}
                    {item.category && (
                      <div className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur text-white text-[9px] font-black uppercase tracking-wider shadow-md">
                        {item.category}
                      </div>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-xl bg-white/90 text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white flex items-center justify-center shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[13px]">delete</span>
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-sm font-serif font-black text-[#2C2C2C] leading-snug line-clamp-2 mb-1">
                        {displayName}
                      </h4>
                      {item.type === 'song' && (item as any).songData?.englishTitle && (
                        <p className="text-[9px] text-outline/50 font-medium line-clamp-1">{(item as any).songData.englishTitle}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#E5E0DA]/40">
                      <p className="text-[9px] font-bold text-outline/40">{item.date}</p>
                      <span className="text-[9px] font-black text-outline/20 uppercase">{item.size}</span>
                    </div>
                  </div>

                  {/* Hover download overlay */}
                  <div className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => item.type === 'file' ? window.open(item.fileUrl, '_blank') : handleDownload(item)}
                      className="w-full py-2 bg-black text-white rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-xl">
                      {item.type === 'file' ? (isZh ? '打开 / 下载' : 'Open / Download') : (isZh ? '下载 PPT' : 'Download PPT')}
                    </button>
                  </div>
                </motion.div>
              );
            })
          ) : (
            <div className="col-span-full py-40 text-center bg-white rounded-[56px] border-2 border-dashed border-[#E5E0DA]/50">
               <div className="w-24 h-24 rounded-full bg-[#F9F7F5] flex items-center justify-center mx-auto mb-8 text-outline/10">
                 <span className="material-symbols-outlined text-5xl">folder_off</span>
               </div>
               <h3 className="text-2xl font-serif font-black text-outline/40 uppercase tracking-widest">{t('noFilesFound') || 'No Files Found'}</h3>
               <p className="text-sm font-bold text-outline/20 mt-4 max-w-xs mx-auto">{t('searchLibraryPlaceholder')}</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Upload Modal Overlay */}
      <AnimatePresence>
        {isUploading && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsUploading(false)}
               className="absolute inset-0 bg-black/60 backdrop-blur-md"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.9, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="relative bg-[#F9F7F5] w-full max-w-4xl rounded-[48px] overflow-hidden shadow-2xl p-8 lg:p-16"
             >
                <input ref={uploadRef} type="file" accept=".ppt,.pptx,.pdf,.key,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" onChange={handleFileChosen} />
                <div className="flex flex-col lg:flex-row gap-12">
                   <div className="flex-1 space-y-6">
                      <div className="space-y-1">
                        <h2 className="text-3xl font-serif font-black text-[#2C2C2C] tracking-tighter italic">{isZh ? '上传文件' : 'Upload File'}</h2>
                        <p className="text-[11px] text-outline/40 font-medium">{isZh ? '先选一个分类，再选择文件（PPT / PDF）' : 'Pick a category, then choose a file (PPT / PDF)'}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => uploadRef.current?.click()}
                        className="w-full border-2 border-dashed border-[#E5E0DA] rounded-[32px] aspect-video flex flex-col items-center justify-center group hover:border-emerald-500/40 hover:bg-emerald-50/30 transition-all"
                      >
                         <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-outline/20 shadow-sm group-hover:text-emerald-500 group-hover:scale-110 transition-all mb-4">
                            <span className="material-symbols-outlined text-3xl">upload_file</span>
                         </div>
                         <p className="text-[10px] font-black uppercase tracking-[0.2em] text-outline/40 group-hover:text-emerald-600">{isZh ? '点击选择文件' : 'Click to choose a file'}</p>
                      </button>
                   </div>

                   <div className="w-px bg-[#E5E0DA] hidden lg:block"></div>

                   <div className="w-full lg:w-72 space-y-8">
                      <div className="space-y-3">
                         <h4 className="text-[9px] font-black uppercase tracking-widest text-[#2C2C2C]">{isZh ? '选择分类' : 'Select Category'}</h4>
                         <div className="grid grid-cols-1 gap-2">
                            {categories.map(c => (
                              <button key={c} onClick={() => setUploadCategory(c)}
                                className={`w-full p-4 rounded-2xl border flex items-center gap-3 transition-all ${uploadCategory === c ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-[#E5E0DA]/50 hover:border-emerald-500/30 hover:shadow-md'}`}>
                                 <span className="material-symbols-outlined text-xl">{uploadCategory === c ? 'check_circle' : 'folder'}</span>
                                 <span className="text-[11px] font-black uppercase tracking-widest">{c}</span>
                              </button>
                            ))}
                         </div>
                         {categories.length === 0 && <p className="text-[10px] text-outline/40">{isZh ? '请先在上面添加分类' : 'Add a category first'}</p>}
                      </div>

                      <button
                        onClick={() => setIsUploading(false)}
                        className="w-full py-4 bg-black text-white rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] hover:bg-red-600 transition-all shadow-xl active:scale-95"
                      >
                         {isZh ? '取消' : 'Cancel'}
                      </button>
                   </div>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Online Preview Modal */}
      <AnimatePresence>
        {previewItem && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setPreviewItem(null)}
               className="absolute inset-0 bg-black/90 backdrop-blur-xl"
             />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative w-full max-w-7xl aspect-video bg-[#1A1A1A] rounded-[48px] overflow-hidden shadow-2xl flex"
              >
                {/* Left Side: Theme Selection (NEW) */}
                <div className="w-80 bg-black/40 backdrop-blur-xl p-8 border-r border-white/10 flex flex-col gap-8">
                   <div className="space-y-1">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Layout Settings</h4>
                      <h3 className="text-xl font-serif font-black text-white italic">Customize Background</h3>
                   </div>

                   <div className="flex-1 overflow-y-auto no-scrollbar">
                      <div className="grid grid-cols-2 gap-3">
                         {allBgOptions.map((bg) => (
                           <button 
                             key={bg.id}
                             onClick={() => {
                               if (bg.isAi) {
                                 setIsAiPromptOpen(true);
                               } else {
                                 setSelectedBg(bg);
                               }
                             }}
                             className={`relative aspect-video rounded-2xl overflow-hidden border-2 transition-all ${selectedBg.id === bg.id ? 'border-emerald-500 scale-105 shadow-lg' : 'border-white/10 hover:border-emerald-500/50'}`}
                           >
                             {bg.url ? (
                               <img src={bg.url} className="w-full h-full object-cover" alt="BG" referrerPolicy="no-referrer" />
                             ) : bg.color ? (
                               <div className="w-full h-full" style={{ backgroundColor: `#${bg.color}` }}></div>
                             ) : (
                               <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
                                  {isGeneratingAiBg ? <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span> : <span className="material-symbols-outlined text-sm">auto_awesome</span>}
                               </div>
                             )}
                             <div className="absolute inset-x-0 bottom-0 py-1 bg-black/60 text-[6px] font-black text-white uppercase text-center">{bg.label}</div>
                           </button>
                         ))}
                      </div>
                   </div>

                   <button 
                     onClick={() => setPreviewItem(null)}
                     className="w-full py-4 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-all border border-white/10"
                   >
                     Exit Preview
                   </button>
                </div>

                {/* Right Side: PPT Content - Real slide preview */}
                <div className="flex-1 flex flex-col relative group overflow-y-auto no-scrollbar">
                   <div className="absolute top-8 left-8 z-10 space-y-1">
                      <h3 className="text-white text-xl font-serif font-black drop-shadow-lg">
                        {(previewItem as any).songTitle || previewItem.title || previewItem.name}
                      </h3>
                      <p className="text-white/40 text-[10px] font-black tracking-widest uppercase">
                        {previewItem.date} · {previewItem.type.toUpperCase()}
                      </p>
                   </div>

                   {/* If we have full songData, show real slides */}
                   {(previewItem as any).songData ? (() => {
                     const sd = (previewItem as any).songData;
                     const songs: any[] = sd.songs && Array.isArray(sd.songs) ? sd.songs : [sd];
                     const lc = sd.lyricColor || '#FFFFFF';
                     const tc = sd.translationColor || '#A7F3D0';
                     const lps = sd.linesPerSlide || 2;
                     return (
                       <div className="flex-1 flex flex-col gap-0 overflow-y-auto no-scrollbar">
                         {songs.map((song: any, si: number) => {
                           const bg = song.bg || sd.globalBg;
                           // Resolve colors/overlay exactly like the .pptx export.
                           const pc = resolveSlideColors(bg, song.lyricColor || lc, song.translationColor || tc);
                           const songLc = pc.lc;
                           const songTc = pc.tc;
                           const hasImg = !!bg?.url;
                           const songLps = song.linesPerSlide || lps;
                           const lyricsLines = (song.lyrics || '').split('\n').filter((l: string) => l.trim());
                           const englishLines = (song.englishLyrics || '').split('\n').filter((l: string) => l.trim());
                           const slides = [
                             { type: 'cover', title: song.title, sub: song.englishTitle },
                             ...Array.from({ length: Math.ceil(lyricsLines.length / songLps) }, (_, i) => ({
                               type: 'lyric', startIdx: i * songLps
                             }))
                           ];
                           const bgStyle: React.CSSProperties = bg?.url
                             ? { backgroundImage: `url(${bg.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                             : { backgroundColor: `#${bg?.color || '064E3B'}` };
                           return (
                             <div key={si} className="flex-shrink-0">
                               {slides.map((slide, idx) => (
                                 <div key={idx} className="relative flex items-center justify-center text-center p-8" style={{ ...bgStyle, aspectRatio: '16/9' }}>
                                   {hasImg && <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/50 to-black/40" />}
                                   <div className="relative z-10 space-y-2 w-full">
                                     {slide.type === 'cover' ? (
                                       <>
                                         <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: songLc, opacity: 0.6 }}>SLIDE {idx + 1}</p>
                                         <h2 className="text-4xl font-serif font-black" style={{ color: songLc, textShadow: PREVIEW_TEXT_SHADOW }}>{(slide as any).title}</h2>
                                         <p className="text-lg font-medium" style={{ color: songTc, textShadow: PREVIEW_TEXT_SHADOW }}>{(slide as any).sub}</p>
                                       </>
                                     ) : (
                                       <>
                                         <p className="text-[8px] font-black uppercase tracking-widest text-white/30">SLIDE {idx + 1}</p>
                                         {Array.from({ length: songLps }).map((_, j) => {
                                           const lineIdx = (slide as any).startIdx + j;
                                           return (
                                             <div key={j}>
                                               {lyricsLines[lineIdx] && <p className="text-2xl font-serif font-black" style={{ color: songLc, textShadow: PREVIEW_TEXT_SHADOW }}>{lyricsLines[lineIdx]}</p>}
                                               {englishLines[lineIdx] && <p className="text-sm italic" style={{ color: songTc, textShadow: PREVIEW_TEXT_SHADOW }}>{englishLines[lineIdx]}</p>}
                                             </div>
                                           );
                                         })}
                                       </>
                                     )}
                                   </div>
                                 </div>
                               ))}
                             </div>
                           );
                         })}
                       </div>
                     );
                   })() : (
                   /* Fallback for items without songData */
                   <div
                     className="w-full h-full flex flex-col items-center justify-center p-20 text-center relative overflow-hidden transition-all duration-700 bg-black"
                     style={!selectedBg.url ? { backgroundColor: `#${selectedBg.color || '064E3B'}` } : {}}
                   >
                      {selectedBg.url && <img src={selectedBg.url} className="absolute inset-0 w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />}
                      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-black/20 pointer-events-none"></div>
                      <motion.div
                        key={selectedBg.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative z-10 space-y-6"
                      >
                        <h2 className="text-6xl font-serif font-black text-white italic leading-tight tracking-tighter drop-shadow-2xl">
                          {previewItem.title || previewItem.name.split('_').join(' ')}
                        </h2>
                        {previewItem.preacher && (
                          <p className="text-emerald-400 text-2xl font-black uppercase tracking-[0.5em]">{previewItem.preacher}</p>
                        )}
                      </motion.div>
                   </div>
                   )}

                   {/* Controls */}
                   <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 p-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="h-10 w-10 rounded-xl hover:bg-white/10 text-white transition-colors">
                        <span className="material-symbols-outlined">navigate_before</span>
                      </button>
                      <div className="h-10 px-4 flex items-center text-[10px] font-black text-white/60 border-x border-white/10 uppercase tracking-widest">
                        1 / 12
                      </div>
                      <button className="h-10 w-10 rounded-xl hover:bg-white/10 text-white transition-colors">
                        <span className="material-symbols-outlined">navigate_next</span>
                      </button>
                   </div>

                   {/* Footer bar */}
                   <div className="h-20 bg-black/60 backdrop-blur-xl border-t border-white/10 flex items-center justify-between px-8 shrink-0">
                      <div className="flex items-center gap-3">
                         <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${previewItem.type === 'weekly' ? 'bg-emerald-500' : previewItem.type === 'song' ? 'bg-indigo-400' : 'bg-orange-400'}`}></div>
                         <span className="text-white/70 text-[10px] font-black uppercase tracking-widest">
                           {(previewItem as any).songTitle || previewItem.title || previewItem.name}
                         </span>
                      </div>
                      <div className="flex items-center gap-3">
                         <button
                           onClick={() => setPreviewItem(null)}
                           className="px-5 py-3 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all border border-white/10"
                         >
                           关闭
                         </button>
                         <button
                           onClick={() => handleDownload(previewItem)}
                           className="px-8 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-xl shadow-emerald-500/20"
                         >
                            <span className="material-symbols-outlined text-base">download</span>
                            下载 PPT
                         </button>
                      </div>
                   </div>
                </div>
              </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Persistence Notification */}
      <AnimatePresence>
        {noti && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[300] bg-black text-white px-10 py-6 rounded-full font-black text-xs uppercase tracking-[0.3em] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.4)] flex items-center gap-4"
          >
             <span className="material-symbols-outlined text-emerald-400">offline_pin</span>
             {noti}
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Background Prompt Modal */}
      <AnimatePresence>
        {isAiPromptOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAiPromptOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white w-full max-w-lg rounded-[40px] overflow-hidden shadow-2xl p-10 flex flex-col items-center text-center"
            >
                <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-6">
                  <span className="material-symbols-outlined text-3xl">auto_awesome</span>
                </div>
                <h3 className="text-2xl font-serif font-black text-[#2C2C2C] mb-2">AI 生成背景</h3>
                <p className="text-[11px] text-outline/40 font-medium mb-8">
                  输入一个主题（如“森林”、“光芒”、“星空”），AI 将为您生成专属敬拜背景。
                </p>
                
                <input 
                  type="text" 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="例如：黎明的圣殿..."
                  className="w-full bg-[#F9F7F5] border-2 border-[#E5E0DA]/50 rounded-2xl py-4 px-6 text-sm font-bold focus:border-emerald-500 focus:ring-0 outline-none mb-10 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleAiBgGen()}
                />

                <div className="flex w-full gap-4">
                   <button 
                     onClick={() => setIsAiPromptOpen(false)}
                     className="flex-1 py-4 bg-[#F9F7F5] text-outline/40 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#E5E0DA] transition-all"
                   >
                     Cancel
                   </button>
                   <button 
                     disabled={isGeneratingAiBg || !aiPrompt.trim()}
                     onClick={handleAiBgGen}
                     className="flex-1 py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                   >
                     {isGeneratingAiBg ? (
                        <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                     ) : (
                        <span className="material-symbols-outlined text-sm">magic_button</span>
                     )}
                     Generate
                   </button>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
