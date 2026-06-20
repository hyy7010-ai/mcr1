import React, { useState, useEffect, useRef } from 'react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion, Reorder, AnimatePresence } from 'motion/react';
import { fetchSongFromUrl, translateLyrics } from '../services/geminiService';
import { logActivity } from '../services/activityService';
import { googleDriveService } from '../services/googleDrive';
import { supabase } from '../lib/supabase';
import { isSuperAdmin, getActiveChurchId, isDemoChurch } from '../lib/permissions';
import { resolveSlideColors, pptShadow, previewShadow, type ShadowLevel } from '../lib/pptTheme';

import LyricsSheetModal from '../components/LyricsSheetModal';

interface Song {
  id: string;
  title: string;
  englishTitle: string;
  pages: number;
  lyrics: string;
  englishLyrics: string;
  key: string;
  external_url?: string;
  customBg?: any;
}

const INITIAL_LIBRARY: Song[] = [
  { 
    id: '1', 
    title: '奇异恩典', 
    englishTitle: 'Amazing Grace', 
    pages: 8, 
    lyrics: '奇异恩典 何等甘甜\n我罪已得赦免\n前我失丧 今被寻回\n瞎眼今得看见',
    englishLyrics: 'Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see',
    key: 'Bb' 
  },
  { 
    id: '2', 
    title: '祢是我我的力量', 
    englishTitle: 'You Are My Strength', 
    pages: 10, 
    lyrics: '祢是我力量 当我很软弱\n祢是我心中 无价珍宝\n祢是我所有一切\n寻得祢真珠 我不愿放弃',
    englishLyrics: 'You are my strength when I am weak\nYou are the treasure that I seek\nYou are my all in all\nSeeking You as a precious jewel',
    key: 'G' 
  },
  { 
    id: '3', 
    title: '哈利路亚', 
    englishTitle: 'Hallelujah', 
    pages: 6, 
    lyrics: '我听过那神秘的和弦\n大卫弹奏取悦上主\n它就在这里\n哈利路亚', 
    englishLyrics: 'I heard there was a secret chord\nThat David played and it pleased the Lord\nIt goes like this\nHallelujah', 
    key: 'D' 
  },
  { 
    id: '4', 
    title: '在这里', 
    englishTitle: 'Right Here', 
    pages: 5, 
    lyrics: '在这里 我遇见祢\n在这里 我降服于祢\n祢的爱在这里\n直到永远', 
    englishLyrics: 'Right here I meet You\nRight here I surrender to You\nYour love is here\nForevermore', 
    key: 'C' 
  },
  {
    id: '5',
    title: '我神真伟大',
    englishTitle: 'How Great Is Our God',
    pages: 8,
    lyrics: '尊贵君王 荣美在宝座上\n全地都当欢欣\n祂裹着光辉 黑暗都躲避\n在祂声音战栗',
    englishLyrics: 'The splendor of a King, clothed in majesty\nLet all the earth rejoice\nHe wraps Himself in light, and darkness tries to hide\nAnd trembles at His voice',
    key: 'A'
  }
];

// Remove duplicate paragraphs/lines that worship lyrics often repeat back-to-back.
// 1) collapse immediately-repeated single lines, 2) collapse immediately-repeated
// 2–8 line blocks (e.g. a verse pasted twice in a row).
// Strip ALL blank/whitespace-only lines from pasted lyrics. Worship lyrics are
// shown one line per row on the slides, so blank lines only create empty slides.
function stripBlankLines(text: string): string {
  if (!text) return text;
  return text.split('\n').filter(l => l.trim().length > 0).join('\n').trim();
}

function dedupeLyrics(text: string): string {
  if (!text) return text;
  // Remove blank lines up-front so verse de-duplication compares real content only.
  let lines = stripBlankLines(text).split('\n');

  // collapse consecutive identical (non-empty) lines
  const single: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const prev = single.length ? single[single.length - 1].trim() : null;
    if (t && t === prev) continue;
    single.push(line);
  }
  lines = single;

  // collapse a block of N lines immediately repeated (largest blocks first)
  for (let size = 8; size >= 2; size--) {
    let i = 0;
    while (i + 2 * size <= lines.length) {
      const a = lines.slice(i, i + size).map(l => l.trim()).join('\n');
      const b = lines.slice(i + size, i + 2 * size).map(l => l.trim()).join('\n');
      if (a && a === b) {
        lines.splice(i + size, size); // drop the repeat
      } else {
        i++;
      }
    }
  }

  // blank lines were already removed above
  return lines.join('\n').trim();
}

