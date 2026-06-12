import React, { useState, useRef, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';

type ScheduleRow = {
  name: string;
  time: string;
  loc: string;
  contact: string;
  note: string;
};

// A single example row — churches edit/add their own.
const DEFAULT_SCHEDULE: ScheduleRow[] = [
  { name: '主日崇拜', time: '周日 10:00am', loc: '教会', contact: '—', note: '示例 — 可编辑或删除' },
];

// Signature of the OLD 7-row sample, so we can replace it for churches that never edited it.
const OLD_SAMPLE_SIG = '晨祷|祷告会|Living Stone|Rock Group|Harmony|Grace Group|Children / Youth';

export default function About() {
  const { mode } = useMode();
  const { t, isZh } = useLanguage();
  const { church, profile, refreshProfile } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  const [isEditing, setIsEditing] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const openInMaps = (addr: string) => {
    if (!addr) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`, '_blank');
  };
  const copyAddress = (addr: string) => {
    if (!addr) return;
    navigator.clipboard?.writeText(addr);
    setAddrCopied(true);
    setTimeout(() => setAddrCopied(false), 1500);
  };
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);

  // Load per-church schedule from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(churchKey('about_schedule'));
      if (saved) {
        const parsed: ScheduleRow[] = JSON.parse(saved);
        // If it's still the old 7-row sample (never edited), replace with the single example.
        const sig = parsed.map(r => r.name).join('|');
        setScheduleRows(sig === OLD_SAMPLE_SIG ? DEFAULT_SCHEDULE : parsed);
      } else {
        setScheduleRows(DEFAULT_SCHEDULE);
      }
    } catch {
      setScheduleRows(DEFAULT_SCHEDULE);
    }
  }, [activeChurchId]);

  // Persist schedule whenever it changes
  useEffect(() => {
    if (scheduleRows.length >= 0) {
      localStorage.setItem(churchKey('about_schedule'), JSON.stringify(scheduleRows));
    }
  }, [scheduleRows, activeChurchId]);

  // ── Core Values (editable) ──────────────────────────────────────────────────
  const DEFAULT_VALUES = {
    heading: 'Living Out the Faith',
    items: [
      { title: '爱 / Love', desc: '凭着恩典，我们在每个行动、话语和祷告中活出这价值。' },
      { title: '服事 / Serve', desc: '凭着恩典，我们在每个行动、话语和祷告中活出这价值。' },
      { title: '门训 / Disciple', desc: '凭着恩典，我们在每个行动、话语和祷告中活出这价值。' },
    ],
  };
  const [coreValues, setCoreValues] = useState(DEFAULT_VALUES);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(churchKey('about_corevalues'));
      setCoreValues(saved ? JSON.parse(saved) : DEFAULT_VALUES);
    } catch { setCoreValues(DEFAULT_VALUES); }
  }, [activeChurchId]);
  useEffect(() => {
    localStorage.setItem(churchKey('about_corevalues'), JSON.stringify(coreValues));
  }, [coreValues, activeChurchId]);
  const updateValueItem = (i: number, field: 'title' | 'desc', v: string) =>
    setCoreValues(prev => ({ ...prev, items: prev.items.map((it, idx) => idx === i ? { ...it, [field]: v } : it) }));

  const updateScheduleRow = (index: number, field: keyof ScheduleRow, value: string) => {
    setScheduleRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const addScheduleRow = () => {
    setScheduleRows(prev => [...prev, { name: '', time: '', loc: '', contact: '', note: '' }]);
  };

  const deleteScheduleRow = (index: number) => {
    setScheduleRows(prev => prev.filter((_, i) => i !== index));
  };
  const [saving, setSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [galleryLimit, setGalleryLimit] = useState(4);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const mainImageInputRef = useRef<HTMLInputElement>(null);

  const [aboutData, setAboutData] = useState({
    name: '',
    description: '',
    vision: '',
    imageUrl: '',
    logoUrl: '',
    serviceTimes: 'Sunday 9:00 AM',
    secondaryTime: 'Wednesday 7:30 PM',
    location: '',
    history: '',
    founders: '',
    denomination: '',
    galleryImages: [
      'https://images.unsplash.com/photo-1510590337019-5ef8d3d32116?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1548625361-ecacfa310659?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1511649475669-e288648b2339?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1529070532788-757659e6659c?q=80&w=600&auto=format&fit=crop',
    ],
    team: [
      { name: 'David Chen', role: t('pastors'), image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop', title: t('pastorShort') },
      { name: 'Sarah Chen', role: t('pastors'), image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&auto=format&fit=crop', title: t('pastorShort') },
    ]
  });

  useEffect(() => {
    if (church) {
      setAboutData(prev => ({
        ...prev,
        name: church.name || t('churchTitle'),
        description: church.description || t('churchDesc'),
        imageUrl: church.image_url || 'https://images.unsplash.com/photo-1544427920-c49ccfb85579?q=80&w=1600&auto=format&fit=crop',
        logoUrl: church.logo_url || '',
        location: church.location || '123 Grace Way, Serenity City',
      }));
    }
  }, [church, t]);

  const handleSave = async () => {
    if (!church?.id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('churches')
        .update({
          name: aboutData.name,
          description: aboutData.description,
          image_url: aboutData.imageUrl,
          logo_url: aboutData.logoUrl,
          location: aboutData.location,
        })
        .eq('id', church.id);

      if (error) throw error;
      await refreshProfile();
      setIsEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save church details');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !church?.id) return;
    
    setSaving(true);
    try {
      // Convert to base64 — no Storage bucket needed
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const maxW = 400;
            const scale = img.width > maxW ? maxW / img.width : 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = ev.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setAboutData(prev => ({ ...prev, logoUrl: base64 }));
    } catch (err: any) {
      console.error('Logo upload failed:', err);
      alert('Upload failed. Please ensure your Supabase Storage has a "public" or "church-assets" bucket with public access, or just paste an image URL instead.\n\nError: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMainImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !church?.id) return;
    
    setSaving(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${church.id}-hero-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Try common bucket names
      const buckets = ['church-assets', 'public', 'avatars', 'hero'];
      let publicUrl = '';
      let lastError = null;

      for (const bucket of buckets) {
        try {
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: true
            });

          if (!uploadError) {
            const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
            publicUrl = data.publicUrl;
            break;
          }
          lastError = uploadError;
        } catch (innerErr) {
          lastError = innerErr;
        }
      }

      if (publicUrl) {
        setAboutData(prev => ({ ...prev, imageUrl: publicUrl }));
      } else {
        throw lastError || new Error('All upload attempts failed');
      }
    } catch (err: any) {
      console.error('Hero upload failed:', err);
      alert('Upload failed. Please ensure your Supabase Storage has a "public" or "church-assets" bucket with public access.\n\nError: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !church?.id) return;

    setSaving(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${church.id}-gallery-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Try common bucket names
      const buckets = ['public', 'church-assets', 'gallery'];
      let publicUrl = '';
      let lastError = null;

      for (const bucket of buckets) {
        try {
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(filePath, file, { upsert: true });

          if (!uploadError) {
            const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
            publicUrl = data.publicUrl;
            break;
          }
          lastError = uploadError;
        } catch (innerErr) {
          lastError = innerErr;
        }
      }

      if (publicUrl) {
        setAboutData(prev => ({ 
          ...prev, 
          galleryImages: [publicUrl, ...prev.galleryImages] 
        }));
      } else {
        throw lastError || new Error('Upload failed');
      }
    } catch (err: any) {
      console.error('Gallery upload failed:', err);
      alert('Upload failed. Please ensure you have a "public" bucket in Supabase Storage.\n\nError: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeGalleryImage = (indexToRemove: number) => {
    setAboutData({
      ...aboutData,
      galleryImages: aboutData.galleryImages.filter((_, idx) => idx !== indexToRemove)
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-12 animate-in fade-in duration-1000">
      
      {/* Header with Manager Actions */}
      <header className="mb-12 flex items-end justify-between">
        <div>
          <h2 className="font-headline-md text-on-surface opacity-90">{t('aboutChurch')}</h2>
          <nav className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-outline">{t('learnMoreAbout')}</span>
          </nav>
        </div>
        {mode === 'Manager' && !isEditing && (
          <button 
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 rounded-full bg-surface-container-high px-5 py-2.5 text-xs font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            {t('editDetails')}
          </button>
        )}
      </header>

      {isEditing ? (
        <div className="rounded-[32px] bg-surface-container-lowest p-8 border border-outline-variant/30 shadow-xl animate-in zoom-in-95">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Church Name</label>
                <input
                  type="text"
                  value={aboutData.name}
                  onChange={e => setAboutData({ ...aboutData, name: e.target.value })}
                  className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Vision Statement</label>
                <textarea
                  value={aboutData.vision}
                  onChange={e => setAboutData({ ...aboutData, vision: e.target.value })}
                  rows={2}
                  className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">History / Mission</label>
                <textarea
                  value={aboutData.history}
                  onChange={e => setAboutData({ ...aboutData, history: e.target.value })}
                  rows={4}
                  className="w-full rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Church Logo (Small Square)</label>
                <div className="flex gap-4 items-center">
                  <div className="h-12 w-12 rounded-xl bg-surface-container-high border border-outline-variant overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {aboutData.logoUrl ? (
                      <img src={aboutData.logoUrl} className="w-full h-full object-cover" alt="Logo Preview" />
                    ) : (
                      <span className="material-symbols-outlined text-outline text-xl">church</span>
                    )}
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="text"
                      value={aboutData.logoUrl}
                      onChange={e => setAboutData({ ...aboutData, logoUrl: e.target.value })}
                      placeholder="Paste URL or upload..."
                      className="flex-1 rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all"
                    />
                    <button 
                      onClick={() => logoInputRef.current?.click()}
                      className="h-11 w-11 rounded-2xl bg-surface-container-high border border-outline-variant flex items-center justify-center text-outline hover:text-primary hover:border-primary transition-all"
                    >
                      <span className="material-symbols-outlined">upload</span>
                    </button>
                    <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
               <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Main Hero Image</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aboutData.imageUrl}
                    onChange={e => setAboutData({ ...aboutData, imageUrl: e.target.value })}
                    placeholder="Hero Image URL..."
                    className="flex-1 rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm focus:border-primary outline-none transition-all"
                  />
                  <button 
                    onClick={() => mainImageInputRef.current?.click()}
                    className="h-11 w-11 rounded-2xl bg-surface-container-high border border-outline-variant flex items-center justify-center text-outline hover:text-primary hover:border-primary transition-all"
                  >
                    <span className="material-symbols-outlined">upload</span>
                  </button>
                  <input type="file" ref={mainImageInputRef} className="hidden" accept="image/*" onChange={handleMainImageUpload} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Founder</label>
                  <input type="text" value={aboutData.founders} onChange={e => setAboutData({...aboutData, founders: e.target.value})} className="rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm outline-none" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Denomination</label>
                  <input type="text" value={aboutData.denomination} onChange={e => setAboutData({...aboutData, denomination: e.target.value})} className="rounded-2xl border border-outline-variant bg-surface-container py-3 px-5 text-sm outline-none" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-outline ml-2">Gallery Control</label>
                <div className="flex gap-2 flex-wrap">
                   {aboutData.galleryImages.slice(0, 4).map((img, i) => (
                     <div key={i} className="relative group w-16 h-16 rounded-xl overflow-hidden">
                       {img && <img src={img} className="w-full h-full object-cover" alt="" />}
                       <button onClick={() => removeGalleryImage(i)} className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><span className="material-symbols-outlined text-sm">close</span></button>
                     </div>
                   ))}
                   <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                   <button onClick={() => fileInputRef.current?.click()} className="w-16 h-16 rounded-xl border-2 border-dashed border-outline-variant flex items-center justify-center text-outline hover:text-primary hover:border-primary transition-all">
                     <span className="material-symbols-outlined">add</span>
                   </button>
                </div>
              </div>
            </div>
          </div>

          {/* Schedule Editor */}
          <div className="mt-10 border-t border-outline-variant/20 pt-10">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-outline mb-1">Weekly Schedule</p>
                <h4 className="font-serif text-xl font-bold text-on-surface">小组聚会时间表</h4>
              </div>
              <button
                onClick={addScheduleRow}
                className="flex items-center gap-2 rounded-2xl bg-primary/10 text-primary px-5 py-2.5 text-xs font-bold hover:bg-primary hover:text-on-primary transition-all"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                添加一行
              </button>
            </div>

            <div className="space-y-3">
              {/* Header labels */}
              <div className="grid grid-cols-[1fr_1fr_0.8fr_1fr_1fr_auto] gap-2 px-2">
                {['聚会名称', '时间', '地点', '联络人', '备注', ''].map((h, i) => (
                  <span key={i} className="text-[9px] font-black uppercase tracking-widest text-outline">{h}</span>
                ))}
              </div>

              {scheduleRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_0.8fr_1fr_1fr_auto] gap-2 items-center bg-surface-container-low/60 rounded-2xl p-3">
                  {(['name', 'time', 'loc', 'contact', 'note'] as (keyof ScheduleRow)[]).map(field => (
                    <input
                      key={field}
                      type="text"
                      value={row[field]}
                      onChange={e => updateScheduleRow(i, field, e.target.value)}
                      className="w-full rounded-xl border border-outline-variant/50 bg-white py-2 px-3 text-xs text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                    />
                  ))}
                  <button
                    onClick={() => deleteScheduleRow(i)}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-outline hover:bg-error/10 hover:text-error transition-all"
                    title="Delete row"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              ))}

              {scheduleRows.length === 0 && (
                <div className="rounded-2xl border-2 border-dashed border-outline-variant/30 py-8 text-center text-xs text-outline">
                  还没有聚会安排。点击"添加一行"来开始。
                </div>
              )}
            </div>
          </div>

          {/* Core Values Editor */}
          <div className="mt-10 border-t border-outline-variant/20 pt-10">
            <div className="mb-6">
              <p className="text-[10px] uppercase font-bold tracking-widest text-outline mb-1">{t('coreValues')}</p>
              <input
                value={coreValues.heading}
                onChange={e => setCoreValues(p => ({ ...p, heading: e.target.value }))}
                placeholder="Living Out the Faith"
                className="font-serif text-xl font-bold text-on-surface bg-transparent border-b border-outline-variant/30 outline-none focus:border-primary w-full max-w-md py-1"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {coreValues.items.map((it, i) => (
                <div key={i} className="space-y-2 bg-surface-container-low/60 rounded-2xl p-4">
                  <input value={it.title} onChange={e => updateValueItem(i, 'title', e.target.value)} placeholder={isZh ? '标题' : 'Title'}
                    className="w-full rounded-xl border border-outline-variant/50 bg-white py-2 px-3 text-sm font-bold outline-none focus:border-primary" />
                  <textarea value={it.desc} onChange={e => updateValueItem(i, 'desc', e.target.value)} rows={3} placeholder={isZh ? '描述' : 'Description'}
                    className="w-full rounded-xl border border-outline-variant/50 bg-white py-2 px-3 text-xs outline-none focus:border-primary resize-none" />
                </div>
              ))}
            </div>
          </div>

          {/* Team Editor */}
          <div className="mt-10 border-t border-outline-variant/20 pt-10">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-outline mb-1">Our Team</p>
                <h4 className="font-serif text-xl font-bold text-on-surface">我们的团队</h4>
              </div>
              <button
                onClick={() => setAboutData(prev => ({ ...prev, team: [...prev.team, { name: '', role: '', image: '', title: '' }] }))}
                className="flex items-center gap-2 rounded-2xl bg-primary/10 text-primary px-5 py-2.5 text-xs font-bold hover:bg-primary hover:text-on-primary transition-all"
              >
                <span className="material-symbols-outlined text-sm">person_add</span>
                添加成员
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-2 px-2 mb-1">
                {['姓名','职位','标签','照片',''].map((h,i) => (
                  <span key={i} className="text-[9px] font-black uppercase tracking-widest text-outline">{h}</span>
                ))}
              </div>
              {aboutData.team.map((member, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-2 items-center bg-surface-container-low/60 rounded-2xl p-3">
                  {(['name','role','title'] as const).map(field => (
                    <input key={field} type="text" value={(member as any)[field] || ''} placeholder={field}
                      onChange={e => {
                        const team = [...aboutData.team];
                        team[idx] = { ...team[idx], [field]: e.target.value };
                        setAboutData({ ...aboutData, team });
                      }}
                      className="rounded-xl border border-outline-variant/50 bg-white py-2 px-3 text-xs outline-none focus:border-primary"
                    />
                  ))}
                  {/* Photo upload + URL */}
                  <div className="flex items-center gap-2">
                    {member.image && (
                      <img src={member.image} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-outline-variant/30" />
                    )}
                    <label className="flex-1 cursor-pointer">
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const team = [...aboutData.team];
                            team[idx] = { ...team[idx], image: ev.target?.result as string };
                            setAboutData({ ...aboutData, team });
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                      <span className="flex items-center gap-1 rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2 px-3 text-xs text-primary font-bold hover:bg-primary/10 transition-all">
                        <span className="material-symbols-outlined text-[14px]">upload</span>
                        {member.image ? '更换' : '上传'}
                      </span>
                    </label>
                  </div>
                  <button onClick={() => setAboutData({ ...aboutData, team: aboutData.team.filter((_, i) => i !== idx) })}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-outline hover:bg-error/10 hover:text-error transition-all">
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              ))}
              {aboutData.team.length === 0 && (
                <div className="rounded-2xl border-2 border-dashed border-outline-variant/30 py-8 text-center text-xs text-outline">
                  还没有团队成员。点击"添加成员"来开始。
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 flex justify-end gap-4">
             <button onClick={() => setIsEditing(false)} className="px-8 py-3 text-sm font-bold text-outline hover:text-on-surface transition-colors">Cancel</button>
             <button onClick={handleSave} disabled={saving} className="rounded-2xl bg-primary px-10 py-3 text-sm font-bold text-on-primary shadow-xl shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50">
               {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Save Changes'}
             </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-16">
          
          {/* 1. Serene Hero Section */}
          <section className="relative h-[480px] w-full overflow-hidden rounded-[48px] shadow-2xl group">
                    {aboutData.imageUrl && (
                      <motion.img 
                        initial={{ scale: 1.1 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 20, repeat: Infinity, repeatType: "reverse" }}
                        src={aboutData.imageUrl} 
                        alt="Church Interior" 
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
            
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="font-serif text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight"
              >
                {aboutData.name}
              </motion.h1>
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="max-w-2xl text-xl text-white/80 font-medium font-serif italic"
              >
                {aboutData.vision}
              </motion.p>
            </div>

            {/* Floating Badge (Scroll indicator or visual garnish) */}
            <div className="absolute bottom-10 right-10 flex h-20 w-20 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20 animate-pulse">
               <span className="material-symbols-outlined text-white text-3xl">expand_more</span>
            </div>
          </section>

          {/* 2. Bento Grid: Identity & Community */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* History Card (Large) */}
            <div className="lg:col-span-12 rounded-[40px] bg-surface-container-low p-10 border border-outline-variant/20 relative group overflow-hidden">
               <div className="absolute right-0 top-0 h-64 w-64 bg-primary/5 blur-[80px] group-hover:bg-primary/10 transition-colors"></div>
               
               <header className="flex items-center gap-4 mb-8">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-3xl filled">temple_buddhist</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-outline">{t('ourHistory')}</span>
                    <h3 className="font-serif text-3xl font-bold text-on-surface">{t('history')}</h3>
                  </div>
               </header>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                  <div className="md:col-span-2">
                    <p className="text-xl leading-relaxed text-on-surface-variant font-serif italic border-l-4 border-primary/20 pl-8">
                      {aboutData.history}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center gap-6">
                    <div className="flex items-center gap-4 group/icon">
                       <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high group-hover/icon:bg-primary group-hover/icon:text-on-primary transition-all">
                          <span className="material-symbols-outlined text-xl">person_pin</span>
                       </div>
                       <div>
                          <p className="text-[10px] uppercase font-bold text-outline">{t('founder')}</p>
                          <p className="font-bold text-on-surface">{aboutData.founders}</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-4 group/icon">
                       <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high group-hover/icon:bg-primary group-hover/icon:text-on-primary transition-all">
                          <span className="material-symbols-outlined text-xl">account_tree</span>
                       </div>
                       <div>
                          <p className="text-[10px] uppercase font-bold text-outline">{t('denomination')}</p>
                          <p className="font-bold text-on-surface">{aboutData.denomination}</p>
                       </div>
                    </div>
                  </div>
               </div>
            </div>

            {/* Service Times (Small) */}
            <div className="lg:col-span-6 rounded-[40px] bg-secondary-container p-10 flex flex-col justify-between border border-secondary/10 group">
               <header className="flex justify-between items-start">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-on-secondary-container">
                    <span className="material-symbols-outlined text-2xl">schedule</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-on-secondary-container opacity-60 mt-1">{t('serviceTimes')}</span>
               </header>
               <div className="mt-8">
                  <p className="text-sm font-bold text-on-secondary-container opacity-80 uppercase tracking-widest mb-1">{t('sundayWorship')}</p>
                  <h4 className="font-serif text-5xl font-black text-on-secondary-container text-shadow-sm">{aboutData.serviceTimes}</h4>
                  <p className="mt-4 text-on-secondary-container opacity-70 italic font-medium">中/泰/英三语同步</p>
               </div>
               <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center text-on-secondary-container">
                  <span className="text-sm font-medium">{t('secondaryTime') || '祷告会'}</span>
                  <span className="text-sm font-bold">{aboutData.secondaryTime}</span>
               </div>
            </div>

            {/* Location & Navigation (Small) */}
            <div className="lg:col-span-6 rounded-[40px] bg-surface-container-high p-10 flex flex-col justify-between relative overflow-hidden group">
               <div className="absolute right-0 bottom-0 opacity-10 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-[200px] -mr-10 -mb-10 text-primary">map</span>
               </div>
               
               <header className="relative z-10 flex justify-between items-start">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-2xl">location_on</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-outline mt-1">{t('location')}</span>
               </header>

               <div className="relative z-10 mt-8">
                  <h4 className="font-headline-sm text-2xl text-on-surface mb-2">{aboutData.location}</h4>
                  <p className="text-sm text-on-surface-variant max-w-[200px]">{t('mainSanctuary')} • {t('freeParking') || '提供免费泊车'}</p>
               </div>

               <div className="relative z-10 mt-10 flex gap-2">
                  <button
                    onClick={() => openInMaps(aboutData.location)}
                    className="flex-1 rounded-2xl bg-primary py-3.5 text-xs font-bold text-on-primary shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-sm">navigation</span>
                    {t('navigation')}
                  </button>
                  <button
                    onClick={() => copyAddress(aboutData.location)}
                    title={aboutData.location}
                    className="flex h-12 px-4 items-center justify-center gap-1.5 rounded-2xl bg-surface-container-highest text-on-surface hover:bg-primary/5 transition-colors text-xs font-bold">
                    <span className="material-symbols-outlined text-lg">{addrCopied ? 'check' : 'content_copy'}</span>
                  </button>
               </div>
            </div>
          </section>

          {/* 3. New Section: Core Values */}
          <section className="py-8">
             <header className="flex flex-col items-center text-center mb-16">
                <div className="mb-4 inline-flex items-center gap-3">
                  <div className="h-px w-8 bg-primary/30"></div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">{t('coreValues')}</span>
                  <div className="h-px w-8 bg-primary/30"></div>
                </div>
                <h3 className="font-serif text-4xl md:text-5xl font-bold text-on-surface">{coreValues.heading}</h3>
             </header>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                {[
                  { icon: 'favorite', bg: 'bg-primary/5', color: 'text-primary' },
                  { icon: 'volunteer_activism', bg: 'bg-secondary/5', color: 'text-secondary' },
                  { icon: 'group', bg: 'bg-tertiary/5', color: 'text-tertiary' }
                ].map((val, i) => (
                  <motion.div
                    whileHover={{ y: -8 }}
                    key={i}
                    className="flex flex-col items-center text-center group"
                  >
                    <div className={`mb-8 flex h-24 w-24 items-center justify-center rounded-full ${val.bg} ${val.color} transition-all group-hover:scale-110 shadow-sm border border-outline-variant/10`}>
                       <span className="material-symbols-outlined text-4xl filled">{val.icon}</span>
                    </div>
                    <h4 className="font-serif text-2xl font-bold text-on-surface mb-3">{coreValues.items[i]?.title}</h4>
                    <p className="text-on-surface-variant text-sm leading-relaxed opacity-80">
                      {coreValues.items[i]?.desc}
                    </p>
                  </motion.div>
                ))}
             </div>
          </section>

          {/* 3. New Section: Weekly Cell Group Schedule Table */}
          <section className="py-12">
            <header className="flex flex-col items-center text-center mb-12">
               <div className="mb-4 inline-flex items-center gap-3">
                 <div className="h-px w-8 bg-primary/30"></div>
                 <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">{t('cellGroupSchedule')}</span>
                 <div className="h-px w-8 bg-primary/30"></div>
               </div>
               <h3 className="font-serif text-4xl font-bold text-on-surface mb-4">{t('cellGroupSchedule')}</h3>
               <p className="text-sm text-on-surface-variant max-w-2xl opacity-70">
                 {t('cellGroupDesc')}
               </p>
            </header>

            <div className="overflow-x-auto rounded-[32px] border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/20">{t('meetingName')}</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/20">{t('meetingTime')}</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/20">{t('meetingLocation')}</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/20">{t('contactPerson')}</th>
                    <th className="p-6 text-[10px] font-black uppercase tracking-widest text-outline border-b border-outline-variant/20">{t('note')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {scheduleRows.map((row, i) => (
                    <tr key={i} className="hover:bg-primary/5 transition-colors group">
                      <td className="p-6 text-sm font-bold text-on-surface">{row.name}</td>
                      <td className="p-6 text-sm text-on-surface-variant font-medium">{row.time}</td>
                      <td className="p-6 text-sm text-on-surface-variant">{row.loc}</td>
                      <td className="p-6 text-sm text-on-surface-variant font-medium">{row.contact}</td>
                      <td className="p-6 text-sm text-on-surface-variant opacity-70 italic">{row.note}</td>
                    </tr>
                  ))}
                  {scheduleRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-sm text-outline italic">
                        暂无聚会安排
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4. Our Team (Refined Visuals) */}
          <section className="rounded-[48px] bg-surface-container-lowest p-12 border border-outline-variant/30">
             <header className="flex items-center justify-between mb-12">
                <h3 className="font-serif text-3xl font-bold text-on-surface">{t('ourTeam')}</h3>
                <div className="h-0.5 flex-1 mx-8 bg-gradient-to-r from-outline-variant/30 to-transparent"></div>
             </header>
             
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12">
               {aboutData.team.map((member, idx) => (
                 <motion.div 
                   initial={{ opacity: 0, y: 20 }}
                   whileInView={{ opacity: 1, y: 0 }}
                   viewport={{ once: true }}
                   transition={{ delay: idx * 0.1 }}
                   key={idx} 
                   className="flex flex-col items-center group"
                 >
                   <div className="relative mb-6">
                     <div className="absolute inset-0 rounded-[32px] bg-primary/20 blur-2xl opacity-0 group-hover:opacity-40 transition-opacity"></div>
                     {member.image ? (
                       <img 
                         src={member.image} 
                         alt={member.name} 
                         className="relative w-48 h-48 rounded-[32px] object-cover border-4 border-white shadow-xl transition-transform duration-500 group-hover:scale-105"
                         referrerPolicy="no-referrer"
                       />
                     ) : (
                       <div className="relative w-48 h-48 rounded-[32px] bg-surface-container flex items-center justify-center border-4 border-white shadow-xl transition-transform duration-500 group-hover:scale-105">
                         <span className="material-symbols-outlined text-outline text-6xl">person</span>
                       </div>
                     )}
                     <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/60 backdrop-blur-xl border border-white/40 px-5 py-2 rounded-2xl shadow-xl text-[10px] font-bold text-primary tracking-widest uppercase">
                        {member.title}
                     </div>
                   </div>
                   <h4 className="font-serif text-xl font-bold text-on-surface">{member.name}</h4>
                   <p className="text-xs text-outline uppercase tracking-widest mt-1 font-bold">{member.role}</p>
                 </motion.div>
               ))}
             </div>
          </section>

          {/* 5. Photo Gallery (Enhanced) */}
          <section className="pb-12">
            <header className="flex items-end justify-between mb-10">
              <div>
                <h3 className="font-serif text-3xl font-bold text-on-surface">{t('photoGallery')}</h3>
                <p className="text-xs text-outline uppercase tracking-wider mt-1">{t('momentsOfGrace') || '感恩瞬间'}</p>
              </div>
              {mode === 'Manager' && (
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="h-12 w-12 flex items-center justify-center rounded-full bg-surface-container-high text-primary hover:bg-primary hover:text-on-primary transition-all shadow-sm"
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              )}
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {aboutData.galleryImages.slice(0, galleryLimit).map((img, idx) => (
                  <motion.div 
                    layout
                    whileHover={{ scale: 1.02 }}
                    onClick={() => setSelectedImage(img)}
                    key={idx} 
                    className="aspect-[4/3] rounded-[32px] overflow-hidden shadow-sm cursor-pointer group relative"
                  >
                    {img && (
                      <img 
                        src={img} 
                        alt={`Gallery ${idx}`} 
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-3xl">zoom_in</span>
                    </div>
                  </motion.div>
              ))}
            </div>

            {galleryLimit < aboutData.galleryImages.length && (
              <div className="mt-12 flex justify-center">
                 <button 
                  onClick={() => setGalleryLimit(prev => prev + 4)}
                  className="flex items-center gap-2 text-xs font-bold text-primary tracking-widest uppercase hover:opacity-70 transition-opacity"
                 >
                   {t('loadMore')}
                   <span className="material-symbols-outlined text-lg">expand_more</span>
                 </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Lightbox Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-8 backdrop-blur-xl"
          >
            <motion.img 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={selectedImage} 
              className="max-h-full max-w-full rounded-[32px] shadow-2xl"
              alt="Enlarged gallery view"
              referrerPolicy="no-referrer"
            />
            <button className="absolute top-10 right-10 text-white/60 hover:text-white">
              <span className="material-symbols-outlined text-4xl">close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
