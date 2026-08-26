import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { getActiveChurchId, isDemoChurch, canManageChurch } from '../lib/permissions';
import { isSampleChurch, SAMPLE_PUBLICATIONS } from '../lib/demoChurch';
import { supabase } from '../lib/supabase';
import { logActivity } from '../services/activityService';

// ─── Types ────────────────────────────────────────────────────────────────────
type Category = 'Devotional' | 'Bible Study' | 'Newsletter' | 'Sermon' | 'Other';

interface Publication {
  id: string;
  church_id: string;
  title: string;
  description: string;
  category: Category;
  file_url: string;
  file_name: string;
  file_size: number;
  created_by: string;
  created_at: string;
}

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORIES: {
  value: Category;
  labelEn: string;
  labelZh: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    value: 'Devotional',
    labelEn: 'Devotional',
    labelZh: '灵修',
    icon: 'favorite',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
    border: 'border-purple-200',
  },
  {
    value: 'Bible Study',
    labelEn: 'Bible Study',
    labelZh: '查经',
    icon: 'book',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    border: 'border-blue-200',
  },
  {
    value: 'Newsletter',
    labelEn: 'Newsletter',
    labelZh: '简报',
    icon: 'newspaper',
    color: 'text-green-700',
    bg: 'bg-green-100',
    border: 'border-green-200',
  },
  {
    value: 'Sermon',
    labelEn: 'Sermon',
    labelZh: '讲道',
    icon: 'mic',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    border: 'border-amber-200',
  },
  {
    value: 'Other',
    labelEn: 'Other',
    labelZh: '其他',
    icon: 'picture_as_pdf',
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    border: 'border-gray-200',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getCategoryConfig(category: Category) {
  return CATEGORIES.find((c) => c.value === category) || CATEGORIES[4];
}

const MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5 MB

// ─── Upload Modal ─────────────────────────────────────────────────────────────
interface UploadModalProps {
  onClose: () => void;
  onSave: (pub: Omit<Publication, 'id' | 'church_id' | 'created_at'>) => void;
  t: (key: string) => string;
}

function UploadModal({ onClose, onSave, t }: UploadModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sizeWarning, setSizeWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf'
    );
    if (dropped.length) {
      setFiles(dropped);
      setSizeWarning(dropped.some((f) => f.size > MAX_BASE64_SIZE));
      if (!title && dropped[0]) {
        setTitle(dropped[0].name.replace(/\.pdf$/i, ''));
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter(
      (f) => f.type === 'application/pdf'
    );
    if (selected.length) {
      setFiles(selected);
      setSizeWarning(selected.some((f) => f.size > MAX_BASE64_SIZE));
      if (!title && selected[0]) {
        setTitle(selected[0].name.replace(/\.pdf$/i, ''));
      }
    }
  };

  const handleSubmit = async () => {
    if (!files.length || !title.trim()) return;
    setIsProcessing(true);

    // Process each file (or just the first for single-title mode)
    const file = files[0];
    if (file.size > MAX_BASE64_SIZE) {
      alert(t('fileExceedsSize'));
      setIsProcessing(false);
      return;
    }

    // Upload the file to Supabase Storage and store its PUBLIC URL (not the raw base64).
    // Storing base64 in the DB made rows too large to sync — others couldn't see the file and
    // a multi-MB data: URL wouldn't download. A short public URL fixes both.
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      let fileUrl = '';

      const { error: upErr } = await supabase.storage
        .from('publications')
        .upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });

      if (!upErr) {
        const { data: urlData } = supabase.storage.from('publications').getPublicUrl(path);
        fileUrl = urlData.publicUrl;
      } else {
        console.warn('[Publications] storage upload failed, falling back to data URL:', upErr.message);
        fileUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      onSave({
        title: title.trim(),
        description: description.trim(),
        category,
        file_url: fileUrl,
        file_name: file.name,
        file_size: file.size,
        created_by: '',
      });
    } catch (err) {
      console.error('[Publications] upload error:', err);
      alert(t('uploadFailed') || 'Upload failed. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg p-8 flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif font-black text-2xl text-on-surface">
              {t('uploadPublication')}
            </h2>
            <p className="text-xs text-outline mt-1">
              {t('uploadPdfDesc')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-surface-container flex items-center justify-center hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-outline text-[20px]">close</span>
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all ${
            isDragging
              ? 'border-primary bg-primary/5 scale-[1.01]'
              : files.length
              ? 'border-green-400 bg-green-50'
              : 'border-outline-variant hover:border-primary/50 hover:bg-surface-container'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <span
            className={`material-symbols-outlined text-[40px] ${
              files.length ? 'text-green-500' : 'text-outline'
            }`}
          >
            {files.length ? 'check_circle' : 'upload_file'}
          </span>
          {files.length ? (
            <div className="text-center">
              <p className="font-black text-sm text-on-surface">{files[0].name}</p>
              <p className="text-xs text-outline mt-0.5">{formatFileSize(files[0].size)}</p>
              {files.length > 1 && (
                <p className="text-xs text-outline">+{files.length - 1} more</p>
              )}
            </div>
          ) : (
            <div className="text-center">
              <p className="font-black text-sm text-on-surface">
                {t('dragDropPdf')}
              </p>
              <p className="text-xs text-outline mt-1">
                {t('maxFileSizeDemo')}
              </p>
            </div>
          )}
        </div>

        {sizeWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-600 text-[18px]">warning</span>
            <p className="text-xs text-amber-800 font-bold">
              {t('fileSizeWarning')}
            </p>
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-outline">
            {t('titleLabel')}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('publicationTitle')}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-outline">
            {t('descriptionOptional')}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('briefDescription')}
            rows={2}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all resize-none"
          />
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-outline">
            {t('categoryLabel')}
          </label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  category === cat.value
                    ? `${cat.bg} ${cat.color} ${cat.border}`
                    : 'bg-surface-container border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{cat.icon}</span>
                {t('cat_' + cat.value.toLowerCase().replace(' ', '')) || cat.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border border-outline-variant text-on-surface-variant text-sm font-black hover:bg-surface-container transition-colors"
          >
            {t('cancelLabel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!files.length || !title.trim() || isProcessing}
            className="flex-1 py-3 rounded-2xl bg-primary text-white text-sm font-black hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t('processingLabel')}
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                {t('uploadLabel')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Publication Card ─────────────────────────────────────────────────────────
// Download a publication file (handles both storage URLs and legacy base64 data URLs).
async function downloadPublication(pub: Publication) {
  const url = pub.file_url;
  if (!url) return;
  if (url.startsWith('data:')) {
    try {
      const blob = await fetch(url).then(r => r.blob());
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = pub.file_name || `${pub.title || 'publication'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
      return;
    } catch { /* fall through */ }
  }
  window.open(url, '_blank');
}

// ─── Preview Modal ────────────────────────────────────────────────────────────
function PreviewModal({ pub, onClose }: { pub: Publication; onClose: () => void }) {
  const { language } = useLanguage();
  const isZh = language.startsWith('zh');
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/15">
          <div className="min-w-0">
            <h3 className="font-serif font-black text-lg text-on-surface truncate">{pub.title}</h3>
            <p className="text-[11px] text-outline truncate">{pub.file_name} · {formatFileSize(pub.file_size)}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center hover:bg-surface-container-high transition-colors flex-shrink-0">
            <span className="material-symbols-outlined text-outline text-[20px]">close</span>
          </button>
        </div>
        <div className="flex-1 bg-surface-container-low">
          <iframe title={pub.title} src={pub.file_url} className="w-full h-full border-0" />
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/15">
          <button onClick={onClose} className="px-4 py-2.5 rounded-2xl text-sm font-black text-outline hover:bg-surface-container transition-colors">
            {isZh ? '关闭' : 'Close'}
          </button>
          <button onClick={() => downloadPublication(pub)} className="px-5 py-2.5 rounded-2xl bg-primary text-white text-sm font-black flex items-center gap-2 hover:opacity-90 transition-opacity">
            <span className="material-symbols-outlined text-[18px]">download</span>
            {isZh ? '下载' : 'Download'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface PublicationCardProps {
  pub: Publication;
  isManager: boolean;
  onDelete: (id: string) => void;
  onPreview: (pub: Publication) => void;
  t: (key: string) => string;
}

function PublicationCard({ pub, isManager, onDelete, onPreview, t }: PublicationCardProps) {
  const cat = getCategoryConfig(pub.category);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      window.confirm(`Delete "${pub.title}"? This cannot be undone.`)
    ) {
      onDelete(pub.id);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4, boxShadow: '0 20px 40px rgba(0,0,0,0.12)' }}
      onClick={() => onPreview(pub)}
      className="bg-white rounded-[24px] border border-outline-variant/30 overflow-hidden cursor-pointer group transition-shadow shadow-sm flex flex-col"
    >
      {/* Cover area */}
      <div
        className={`h-32 flex items-center justify-center relative ${cat.bg}`}
      >
        <span className={`material-symbols-outlined text-[56px] ${cat.color} opacity-60`}>
          picture_as_pdf
        </span>
        <div
          className={`absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black border ${cat.bg} ${cat.color} ${cat.border}`}
        >
          <span className="material-symbols-outlined text-[12px]">{cat.icon}</span>
          {t('cat_' + cat.value.toLowerCase().replace(' ', '')) || cat.labelEn}
        </div>
        {/* Download overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-2xl px-4 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">download</span>
            <span className="text-xs font-black text-primary">
              {t('openLabel')}
            </span>
          </div>
        </div>
        {/* Delete button */}
        {isManager && (
          <button
            onClick={handleDelete}
            className="absolute top-3 right-3 w-8 h-8 rounded-xl bg-white/80 hover:bg-error/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
          >
            <span className="material-symbols-outlined text-[16px] text-error">delete</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="font-serif font-black text-sm text-on-surface line-clamp-2 leading-snug">
          {pub.title}
        </h3>
        {pub.description && (
          <p className="text-xs text-on-surface-variant line-clamp-2 leading-relaxed">
            {pub.description}
          </p>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between">
          <span className="text-[10px] text-outline font-bold">
            {formatFileSize(pub.file_size)}
          </span>
          <span className="text-[10px] text-outline">
            {formatDate(pub.created_at)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Publications() {
  const { profile, church, user } = useAuth();
  const { t } = useLanguage();
  const { mode } = useMode();

  const activeChurchId = getActiveChurchId(profile, church);
  // Only treat as demo when there's truly no church ID available
  const isDemo = !activeChurchId || isDemoChurch(church) && !profile?.church_id;
  // 示例教会只读 —— 不留点了会污染样板间（或被 RLS 拒绝）的按钮
  const isManager = canManageChurch(profile, user) && !isSampleChurch(church);

  const STORAGE_KEY = `publications_${activeChurchId || 'default'}`;

  const [publications, setPublications] = useState<Publication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [previewPub, setPreviewPub] = useState<Publication | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category | 'All'>('All');

  // ── Load publications ──────────────────────────────────────────────────────
  const loadPublications = async () => {
    setIsLoading(true);

    // 示例教会直接用常量 —— 示范内容不该取决于用户点没点过「填充示例内容」
    if (isSampleChurch(church)) {
      setPublications(SAMPLE_PUBLICATIONS.map((p, i) => ({
        id: `demo-pub-${i}`,
        church_id: activeChurchId || '',
        title: p.title,
        description: p.description,
        category: p.category as any,
        file_url: '',
        file_name: p.file_name,
        file_size: p.file_size,
        created_by: '陈约翰 John Chen',
        created_at: new Date(Date.now() - (i + 1) * 864e5).toISOString(),
      })));
      setIsLoading(false);
      return;
    }

    try {
      if (!isDemo && activeChurchId) {
        const { data, error } = await supabase
          .from('church_publications')
          .select('*')
          .eq('church_id', activeChurchId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          setPublications(data as Publication[]);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to localStorage
    }

    // localStorage fallback
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setPublications(stored ? JSON.parse(stored) : []);
    } catch {
      setPublications([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadPublications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChurchId]);

  // ── Save to localStorage ───────────────────────────────────────────────────
  const saveToLocal = (pubs: Publication[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pubs));
    } catch {
      // localStorage full
    }
  };

  // ── Handle upload save ─────────────────────────────────────────────────────
  const handleSave = async (pubData: Omit<Publication, 'id' | 'church_id' | 'created_at'>) => {
    if (!activeChurchId) return;

    const newPub: Publication = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      church_id: activeChurchId,
      created_at: new Date().toISOString(),
      created_by: profile?.full_name || user?.email || 'Manager',
      ...pubData,
    };

    // The upload modal already stored the file and produced a public URL — just insert
    // the metadata row so the publication syncs to everyone. (Re-fetching + re-uploading
    // the file here was failing and silently dropping the row to localStorage.)
    if (!isDemo) {
      try {
        const { data: inserted, error: dbError } = await supabase
          .from('church_publications')
          .insert({
            church_id: activeChurchId,
            title: pubData.title,
            description: pubData.description,
            category: pubData.category,
            file_url: pubData.file_url,
            file_name: pubData.file_name,
            file_size: pubData.file_size,
            created_by: newPub.created_by,
          })
          .select()
          .single();

        if (!dbError && inserted) {
          setPublications([inserted as Publication, ...publications]);
          setShowUpload(false);
          logActivity({
            churchId: activeChurchId,
            userId: profile?.id,
            userName: profile?.full_name || 'Manager',
            userRole: profile?.role || mode,
            action: 'uploaded publication',
            target: pubData.title,
            type: 'Resource',
          });
          return;
        }
        if (dbError) console.warn('[Publications] DB insert failed:', dbError.message);
      } catch (e) {
        console.warn('[Publications] save error:', e);
      }
    }

    // localStorage fallback (base64)
    const updated = [newPub, ...publications];
    setPublications(updated);
    saveToLocal(updated);
    setShowUpload(false);

    logActivity({
      churchId: activeChurchId,
      userId: profile?.id,
      userName: profile?.full_name || 'Manager',
      userRole: profile?.role || mode,
      action: 'uploaded publication',
      target: pubData.title,
      type: 'Resource',
    });
  };

  // ── Handle delete ──────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!activeChurchId) return;
    const pub = publications.find((p) => p.id === id);

    // Try Supabase delete
    if (!isDemo && !id.startsWith('local-')) {
      try {
        await supabase.from('church_publications').delete().eq('id', id);
      } catch {
        // Ignore
      }
    }

    const updated = publications.filter((p) => p.id !== id);
    setPublications(updated);
    saveToLocal(updated);

    if (pub) {
      logActivity({
        churchId: activeChurchId,
        userId: profile?.id,
        userName: profile?.full_name || 'Manager',
        userRole: profile?.role || mode,
        action: 'deleted publication',
        target: pub.title,
        type: 'System',
      });
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = publications.filter((pub) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      pub.title.toLowerCase().includes(q) ||
      pub.description?.toLowerCase().includes(q) ||
      pub.category.toLowerCase().includes(q);
    const matchesCategory = activeCategory === 'All' || pub.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // ── Category counts ────────────────────────────────────────────────────────
  const getCategoryCount = (cat: Category | 'All') =>
    cat === 'All'
      ? publications.length
      : publications.filter((p) => p.category === cat).length;

  return (
    <div className="min-h-full p-8 flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-black text-on-surface tracking-tight">
            {t('freePublications')}
          </h1>
          <p className="text-sm text-outline mt-1">
            {t('publicationsDesc')}
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-primary text-white text-sm font-black hover:bg-primary/90 transition-all shadow-md shadow-primary/20 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            {t('uploadLabel')}
          </button>
        )}
      </div>

      {/* ── Search + Filter ── */}
      <div className="flex flex-col gap-4">
        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchByTitleCategory')}
            className="w-full max-w-md rounded-2xl border border-outline-variant bg-white py-3 pl-12 pr-4 text-sm text-on-surface placeholder:text-outline/50 focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              <span className="material-symbols-outlined text-[16px] text-outline hover:text-on-surface transition-colors">
                close
              </span>
            </button>
          )}
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory('All')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${
              activeCategory === 'All'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-surface-container border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">menu_book</span>
            {t('allLabel')}
            <span className="ml-0.5 opacity-70">({getCategoryCount('All')})</span>
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black border transition-all ${
                activeCategory === cat.value
                  ? `${cat.bg} ${cat.color} ${cat.border} shadow-sm`
                  : 'bg-surface-container border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{cat.icon}</span>
              {t('cat_' + cat.value.toLowerCase().replace(' ', '')) || cat.labelEn}
              <span className="ml-0.5 opacity-70">({getCategoryCount(cat.value)})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-xs font-black uppercase tracking-widest text-outline animate-pulse">
              {t('loadingLabel')}
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 flex flex-col items-center justify-center py-24 gap-6"
        >
          <div className="w-24 h-24 rounded-[32px] bg-surface-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[48px] text-outline/40">
              auto_stories
            </span>
          </div>
          <div className="text-center">
            <h3 className="font-serif font-black text-xl text-on-surface mb-2">
              {searchQuery || activeCategory !== 'All'
                ? t('noMatchingPublications')
                : t('noPublicationsYet')}
            </h3>
            <p className="text-sm text-outline max-w-sm mx-auto leading-relaxed">
              {searchQuery || activeCategory !== 'All'
                ? t('tryDifferentSearch')
                : isManager
                ? t('clickUploadFirst')
                : t('publicationsWillAppear')}
            </p>
          </div>
          {isManager && !searchQuery && activeCategory === 'All' && (
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-white text-sm font-black hover:bg-primary/90 transition-all shadow-md shadow-primary/20"
            >
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              {t('uploadFirstOne')}
            </button>
          )}
        </motion.div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((pub) => (
              <PublicationCard
                key={pub.id}
                pub={pub}
                isManager={isManager}
                onDelete={handleDelete}
                onPreview={setPreviewPub}
                t={t}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Upload Modal ── */}
      <AnimatePresence>
        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onSave={handleSave}
            t={t}
          />
        )}
      </AnimatePresence>

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {previewPub && (
          <PreviewModal pub={previewPub} onClose={() => setPreviewPub(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