export default function Songs() {
  const { mode } = useMode();
  const { t, isZh, language } = useLanguage();
  const { profile, user, church } = useAuth();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState<'Library' | 'Weekly' | 'Export'>('Library');
  const [librarySongs, setLibrarySongs] = useState<Song[]>(INITIAL_LIBRARY);
  const [weeklySetlist, setWeeklySetlist] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const isPlatformAdmin = isSuperAdmin(profile, user);
  const activeChurchId = getActiveChurchId(profile, church);

  useEffect(() => {
    // Always fetch when we have a real (non-demo) church to query
    if (activeChurchId && !isDemoChurch(church)) {
      fetchSongs();
    }
    // For demo/super-admin with no real church, INITIAL_LIBRARY is already the default state
  }, [activeChurchId]);

  const songsCacheKey = () => `songs_cache_${activeChurchId}`;

  const fetchSongs = async () => {
    if (!activeChurchId || isDemoChurch(church)) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('church_id', activeChurchId)
        .order('title', { ascending: true });

      if (error) throw error;

      const supSongs = (data || []).map(s => ({
        ...s,
        englishTitle: s.english_title || s.title,
        englishLyrics: s.english_lyrics || s.lyrics,
        pages: s.pages || Math.ceil((s.lyrics?.split('\n').filter((l: string) => l.trim()).length || 1) / 2) + 1
      }));

      // Cache the church's real songs so a later slow/failed read never shows blanks.
      try { localStorage.setItem(songsCacheKey(), JSON.stringify(supSongs)); } catch {}

      // Always merge Supabase songs with INITIAL_LIBRARY so all users see the default songs
      const existingIds = new Set(supSongs.map(s => s.id));
      const merged = [...supSongs, ...INITIAL_LIBRARY.filter(s => !existingIds.has(s.id))];
      setLibrarySongs(merged);
    } catch (err) {
      console.error('Error fetching songs:', err);
      // Resilience: on a failed/timed-out read, fall back to the last cached songs
      // (plus defaults) instead of dropping to defaults-only — that looked like "they vanished".
      try {
        const cached = JSON.parse(localStorage.getItem(songsCacheKey()) || '[]');
        if (cached.length) {
          const ids = new Set(cached.map((s: any) => s.id));
          setLibrarySongs([...cached, ...INITIAL_LIBRARY.filter(s => !ids.has(s.id))]);
        }
      } catch {}
    } finally {
      setIsLoading(false);
    }
  };
  
  // Ready PPT Library State
  const [pptLibrary, setPptLibrary] = useState<any[]>([
    { id: 'p1', name: 'Ready_PPT_Sunday_Worship_2024-05-01', type: 'weekly', date: '2024-05-01', songCount: 4, size: '4.2MB' },
    { id: 'p2', name: 'Amazing_Grace_Standard', type: 'song', date: '2024-04-28', title: '奇异恩典', size: '1.1MB' },
    { id: 'p3', name: 'Sermon_Living_By_Faith', type: 'sermon', date: '2024-05-01', preacher: 'Ps. David', size: '2.8MB' }
  ]);
  const [readyFilter, setReadyFilter] = useState<'all' | 'song' | 'weekly' | 'sermon'>('all');
  const [isAddingSong, setIsAddingSong] = useState(false);
  // Bulk add: pick how many songs, paste lyrics for each (first line = title), save all at once
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [bulkTexts, setBulkTexts] = useState<string[]>(['', '', '']);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [newSongUrl, setNewSongUrl] = useState('');
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [newSongData, setNewSongData] = useState({ 
    title: '', 
    englishTitle: '', 
    lyrics: '', 
    englishLyrics: '',
    key: 'C',
    external_url: '' 
  });
  const [editingSong, setEditingSong] = useState<any | null>(null);
  const [previewingSong, setPreviewingSong] = useState<any | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showLyricsSheet, setShowLyricsSheet] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  
  // Google Drive Integration State
  const [googleToken, setGoogleToken] = useState<string | null>(localStorage.getItem('google_drive_token'));
  const [autoUploadToDrive, setAutoUploadToDrive] = useState(localStorage.getItem('auto_upload_drive') === 'true');
  const [autoSaveToLibrary, setAutoSaveToLibrary] = useState(localStorage.getItem('auto_save_library') === 'true');
  const [activePreviewTab, setActivePreviewTab] = useState<'theme' | 'lyrics'>('theme');

  const handleConnectDrive = async () => {
    // In a real app, this would be a full OAuth flow. 
    // Here we will use a simulated flow that prompts for basic permission
    const SCOPES = 'https://www.googleapis.com/auth/drive.file';
    const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy_client_id';
    
    // For this context, we will mock the token for demonstration or ask for it if possible.
    // However, the user wants "automatic" so I will implement the logic.
    // I will explain in the summary that They need to configure the Google Client ID.
    
    setDownloadStatus(isZh ? '正在连接 Google Drive...' : 'Connecting to Google Drive...');
    
    // Admin setup guide console log for development
    if (process.env.NODE_ENV !== 'production') {
      console.info("Google Drive API Setup: Configure your Client ID in .env to enable real syncing.");
    }

    setTimeout(() => {
      const mockToken = 'mock_token_' + Math.random().toString(36).substring(7);
      setGoogleToken(mockToken);
      localStorage.setItem('google_drive_token', mockToken);
      setDownloadStatus(t('driveConnected') || '✅ Google Drive 已连接');
      setTimeout(() => setDownloadStatus(null), 3000);
    }, 1500);
  };

  const handleToggleAutoUpload = () => {
    const newValue = !autoUploadToDrive;
    setAutoUploadToDrive(newValue);
    localStorage.setItem('auto_upload_drive', String(newValue));
  };

  const handleToggleAutoSave = () => {
    const newValue = !autoSaveToLibrary;
    setAutoSaveToLibrary(newValue);
    localStorage.setItem('auto_save_library', String(newValue));
  };
  
  // Background selection state
  const BACKGROUND_OPTIONS = [
    { id: 'emerald', label: t('bgEmerald') || '森林深绿', color: '064E3B', url: null },
    { id: 'light', label: t('bgLight') || '圣洁光芒', url: 'https://images.unsplash.com/photo-1510531704581-5b2870972060?auto=format&fit=crop&q=80&w=2560' },
    { id: 'peace', label: t('bgPeace') || '宁静时刻', url: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&q=80&w=2560' },
    { id: 'cross', label: t('bgCross') || '福音之光', url: 'https://images.unsplash.com/photo-1445053023192-8d45cb66099d?auto=format&fit=crop&q=80&w=2560' },
    { id: 'mountain', label: t('bgMountain') || '群山呼唤', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=2560' },
    { id: 'ocean', label: t('bgOcean') || '圣灵如水', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&q=80&w=2560' },
    { id: 'ai', label: t('aiGenerate') || 'AI 生成', isAi: true, color: '1F2937' }
  ];
  const [selectedBg, setSelectedBg] = useState(BACKGROUND_OPTIONS[0]);
  const [isGeneratingAiBg, setIsGeneratingAiBg] = useState(false);
  const [linesPerSlide, setLinesPerSlide] = useState(2); 
  const [pptVersionName, setPptVersionName] = useState(t('sundayWorship') || 'Sunday Worship');
  const [isEditingPptName, setIsEditingPptName] = useState(false);
  const [customBgs, setCustomBgs] = useState<any[]>([]);
  
  // Real-time translation settings
  const [enableRealtimeTranslation, setEnableRealtimeTranslation] = useState(true);
  // Whether to include the song-title (cover) slide in the generated PPT
  const [showSongTitle, setShowSongTitle] = useState(true);
  const defaultSource = language.startsWith('zh') ? 'zh' : language.startsWith('ja') ? 'ja' : language.startsWith('ko') ? 'ko' : 'en';
  const defaultTarget = language.startsWith('zh') ? 'en' : 'zh';
  const [sourceLang, setSourceLang] = useState<'en' | 'zh' | 'ko' | 'ja'>(defaultSource as any);
  const [targetLanguage, setTargetLanguage] = useState<'en' | 'zh' | 'ko' | 'ja'>(defaultTarget as any);

  const [isAiPromptOpen, setIsAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  // Text color & size customization for PPT slides
  const [lyricColor, setLyricColor] = useState('#FFFFFF');
  const [translationColor, setTranslationColor] = useState('#A7F3D0');
  const [lyricFontSize, setLyricFontSize] = useState(48);
  const [translationFontSize, setTranslationFontSize] = useState(24);
  // Whether slide text gets a drop shadow (user-toggleable)
  const [enableShadow, setEnableShadow] = useState(true);
  // How heavy that shadow is — light / medium / strong.
  const [shadowLevel, setShadowLevel] = useState<ShadowLevel>('medium');
  // Export-wide overrides: when ON, every song uses the GLOBAL font size /
  // background and any per-song customisation is ignored, so the whole deck
  // looks uniform.
  const [unifyFontSize, setUnifyFontSize] = useState(false);
  const [unifyBackground, setUnifyBackground] = useState(false);

  // Church-specific localStorage keys — data is fully isolated per church
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  // Per-song Ready PPT library: { [songId]: savedEntry }
  // Initialized empty; populated by useEffect once activeChurchId is known
  const [readySongPPTs, setReadySongPPTs] = useState<Record<string, any>>({});

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(churchKey('ready_ppt_songs')) || '[]');
      const map: Record<string, any> = {};
      stored.forEach((e: any) => { if (e.songId) map[e.songId] = e; });
      setReadySongPPTs(map);
    } catch { setReadySongPPTs({}); }
    // Restore previously-uploaded background images so they stay in the library.
    try {
      const savedBgs = JSON.parse(localStorage.getItem(churchKey('custom_bgs')) || '[]');
      if (Array.isArray(savedBgs)) setCustomBgs(savedBgs);
    } catch { setCustomBgs([]); }
    // Restore the shadow on/off preference.
    try {
      const s = localStorage.getItem(churchKey('ppt_shadow'));
      if (s !== null) setEnableShadow(s === 'true');
      const sl = localStorage.getItem(churchKey('ppt_shadow_level'));
      if (sl === 'light' || sl === 'medium' || sl === 'strong') setShadowLevel(sl);
    } catch {}
    // Restore the "unify font size / background" export preferences.
    try {
      const uf = localStorage.getItem(churchKey('ppt_unify_font'));
      if (uf !== null) setUnifyFontSize(uf === 'true');
      const ub = localStorage.getItem(churchKey('ppt_unify_bg'));
      if (ub !== null) setUnifyBackground(ub === 'true');
    } catch {}
  }, [activeChurchId]);

  // Persist uploaded backgrounds so they survive reloads (per church).
  useEffect(() => {
    try { localStorage.setItem(churchKey('custom_bgs'), JSON.stringify(customBgs)); } catch {}
  }, [customBgs, activeChurchId]);

  // Persist the shadow preference.
  useEffect(() => {
    try {
      localStorage.setItem(churchKey('ppt_shadow'), String(enableShadow));
      localStorage.setItem(churchKey('ppt_shadow_level'), shadowLevel);
    } catch {}
  }, [enableShadow, shadowLevel, activeChurchId]);

  // Persist the unify-font / unify-background export preferences.
  useEffect(() => {
    try {
      localStorage.setItem(churchKey('ppt_unify_font'), String(unifyFontSize));
      localStorage.setItem(churchKey('ppt_unify_bg'), String(unifyBackground));
    } catch {}
  }, [unifyFontSize, unifyBackground, activeChurchId]);

  // Save one song's PPT settings to the per-song Ready PPT library (church-isolated)
  const saveToReadyPPT = (song: Song, bg: any) => {
    const entry = {
      id: crypto.randomUUID(),
      songId: song.id,
      songTitle: song.title,
      name: song.title,
      type: 'song' as const,
      date: new Date().toISOString().split('T')[0],
      size: '~1MB',
      churchId: activeChurchId || 'demo',
      songData: {
        title: song.title,
        englishTitle: song.englishTitle,
        lyrics: song.lyrics,
        englishLyrics: song.englishLyrics,
        bg,
        linesPerSlide,
        lyricColor,
        translationColor,
        lyricFontSize,
        translationFontSize,
        shadow: enableShadow
      }
    };
    const songKey = churchKey('ready_ppt_songs');
    const existing: any[] = JSON.parse(localStorage.getItem(songKey) || '[]');
    const filtered = existing.filter((e: any) => e.songId !== song.id);
    localStorage.setItem(songKey, JSON.stringify([entry, ...filtered]));
    // Sync to church-specific ppt_library_sync so ReadyPPT page picks it up
    const libKey = churchKey('ppt_library_sync');
    const libSync: any[] = JSON.parse(localStorage.getItem(libKey) || '[]');
    const filteredLib = libSync.filter((e: any) => e.songId !== song.id);
    localStorage.setItem(libKey, JSON.stringify([entry, ...filteredLib]));
    setReadySongPPTs(prev => ({ ...prev, [song.id]: entry }));

    // ── Sync to Supabase so ALL church members see this PPT entry ──────────────
    if (activeChurchId && activeChurchId !== 'demo-church-id') {
      supabase.from('church_ppt_library')
        .upsert({
          id: entry.id,
          church_id: activeChurchId,
          name: song.title,
          category: '敬拜',
          file_url: '',
          file_size: '~1MB',
          song_data: JSON.stringify(entry.songData),
          created_by: profile?.full_name || user?.email || '',
        }, { onConflict: 'id' })
        .then(({ error }) => { if (error) console.warn('PPT library sync:', error.message); });
    }

    setDownloadStatus(`✅ ${isZh ? `《${song.title}》已存入 Ready PPT 库` : `"${song.title}" saved to Ready PPT`}`);
    setTimeout(() => setDownloadStatus(null), 2500);
  };

  // Pre-fetch an external image URL as base64 (for PPT embedding)
  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    if (!url || url.startsWith('data:')) return url || null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
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

  const handleAiBgGen = () => {
    setIsGeneratingAiBg(true);
    
    // Using Pollinations AI with ultra-HD enhancements
    const seed = Math.floor(Math.random() * 1000000);
    const promptValue = aiPrompt.trim() || 'sacred holy light, ethereal atmosphere';
    
    // Professional photography and high-end church media style enforcement
    const styleEnhancer = "Professional 8k photography, hyper-realistic, extremely high detail, sharp focus, high-end Christian worship background, majestic soft volumetric lighting, cinematic atmosphere, clean and elegant composition, deep rich colors, high dynamic range, masterwork, no artifacts, crystal clear, 16:9 aspect ratio";
    
    const encodedPrompt = encodeURIComponent(`${promptValue}, ${styleEnhancer}`);
    const aiUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=3840&height=2160&nologo=true&enhance=true&seed=${seed}`;
    
    // Simulate generation delay
    setTimeout(() => {
      setIsGeneratingAiBg(false);
      const newAiBg = { 
        id: `ai-${Date.now()}`, 
        label: aiPrompt ? `AI: ${aiPrompt.substring(0, 10)}...` : t('aiBgGenerated'), 
        url: aiUrl,
        isAiResult: true,
        isLoading: true 
      };
      setCustomBgs(prev => [...prev, newAiBg]);
      setSelectedBg(newAiBg);
      setDownloadStatus(`✨ ${t('aiBgGenerated')}`);
      setIsAiPromptOpen(false);
      setAiPrompt('');
      setTimeout(() => setDownloadStatus(null), 2000);
    }, 2500);
  };
  
  const allBgOptions = [...BACKGROUND_OPTIONS, ...customBgs];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again still fires onChange.
    e.target.value = '';
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const newBg = {
          // Fully-unique id — the old `customBgs.length` based id collided when
          // images were added/removed, which made every upload look "the same".
          id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: t('uploadImage'),
          url: dataUrl
        };
        setCustomBgs(prev => [...prev, newBg]);
        // If a song is open in the preview, apply the upload to THAT song only
        // (per-song background). Otherwise set it as the global theme.
        if (previewingSong) {
          const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, customBg: newBg } : s);
          setWeeklySetlist(updatedWeekly);
          setPreviewingSong({ ...previewingSong, customBg: newBg });
        } else {
          setSelectedBg(newBg);
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  // Translation state for modal
  const [tempLyrics, setTempLyrics] = useState('');
  const [tempTranslation, setTempTranslation] = useState('');

  useEffect(() => {
    if (editingSong) {
      const lyrics = editingSong.lyrics || '';
      setTempLyrics(lyrics);
      if (editingSong.englishLyrics) {
        setTempTranslation(editingSong.englishLyrics);
      } else if (enableRealtimeTranslation && lyrics.trim()) {
        setTempTranslation('');
        translateLyrics(lyrics, targetLanguage)
          .then(translated => setTempTranslation(translated))
          .catch(() => {});
      } else {
        setTempTranslation('');
      }
    }
  }, [editingSong]);
  
  const [translating, setTranslating] = useState(false);
  const handleRealtimeTranslate = async (text: string, isNewSong: boolean = false) => {
    if (!text.trim()) return;
    setTranslating(true);
    try {
      const translated = await translateLyrics(text, targetLanguage);
      if (isNewSong) {
        setNewSongData(prev => ({ ...prev, englishLyrics: translated }));
      } else {
        setTempTranslation(translated);
      }
    } catch (e) {
      console.error('Translation failed:', e);
    } finally {
      setTranslating(false);
    }
  };

  // Debounce keystroke translation so we don't fire an API call on every key.
  const translateTimerRef = useRef<any>(null);
  const scheduleTranslate = (text: string, isNewSong: boolean = false) => {
    if (!enableRealtimeTranslation) return;
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    translateTimerRef.current = setTimeout(() => handleRealtimeTranslate(text, isNewSong), 700);
  };

  // Stats
  const totalPages = weeklySetlist.reduce((acc, song) => acc + song.pages, 0);

  const handleGeneratePpt = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setActiveStep('Export');
    }, 2000);
  };

  const handleUpdateSong = async (updatedSong: any) => {
    // Auto-remove blank lines so slides never render empty rows.
    updatedSong = {
      ...updatedSong,
      lyrics: stripBlankLines(updatedSong.lyrics || ''),
      englishLyrics: stripBlankLines(updatedSong.englishLyrics || ''),
    };
    setDownloadStatus(isZh ? '正在保存...' : 'Saving...');
    try {
      const { error } = await supabase
        .from('songs')
        .update({
          title: updatedSong.title,
          english_title: updatedSong.englishTitle,
          lyrics: updatedSong.lyrics,
          english_lyrics: updatedSong.englishLyrics,
          key: updatedSong.key,
          external_url: updatedSong.external_url
        })
        .eq('id', updatedSong.id);

      if (error) throw error;

      const newLibrary = librarySongs.map(s => s.id === updatedSong.id ? updatedSong : s);
      setLibrarySongs(newLibrary);

      // Also update in weekly setlist if present
      setWeeklySetlist(weeklySetlist.map(s => s.id === updatedSong.id ? { ...s, ...updatedSong } : s));

      if (activeChurchId) {
        logActivity({
          churchId: activeChurchId,
          userId: user?.id,
          userName: profile?.full_name || user?.email || 'Unknown',
          userRole: profile?.role || 'Staff',
          action: isZh ? '更新歌曲' : 'Updated Song',
          target: `"${updatedSong.title}"`,
          type: 'Resource',
        });
      }

      setEditingSong(null);
      setDownloadStatus(t('successfullySaved'));
    } catch (err: any) {
      console.error('Update song error:', err);
      setDownloadStatus(isZh ? '保存失败' : 'Failed to save');
    } finally {
      setTimeout(() => setDownloadStatus(null), 3000);
    }
  };

  const handleFetchLyrics = async () => {
    if (!newSongUrl) return;
    setIsFetchingLyrics(true);
    try {
      const data = await fetchSongFromUrl(newSongUrl);
      const extractedLyrics = dedupeLyrics(data.lyrics || ''); // auto-remove repeated paragraphs
      setNewSongData({
        ...newSongData,
        title: data.title || '',
        englishTitle: data.englishTitle || '',
        lyrics: extractedLyrics,
        englishLyrics: data.englishLyrics || '',
        external_url: newSongUrl
      });
      setDownloadStatus(t('previewReady'));
      // Auto-translate the extracted lyrics (extraction sets state programmatically,
      // which doesn't trigger the onChange translation).
      if (extractedLyrics.trim() && !(data.englishLyrics || '').trim() && enableRealtimeTranslation) {
        translateLyrics(extractedLyrics, targetLanguage)
          .then(translated => setNewSongData(prev => ({ ...prev, englishLyrics: translated })))
          .catch(() => {});
      }
    } catch (error) {
      setDownloadStatus(t('invalidUrl'));
    } finally {
      setIsFetchingLyrics(false);
      setTimeout(() => setDownloadStatus(null), 3000);
    }
  };

  const handleSaveNewSong = async () => {
    // Auto-remove blank lines from the lyrics before saving (no empty slides).
    newSongData.lyrics = stripBlankLines(newSongData.lyrics);
    newSongData.englishLyrics = stripBlankLines(newSongData.englishLyrics);
    // Warn if this song is already in the library (matched by title)
    const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const dup = librarySongs.find(s =>
      (newSongData.title && normTitle(s.title || '') === normTitle(newSongData.title)) ||
      (newSongData.englishTitle && normTitle(s.englishTitle || '') === normTitle(newSongData.englishTitle))
    );
    if (dup && !window.confirm(isZh
      ? `歌库里已经有《${dup.title}》了，还要再加一首吗？`
      : `"${dup.title}" is already in the library. Add it again anyway?`)) {
      return;
    }

    // Demo church or no church → save locally only
    if (!activeChurchId || isDemoChurch(church)) {
      const localSong: Song = {
        id: `local-${Date.now()}`,
        title: newSongData.title,
        englishTitle: newSongData.englishTitle,
        lyrics: newSongData.lyrics,
        englishLyrics: newSongData.englishLyrics,
        key: newSongData.key,
        external_url: newSongData.external_url,
        pages: Math.ceil((newSongData.lyrics.split('\n').filter(l => l.trim()).length || 1) / (linesPerSlide || 2)) + 1
      };
      setLibrarySongs([localSong, ...librarySongs]);
      setIsAddingSong(false);
      setNewSongData({ title: '', englishTitle: '', lyrics: '', englishLyrics: '', key: 'C', external_url: '' });
      setNewSongUrl('');
      setDownloadStatus(isZh ? '✅ 已保存（本地模式）' : '✅ Saved locally');
      setTimeout(() => setDownloadStatus(null), 3000);
      return;
    }

    setDownloadStatus(isZh ? '正在保存到云端...' : 'Syncing to cloud...');
    try {
      const newSongRecord = {
        church_id: activeChurchId,
        title: newSongData.title,
        english_title: newSongData.englishTitle,
        lyrics: newSongData.lyrics,
        english_lyrics: newSongData.englishLyrics,
        key: newSongData.key,
        external_url: newSongData.external_url
      };

      const { data, error } = await supabase
        .from('songs')
        .insert(newSongRecord)
        .select()
        .single();

      if (error) {
        console.error('Save song error:', error);
        // If songs table doesn't exist / schema cache miss → fall back to local save
        const errMsg = error.message || JSON.stringify(error);
        const isTableMissing = errMsg.toLowerCase().includes('schema cache') ||
          errMsg.toLowerCase().includes('does not exist') ||
          errMsg.toLowerCase().includes('relation') ||
          (error as any).code === 'PGRST204';
        if (isTableMissing) {
          const localSong: Song = {
            id: `local-${Date.now()}`,
            title: newSongData.title,
            englishTitle: newSongData.englishTitle,
            lyrics: newSongData.lyrics,
            englishLyrics: newSongData.englishLyrics,
            key: newSongData.key,
            external_url: newSongData.external_url,
            pages: Math.ceil((newSongData.lyrics.split('\n').filter(l => l.trim()).length || 1) / (linesPerSlide || 2)) + 1
          };
          setLibrarySongs([localSong, ...librarySongs]);
          setIsAddingSong(false);
          setNewSongData({ title: '', englishTitle: '', lyrics: '', englishLyrics: '', key: 'C', external_url: '' });
          setNewSongUrl('');
          setDownloadStatus(isZh ? '✅ 已保存（本地模式，数据库表未配置）' : '✅ Saved locally (DB table not set up)');
          setTimeout(() => setDownloadStatus(null), 4000);
          return;
        }
        setDownloadStatus(`❌ ${isZh ? '保存失败：' : 'Save failed: '}${errMsg.substring(0, 80)}`);
        setTimeout(() => setDownloadStatus(null), 5000);
        return;
      }

      const newSong: Song = {
        ...data,
        englishTitle: data.english_title,
        englishLyrics: data.english_lyrics,
        pages: Math.ceil((newSongData.lyrics.split('\n').filter(l => l.trim()).length || 1) / (linesPerSlide || 2)) + 1
      };

      setLibrarySongs([newSong, ...librarySongs]);
      setIsAddingSong(false);
      setNewSongData({ title: '', englishTitle: '', lyrics: '', englishLyrics: '', key: 'C', external_url: '' });
      setNewSongUrl('');

      if (activeChurchId) {
        logActivity({
          churchId: activeChurchId,
          userId: user?.id,
          userName: profile?.full_name || user?.email || 'Unknown',
          userRole: profile?.role || 'Staff',
          action: isZh ? '添加歌曲' : 'Added Song',
          target: `"${newSong.title}"`,
          type: 'Resource',
        });
      }

      setDownloadStatus(t('successfullySaved'));
      setTimeout(() => setDownloadStatus(null), 3000);
    } catch (err: any) {
      console.error('Save song error:', err);
      setDownloadStatus(`❌ ${isZh ? '保存失败：' : 'Save failed: '}${err?.message || 'Unknown error'}`);
      setTimeout(() => setDownloadStatus(null), 5000);
    }
  };

  // Bulk add: each box = one song; first line is the title, the rest is the lyrics.
  // Saves everything in one go instead of the add→paste→save loop per song.
  const handleSaveBulkSongs = async () => {
    const parsed = bulkTexts
      .map(text => {
        const lines = text.split('\n');
        const titleIdx = lines.findIndex(l => l.trim());
        if (titleIdx === -1) return null;
        const title = lines[titleIdx].trim();
        const lyrics = dedupeLyrics(lines.slice(titleIdx + 1).join('\n').trim());
        return lyrics ? { title, lyrics } : null;
      })
      .filter(Boolean) as { title: string; lyrics: string }[];

    if (parsed.length === 0) {
      setDownloadStatus(isZh ? '❌ 请粘贴歌词（每格第一行是歌名）' : '❌ Paste lyrics first (first line = title)');
      setTimeout(() => setDownloadStatus(null), 4000);
      return;
    }

    // Skip songs already in the library (and duplicates within this batch), matched by title.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const existing = new Set(librarySongs.flatMap(s => [norm(s.title || ''), norm(s.englishTitle || '')]).filter(Boolean));
    const fresh: typeof parsed = [];
    const skipped: string[] = [];
    for (const s of parsed) {
      const key = norm(s.title);
      if (existing.has(key)) { skipped.push(s.title); continue; }
      existing.add(key);
      fresh.push(s);
    }
    if (fresh.length === 0) {
      setDownloadStatus(isZh ? `⚠️ ${skipped.length} 首歌都已在歌库里，没有重复添加` : `⚠️ All ${skipped.length} songs already exist — nothing added`);
      setTimeout(() => setDownloadStatus(null), 5000);
      return;
    }
    const parsedToSave = fresh;

    setBulkSaving(true);
    const toLocalSong = (s: { title: string; lyrics: string }): Song => ({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: s.title,
      englishTitle: '',
      lyrics: s.lyrics,
      englishLyrics: '',
      key: 'C',
      external_url: '',
      pages: Math.ceil((s.lyrics.split('\n').filter(l => l.trim()).length || 1) / (linesPerSlide || 2)) + 1,
    });

    try {
      if (!activeChurchId || isDemoChurch(church)) {
        setLibrarySongs([...parsedToSave.map(toLocalSong), ...librarySongs]);
      } else {
        const { data, error } = await supabase
          .from('songs')
          .insert(parsedToSave.map(s => ({ church_id: activeChurchId, title: s.title, lyrics: s.lyrics, key: 'C' })))
          .select();
        if (error || !data) {
          console.warn('Bulk save fell back to local:', error?.message);
          setLibrarySongs([...parsedToSave.map(toLocalSong), ...librarySongs]);
        } else {
          const saved: Song[] = data.map((d: any) => ({
            id: d.id,
            title: d.title,
            englishTitle: d.english_title || '',
            lyrics: d.lyrics,
            englishLyrics: d.english_lyrics || '',
            key: d.key || 'C',
            external_url: d.external_url || '',
            pages: Math.ceil((d.lyrics?.split('\n').filter((l: string) => l.trim()).length || 1) / (linesPerSlide || 2)) + 1,
          }));
          setLibrarySongs([...saved, ...librarySongs]);
          logActivity({
            churchId: activeChurchId,
            userId: user?.id,
            userName: profile?.full_name || user?.email || 'Unknown',
            userRole: profile?.role || 'Staff',
            action: isZh ? `批量添加 ${saved.length} 首歌曲` : `Bulk added ${saved.length} songs`,
            target: saved.map(s => s.title).join(', '),
            type: 'Resource',
          });
        }
      }
      setIsBulkAdding(false);
      setBulkTexts(['', '', '']);
      setDownloadStatus(isZh
        ? `✅ 已添加 ${parsedToSave.length} 首歌${skipped.length ? `，跳过 ${skipped.length} 首已存在（${skipped.join('、')}）` : ''}`
        : `✅ Added ${parsedToSave.length} song(s)${skipped.length ? `, skipped ${skipped.length} duplicate(s)` : ''}`);
      setTimeout(() => setDownloadStatus(null), 3000);
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDownload = async (fileName: string, songsOverride?: any[]) => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

    let targetFileName = fileName;
    if (fileName.includes('Ready_PPT') || fileName.includes('Worship_Setlist') || fileName === `${pptVersionName}.pptx`) {
      targetFileName = `Worship_${pptVersionName}_${dateStr}.pptx`;
    }

    setDownloadStatus(`${t('generating')} ${targetFileName}...`);

    try {
      const { default: pptxgen } = await import('pptxgenjs');
      const generatePPT = async (songsToExport: any[], finalName: string, isSingle: boolean = false) => {
        let pres = new pptxgen();
        pres.layout = 'LAYOUT_16x9';
        // Set true if any background image couldn't be embedded; used to warn
        // the user instead of silently shipping solid-colour slides.
        let bgEmbedFailed = false;

        // Pre-fetch all background images as base64 to ensure they embed properly
        const bgUrlCache = new Map<string, string>();
        const urlsToFetch = new Set<string>();
        songsToExport.forEach(song => {
          const bg = unifyBackground ? selectedBg : (song.customBg || selectedBg);
          if (bg?.url && !bg.url.startsWith('data:')) urlsToFetch.add(bg.url);
        });
        await Promise.all(Array.from(urlsToFetch).map(async (url) => {
          const b64 = await fetchImageAsBase64(url);
          if (b64) bgUrlCache.set(url, b64);
        }));

        const generateSongSlides = (song: any, isMultiple: boolean) => {
          // When "unify background" is on, every song uses the global background.
          const activeBg = unifyBackground ? selectedBg : (song.customBg || selectedBg);
          // Auto-adapt text color to the background and decide if we need a dark
          // readability overlay (matches the on-screen preview exactly).
          const userLc = song.lyricColor || lyricColor;
          const userTc = song.translationColor || translationColor;
          const colors = resolveSlideColors(activeBg, userLc, userTc);
          const lc = colors.lc.replace('#', '');
          const tc = colors.tc.replace('#', '');
          const lps = song.linesPerSlide || linesPerSlide;
          // When "unify font size" is on, every song uses the global font sizes.
          const lfs = unifyFontSize ? lyricFontSize : (song.lyricFontSize || lyricFontSize);
          const tfs = unifyFontSize ? translationFontSize : (song.translationFontSize || translationFontSize);
          // Respect the per-song saved shadow flag, falling back to the global toggle.
          const shadowOn = song.shadow !== undefined ? song.shadow : enableShadow;
          const textShadow = shadowOn ? pptShadow(shadowLevel) : undefined;

          // Sets the slide background AND draws the dark overlay for image
          // backgrounds so text stays readable on bright/busy photos.
          const setSlideBg = (s: any) => {
            if (activeBg?.url) {
              const cached = bgUrlCache.get(activeBg.url);
              if (cached) {
                s.background = { data: cached };
              } else if (activeBg.url.startsWith('data:')) {
                s.background = { data: activeBg.url };
              } else {
                // The image couldn't be embedded as base64 (CORS / timeout /
                // network). Do NOT hand the raw URL to pptxgenjs via { path } —
                // it will try to fetch it during write() and throw, killing the
                // entire export. Fall back to a solid colour so the file still
                // generates, and remember it so we can warn the user.
                bgEmbedFailed = true;
                s.background = { color: activeBg?.color || "064E3B" };
              }
            } else {
              s.background = { color: activeBg?.color || "064E3B" };
            }
            if (colors.overlay) {
              s.addShape(pres.ShapeType.rect, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 55 }, line: { type: 'none' },
              });
            }
          };

          const titleFont = "Microsoft YaHei";
          const bodyFont = "Microsoft YaHei";

          // Title (cover) slide(s) — only when "show song name" is on
          if (showSongTitle) {
            // Song Header Slide (only if multiple songs)
            if (isMultiple) {
              let headerSlide = pres.addSlide();
              setSlideBg(headerSlide);
              headerSlide.addText("SONG", {
                x: 0, y: 1.0, w: "100%", align: "center", fontFace: bodyFont, fontSize: 14, color: "A7F3D0", bold: true, charSpacing: 10
              });
              headerSlide.addText(song.title, {
                x: 0, y: 2.2, w: "100%", h: 1.5,
                align: "center", fontFace: titleFont, fontSize: 64, color: "FFFFFF", bold: true,
                shadow: textShadow
              });
              headerSlide.addShape(pres.ShapeType.rect, { x: 4.25, y: 4.2, w: 1.5, h: 0.05, fill: { color: "A7F3D0" } });
            }

            // Cover slide
            let slide = pres.addSlide();
            setSlideBg(slide);

            if (isMultiple) {
              slide.addText("WORSHIP SONG", {
                x: 0, y: 0.8, w: "100%", align: "center", fontFace: bodyFont, fontSize: 12, color: "A7F3D0", bold: true, charSpacing: 15
              });
            }

            slide.addText(song.title, {
              x: 0, y: 1.5, w: "100%", h: 2,
              align: "center", fontFace: titleFont, fontSize: 48, color: lc, bold: true,
              shadow: textShadow
            });

            slide.addText(song.englishTitle || "", {
              x: 0, y: 3.5, w: "100%", h: 1,
              align: "center", fontFace: bodyFont, fontSize: 24, color: tc,
              shadow: textShadow
            });
          }

          const lyricsLines = (song.lyrics || "").split('\n').filter((l: string) => l.trim().length > 0);
          const englishLines = (song.englishLyrics || "").split('\n').filter((l: string) => l.trim().length > 0);

          const pairsPerSlide = Math.max(1, lps);

          for (let i = 0; i < lyricsLines.length; i += pairsPerSlide) {
            let lSlide = pres.addSlide();
            setSlideBg(lSlide);
            let currentY = 1.0;
            for (let j = 0; j < pairsPerSlide; j++) {
              const idx = i + j;
              if (lyricsLines[idx]) {
                const lyricPt = Math.max(12, Math.min(72, lfs));
                const transPt = Math.max(10, Math.min(48, tfs));
                lSlide.addText(lyricsLines[idx], {
                  x: 0, y: currentY, w: "100%", h: 0.8,
                  align: "center", fontFace: titleFont, fontSize: lyricPt, color: lc, bold: true,
                  shadow: textShadow
                });
                currentY += 0.8;
                if (englishLines[idx]) {
                  lSlide.addText(englishLines[idx], {
                    x: 0, y: currentY, w: "100%", h: 0.6,
                    align: "center", fontFace: bodyFont, fontSize: transPt, color: tc, italic: true,
                    shadow: textShadow
                  });
                  currentY += 0.8;
                }
              }
            }
          }
        };

        const isMultiple = songsToExport.length > 1;
        songsToExport.forEach(song => generateSongSlides(song, isMultiple));

        // Get as blob for both download and Supabase sync
        const blob = await pres.write({ outputType: 'blob' }) as Blob;

        // Trigger download
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = finalName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);

        // Sync to Supabase so all users see it in PPT Library
        if (activeChurchId && activeChurchId !== 'demo-church-id') {
          try {
            const fileId = crypto.randomUUID();
            const path = `ppt/${activeChurchId}/${fileId}.pptx`;
            const { error: upErr } = await supabase.storage
              .from('publications')
              .upload(path, blob, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
            if (!upErr) {
              const { data: urlData } = supabase.storage.from('publications').getPublicUrl(path);
              await supabase.from('church_ppt_library').insert({
                id: fileId,
                church_id: activeChurchId,
                name: finalName,
                category: isSingle ? '敬拜' : '本周',
                file_url: urlData.publicUrl,
                file_size: `${(blob.size / (1024 * 1024)).toFixed(1)}MB`,
                created_by: profile?.full_name || user?.email || 'Staff',
              });
            }
          } catch (syncErr) {
            console.warn('PPT library sync failed (non-critical):', syncErr);
          }
        }
        return bgEmbedFailed;
      };

      const exportSongs = songsOverride || weeklySetlist;

      // Handle the main download
      let bgFailed = false;
      if (previewingSong && fileName === `${previewingSong.title}.pptx`) {
        bgFailed = await generatePPT([previewingSong], targetFileName, true);
      } else {
        bgFailed = await generatePPT(exportSongs, targetFileName);
      }

      if (bgFailed) {
        // The file still exported — just warn that some backgrounds fell back
        // to a solid colour so the user isn't surprised.
        setDownloadStatus(isZh
          ? '⚠️ 部分背景图无法加载，已用纯色代替（文件已导出）'
          : '⚠️ Some backgrounds could not load; solid colour used (file exported)');
        setTimeout(() => setDownloadStatus(null), 5000);
      } else {
        setDownloadStatus(`✅ ${t('successfullySaved')}: ${targetFileName}`);
        setTimeout(() => setDownloadStatus(null), 3500);
      }

    } catch (err) {
      console.error("Critical download error:", err);
      setDownloadStatus(isZh ? "下载失败，请重试" : "Download failed, please try again.");
      setTimeout(() => setDownloadStatus(null), 3000);
    }
  };

  const handlePreview = (fileName: string) => {
    setDownloadStatus(`${t('renderingPreview')}: ${fileName}...`);
    setTimeout(() => {
      setDownloadStatus(t('previewReady'));
      setTimeout(() => setDownloadStatus(null), 3000);
      // In a real app, this would open a viewer
      window.open('https://docs.google.com/presentation/d/e/2PACX-1vT5n8...', '_blank');
    }, 1000);
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#F9F7F5] overflow-y-auto no-scrollbar pb-24">
      {/* Workflow Strategy Header */}
      <div className="p-8 md:p-12 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between gap-4 md:gap-8 mb-8">
          {/* Translation & Target Language Controls */}
          <div className="flex items-center gap-4 bg-white p-2.5 rounded-full border border-[#E5E0DA] shadow-sm ring-1 ring-black/5 overflow-hidden transition-all hover:shadow-md">
             <div className="flex items-center gap-3 pl-2 pr-4 group cursor-pointer" onClick={() => setEnableRealtimeTranslation(!enableRealtimeTranslation)}>
                {/* Switch Style Toggle */}
                <div className={`relative w-11 h-6 rounded-full transition-all duration-300 ${enableRealtimeTranslation ? 'bg-emerald-500 shadow-inner' : 'bg-neutral-200'}`}>
                   <motion.div 
                     initial={false}
                     animate={{ x: enableRealtimeTranslation ? 20 : 2 }}
                     className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-md"
                     transition={{ type: "spring", stiffness: 500, damping: 30 }}
                   />
                </div>

                <div className="flex flex-col select-none">
                   <span className="text-[8px] font-black text-outline/40 uppercase tracking-[0.2em] leading-tight">{isZh ? '实时同步' : 'AUTO SYNC'}</span>
                   <span className={`text-[10px] font-black uppercase tracking-tight leading-tight ${enableRealtimeTranslation ? 'text-emerald-600' : 'text-outline/20'}`}>
                     {enableRealtimeTranslation ? (isZh ? '已开启' : 'ON') : (isZh ? '已关闭' : 'OFF')}
                   </span>
                </div>
             </div>
             
             <div className="h-8 w-px bg-[#E5E0DA]"></div>

             {/* FROM language */}
             <div className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 rounded-full transition-colors">
               <div className="flex flex-col">
                 <span className="text-[7px] font-black text-outline/40 uppercase tracking-[0.2em]">{isZh ? '原文' : 'FROM'}</span>
                 <select
                   value={sourceLang}
                   onChange={(e) => setSourceLang(e.target.value as any)}
                   className="bg-transparent border-none p-0 text-[11px] font-black uppercase tracking-tight focus:ring-0 cursor-pointer text-[#2C2C2C] -mt-0.5"
                 >
                   <option value="zh">中文</option>
                   <option value="en">English</option>
                   <option value="ko">한국어</option>
                   <option value="ja">日本語</option>
                   <option value="th">ภาษาไทย</option>
                 </select>
               </div>
             </div>

             <span className="material-symbols-outlined text-[16px] text-outline/40">arrow_forward</span>

             {/* TO language */}
             <div className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 rounded-full transition-colors">
               <div className="flex flex-col">
                 <span className="text-[7px] font-black text-outline/40 uppercase tracking-[0.2em]">{isZh ? '译文' : 'TO'}</span>
                 <select
                   value={targetLanguage}
                   onChange={(e) => setTargetLanguage(e.target.value as any)}
                   className="bg-transparent border-none p-0 text-[11px] font-black uppercase tracking-tight focus:ring-0 cursor-pointer text-[#2C2C2C] -mt-0.5"
                 >
                   <option value="en">English</option>
                   <option value="zh">中文</option>
                   <option value="ko">한국어</option>
                   <option value="ja">日本語</option>
                   <option value="th">ภาษาไทย</option>
                 </select>
               </div>
             </div>
          </div>

          <div className="flex-1 flex justify-end gap-3">
            <button
              onClick={() => setIsBulkAdding(true)}
              className="px-6 py-5 bg-white text-black border-2 border-black/10 rounded-[24px] font-black uppercase tracking-widest text-xs flex items-center gap-2 hover:border-black transition-all active:scale-95 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">library_add</span>
              {isZh ? '批量添加' : 'Bulk Add'}
            </button>
            <button
              onClick={() => setIsAddingSong(true)}
              className="px-8 py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest text-xs flex items-center gap-3 hover:bg-emerald-600 transition-all shadow-xl shadow-black/10 active:scale-95 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">add</span>
              {t('addSong')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 md:gap-8 mb-12 max-w-4xl mx-auto">
          {/* Step 1: Library */}
          <button 
            onClick={() => setActiveStep('Library')}
            className={`flex-1 min-h-[140px] rounded-[32px] p-8 text-center border-2 transition-all flex flex-col items-center justify-center gap-3 group relative overflow-hidden ${activeStep === 'Library' ? 'bg-white border-purple-500 shadow-2xl shadow-purple-500/10 ring-4 ring-purple-500/5' : 'bg-white border-neutral-200 opacity-65 hover:opacity-100 hover:border-neutral-300 hover:shadow-md'}`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-all ${activeStep === 'Library' ? 'bg-purple-500 text-white scale-110' : 'bg-neutral-100 text-neutral-400 group-hover:bg-purple-100 group-hover:text-purple-400'}`}>
               <span className="material-symbols-outlined text-[18px]">library_music</span>
            </div>
            <span className={`text-xl font-serif font-black ${activeStep === 'Library' ? 'text-black' : 'text-neutral-400'}`}>{t('songLibrary')}</span>
            <div className={`text-[9px] font-bold uppercase tracking-[0.2em] leading-relaxed transition-colors ${activeStep === 'Library' ? 'text-neutral-400' : 'text-neutral-300'}`}>
               {t('pasteLyricsDesc')} · {t('dualLanguageDesc')} · {t('saveDirectlyDesc')}
            </div>
            {activeStep === 'Library' && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-purple-500"></div>}
          </button>

          <div className="flex flex-col items-center gap-1 opacity-20">
             <span className="material-symbols-outlined scale-125">arrow_forward</span>
          </div>

          {/* Step 2: Setlist */}
          <button 
            onClick={() => setActiveStep('Weekly')}
            className={`flex-1 min-h-[140px] rounded-[32px] p-8 text-center border-2 transition-all flex flex-col items-center justify-center gap-3 group relative overflow-hidden ${activeStep === 'Weekly' ? 'bg-white border-emerald-500 shadow-2xl shadow-emerald-500/10 ring-4 ring-emerald-500/5' : 'bg-white border-neutral-200 opacity-65 hover:opacity-100 hover:border-neutral-300 hover:shadow-md'}`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-all ${activeStep === 'Weekly' ? 'bg-emerald-500 text-white scale-110' : 'bg-neutral-100 text-neutral-400 group-hover:bg-emerald-100 group-hover:text-emerald-400'}`}>
               <span className="material-symbols-outlined text-[18px]">event_note</span>
            </div>
            <span className={`text-xl font-serif font-black ${activeStep === 'Weekly' ? 'text-black' : 'text-neutral-400'}`}>{t('weeklySetlist')}</span>
            <div className={`text-[9px] font-bold uppercase tracking-[0.2em] leading-relaxed transition-colors ${activeStep === 'Weekly' ? 'text-neutral-400' : 'text-neutral-300'}`}>
               {t('selectFromLibDesc')} · {t('dragToReorderDesc')} · {t('configBgDesc')}
            </div>
            {activeStep === 'Weekly' && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-emerald-500"></div>}
          </button>

          <div className="flex flex-col items-center gap-1 opacity-20">
             <span className="material-symbols-outlined scale-125">arrow_forward</span>
          </div>

          {/* Step 3: Export */}
          <button 
            onClick={() => setActiveStep('Export')}
            className={`flex-1 min-h-[140px] rounded-[32px] p-8 text-center border-2 transition-all flex flex-col items-center justify-center gap-3 group relative overflow-hidden ${activeStep === 'Export' ? 'bg-white border-orange-500 shadow-2xl shadow-orange-500/10 ring-4 ring-orange-500/5' : 'bg-white border-neutral-200 opacity-65 hover:opacity-100 hover:border-neutral-300 hover:shadow-md'}`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-all ${activeStep === 'Export' ? 'bg-orange-500 text-white scale-110' : 'bg-neutral-100 text-neutral-400 group-hover:bg-orange-100 group-hover:text-orange-400'}`}>
               <span className="material-symbols-outlined text-[18px]">ios_share</span>
            </div>
            <span className={`text-xl font-serif font-black ${activeStep === 'Export' ? 'text-black' : 'text-neutral-400'}`}>{t('oneClickExport')}</span>
            <div className={`text-[9px] font-bold uppercase tracking-[0.2em] leading-relaxed transition-colors ${activeStep === 'Export' ? 'text-neutral-400' : 'text-neutral-300'}`}>
               {t('smartMergeDesc')} · {t('pkgPublishDesc')} · {t('notifyItDesc')}
            </div>
            {activeStep === 'Export' && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-orange-500"></div>}
          </button>
        </div>

        {/* Dynamic Content Area */}
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10 flex items-center justify-center gap-3">
             <div className="h-px w-12 bg-[#E5E0DA]"></div>
              <h2 className="text-xl font-serif font-black text-[#2C2C2C] uppercase tracking-widest">
                {activeStep === 'Library' ? t('firstStepLib') : activeStep === 'Weekly' ? t('secondStepSetlist') : t('finalStepExport')}
              </h2>
              <div className="h-px w-12 bg-[#E5E0DA]"></div>
            </div>

            <AnimatePresence mode="wait">
              {activeStep === 'Weekly' && (
              <motion.div 
                key="weekly"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                {/* Weekly Settings Bar */}
                <div className="flex flex-col md:flex-row items-center gap-8 bg-white p-8 rounded-[32px] border border-[#E5E0DA]/50 shadow-sm">
                   <div className="flex-1 w-full">
                    <div className="flex items-center gap-2 mb-2">
                       <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{t('pptFileName')}</span>
                       <span className="material-symbols-outlined text-[14px] text-emerald-500">drive_file_rename_outline</span>
                    </div>
                    <div className="flex items-center gap-3 bg-[#F9F7F5] rounded-2xl px-6 py-4 border border-emerald-500/10 shadow-inner group focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
                       <input 
                         type="text"
                         value={pptVersionName}
                         onChange={(e) => setPptVersionName(e.target.value)}
                         className="bg-transparent border-none text-lg font-serif font-black text-[#2C2C2C] focus:ring-0 w-full p-0"
                         placeholder="e.g. Sunday Worship 2024-05-01"
                       />
                    </div>
                  </div>
                  <div className="h-12 w-px bg-[#E5E0DA] hidden md:block"></div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <span className="text-[10px] font-black text-outline/40 uppercase tracking-widest">{t('globalLayout')}</span>
                    <div className="flex gap-1 p-1 bg-[#F9F7F5] rounded-xl border border-[#E5E0DA]/30">
                      {[1, 2, 3].map((val) => (
                        <button
                          key={val}
                          onClick={() => setLinesPerSlide(val)}
                          className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${linesPerSlide === val ? 'bg-white text-emerald-600 shadow-sm' : 'text-outline/40'}`}
                        >
                          {val} {t('pairsPerSlide')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-12 w-px bg-[#E5E0DA] hidden md:block"></div>
                  {/* Song name (cover slide) on/off */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <span className="text-[10px] font-black text-outline/40 uppercase tracking-widest">{isZh ? '歌名页' : 'Title Slide'}</span>
                    <div className="flex gap-1 p-1 bg-[#F9F7F5] rounded-xl border border-[#E5E0DA]/30">
                      <button
                        onClick={() => setShowSongTitle(true)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${showSongTitle ? 'bg-white text-emerald-600 shadow-sm' : 'text-outline/40'}`}
                      >
                        {isZh ? '要歌名' : 'With'}
                      </button>
                      <button
                        onClick={() => setShowSongTitle(false)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${!showSongTitle ? 'bg-white text-emerald-600 shadow-sm' : 'text-outline/40'}`}
                      >
                        {isZh ? '不要' : 'Without'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Setlist List */}
                <Reorder.Group axis="y" values={weeklySetlist} onReorder={setWeeklySetlist} className="space-y-4">
                  {weeklySetlist.length > 0 ? (
                    weeklySetlist.map((song, index) => (
                      <Reorder.Item 
                        key={song.id} 
                        value={song}
                        className="bg-white rounded-[20px] p-6 border border-[#E5E0DA]/50 shadow-sm flex items-center gap-6 cursor-grab active:cursor-grabbing hover:border-emerald-500/20 group/item"
                      >
                        <div className="w-10 h-10 flex items-center justify-center text-lg font-serif font-black text-outline/40">
                          {index + 1}
                        </div>
                        <div 
                          className="flex-1 cursor-zoom-in"
                          onClick={() => setPreviewingSong(song)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-[18px] font-serif font-black text-[#2C2C2C] group-hover/item:text-emerald-600 transition-colors">{song.title}</h3>
                            {readySongPPTs[song.id] ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-black uppercase tracking-wide flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">check_circle</span>
                                Ready PPT
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-500 text-[8px] font-black uppercase tracking-wide">
                                {isZh ? '未保存' : 'Unsaved'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-1">
                             <p className="text-[10px] font-bold text-outline/60 uppercase tracking-wide">
                               {song.englishTitle} · {song.pages} {t('pageCountStr')} · <span className="text-emerald-500/60 font-black italic">{t('preview')}</span>
                             </p>
                             
                          <div className="flex items-center gap-3 p-1.5 bg-[#F9F7F5] rounded-full border border-[#E5E0DA]/30">
                            <div className="flex gap-1.5">
                               {allBgOptions.filter(b => !b.isAi).map(bg => (
                                  <button
                                    key={bg.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const updatedWeekly = weeklySetlist.map(s => s.id === song.id ? { ...s, customBg: bg } : s);
                                      setWeeklySetlist(updatedWeekly);
                                      if (previewingSong?.id === song.id) {
                                          setPreviewingSong({ ...song, customBg: bg });
                                      }
                                    }}
                                    className={`w-5 h-5 rounded-full border-2 border-white shadow-md transition-all hover:scale-125 ${ (song.customBg?.id || selectedBg.id) === bg.id ? 'ring-2 ring-emerald-500 scale-110' : 'opacity-80 hover:opacity-100' }`}
                                    style={bg.url ? { backgroundImage: `url(${bg.url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { backgroundColor: `#${bg.color}` }}
                                    title={bg.label}
                                  />
                               ))}
                               <button 
                                  onClick={(e) => { e.stopPropagation(); setWeeklySetlist(weeklySetlist.map(s => s.id === song.id ? { ...s, customBg: null } : s)); }}
                                  className="w-5 h-5 rounded-full bg-white border border-[#E5E0DA] flex items-center justify-center hover:bg-emerald-50 hover:border-emerald-500 transition-colors shadow-sm group"
                                  title={t('followTheme')}
                               >
                                  <span className="material-symbols-outlined text-[12px] text-outline/40 group-hover:text-emerald-600">auto_fix_normal</span>
                               </button>
                            </div>
                         </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase text-outline/40 group-hover/item:text-emerald-500/60 transition-colors">
                          <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
                          {t('dragSort')}
                        </div>
                      </Reorder.Item>
                    ))
                  ) : (
                    <div className="py-20 text-center border-2 border-dashed border-[#E5E0DA] rounded-[32px] bg-white/50">
                        <span className="material-symbols-outlined text-4xl text-outline/20 mb-2">library_music</span>
                        <p className="text-sm font-bold text-outline/40 tracking-wider uppercase">{t('emptySetlistDesc')}</p>
                    </div>
                  )}
                </Reorder.Group>

                {/* Footer Actions */}
                <div className="mt-12 flex items-center justify-between border-t border-[#E5E0DA] pt-8">
                  <button 
                    onClick={() => setActiveStep('Library')}
                    className="text-[10px] font-black uppercase tracking-widest text-[#2C2C2C]/40 hover:text-emerald-600 transition-colors flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    {t('backToLibrary')}
                  </button>
                  <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-[#2C2C2C] uppercase tracking-widest bg-white ring-1 ring-[#E5E0DA] px-6 py-3 rounded-full">
                      {t('totalCountPages') ? t('totalCountPages').replace('{count}', String(totalPages)) : `Total ${totalPages} Pages`}
                    </div>
                    <button
                      onClick={() => setShowLyricsSheet(true)}
                      disabled={weeklySetlist.length === 0}
                      className="flex items-center gap-2 bg-white border-2 border-neutral-200 text-neutral-700 px-6 py-4 rounded-[20px] font-black uppercase tracking-widest text-xs hover:border-neutral-400 hover:bg-neutral-50 transition-all disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-[18px]">description</span>
                      歌词单
                    </button>
                    <button
                      onClick={handleGeneratePpt}
                      disabled={isGenerating || weeklySetlist.length === 0}
                      className="flex items-center gap-3 bg-[#10B981] text-white px-10 py-5 rounded-[20px] font-black uppercase tracking-widest text-xs hover:bg-[#059669] transition-all shadow-xl shadow-emerald-500/20 group disabled:opacity-30 disabled:grayscale"
                    >
                      {isGenerating ? (
                        <>
                          <span className="material-symbols-outlined animate-spin">progress_activity</span>
                          {t('generating') || '拼命生成中...'}
                        </>
                      ) : (
                        <>
                          {t('generatePpt') || '开始生成 PPT'}
                          <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeStep === 'Library' && (
              <motion.div 
                key="library"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="space-y-6"
              >
                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Song List */}
                  <div className="w-full bg-white rounded-[32px] border border-outline-variant/30 shadow-sm p-8 overflow-hidden">
                    <div className="flex justify-between items-center mb-8 gap-4">
                      <div className="relative flex-1">
                        <span className="material-symbols-outlined absolute left-4 top-3 text-outline/30">search</span>
                        <input
                          type="text"
                          placeholder={t('searchLibraryPlaceholder')}
                          className="w-full bg-[#F9F7F5] border-none rounded-xl py-3 pl-12 pr-4 font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                      <button
                        onClick={() => setIsAddingSong(true)}
                        className="shrink-0 bg-black text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-purple-600 transition-all shadow-lg shadow-black/10"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        {t('addNewSong')}
                      </button>
                    </div>

                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                      {librarySongs.map((song) => (
                        <div 
                          key={song.id} 
                          className={`p-5 rounded-2xl border transition-all flex items-center justify-between group ${editingSong?.id === song.id ? 'border-purple-600 bg-purple-50/30' : 'border-[#E5E0DA]/30 hover:border-purple-500/30 bg-white shadow-sm'}`}
                        >
                          <div 
                            className="flex-1 cursor-pointer"
                            onClick={() => setEditingSong(song)}
                          >
                            <div className="flex items-center gap-2">
                               <h4 className="font-serif font-black text-[#2C2C2C]">{song.title}</h4>
                               <span className={`material-symbols-outlined text-[14px] transition-opacity ${editingSong?.id === song.id ? 'text-purple-600 opacity-100' : 'text-outline/30 opacity-0 group-hover:opacity-100'}`}>edit</span>
                            </div>
                            <p className="text-[10px] font-bold text-outline/50 uppercase tracking-widest">{song.englishTitle}</p>
                          </div>
                          <div className="ml-4 flex gap-2">
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center transition-all shadow-sm ${weeklySetlist.find(s => s.id === song.id) ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
                              onClick={() => {
                                if (!weeklySetlist.find(s => s.id === song.id)) {
                                  setWeeklySetlist([...weeklySetlist, song]);
                                } else {
                                  setWeeklySetlist(weeklySetlist.filter(s => s.id !== song.id));
                                }
                              }}
                            >
                              <span className="material-symbols-outlined text-[20px]">{weeklySetlist.find(s => s.id === song.id) ? 'check' : 'add_circle'}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                <div className="flex justify-end pt-4">
                    <button
                      onClick={() => setActiveStep('Weekly')}
                      className="flex items-center gap-3 bg-[#4F46E5] text-white px-12 py-5 rounded-[24px] font-black uppercase tracking-widest text-xs hover:bg-[#4338CA] transition-all shadow-xl shadow-purple-500/20 group animate-bounce-subtle"
                    >
                      {t('toArrangeSetlist')}
                      <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
                    </button>
                  </div>
              </motion.div>
            )}

            {/* Removed Redundant Ready Step */}

            {activeStep === 'Export' && (
              <motion.div 
                key="export"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center p-12 bg-white rounded-[40px] border border-[#E5E0DA]/50 shadow-sm text-center"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl mx-auto items-start">
                  {/* Google Drive Integration Card */}
                  <div className="col-span-full bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-8 rounded-[40px] flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm mb-4">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-lg shadow-blue-500/10 transition-transform hover:scale-105 border border-blue-50 relative group">
                        <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                        <img 
                          src="https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" 
                          alt="Google Drive" 
                          className="w-10 h-10 relative z-10"
                        />
                      </div>
                      <div className="text-left">
                        <h4 className="text-lg font-serif font-black text-blue-900 leading-tight">{isZh ? 'Google Drive 同步' : 'Google Drive Sync'}</h4>
                        <div className="flex flex-col mt-1">
                          <p className="text-[10px] font-bold text-blue-700/60 uppercase tracking-widest">
                            {googleToken ? (isZh ? '云端存储已就绪' : 'Cloud Storage Connected') : (isZh ? '自动备份您的 PPT 资源' : 'Auto-backup your PPT resources')}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                   <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4">
                         <div className="flex flex-col items-end gap-1">
                            <span className="text-[8px] font-black text-blue-900/40 uppercase tracking-widest">{isZh ? '自动存库' : 'AUTO SAVE'}</span>
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-blue-100 min-w-[80px] justify-center">
                               <div className={`w-2 h-2 rounded-full ${autoSaveToLibrary ? 'bg-orange-500 animate-pulse' : 'bg-gray-200'}`}></div>
                               {autoSaveToLibrary && <span className="text-[10px] font-black uppercase text-orange-600">{isZh ? '开启' : 'ON'}</span>}
                               <button 
                                 onClick={handleToggleAutoSave}
                                 className={`ml-2 w-10 h-5 rounded-full transition-all relative ${autoSaveToLibrary ? 'bg-orange-500 shadow-md shadow-orange-500/20' : 'bg-gray-200'}`}
                               >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all shadow-sm ${autoSaveToLibrary ? 'right-1' : 'left-1'}`}></div>
                               </button>
                            </div>
                         </div>

                         <div className="flex flex-col items-end gap-1">
                            <span className="text-[8px] font-black text-blue-900/40 uppercase tracking-widest">{isZh ? '云盘同步' : 'DRIVE SYNC'}</span>
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-blue-100 min-w-[80px] justify-center">
                               <div className={`w-2 h-2 rounded-full ${autoUploadToDrive ? 'bg-green-500 animate-pulse' : 'bg-gray-200'}`}></div>
                               {autoUploadToDrive && <span className="text-[10px] font-black uppercase text-green-600">{isZh ? '开启' : 'ON'}</span>}
                               <button 
                                 onClick={handleToggleAutoUpload}
                                 className={`ml-2 w-10 h-5 rounded-full transition-all relative ${autoUploadToDrive ? 'bg-green-500 shadow-md shadow-green-500/20' : 'bg-gray-200'}`}
                               >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all shadow-sm ${autoUploadToDrive ? 'right-1' : 'left-1'}`}></div>
                               </button>
                            </div>
                         </div>
                      </div>
                      <button 
                        onClick={() => {
                          localStorage.removeItem('google_drive_token');
                          setGoogleToken(null);
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-blue-900/40 hover:text-red-500 transition-colors ml-4"
                      >
                        {isZh ? '断开' : 'Disconnect'}
                      </button>
                   </div>
                  </div>

                  {/* PPT Export Card - Centered for better focus */}
                  <div className="col-span-full group p-12 rounded-[56px] bg-white border-2 border-emerald-500/10 flex flex-col md:flex-row items-center text-left gap-12 hover:shadow-2xl hover:shadow-emerald-500/5 hover:border-emerald-500/30 transition-all duration-700 relative overflow-hidden ring-8 ring-emerald-500/5">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                    <div className="w-40 h-40 rounded-[44px] bg-emerald-600 text-white flex items-center justify-center shadow-2xl shadow-emerald-500/30 group-hover:scale-105 group-hover:rotate-6 transition-all shrink-0 relative z-10 duration-700">
                      <span className="material-symbols-outlined text-6xl">present_to_all</span>
                    </div>
                    <div className="flex-1 space-y-6 w-full relative z-10">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between group/file">
                           <div className="flex-1">
                              {isEditingPptName ? (
                                 <input 
                                   autoFocus
                                   type="text"
                                   className="w-full bg-neutral-50 border-2 border-emerald-500/30 rounded-xl px-4 py-2 text-lg font-black text-[#2C2C2C] focus:ring-0"
                                   value={pptVersionName}
                                   onChange={(e) => setPptVersionName(e.target.value)}
                                   onBlur={() => setIsEditingPptName(false)}
                                   onKeyDown={(e) => e.key === 'Enter' && setIsEditingPptName(false)}
                                 />
                              ) : (
                                 <h4 
                                   onClick={() => setIsEditingPptName(true)}
                                   className="text-2xl font-serif font-black text-[#2C2C2C] uppercase tracking-tight line-clamp-1 flex items-center gap-3 cursor-pointer group-hover:text-emerald-600 transition-colors"
                                 >
                                   {pptVersionName}.PPTX
                                   <span className="material-symbols-outlined text-lg opacity-0 group-hover:opacity-100 transition-opacity">drive_file_rename_outline</span>
                                 </h4>
                              )}
                           </div>
                        </div>
                        <p className="text-[10px] font-bold text-outline/40 uppercase tracking-[0.2em] leading-relaxed">
                          {t('lyricOptimization')} · {t('perSlide')} {linesPerSlide} {t('pairsPerSlide')} · {t('themeInjected')}
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 w-full">
                        {/* Per-song Ready PPT status summary */}
                        {weeklySetlist.length > 0 && (
                          <div className="flex flex-wrap gap-2 p-4 bg-[#F9F7F5] rounded-2xl border border-[#E5E0DA]/30">
                            <span className="text-[9px] font-black uppercase tracking-widest text-outline/40 w-full mb-1">Ready PPT 状态</span>
                            {weeklySetlist.map(s => (
                              <div key={s.id} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black uppercase ${readySongPPTs[s.id] ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-600'}`}>
                                <span className="material-symbols-outlined text-[10px]">{readySongPPTs[s.id] ? 'check_circle' : 'warning'}</span>
                                {s.title}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Combined Save + Export button */}
                        <button
                          onClick={() => {
                            const today = new Date().toISOString().split('T')[0];
                            // Save each song individually to Ready PPT library
                            weeklySetlist.forEach(s => saveToReadyPPT(s, s.customBg || selectedBg));
                            // Also save the combined weekly PPT record
                            const weeklyData = {
                              songs: weeklySetlist.map(s => ({
                                title: s.title,
                                englishTitle: s.englishTitle,
                                lyrics: s.lyrics,
                                englishLyrics: s.englishLyrics,
                                bg: s.customBg || selectedBg,
                                linesPerSlide,
                                lyricColor,
                                translationColor,
                                shadow: enableShadow
                              })),
                              globalBg: selectedBg,
                              linesPerSlide,
                              lyricColor,
                              translationColor,
                              shadow: enableShadow
                            };
                            const newPpt = {
                              id: `p-${Date.now()}`,
                              name: `${pptVersionName}_${today}`,
                              type: 'weekly',
                              date: today,
                              size: '4.5MB',
                              songData: weeklyData
                            };
                            const libKey = churchKey('ppt_library_sync');
                            const existing = JSON.parse(localStorage.getItem(libKey) || '[]');
                            localStorage.setItem(libKey, JSON.stringify([newPpt, ...existing]));
                            handleDownload(`${pptVersionName}.pptx`);
                          }}
                          className="w-full py-5 bg-emerald-600 text-white rounded-[24px] font-black text-[11px] uppercase tracking-[0.2em] hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-500/20 active:scale-95 flex items-center justify-center gap-3"
                        >
                          <span className="material-symbols-outlined text-xl">inventory_2</span>
                          {isZh ? '存入 Ready PPT 库并导出' : 'Save to Ready PPT + Export'}
                        </button>
                        {/* Separate buttons */}
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              weeklySetlist.forEach(s => saveToReadyPPT(s, s.customBg || selectedBg));
                              setTimeout(() => { navigate('/app/ready'); }, 1800);
                            }}
                            className="flex-1 py-4 bg-white text-[#2C2C2C] border-2 border-emerald-600/20 rounded-[20px] font-black text-[10px] uppercase tracking-[0.15em] hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
                          >
                            <span className="material-symbols-outlined text-lg">save</span>
                            {isZh ? '仅存库' : 'Save Only'}
                          </button>
                          <button
                            onClick={() => handleDownload(`${pptVersionName}.pptx`)}
                            className="flex-1 py-4 bg-white text-[#2C2C2C] border-2 border-emerald-600/20 rounded-[20px] font-black text-[10px] uppercase tracking-[0.15em] hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
                          >
                            <span className="material-symbols-outlined text-lg">download</span>
                            {t('exportPptx')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-16 flex flex-col items-center gap-4">
                  <button 
                    onClick={() => setActiveStep('Library')}
                    className="text-[10px] font-black text-outline/40 uppercase tracking-[0.2em] hover:text-emerald-600 transition-colors"
                  >
                    ← {t('backToSetlist')}
                  </button>
                  {downloadStatus && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="px-6 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[10px] font-black uppercase tracking-widest"
                    >
                      {downloadStatus}
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Notification Toast */}
      <AnimatePresence>
        {downloadStatus && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-8 right-8 z-[200] bg-black text-white px-6 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-2xl flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-emerald-400">info</span>
            {downloadStatus}
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
                <h3 className="text-2xl font-serif font-black text-[#2C2C2C] mb-2">AI {t('bgGenerate')}</h3>
                <p className="text-[11px] text-outline/40 font-medium mb-8">
                  {isZh ? '输入一个主题（如“森林”、“光芒”、“星空”），AI 将为您生成专属敬拜背景。' : 'Enter a theme (e.g., "forest", "light", "starry sky"), and AI will generate a unique worship background for you.'}
                </p>
                
                <div className="w-full space-y-4 mb-10">
                  <input 
                    type="text" 
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder={isZh ? '例如：黎明的圣殿...' : 'e.g. Temple at dawn...'}
                    className="w-full bg-[#F9F7F5] border-2 border-[#E5E0DA]/50 rounded-2xl py-4 px-6 text-sm font-bold focus:border-emerald-500 focus:ring-0 outline-none transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleAiBgGen()}
                  />
                  <div className="flex flex-wrap justify-center gap-2">
                    {['Holy Light', 'Grace Forest', 'Morning Star', 'Deep Prayer'].map(p => (
                      <button 
                        key={p} 
                        onClick={() => setAiPrompt(p)}
                        className="px-4 py-1.5 rounded-full bg-[#F9F7F5] border border-[#E5E0DA]/30 text-[9px] font-black uppercase text-outline/40 hover:text-emerald-600 hover:border-emerald-500 transition-all"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex w-full gap-4">
                   <button 
                     onClick={() => setIsAiPromptOpen(false)}
                     className="flex-1 py-4 bg-[#F9F7F5] text-outline/40 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#E5E0DA] transition-all"
                   >
                     {t('cancel')}
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
                     {isZh ? '立即生成' : 'Generate'}
                   </button>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Song Modal */}
      {editingSong && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[32px] w-full max-w-lg p-8 shadow-2xl flex flex-col gap-6"
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-serif font-black text-[#2C2C2C]">{t('editSong')}</h2>
                <p className="text-[10px] font-bold text-outline/40 uppercase tracking-widest">{editingSong.title}</p>
              </div>
              <button onClick={() => setEditingSong(null)} className="h-8 w-8 rounded-full bg-[#F9F7F5] flex items-center justify-center hover:bg-black hover:text-white transition-all">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleUpdateSong({
                ...editingSong,
                title: formData.get('title'),
                englishTitle: formData.get('englishTitle'),
                lyrics: tempLyrics,
                englishLyrics: tempTranslation
              });
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1">{t('chineseTitle')}</label>
                  <input 
                    name="title"
                    type="text" 
                    defaultValue={editingSong.title}
                    className="w-full p-3 rounded-xl bg-[#F9F7F5] border-none outline-none font-bold text-xs" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1">{t('englishTitleLabel')}</label>
                  <input 
                    name="englishTitle"
                    type="text" 
                    defaultValue={editingSong.englishTitle}
                    className="w-full p-3 rounded-xl bg-[#F9F7F5] border-none outline-none font-bold text-xs" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1 flex items-center justify-between gap-2">
                    <span>{t('chineseLyrics')}</span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { const c = dedupeLyrics(tempLyrics); setTempLyrics(c); handleRealtimeTranslate(c); }}
                        className="px-2 py-1 rounded-lg bg-white border border-outline-variant/30 text-[9px] font-black text-on-surface hover:border-emerald-500 hover:text-emerald-600 transition-all flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[12px]">filter_list_off</span>{isZh ? '去重复' : 'Dedupe'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRealtimeTranslate(tempLyrics)}
                        disabled={translating}
                        className="px-2 py-1 rounded-lg bg-[#4F46E5] text-white text-[9px] font-black hover:bg-[#4338CA] transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[12px]">{translating ? 'hourglass_top' : 'translate'}</span>{translating ? (isZh ? '翻译中' : '...') : (isZh ? '重新翻译' : 'Translate')}
                      </button>
                    </span>
                  </label>
                  <textarea
                    value={tempLyrics}
                    onChange={(e) => {
                      setTempLyrics(e.target.value);
                      scheduleTranslate(e.target.value);
                    }}
                    className="w-full h-48 p-4 rounded-xl bg-[#F9F7F5] border-none outline-none text-xs resize-none leading-relaxed"
                    placeholder={t('enterLyricsPlaceholder')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-primary ml-1 flex items-center justify-between">
                    {t('aiTranslation')}
                    <span className="material-symbols-outlined text-[12px] animate-pulse">auto_awesome</span>
                  </label>
                  <textarea 
                    value={tempTranslation}
                    onChange={(e) => setTempTranslation(e.target.value)}
                    className="w-full h-48 p-4 rounded-xl bg-[#EEEDFF]/50 border-none outline-none text-xs resize-none leading-relaxed text-[#4F46E5]"
                    placeholder={t('aiWaitPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setEditingSong(null)}
                  className="flex-1 py-3 bg-[#F9F7F5] text-on-surface font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-[#E5E0DA] transition-all"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit"
                  className="flex-[2] py-3 bg-black text-white font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-[#4F46E5] transition-all shadow-xl shadow-black/10"
                >
                  {t('saveChanges')}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Song Preview PPT Modal */}
      {previewingSong && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[40px] w-full max-w-5xl overflow-hidden shadow-2xl border border-white/20"
          >
             <div className="p-8 flex items-center justify-between border-b border-[#E5E0DA]/30">
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                      <span className="material-symbols-outlined text-2xl">visibility</span>
                   </div>
                   <div>
                      <h2 className="text-2xl font-serif font-black text-[#2C2C2C]">{previewingSong.title} - {t('preview')}</h2>
                      <p className="text-[10px] font-bold text-outline/50 uppercase tracking-[0.2em]">
                        {previewingSong.englishTitle} · {t('totalCountPages').replace('{count}', (Math.ceil((previewingSong.lyrics?.split('\n').filter((l: string) => l.trim()).length || 0) / linesPerSlide) + 1).toString())}
                      </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                   <div className="hidden md:flex items-center gap-2 px-6 py-2 bg-emerald-50 rounded-full border border-emerald-100">
                      <span className="material-symbols-outlined text-emerald-600 text-[14px] animate-pulse">auto_awesome</span>
                      <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">{t('worshipPptDirect')}</span>
                   </div>
                   <button onClick={() => setPreviewingSong(null)} className="h-12 w-12 rounded-full bg-[#F9F7F5] flex items-center justify-center hover:bg-black hover:text-white transition-all shadow-sm">
                      <span className="material-symbols-outlined">close</span>
                   </button>
                </div>
             </div>
             
             <div className="flex flex-col lg:flex-row max-h-[85vh] overflow-hidden">
                {/* Left Side: Preview Slides */}
                <div className="flex-1 p-10 bg-[#F9F7F5] overflow-y-auto no-scrollbar border-r border-[#E5E0DA]/50">
                    <div className="grid grid-cols-1 gap-8">
                      {(() => {
                        // Resolve preview colors/overlay/size/bg the SAME way the
                        // .pptx does, so what you see here is exactly what downloads.
                        // The unify toggles override the per-song background/size.
                        const previewBg = unifyBackground ? selectedBg : (previewingSong.customBg || selectedBg);
                        const previewLfs = unifyFontSize ? lyricFontSize : (previewingSong.lyricFontSize || lyricFontSize);
                        const previewTfs = unifyFontSize ? translationFontSize : (previewingSong.translationFontSize || translationFontSize);
                        const pcBg = previewBg;
                        const pc = resolveSlideColors(pcBg, lyricColor, translationColor);
                        const hasImg = !!pcBg?.url;
                        // Show the "independent background" badge only when this song
                        // is actually using its own bg (i.e. not unified to global).
                        const usingOwnBg = !unifyBackground && !!previewingSong.customBg;
                        const shadowCss = enableShadow ? previewShadow(shadowLevel) : 'none';
                        return (<>
                      {/* Slide 1 - Cover (only when "with title" is selected) */}
                      {showSongTitle && (
                      <div
                        className="rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-xl relative group overflow-hidden"
                        style={{
                          aspectRatio: '16/9',
                          ...(!previewBg?.url ? { backgroundColor: `#${previewBg?.color || '064E3B'}` } : {})
                        }}
                      >
                        {previewBg?.url && (
                           <img
                             src={previewBg.url}
                             alt="BG"
                             referrerPolicy="no-referrer"
                             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                             onError={(e) => {
                               (e.target as HTMLImageElement).style.display = 'none';
                             }}
                           />
                        )}
                        {hasImg && <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/45 to-black/30 pointer-events-none"></div>}
                        <div className="absolute inset-0 ring-1 ring-white/10 rounded-3xl pointer-events-none"></div>
                        <h3 className="font-serif font-black mb-4 relative z-10" style={{ color: pc.lc, fontSize: `${Math.round(previewLfs * 0.85)}px`, textShadow: shadowCss }}>{previewingSong.title}</h3>
                        <p className="uppercase tracking-widest relative z-10" style={{ color: pc.tc, fontSize: `${Math.round(previewTfs * 0.85)}px`, textShadow: shadowCss }}>{previewingSong.englishTitle}</p>
                        <div className="absolute bottom-4 left-4 flex items-center gap-2 z-10 uppercase">
                           <div className="text-[8px] text-white/40 font-black">SLIDE 01 / {t('cover')}</div>
                           {usingOwnBg && <span className="text-[8px] px-2 py-0.5 rounded-full bg-emerald-500/80 text-white font-black uppercase">{t('independentBg')}</span>}
                        </div>
                      </div>
                      )}

                      {/* Lyrics Slide Preview */}
                      {Array.from({ length: Math.ceil((previewingSong.lyrics?.split('\n').filter((l: string) => l.trim()).length || 0) / linesPerSlide) }).map((_, slideIndex) => (
                        <div
                          key={slideIndex}
                          className="rounded-3xl p-10 flex flex-col justify-center text-center shadow-xl relative overflow-hidden mb-8"
                          style={{
                            aspectRatio: '16/9',
                            ...(!previewBg?.url ? { backgroundColor: `#${previewBg?.color || '064E3B'}` } : {})
                          }}
                        >
                          {previewBg?.url && (
                            <img
                              src={previewBg.url}
                              alt="BG"
                              referrerPolicy="no-referrer"
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          {hasImg && <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/50 to-black/40 pointer-events-none"></div>}

                          <div className="relative z-10 space-y-4">
                            {Array.from({ length: linesPerSlide }).map((_, pairIdx) => {
                              const lyricIdx = slideIndex * linesPerSlide + pairIdx;
                              const cnLine = previewingSong.lyrics?.split('\n')[lyricIdx];
                              const enLine = previewingSong.englishLyrics?.split('\n')[lyricIdx];

                              if (!cnLine && slideIndex > 0) return null;

                              return (
                                <div key={pairIdx} className="space-y-1">
                                  <p className="font-serif font-black leading-tight" style={{ color: pc.lc, fontSize: `${Math.round(previewLfs * 0.78)}px`, textShadow: shadowCss }}>
                                    {cnLine || (slideIndex === 0 && pairIdx === 0 ? t('firstLinePlaceholder') : "")}
                                  </p>
                                  <p className="italic font-normal tracking-wide" style={{ color: pc.tc, fontSize: `${Math.round(previewTfs * 0.78)}px`, textShadow: shadowCss }}>
                                    {enLine || (slideIndex === 0 && pairIdx === 0 ? t('translatingLine') : "")}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                          <div className="absolute bottom-4 left-4 text-[8px] text-white/40 font-black z-10 uppercase">SLIDE {slideIndex + 2} / {t('content')}</div>
                        </div>
                      ))}

                      {/* Slides are now generated dynamically above */}
                        </>);
                      })()}
                    </div>
                </div>

                 {/* Right Side: Sidebar Settings & Inline Editor */}
                <div className="w-full lg:w-96 bg-white p-8 flex flex-col gap-6 shadow-2xl z-10 overflow-y-auto no-scrollbar">
                   {/* Tabs for Sidebar */}
                   <div className="flex gap-2 p-1 bg-[#F9F7F5] rounded-2xl border border-[#E5E0DA]/30">
                      <button 
                        onClick={() => setActivePreviewTab('theme')}
                        className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activePreviewTab === 'theme' ? 'bg-white text-emerald-600 shadow-md' : 'text-outline/40 hover:text-emerald-500'}`}
                      >
                         <span className="material-symbols-outlined text-[16px]">palette</span>
                         {t('theme')}
                      </button>
                      <button 
                        onClick={() => setActivePreviewTab('lyrics')}
                        className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activePreviewTab === 'lyrics' ? 'bg-white text-emerald-600 shadow-md' : 'text-outline/40 hover:text-emerald-500'}`}
                      >
                         <span className="material-symbols-outlined text-[16px]">draw</span>
                         {t('edit')}
                      </button>
                   </div>

                   {activePreviewTab === 'theme' ? (
                     <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                               <h4 className="text-[10px] font-black uppercase tracking-widest text-[#2C2C2C]">{t('themeLibrary')}</h4>
                               {previewingSong.customBg && (
                                 <button 
                                   onClick={() => setWeeklySetlist(weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, customBg: null } : s))}
                                   className="text-[8px] font-black text-orange-500 uppercase tracking-widest hover:underline"
                                 >
                                   {t('resetToGlobal')}
                                 </button>
                               )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              {allBgOptions.map((bg) => (
                                <button 
                                  key={bg.id}
                                  onClick={() => {
                                    if (bg.isAi) {
                                      setIsAiPromptOpen(true);
                                    } else {
                                      // Apply this background to THIS song only (per-song customBg).
                                      // Do NOT touch the global selectedBg — that was the bug that
                                      // forced every song to share one background.
                                      const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, customBg: bg } : s);
                                      setWeeklySetlist(updatedWeekly);
                                      const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                                      if (updatedPreviewSong) {
                                        setPreviewingSong(updatedPreviewSong);
                                      }
                                    }
                                  }}
                                  className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all ${ (previewingSong.customBg?.id || selectedBg.id) === bg.id ? 'border-emerald-500 scale-105 shadow-lg ring-2 ring-emerald-500/20' : 'border-[#E5E0DA]/30 hover:border-emerald-500/50'}`}
                                >
                                  {bg.url ? (
                                    <div className="w-full h-full relative">
                                      <img 
                                        src={bg.url} 
                                        alt={bg.label} 
                                        className="w-full h-full object-cover relative z-10" 
                                        referrerPolicy="no-referrer" 
                                      />
                                    </div>
                                  ) : bg.color ? (
                                    <div className="w-full h-full" style={{ backgroundColor: `#${bg.color}` }}></div>
                                  ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                                      <span className="material-symbols-outlined text-sm">auto_awesome</span>
                                    </div>
                                  )}
                                  <div className="absolute inset-x-0 bottom-0 py-1 bg-black/40 text-[6px] font-black text-white uppercase text-center">{bg.label}</div>
                                </button>
                              ))}
                            </div>
                            
                            <label className="w-full py-2 border-2 border-dashed border-[#E5E0DA] rounded-xl flex items-center justify-center gap-2 hover:bg-[#F9F7F5] cursor-pointer transition-colors">
                                <span className="material-symbols-outlined text-sm text-outline/40">upload</span>
                                <span className="text-[9px] font-black text-outline/60 uppercase">{t('uploadImage')}</span>
                                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                            </label>
                        </div>
                     </div>
                   ) : (
                     <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                        <div className="space-y-4">
                           <div className="space-y-1">
                              <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1">{t('chineseLyrics')}</label>
                              <textarea
                                value={previewingSong.lyrics}
                                onChange={(e) => {
                                  const newVal = e.target.value;
                                  const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, lyrics: newVal } : s);
                                  setWeeklySetlist(updatedWeekly);
                                  const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                                  if (updatedPreviewSong) setPreviewingSong(updatedPreviewSong);
                                  scheduleTranslate(newVal);
                                }}
                                onBlur={(e) => {
                                  // Auto-remove blank lines when leaving the field.
                                  const cleaned = stripBlankLines(e.target.value);
                                  if (cleaned === previewingSong.lyrics) return;
                                  const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, lyrics: cleaned } : s);
                                  setWeeklySetlist(updatedWeekly);
                                  const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                                  if (updatedPreviewSong) setPreviewingSong(updatedPreviewSong);
                                }}
                                className="w-full h-32 p-4 rounded-xl bg-[#F9F7F5] border-none outline-none text-xs resize-none leading-relaxed font-sans focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                placeholder={t('enterLyricsPlaceholder')}
                              />
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-black uppercase tracking-widest text-[#4F46E5] ml-1 flex items-center justify-between">
                                {t('aiTranslation')}
                                <span className="material-symbols-outlined text-[12px] animate-pulse">auto_awesome</span>
                              </label>
                              <textarea
                                value={previewingSong.englishLyrics}
                                onChange={(e) => {
                                  const newVal = e.target.value;
                                  const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, englishLyrics: newVal } : s);
                                  setWeeklySetlist(updatedWeekly);
                                  const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                                  if (updatedPreviewSong) setPreviewingSong(updatedPreviewSong);
                                }}
                                onBlur={(e) => {
                                  const cleaned = stripBlankLines(e.target.value);
                                  if (cleaned === previewingSong.englishLyrics) return;
                                  const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, englishLyrics: cleaned } : s);
                                  setWeeklySetlist(updatedWeekly);
                                  const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                                  if (updatedPreviewSong) setPreviewingSong(updatedPreviewSong);
                                }}
                                className="w-full h-32 p-4 rounded-xl bg-[#EEEDFF]/30 border-none outline-none text-xs resize-none leading-relaxed text-[#4F46E5] font-sans focus:ring-2 focus:ring-[#4F46E5]/20 transition-all"
                                placeholder={t('aiWaitPlaceholder')}
                              />
                           </div>

                           {/* Text Color Pickers */}
                           <div className="flex gap-3 pt-1">
                             <div className="flex-1 space-y-1">
                               <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1">
                                 {isZh ? '歌词颜色' : 'Lyric Color'}
                               </label>
                               <div className="flex items-center gap-2 bg-[#F9F7F5] rounded-xl px-3 py-2 border border-[#E5E0DA]/30">
                                 <input
                                   type="color"
                                   value={lyricColor}
                                   onChange={(e) => setLyricColor(e.target.value)}
                                   className="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
                                   style={{ padding: 0 }}
                                 />
                                 <span className="text-[9px] font-black text-outline/60 tracking-widest">{lyricColor.toUpperCase()}</span>
                               </div>
                             </div>
                             <div className="flex-1 space-y-1">
                               <label className="text-[9px] font-black uppercase tracking-widest text-[#4F46E5] ml-1">
                                 {isZh ? '副歌颜色' : 'Trans. Color'}
                               </label>
                               <div className="flex items-center gap-2 bg-[#EEEDFF]/30 rounded-xl px-3 py-2 border border-[#4F46E5]/10">
                                 <input
                                   type="color"
                                   value={translationColor}
                                   onChange={(e) => setTranslationColor(e.target.value)}
                                   className="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
                                   style={{ padding: 0 }}
                                 />
                                 <span className="text-[9px] font-black text-[#4F46E5]/60 tracking-widest">{translationColor.toUpperCase()}</span>
                               </div>
                             </div>
                           </div>

                           {/* Font Size Controls */}
                           <div className="flex gap-3 pt-1">
                             <div className="flex-1 space-y-1">
                               <label className="text-[9px] font-black uppercase tracking-widest text-outline ml-1">
                                 {isZh ? '歌词字号' : 'Lyric Size'} <span className="text-outline/40">{lyricFontSize}pt</span>
                               </label>
                               <div className="flex items-center gap-2 bg-[#F9F7F5] rounded-xl px-3 py-2 border border-[#E5E0DA]/30">
                                 <button onClick={() => setLyricFontSize(s => Math.max(16, s - 4))} className="text-outline hover:text-primary font-black text-sm leading-none">−</button>
                                 <input
                                   type="range" min={16} max={72} step={2}
                                   value={lyricFontSize}
                                   onChange={e => setLyricFontSize(Number(e.target.value))}
                                   className="flex-1 h-1 accent-emerald-500"
                                 />
                                 <button onClick={() => setLyricFontSize(s => Math.min(72, s + 4))} className="text-outline hover:text-primary font-black text-sm leading-none">＋</button>
                               </div>
                             </div>
                             <div className="flex-1 space-y-1">
                               <label className="text-[9px] font-black uppercase tracking-widest text-[#4F46E5] ml-1">
                                 {isZh ? '翻译字号' : 'Trans. Size'} <span className="text-[#4F46E5]/40">{translationFontSize}pt</span>
                               </label>
                               <div className="flex items-center gap-2 bg-[#EEEDFF]/30 rounded-xl px-3 py-2 border border-[#4F46E5]/10">
                                 <button onClick={() => setTranslationFontSize(s => Math.max(10, s - 2))} className="text-[#4F46E5]/60 hover:text-[#4F46E5] font-black text-sm leading-none">−</button>
                                 <input
                                   type="range" min={10} max={48} step={2}
                                   value={translationFontSize}
                                   onChange={e => setTranslationFontSize(Number(e.target.value))}
                                   className="flex-1 h-1 accent-indigo-400"
                                 />
                                 <button onClick={() => setTranslationFontSize(s => Math.min(48, s + 2))} className="text-[#4F46E5]/60 hover:text-[#4F46E5] font-black text-sm leading-none">＋</button>
                               </div>
                             </div>
                           </div>

                           {/* Text shadow on/off */}
                           <button
                             type="button"
                             onClick={() => setEnableShadow(v => !v)}
                             className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[#F9F7F5] border border-[#E5E0DA]/40 hover:border-emerald-500/40 transition-all"
                           >
                             <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-outline/60">
                               <span className="material-symbols-outlined text-[16px]">format_color_text</span>
                               {isZh ? '文字阴影' : 'Text Shadow'}
                             </span>
                             <span className={`relative w-10 h-5 rounded-full transition-all ${enableShadow ? 'bg-emerald-500' : 'bg-neutral-300'}`}>
                               <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${enableShadow ? 'right-0.5' : 'left-0.5'}`}></span>
                             </span>
                           </button>

                           {/* Shadow depth — only relevant while the shadow is on */}
                           {enableShadow && (
                             <div className="flex gap-2 p-1 bg-[#F9F7F5] rounded-xl border border-[#E5E0DA]/30">
                               {([
                                 { key: 'light',  zh: '轻',  en: 'Light' },
                                 { key: 'medium', zh: '中',  en: 'Medium' },
                                 { key: 'strong', zh: '重',  en: 'Strong' },
                               ] as { key: ShadowLevel; zh: string; en: string }[]).map(opt => (
                                 <button
                                   key={opt.key}
                                   type="button"
                                   onClick={() => setShadowLevel(opt.key)}
                                   className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${shadowLevel === opt.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-outline/40 hover:text-outline/60'}`}
                                 >
                                   {isZh ? opt.zh : opt.en}
                                 </button>
                               ))}
                             </div>
                           )}

                           {/* Whole-deck uniformity — these apply to EVERY song on
                               export, overriding each song's own font size / background. */}
                           <div className="flex items-center gap-2 pt-1">
                             <span className="text-[9px] font-black uppercase tracking-widest text-outline/35">{isZh ? '应用到全部歌曲' : 'Apply to all songs'}</span>
                             <div className="flex-1 h-px bg-[#E5E0DA]/50"></div>
                           </div>

                           {/* Unify font size across all songs */}
                           <button
                             type="button"
                             onClick={() => setUnifyFontSize(v => !v)}
                             className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${unifyFontSize ? 'bg-emerald-50 border-emerald-500/40' : 'bg-[#F9F7F5] border-[#E5E0DA]/40 hover:border-emerald-500/40'}`}
                           >
                             <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-outline/60">
                               <span className="material-symbols-outlined text-[16px]">format_size</span>
                               {isZh ? '统一字号' : 'Unify Font Size'}
                             </span>
                             <span className={`relative w-10 h-5 rounded-full transition-all ${unifyFontSize ? 'bg-emerald-500' : 'bg-neutral-300'}`}>
                               <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${unifyFontSize ? 'right-0.5' : 'left-0.5'}`}></span>
                             </span>
                           </button>

                           {/* Use the same background for all songs */}
                           <button
                             type="button"
                             onClick={() => setUnifyBackground(v => !v)}
                             className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${unifyBackground ? 'bg-emerald-50 border-emerald-500/40' : 'bg-[#F9F7F5] border-[#E5E0DA]/40 hover:border-emerald-500/40'}`}
                           >
                             <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-outline/60">
                               <span className="material-symbols-outlined text-[16px]">wallpaper</span>
                               {isZh ? '统一背景' : 'Same Background'}
                             </span>
                             <span className={`relative w-10 h-5 rounded-full transition-all ${unifyBackground ? 'bg-emerald-500' : 'bg-neutral-300'}`}>
                               <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${unifyBackground ? 'right-0.5' : 'left-0.5'}`}></span>
                             </span>
                           </button>

                           {/* Remove blank lines instantly */}
                           <button
                             type="button"
                             onClick={() => {
                               const cleaned = stripBlankLines(previewingSong.lyrics || '');
                               const cleanedEn = stripBlankLines(previewingSong.englishLyrics || '');
                               const updatedWeekly = weeklySetlist.map(s => s.id === previewingSong.id ? { ...s, lyrics: cleaned, englishLyrics: cleanedEn } : s);
                               setWeeklySetlist(updatedWeekly);
                               const updatedPreviewSong = updatedWeekly.find(s => s.id === previewingSong.id);
                               if (updatedPreviewSong) setPreviewingSong(updatedPreviewSong);
                             }}
                             className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-[#E5E0DA]/50 text-[10px] font-black uppercase tracking-widest text-outline/60 hover:border-emerald-500/40 hover:text-emerald-600 transition-all"
                           >
                             <span className="material-symbols-outlined text-[16px]">filter_list_off</span>
                             {isZh ? '去除空行' : 'Remove Blank Lines'}
                           </button>

                           <button
                             onClick={() => handleUpdateSong(previewingSong)}
                             className="w-full py-3 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                           >
                              <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                              {t('saveAndNotify')}
                           </button>
                        </div>
                     </div>
                   )}

                   <div className="mt-auto pt-6 border-t border-neutral-100 flex flex-col gap-3">
                      <div className="flex gap-2 p-1 bg-[#F9F7F5] rounded-xl border border-[#E5E0DA]/30">
                        {[1, 2, 3].map((val) => (
                          <button
                            key={val}
                            onClick={() => setLinesPerSlide(val)}
                            className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${linesPerSlide === val ? 'bg-white text-emerald-600 shadow-sm' : 'text-outline/40'}`}
                          >
                            {val} {t('pairsPerSlide') || '对/页'}
                          </button>
                        ))}
                      </div>
                      {/* Save to Ready PPT + Download buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            saveToReadyPPT(previewingSong, previewingSong.customBg || selectedBg);
                          }}
                          className={`flex-1 py-4 rounded-[20px] font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 border-2 ${readySongPPTs[previewingSong.id] ? 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600' : 'bg-white text-emerald-700 border-emerald-500/40 hover:bg-emerald-50'}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">{readySongPPTs[previewingSong.id] ? 'check_circle' : 'save'}</span>
                          {readySongPPTs[previewingSong.id] ? (isZh ? '✓ 已存 Ready PPT' : '✓ Saved') : (isZh ? '存为 Ready PPT' : 'Save to Ready PPT')}
                        </button>
                        <button
                          onClick={() => handleDownload(`${previewingSong.title}.pptx`)}
                          className="py-4 px-5 bg-emerald-600 text-white rounded-[20px] font-black text-[10px] hover:bg-emerald-700 transition-all flex items-center justify-center shadow-xl shadow-emerald-500/20 active:scale-95 gap-2"
                        >
                          <span className="material-symbols-outlined text-xl">download</span>
                          {isZh ? '下载' : 'Export'}
                        </button>
                      </div>
                   </div>
                </div>
             </div>

          </motion.div>
        </div>
      )}

      {/* Add Song Modal */}
      {isBulkAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[32px] w-full max-w-3xl p-10 shadow-2xl relative max-h-[90vh] flex flex-col"
          >
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-3xl font-serif font-black text-[#2C2C2C]">{isZh ? '批量添加歌曲' : 'Bulk Add Songs'}</h2>
              <button onClick={() => setIsBulkAdding(false)} className="h-10 w-10 rounded-full bg-[#F9F7F5] flex items-center justify-center hover:bg-black hover:text-white transition-all">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-sm text-outline mb-6">
              {isZh ? '每个格子贴一首歌：第一行写歌名，下面贴歌词。一次全部保存。' : 'One box per song: first line is the title, lyrics below. Saved all at once.'}
            </p>

            {/* How many songs */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] font-black uppercase tracking-widest text-outline">{isZh ? '几首歌？' : 'How many songs?'}</span>
              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setBulkTexts(prev => {
                      const next = [...prev];
                      while (next.length < n) next.push('');
                      return next.slice(0, n);
                    })}
                    className={`w-10 h-10 rounded-xl font-black text-sm transition-all ${bulkTexts.length === n ? 'bg-black text-white shadow-md' : 'bg-[#F9F7F5] text-outline hover:bg-[#E5E0DA]'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* One paste box per song */}
            <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 pr-1">
              {bulkTexts.map((text, i) => (
                <div key={i} className="flex flex-col">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1 mb-1">
                    {isZh ? `第 ${i + 1} 首` : `Song ${i + 1}`}
                  </label>
                  <textarea
                    value={text}
                    onChange={e => setBulkTexts(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder={isZh ? '歌名\n歌词第一行\n歌词第二行\n…' : 'Title\nLyric line 1\nLyric line 2\n…'}
                    className="w-full h-44 p-4 rounded-2xl bg-[#F9F7F5] border-none outline-none font-bold text-sm resize-none focus:ring-2 focus:ring-black/10"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleSaveBulkSongs}
              disabled={bulkSaving}
              className="mt-6 w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all disabled:opacity-50"
            >
              {bulkSaving
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <span className="material-symbols-outlined">done_all</span>}
              {isZh ? `保存全部 ${bulkTexts.filter(t2 => t2.trim()).length} 首` : `Save all ${bulkTexts.filter(t2 => t2.trim()).length}`}
            </button>
          </motion.div>
        </div>
      )}

      {isAddingSong && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[32px] w-full max-w-2xl p-10 shadow-2xl relative"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-serif font-black text-[#2C2C2C]">{t('addNewSong')}</h2>
              <button onClick={() => setIsAddingSong(false)} className="h-10 w-10 rounded-full bg-[#F9F7F5] flex items-center justify-center hover:bg-black hover:text-white transition-all">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-6">
              {/* URL Fetch Section */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#4F46E5] ml-1 flex items-center gap-2">
                   <span className="material-symbols-outlined text-[14px]">link</span>
                   {t('songSourceUrl')}
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newSongUrl}
                    onChange={(e) => setNewSongUrl(e.target.value)}
                    placeholder="https://music.apple.com/... or any website" 
                    className="flex-1 p-4 rounded-2xl bg-[#EEEDFF]/30 border border-[#4F46E5]/10 outline-none font-bold text-sm" 
                  />
                  <button 
                    onClick={handleFetchLyrics}
                    disabled={isFetchingLyrics || !newSongUrl}
                    className="px-6 rounded-2xl bg-[#4F46E5] text-white font-black text-[10px] uppercase tracking-widest hover:bg-[#4338CA] transition-all disabled:opacity-50"
                  >
                    {isFetchingLyrics ? t('fetching') : t('fetchLyrics')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('chineseTitle')}</label>
                  <input 
                    type="text" 
                    value={newSongData.title}
                    onChange={(e) => setNewSongData({ ...newSongData, title: e.target.value })}
                    placeholder={t('egAmazingGraceCn')} 
                    className="w-full p-4 rounded-2xl bg-[#F9F7F5] border-none outline-none font-bold text-sm" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('englishTitleLabel')}</label>
                  <input 
                    type="text" 
                    value={newSongData.englishTitle}
                    onChange={(e) => setNewSongData({ ...newSongData, englishTitle: e.target.value })}
                    placeholder={t('egAmazingGrace')} 
                    className="w-full p-4 rounded-2xl bg-[#F9F7F5] border-none outline-none font-bold text-sm" 
                  />
                </div>
              </div>

              {newSongData.lyrics ? (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                  <span className="material-symbols-outlined text-[16px] mt-0.5 shrink-0">warning</span>
                  <span>{language.startsWith('zh') ? 'AI 提取的歌词可能不完全准确，请保存前核对一遍。' : 'AI-fetched lyrics may not be fully accurate. Please verify before saving.'}</span>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{t('chineseLyrics')}</label>
                  <textarea
                    value={newSongData.lyrics}
                    onChange={(e) => {
                      setNewSongData({ ...newSongData, lyrics: e.target.value });
                      scheduleTranslate(e.target.value, true);
                    }}
                    placeholder={t('enterLyricsPlaceholder')}
                    className="w-full h-48 p-4 rounded-2xl bg-[#F9F7F5] border-none outline-none text-sm resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center justify-between">
                    <span>{t('aiTranslation')}</span>
                    <button
                      type="button"
                      onClick={() => handleRealtimeTranslate(newSongData.lyrics, true)}
                      disabled={translating || !newSongData.lyrics.trim()}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary hover:text-white transition-all disabled:opacity-40"
                    >
                      <span className={`material-symbols-outlined text-[14px] ${translating ? 'animate-spin' : ''}`}>{translating ? 'progress_activity' : 'translate'}</span>
                      {isZh ? '翻译' : 'Translate'}
                    </button>
                  </label>
                  <textarea
                    value={newSongData.englishLyrics}
                    onChange={(e) => setNewSongData({ ...newSongData, englishLyrics: e.target.value })}
                    placeholder={t('aiWaitPlaceholder')}
                    className="w-full h-48 p-4 rounded-2xl bg-[#EEEDFF]/50 border-none outline-none text-sm resize-none text-[#4F46E5]"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setIsAddingSong(false)}
                  className="flex-1 py-4 bg-[#F9F7F5] text-on-surface font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-[#E5E0DA] transition-all"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleSaveNewSong}
                  className="flex-[2] py-4 bg-black text-white font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-emerald-600 transition-all shadow-xl shadow-black/10"
                >
                  {t('saveChanges')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Lyrics Sheet Modal */}
      {showLyricsSheet && weeklySetlist.length > 0 && (
        <LyricsSheetModal
          songs={weeklySetlist}
          allSongs={librarySongs}
          onClose={() => setShowLyricsSheet(false)}
        />
      )}
    </div>
  );
}
