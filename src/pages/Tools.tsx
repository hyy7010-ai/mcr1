import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import SignatureCanvas from 'react-signature-canvas';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { memberService, Member } from '../services/memberService';
import { FEATURE_MODULES, FEATURE_ROLES, FeatureConfig } from '../lib/featureModules';

export default function Tools() {
  const { t, language, isZh } = useLanguage();
  const { mode } = useMode();
  const { church, updateChurch, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'finance' | 'newcomers' | 'features'>('finance');
  const [featureCfg, setFeatureCfg] = useState<FeatureConfig>(() => (church as any)?.feature_config || {});
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [featuresSaved, setFeaturesSaved] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showNewFriendModal, setShowNewFriendModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [newFriends, setNewFriends] = useState<Member[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const [churchName, setChurchName] = useState(church?.name || '');
  const [churchCode, setChurchCode] = useState(church?.code || '');
  const [updatingLogo, setUpdatingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (church) {
      setChurchName(church.name);
      setChurchCode(church.code);
    }
  }, [church]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !church?.id) return;

    setUpdatingLogo(true);
    try {
      // Compress to max 400px wide and convert to base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const maxWidth = 400;
            const scale = img.width > maxWidth ? maxWidth / img.width : 1;
            const canvas = document.createElement('canvas');
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas not supported')); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = ev.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { error: updateError } = await supabase
        .from('churches')
        .update({ logo_url: base64 })
        .eq('id', church.id);

      if (updateError) throw updateError;

      updateChurch({ logo_url: base64 });
      alert(isZh ? '教会标志已更新' : 'Church logo updated');
    } catch (err: any) {
      console.error(err);
      alert((isZh ? '上传失败: ' : 'Upload failed: ') + (err.message || 'Unknown error'));
    } finally {
      setUpdatingLogo(false);
    }
  };

  // ── Feature permissions ──────────────────────────────────────────────────
  // A module not in the config is "on for everyone". Toggling/role-editing
  // writes an explicit entry. Default roles = all three when first restricted.
  const featAt = (key: string) => featureCfg[key] || { enabled: true, roles: [...FEATURE_ROLES] };

  const toggleModule = (key: string) => {
    setFeaturesSaved(false);
    setFeatureCfg(prev => {
      const cur = prev[key] || { enabled: true, roles: [...FEATURE_ROLES] };
      return { ...prev, [key]: { ...cur, enabled: !(cur.enabled !== false) } };
    });
  };

  const toggleRole = (key: string, role: string) => {
    setFeaturesSaved(false);
    setFeatureCfg(prev => {
      const cur = prev[key] || { enabled: true, roles: [...FEATURE_ROLES] };
      const roles = cur.roles && cur.roles.length ? cur.roles : [...FEATURE_ROLES];
      const next = roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role];
      return { ...prev, [key]: { ...cur, roles: next } };
    });
  };

  const saveFeatures = async () => {
    if (!church?.id) return;
    setSavingFeatures(true);
    try {
      const { error } = await supabase.from('churches').update({ feature_config: featureCfg }).eq('id', church.id);
      if (error) throw error;
      updateChurch({ feature_config: featureCfg });
      setFeaturesSaved(true);
      setTimeout(() => setFeaturesSaved(false), 2500);
    } catch (err: any) {
      alert((isZh ? '保存失败：' : 'Save failed: ') + (err.message || 'Unknown error'));
    } finally {
      setSavingFeatures(false);
    }
  };

  const handleUpdateChurchInfo = async () => {
    if (!church?.id) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('churches')
        .update({ name: churchName, code: churchCode })
        .eq('id', church.id);
      if (error) throw error;
      alert(isZh ? '修改已保存' : 'Changes saved');
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!church?.id) return;
    const fetchData = async () => {
      setLoading(true);
      // Finance history — shared per church so Manager + Staff see the same records.
      try {
        const { data: fin } = await supabase
          .from('church_finance')
          .select('*')
          .eq('church_id', church.id)
          .order('created_at', { ascending: false });
        if (fin) {
          setHistory(fin.map((r: any) => ({
            id: r.id,
            date: r.date,
            cashTotal: Number(r.cash_total) || 0,
            tithe: Number(r.tithe) || 0,
            reimbursement: Number(r.reimbursement) || 0,
            grandTotal: Number(r.grand_total) || 0,
            details: r.details || {},
            signees: r.signees || [],
          })));
        }
      } catch (e) { console.warn('finance load failed', e); }
      // Members (for the newcomers tab — managers only, but harmless if it fails)
      try {
        const allMembers = await memberService.getMembers(church.id);
        setNewFriends(allMembers.filter(m => m.status === 'New Friend'));
        setMembers(allMembers.filter(m => m.status !== 'New Friend'));
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [church?.id]);


  // Signature Refs
  const sigPad1 = useRef<SignatureCanvas>(null);
  const sigPad2 = useRef<SignatureCanvas>(null);

  // Denominations state
  const denominations = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05];
  const [counts, setCounts] = useState<{ [key: number]: string }>({});
  const [tithe, setTithe] = useState('0');
  const [reimbursement, setReimbursement] = useState('0');
  const [signee1, setSignee1] = useState('');
  const [signee2, setSignee2] = useState('');

  // New Friend form
  const [friendForm, setFriendForm] = useState({ name: '', phone: '', invitedBy: '', origin: '', yearsInAus: '' });
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // Manager-editable extra questions for the new friend form
  const churchKey = (base: string) => `${base}_${church?.id || 'demo'}`;
  type ExtraQuestion = { id: string; label: string; placeholder: string; type: 'text' | 'number' };
  const DEFAULT_EXTRA_QUESTIONS: ExtraQuestion[] = [];
  const [extraQuestions, setExtraQuestions] = useState<ExtraQuestion[]>(() => {
    try { return JSON.parse(localStorage.getItem(`newFriend_extraQ_${church?.id || 'demo'}`) || '[]'); }
    catch { return []; }
  });
  const [isEditingForm, setIsEditingForm] = useState(false);
  const [editQDraft, setEditQDraft] = useState<ExtraQuestion[]>([]);

  const saveExtraQuestions = (qs: ExtraQuestion[]) => {
    // NOTE: Custom questions are currently stored in localStorage only (keyed by church ID).
    // They will be lost if the browser cache is cleared. A future improvement would be to
    // persist these to a JSON column in the `churches` Supabase table (requires a schema migration).
    setExtraQuestions(qs);
    localStorage.setItem(`newFriend_extraQ_${church?.id || 'demo'}`, JSON.stringify(qs));
  };

  const addExtraQuestion = () => {
    const draft = [...editQDraft, { id: `q_${Date.now()}`, label: isZh ? '新问题' : 'New Question', placeholder: '', type: 'text' as const }];
    setEditQDraft(draft);
  };

  const openEditForm = () => {
    setEditQDraft([...extraQuestions]);
    setIsEditingForm(true);
  };

  const saveEditForm = () => {
    saveExtraQuestions(editQDraft);
    setIsEditingForm(false);
  };

  const calculateTotal = () => {
    const cashTotal = denominations.reduce((acc, d) => {
      const count = parseInt(counts[d] || '0');
      return acc + (d * count);
    }, 0);
    return cashTotal;
  };

  const handleSave = async () => {
    const totalCash = calculateTotal();

    // Validate signatures — both signatories must sign
    if (!signee1.trim() || !signee2.trim()) {
      alert(isZh ? '请填写两位签名人姓名' : 'Please enter both signatory names before saving.');
      return;
    }
    if (sigPad1.current?.isEmpty() || sigPad2.current?.isEmpty()) {
      alert(isZh ? '请完成两位签名后再保存' : 'Both signatories must sign before saving.');
      return;
    }

    // Get signatures as data URLs
    const signature1 = sigPad1.current?.isEmpty() ? null : sigPad1.current?.getTrimmedCanvas().toDataURL('image/png');
    const signature2 = sigPad2.current?.isEmpty() ? null : sigPad2.current?.getTrimmedCanvas().toDataURL('image/png');

    const newRecord = {
      id: Date.now(),
      date: new Date().toLocaleDateString(),
      cashTotal: totalCash,
      tithe: parseFloat(tithe || '0'),
      reimbursement: parseFloat(reimbursement || '0'),
      grandTotal: totalCash + parseFloat(tithe || '0') - parseFloat(reimbursement || '0'),
      details: { ...counts },
      signees: [
        { name: signee1, signature: signature1 },
        { name: signee2, signature: signature2 }
      ]
    };

    // Optimistic add, then persist to the shared church_finance table so Manager + Staff sync.
    setHistory([newRecord, ...history]);
    setShowAddModal(false);
    setCounts({});
    setTithe('0');
    setReimbursement('0');
    setSignee1('');
    setSignee2('');

    if (church?.id) {
      try {
        const { data, error } = await supabase.from('church_finance').insert({
          church_id: church.id,
          date: newRecord.date,
          cash_total: newRecord.cashTotal,
          tithe: newRecord.tithe,
          reimbursement: newRecord.reimbursement,
          grand_total: newRecord.grandTotal,
          details: newRecord.details,
          signees: newRecord.signees,
          created_by: profile?.full_name || 'Unknown',
        }).select().single();
        if (!error && data) {
          // Swap the temp id for the real DB id
          setHistory(prev => prev.map(h => h.id === newRecord.id ? { ...h, id: data.id } : h));
        } else if (error) {
          console.warn('finance save failed:', error.message);
        }
      } catch (e) { console.warn('finance save error', e); }
    }
  };

  const handleMoveToMember = async (friend: Member) => {
    try {
      const updated = await memberService.updateMember(friend.id, {
        status: 'Member',
        role: ['Member'],
        joined: new Date().getFullYear().toString()
      });
      setMembers([updated, ...members]);
      setNewFriends(newFriends.filter(f => f.id !== friend.id));
    } catch (error) {
      console.error('Error moving to member:', error);
    }
  };

  const handleSaveFriend = async () => {
    if (!friendForm.name || !church?.id) return;
    try {
      const newFriendData: Omit<Member, 'id'> = {
        church_id: church.id,
        name: friendForm.name,
        phone: friendForm.phone,
        origin: friendForm.origin,
        yearsInAus: friendForm.yearsInAus,
        referral_source: friendForm.invitedBy,
        initials: friendForm.name.charAt(0).toUpperCase(),
        joined: new Date().toISOString().split('T')[0],
        status: 'New Friend',
        role: ['Member'],
        family: 'Church Core'
      };
      
      const added = await memberService.addMember(newFriendData);
      
      // Auto-create relationship link if invitedBy matches an existing member
      if (friendForm.invitedBy) {
        const inviter = members.find(m => m.name.toLowerCase() === friendForm.invitedBy.toLowerCase());
        if (inviter) {
          await memberService.upsertMemberLink({
            church_id: church.id,
            source_id: inviter.id,
            target_id: added.id,
            type: 'Invited'
          });
        }
      }
      
      setNewFriends([added, ...newFriends]);
      setShowNewFriendModal(false);
      setFriendForm({ name: '', phone: '', invitedBy: '', origin: '', yearsInAus: '' });
    } catch (error) {
      console.error('Error saving friend:', error);
    }
  };

  // Managers get the full tools; Staff get the finance count only; Members are blocked.
  const financeOnly = mode !== 'Manager'; // Staff
  if (mode !== 'Manager' && mode !== 'Staff') {
    return (
      <div className="flex w-full h-full items-center justify-center bg-surface">
        <div className="text-center p-8 rounded-3xl bg-surface-container-low max-w-sm">
          <span className="material-symbols-outlined text-6xl text-error mb-4">lock</span>
          <h2 className="text-xl font-bold mb-2">{isZh ? '无权访问' : 'Access Denied'}</h2>
          <p className="text-sm text-outline">{isZh ? '只有管理员可以查看管理工具与人员分类。' : 'Only managers can view the church administration tools.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col bg-surface min-h-full pb-20">
      {/* Header */}
      <div className="p-6 md:p-8 flex flex-col gap-4 border-b border-outline-variant/10 bg-surface">
        <div>
          <h2 className="mb-2 font-headline-md text-on-surface">{financeOnly ? (isZh ? '财务点收' : 'Finance Count') : (isZh ? '管理工具' : 'Management Tools')}</h2>
          <p className="font-label-sm text-sm text-on-surface-variant uppercase tracking-widest opacity-70">
            {financeOnly ? (isZh ? '数钱点收（与管理员同步）' : 'Cash counting (synced with managers)') : (isZh ? '财务、新朋友及人员分类' : 'Finances, Newcomers & Member Categorization')}
          </p>
        </div>

        <div className="flex gap-4 mt-2">
          <button
            onClick={() => setActiveTab('finance')}
            className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${
              activeTab === 'finance'
                ? 'bg-black text-white shadow-lg'
                : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">payments</span>
            {isZh ? '财务点收 (数钱)' : 'Finances / Giving'}
          </button>
          {!financeOnly && (<>
          <button
            onClick={() => setActiveTab('newcomers')}
            className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${
              activeTab === 'newcomers'
                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">group_add</span>
            {isZh ? '新朋友 & 人员分类' : 'Newcomers & Assignment'}
          </button>
          <button
            onClick={() => setActiveTab('features')}
            className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${
              activeTab === 'features'
                ? 'bg-black text-white shadow-lg'
                : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            {isZh ? '功能权限' : 'Feature Permissions'}
          </button>
          </>)}
        </div>
      </div>

      <div className="flex-1 p-6 md:p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'finance' && (
            <motion.div
              key="finance"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-5xl"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest mb-2">
                    {isZh ? '本周点收总计' : 'Weekly Total'}
                  </p>
                  <h3 className="text-3xl font-serif font-black text-emerald-800">
                    ${history[0]?.grandTotal.toFixed(2) || '0.00'}
                  </h3>
                </div>
                <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-2">
                    {isZh ? '最后记录日期' : 'Last Record Date'}
                  </p>
                  <h3 className="text-xl font-bold">{history[0]?.date || '-'}</h3>
                </div>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="flex flex-col items-center justify-center p-6 rounded-3xl bg-black text-white hover:bg-primary transition-all shadow-lg active:scale-95 group"
                >
                  <span className="material-symbols-outlined text-3xl mb-2 group-hover:scale-110 transition-transform">add_circle</span>
                  <span className="text-[12px] font-black uppercase tracking-widest">{isZh ? '开启新点收' : 'New Count'}</span>
                </button>
              </div>

              <div className="bg-white border border-outline-variant/30 p-8 rounded-[32px] shadow-sm">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">analytics</span>
                  {isZh ? '财务历史记录' : 'Finance History'}
                </h3>
                
                {history.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="material-symbols-outlined text-4xl text-outline/30 mb-2">inbox</span>
                    <p className="text-outline text-sm font-medium">{isZh ? '暂无记录' : 'No records yet'}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="border-b border-outline-variant/20">
                        <tr>
                          <th className="pb-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '日期' : 'Date'}</th>
                          <th className="pb-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '现金' : 'Cash'}</th>
                          <th className="pb-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '十一奉献' : 'Tithe'}</th>
                          <th className="pb-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '报销' : 'Expense'}</th>
                          <th className="pb-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '总额' : 'Total'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(record => (
                          <tr 
                            key={record.id} 
                            onClick={() => setSelectedRecord(record)}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-lowest transition-colors cursor-pointer group"
                          >
                            <td className="py-4 font-bold flex items-center gap-2">
                              {record.date}
                              <span className="material-symbols-outlined text-[16px] opacity-0 group-hover:opacity-100 transition-opacity text-primary">info</span>
                            </td>
                            <td className="py-4 text-sm font-medium">${record.cashTotal.toFixed(2)}</td>
                            <td className="py-4 text-sm font-medium text-emerald-600">+${record.tithe.toFixed(2)}</td>
                            <td className="py-4 text-sm font-medium text-error">-${record.reimbursement.toFixed(2)}</td>
                            <td className="py-4 text-lg font-black">${record.grandTotal.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'newcomers' && (
            <motion.div
              key="newcomers"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-6xl"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                   <h3 className="text-xl font-serif font-black">{isZh ? '新朋友登记表' : 'New Friends Registry'}</h3>
                   <p className="text-xs text-outline">{isZh ? '记录来到教会的新朋友信息，方便同工跟进。' : 'Record information of new visitors to help with follow-up.'}</p>
                </div>
                <button 
                  onClick={() => setShowNewFriendModal(true)}
                  className="px-6 py-3 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-lg flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  {isZh ? '登记新朋友' : 'Add New Friend'}
                </button>
              </div>

              <div className="bg-white border border-outline-variant/30 rounded-[32px] shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-lowest border-b border-outline-variant/20">
                    <tr>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '姓名' : 'Name'}</th>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '家乡 / 哪里人' : 'Origin'}</th>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '来澳年份' : 'Yrs in Aus'}</th>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '推荐人' : 'Invited By'}</th>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '登记日期' : 'Date'}</th>
                      <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '操作' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newFriends.map(friend => (
                      <tr key={friend.id} className="border-b border-outline-variant/10 hover:bg-surface-container-lowest transition-colors">
                        <td className="p-4 font-bold">
                           <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black">
                               {friend.name.charAt(0).toUpperCase()}
                             </div>
                             <div className="flex flex-col">
                               <span className="text-sm">{friend.name}</span>
                               <span className="text-[10px] text-outline font-medium">{friend.phone || '-'}</span>
                             </div>
                           </div>
                        </td>
                        <td className="p-4 text-sm font-medium text-on-surface-variant">{friend.origin || '-'}</td>
                        <td className="p-4 text-sm font-medium">
                          {friend.yearsInAus ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                              {friend.yearsInAus} {isZh ? '年' : 'yrs'}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="p-4 text-sm">
                          <span className="px-2 py-1 bg-surface-container rounded-lg text-xs font-medium">{friend.referral_source || (isZh ? '自行来到' : 'Self')}</span>
                        </td>
                        <td className="p-4">
                          <button 
                            onClick={() => handleMoveToMember(friend)}
                            className="px-3 py-1.5 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all active:scale-95"
                          >
                            {isZh ? '归类为成员' : 'Categorize'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {newFriends.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-outline italic">
                          {isZh ? '暂无登记记录' : 'No records recorded'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Members List Section */}
              <div className="mt-12 bg-white border border-outline-variant/30 rounded-[32px] shadow-sm overflow-hidden">
                <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-lowest">
                  <div>
                    <h3 className="text-xl font-serif font-black">{isZh ? '正式成员名单' : 'Official Member List'}</h3>
                    <p className="text-xs text-outline">{isZh ? '已经归入教会成员体系的人员' : 'Personnel already assigned to groups or roles.'}</p>
                  </div>
                  <span className="px-4 py-2 bg-black text-white rounded-full text-xs font-black">{members.length} {isZh ? '位成员' : 'MEMBERS'}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-lowest border-b border-outline-variant/20">
                      <tr>
                        <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '成员' : 'Member'}</th>
                        <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '职责' : 'Role'}</th>
                        <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '家乡' : 'Origin'}</th>
                        <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest">{isZh ? '加入日期' : 'Joined'}</th>
                        <th className="p-4 text-[10px] font-black text-outline uppercase tracking-widest text-right">{isZh ? '管理' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(member => (
                        <tr key={member.id} className="border-b border-outline-variant/10 hover:bg-surface-container-lowest transition-colors">
                          <td className="p-4 font-bold flex items-center gap-3">
                             <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-[10px] font-black shadow-sm">
                               {member.name.charAt(0).toUpperCase()}
                             </div>
                             <div className="flex flex-col">
                               <span className="text-sm font-black">{member.name}</span>
                               <span className="text-[10px] text-outline font-medium tracking-tight">{member.phone || (isZh ? '无电话' : 'No Phone')}</span>
                             </div>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase border tracking-widest ${
                              member.role?.includes('Leader') 
                                ? 'bg-primary text-white border-primary shadow-sm' 
                                : 'bg-surface-container-low border-outline-variant/20 text-on-surface'
                            }`}>
                              {member.role?.[0] || 'Member'}
                            </span>
                          </td>
                          <td className="p-4 text-xs font-bold text-on-surface-variant italic">{member.origin || '-'}</td>
                          <td className="p-4 text-[10px] font-black text-outline uppercase tracking-tighter">{member.joined}</td>
                          <td className="p-4 text-right">
                             <button className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline hover:text-primary transition-all">
                               <span className="material-symbols-outlined text-[18px]">settings</span>
                             </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'features' && (
            <motion.div
              key="features"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-3xl"
            >
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-serif font-black text-2xl text-on-surface">{isZh ? '功能权限' : 'Feature Permissions'}</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    {isZh ? '开关每个功能，并勾选哪些角色能在菜单里看到它。' : 'Turn each feature on/off and choose which roles can see it in the menu.'}
                  </p>
                </div>
                <button
                  onClick={saveFeatures}
                  disabled={savingFeatures}
                  className="shrink-0 px-6 py-3 rounded-2xl bg-black text-white font-black text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-600 transition-all disabled:opacity-50"
                >
                  {savingFeatures
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[18px]">{featuresSaved ? 'check' : 'save'}</span>}
                  {featuresSaved ? (isZh ? '已保存' : 'Saved') : (isZh ? '保存' : 'Save')}
                </button>
              </div>

              <div className="space-y-3">
                {FEATURE_MODULES.map(m => {
                  const cfg = featAt(m.key);
                  const on = cfg.enabled !== false;
                  const roles = cfg.roles && cfg.roles.length ? cfg.roles : [...FEATURE_ROLES];
                  return (
                    <div key={m.key} className={`rounded-3xl border p-5 transition-all ${on ? 'bg-white border-outline-variant/15 shadow-sm' : 'bg-surface-container-low border-outline-variant/10 opacity-70'}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${on ? 'bg-primary/[0.06] text-primary' : 'bg-surface-container text-outline'}`}>
                            <span className="material-symbols-outlined text-[20px]">{m.icon}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-on-surface truncate">{isZh ? m.zh : m.en}</p>
                            <p className="text-[11px] text-outline">{isZh ? (on ? '已开启' : '已关闭') : (on ? 'Enabled' : 'Disabled')}</p>
                          </div>
                        </div>
                        {/* on/off switch */}
                        <button
                          onClick={() => toggleModule(m.key)}
                          aria-label="toggle"
                          className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${on ? 'bg-emerald-500' : 'bg-outline-variant'}`}
                        >
                          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>

                      {/* role visibility */}
                      {on && (
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                          <span className="text-[10px] font-black uppercase tracking-widest text-outline mr-1">{isZh ? '谁能看：' : 'Visible to:'}</span>
                          {FEATURE_ROLES.map(r => {
                            const checked = roles.includes(r);
                            const labelZh: any = { Manager: '管理员', Staff: '同工', Member: '会友' };
                            return (
                              <button
                                key={r}
                                onClick={() => toggleRole(m.key, r)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all flex items-center gap-1 ${checked ? 'bg-primary/5 border-primary/30 text-primary' : 'bg-surface-container-low border-transparent text-outline hover:bg-surface-container'}`}
                              >
                                <span className="material-symbols-outlined text-[14px]">{checked ? 'check_circle' : 'radio_button_unchecked'}</span>
                                {isZh ? labelZh[r] : r}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-outline mt-5">
                {isZh
                  ? '注：超级管理员始终可见全部；仪表盘、成员审核、管理工具等核心入口不受此限制。'
                  : 'Note: Super admins always see everything; core items (Dashboard, Approvals, Tools) are not affected.'}
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
      <AnimatePresence>
        {showNewFriendModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewFriendModal(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[40px] p-8 md:p-10 shadow-2xl space-y-8"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-[20px] bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-3xl">person_add</span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-serif font-black">{isZh ? '登记新朋友' : 'Add New Friend'}</h3>
                    <p className="text-sm text-outline mt-0.5">{isZh ? '填写新来宾的基本信息' : 'Enter details of the new visitor'}</p>
                  </div>
                </div>
                {mode === 'Manager' && !isEditingForm && (
                  <button onClick={openEditForm} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container text-xs font-black text-outline hover:bg-primary hover:text-white transition-all">
                    <span className="material-symbols-outlined text-sm">edit_note</span>
                    {isZh ? '编辑表单' : 'Edit Form'}
                  </button>
                )}
              </div>

              {/* Manager: Edit Form Mode */}
              {isEditingForm && mode === 'Manager' && (
                <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary">{isZh ? '✏️ 编辑自定义问题（基础字段不可删除）' : '✏️ Edit Custom Questions'}</p>
                  {editQDraft.map((q, i) => (
                    <div key={q.id} className="flex gap-2 items-center">
                      <input
                        value={q.label}
                        onChange={e => { const d=[...editQDraft]; d[i]={...d[i],label:e.target.value}; setEditQDraft(d); }}
                        placeholder={isZh ? '问题标签' : 'Question label'}
                        className="flex-1 h-9 rounded-xl bg-white border border-outline-variant/50 px-3 text-xs font-bold outline-none focus:border-primary"
                      />
                      <input
                        value={q.placeholder}
                        onChange={e => { const d=[...editQDraft]; d[i]={...d[i],placeholder:e.target.value}; setEditQDraft(d); }}
                        placeholder={isZh ? '提示文字' : 'Placeholder'}
                        className="flex-1 h-9 rounded-xl bg-white border border-outline-variant/50 px-3 text-xs outline-none focus:border-primary"
                      />
                      <select
                        value={q.type}
                        onChange={e => { const d=[...editQDraft]; d[i]={...d[i],type:e.target.value as 'text'|'number'}; setEditQDraft(d); }}
                        className="h-9 rounded-xl bg-white border border-outline-variant/50 px-2 text-xs outline-none"
                      >
                        <option value="text">{isZh ? '文字' : 'Text'}</option>
                        <option value="number">{isZh ? '数字' : 'Number'}</option>
                      </select>
                      <button onClick={() => setEditQDraft(editQDraft.filter((_,j)=>j!==i))} className="h-9 w-9 flex items-center justify-center rounded-xl bg-error/10 text-error hover:bg-error hover:text-white transition-all flex-shrink-0">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button onClick={addExtraQuestion} className="flex-1 h-9 rounded-xl border-2 border-dashed border-primary/30 text-xs font-black text-primary hover:bg-primary/5 transition-all flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-sm">add</span>{isZh ? '加问题' : 'Add Question'}
                    </button>
                    <button onClick={saveEditForm} className="px-5 h-9 rounded-xl bg-primary text-white text-xs font-black hover:opacity-90 transition-all">
                      {isZh ? '保存' : 'Save'}
                    </button>
                    <button onClick={() => setIsEditingForm(false)} className="px-4 h-9 rounded-xl bg-surface-container text-xs font-black text-outline hover:bg-error/10 hover:text-error transition-all">
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{isZh ? '姓名' : 'Friend Name'}</label>
                    <input
                      type="text"
                      value={friendForm.name}
                      onChange={(e) => setFriendForm({ ...friendForm, name: e.target.value })}
                      placeholder={isZh ? '姓名' : 'Full Name'}
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{isZh ? '电话号码' : 'Phone'}</label>
                    <input
                      type="tel"
                      value={friendForm.phone}
                      onChange={(e) => setFriendForm({ ...friendForm, phone: e.target.value })}
                      placeholder="0xxx xxx xxx"
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{isZh ? '哪里人 / 家乡' : 'Origin'}</label>
                    <input
                      type="text"
                      value={friendForm.origin}
                      onChange={(e) => setFriendForm({ ...friendForm, origin: e.target.value })}
                      placeholder={isZh ? '例如：广州' : 'e.g. Sydney'}
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{isZh ? '来澳几年' : 'Yrs in Aus'}</label>
                    <input
                      type="number"
                      value={friendForm.yearsInAus}
                      onChange={(e) => setFriendForm({ ...friendForm, yearsInAus: e.target.value })}
                      placeholder="0"
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{isZh ? '推荐人 / 谁带过来的' : 'Invited By'}</label>
                  <input
                    type="text"
                    value={friendForm.invitedBy}
                    onChange={(e) => setFriendForm({ ...friendForm, invitedBy: e.target.value })}
                    placeholder={isZh ? '推荐人姓名' : 'Inviter Name'}
                    className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all"
                  />
                </div>

                {/* Custom extra questions */}
                {extraQuestions.map(q => (
                  <div key={q.id} className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">{q.label}</label>
                    <input
                      type={q.type}
                      value={customAnswers[q.id] || ''}
                      onChange={e => setCustomAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      className="w-full h-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 px-5 font-bold outline-none focus:border-primary transition-all text-sm"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleSaveFriend}
                  disabled={!friendForm.name}
                  className="w-full py-5 rounded-3xl bg-black text-white font-black uppercase tracking-widest hover:bg-primary transition-all shadow-xl active:scale-95 disabled:opacity-30"
                >
                  {isZh ? '保存登记表' : 'Save Friend'}
                </button>
                <button
                  onClick={() => { setShowNewFriendModal(false); setIsEditingForm(false); setCustomAnswers({}); }}
                  className="w-full py-4 text-xs font-black uppercase tracking-widest text-outline hover:text-on-surface transition-colors"
                >
                  {isZh ? '取消' : 'Cancel'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-5xl bg-[#F8F9FA] rounded-[32px] md:rounded-[48px] shadow-2xl flex flex-col md:flex-row max-h-[95vh] md:max-h-[85vh] overflow-hidden"
            >
              {/* Left Side: Denominations (Scrollable on mobile) */}
              <div className="flex-1 p-6 md:p-12 overflow-y-auto">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <span className="material-symbols-outlined">payments</span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-serif font-black">{isZh ? '数钱工具' : 'Cash Calculator'}</h3>
                    <p className="text-xs text-outline font-bold uppercase tracking-widest opacity-60">
                      {new Date().toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                  {denominations.map(d => (
                    <div key={d} className="flex flex-col gap-1">
                      <label className="text-[9px] md:text-[10px] font-black text-outline uppercase tracking-widest ml-1">${d}</label>
                      <input 
                        type="number"
                        placeholder="0"
                        min="0"
                        value={counts[d] || ''}
                        onChange={(e) => setCounts({ ...counts, [d]: e.target.value })}
                        className="w-full h-11 md:h-12 rounded-xl md:rounded-2xl bg-white border border-outline-variant/30 px-4 text-sm font-bold focus:border-emerald-500 outline-none transition-all shadow-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Side: Totals and Save (Scrollable on mobile) */}
              <div className="w-full md:w-[380px] bg-white border-t md:border-t-0 md:border-l border-outline-variant/20 p-6 md:p-10 flex flex-col overflow-y-auto">
                <div className="space-y-6 flex-1">
                   <div className="space-y-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{isZh ? '十一奉献' : 'Tithe Amount'}</label>
                        <input 
                          type="number" 
                          value={tithe} 
                          onChange={(e) => setTithe(e.target.value)}
                          className="w-full h-12 rounded-xl bg-emerald-50 border border-emerald-100 px-4 text-sm font-bold outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-error uppercase tracking-widest">{isZh ? '报销 / 支出' : 'Reimbursement'}</label>
                        <input 
                          type="number" 
                          value={reimbursement}
                          onChange={(e) => setReimbursement(e.target.value)}
                          className="w-full h-12 rounded-xl bg-red-50 border border-red-100 px-4 text-sm font-bold outline-none"
                        />
                      </div>
                   </div>

                   <div className="pt-6 border-t border-dashed border-outline-variant/30 space-y-4">
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-outline">{isZh ? '经手人 1' : 'Responsible Party 1'}</h4>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-outline/30 material-symbols-outlined text-lg">person</span>
                            <input 
                              type="text"
                              placeholder={isZh ? '输入姓名' : 'Enter Name'}
                              value={signee1}
                              onChange={(e) => setSignee1(e.target.value)}
                              className="w-full h-11 rounded-xl bg-surface-container-low border border-outline-variant/30 pl-11 pr-4 text-sm font-medium outline-none focus:border-primary"
                            />
                        </div>
                        <div className="relative rounded-xl bg-[#F8F9FA] border border-outline-variant/20 overflow-hidden">
                            <SignatureCanvas 
                              ref={sigPad1}
                              canvasProps={{ className: 'w-full h-24 md:h-28 cursor-crosshair' }}
                              backgroundColor="rgba(255,255,255,0)"
                            />
                            <button 
                              onClick={() => sigPad1.current?.clear()}
                              className="absolute right-3 bottom-3 w-7 h-7 rounded-full bg-surface-container-high/80 text-on-surface-variant flex items-center justify-center hover:bg-surface-container-highest transition-colors shadow-sm"
                            >
                               <span className="material-symbols-outlined text-[14px]">delete</span>
                            </button>
                        </div>
                      </div>

                      <div className="space-y-3 pt-2">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-outline">{isZh ? '经手人 2' : 'Responsible Party 2'}</h4>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-outline/30 material-symbols-outlined text-lg">person</span>
                            <input 
                              type="text"
                              placeholder={isZh ? '输入姓名' : 'Enter Name'}
                              value={signee2}
                              onChange={(e) => setSignee2(e.target.value)}
                              className="w-full h-11 rounded-xl bg-surface-container-low border border-outline-variant/30 pl-11 pr-4 text-sm font-medium outline-none focus:border-primary"
                            />
                        </div>
                        <div className="relative rounded-xl bg-[#F8F9FA] border border-outline-variant/20 overflow-hidden">
                            <SignatureCanvas 
                              ref={sigPad2}
                              canvasProps={{ className: 'w-full h-24 md:h-28 cursor-crosshair' }}
                              backgroundColor="rgba(255,255,255,0)"
                            />
                            <button 
                              onClick={() => sigPad2.current?.clear()}
                              className="absolute right-3 bottom-3 w-7 h-7 rounded-full bg-surface-container-high/80 text-on-surface-variant flex items-center justify-center hover:bg-surface-container-highest transition-colors shadow-sm"
                            >
                               <span className="material-symbols-outlined text-[14px]">delete</span>
                            </button>
                        </div>
                      </div>
                   </div>

                   <div className="pt-6 border-t border-dashed border-outline-variant/30">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-outline uppercase tracking-wider">{isZh ? '现金总计' : 'Cash Sum'}</span>
                        <span className="font-bold">${calculateTotal().toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-sm font-black uppercase tracking-widest text-on-surface">{isZh ? '最终合计' : 'Grand Total'}</span>
                        <span className="text-2xl md:text-3xl font-serif font-black text-primary">
                          ${(calculateTotal() + parseFloat(tithe || '0') - parseFloat(reimbursement || '0')).toFixed(2)}
                        </span>
                      </div>
                   </div>
                </div>

                <div className="flex flex-col gap-2 mt-8">
                  <button 
                    onClick={handleSave}
                    className="w-full py-4 md:py-5 rounded-2xl md:rounded-3xl bg-black text-white font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-xl active:scale-95"
                  >
                    {isZh ? '保存记录' : 'Save Record'}
                  </button>
                  <button 
                    onClick={() => setShowAddModal(false)}
                    className="w-full py-3 rounded-2xl font-bold text-sm text-outline hover:text-on-surface transition-all"
                  >
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail View Modal */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRecord(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-10 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="flex justify-between items-start mb-6 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-primary text-white flex items-center justify-center">
                    <span className="material-symbols-outlined">receipt_long</span>
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-serif font-black">{isZh ? '记录详情' : 'Record Details'}</h3>
                    <p className="text-[10px] text-outline font-bold uppercase tracking-widest">{selectedRecord.date}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedRecord(null)}
                  className="w-10 h-10 rounded-full hover:bg-surface-container transition-colors flex items-center justify-center"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Denomination Breakdown */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-outline">{isZh ? '现金明细' : 'Cash Breakdown'}</h4>
                    <div className="space-y-1">
                        {denominations.map(d => (
                          <div key={d} className="flex justify-between items-center py-2 border-b border-outline-variant/10 text-sm">
                             <span className="font-bold text-outline">${d}</span>
                             <div className="flex items-center gap-4">
                                <span className="text-xs text-outline-variant">x {selectedRecord.details[d] || 0}</span>
                                <span className="font-black">
                                  ${(d * parseInt(selectedRecord.details[d] || '0')).toFixed(2)}
                                </span>
                             </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Summary Card */}
                  <div className="flex flex-col gap-6">
                    <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/20 space-y-4">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-outline">{isZh ? '现金小计' : 'Cash Total'}</span>
                          <span className="font-black">${selectedRecord.cashTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-emerald-600">{isZh ? '十一奉献' : 'Tithe'}</span>
                          <span className="font-black text-emerald-600">+${selectedRecord.tithe.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-error">{isZh ? '报销支出' : 'Expense'}</span>
                          <span className="font-black text-error">-${selectedRecord.reimbursement.toFixed(2)}</span>
                        </div>
                        <div className="pt-4 border-t border-dashed border-outline-variant/30 flex justify-between items-end">
                          <span className="text-sm font-black uppercase tracking-widest">{isZh ? '最终合' : 'Grand Total'}</span>
                          <span className="text-2xl font-serif font-black text-primary">${selectedRecord.grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Signatures */}
                    <div className="p-6 rounded-3xl bg-surface-container-highest/30 border border-outline-variant/20 space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-outline">{isZh ? '经手负责人' : 'Responsible Party'}</h4>
                        <div className="grid grid-cols-1 gap-4">
                          {selectedRecord.signees?.map((signee: any, i: number) => (signee.name || signee.signature) && (
                            <div key={i} className="flex flex-col gap-2 p-4 rounded-2xl bg-white/50 border border-black/5">
                               <div className="flex items-center gap-2">
                                 <div className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[8px] font-black">
                                   {i + 1}
                                 </div>
                                 <span className="text-xs font-bold uppercase tracking-wider">{signee.name || (isZh ? '未命名的负责人' : 'Unnamed Signee')}</span>
                               </div>
                               {signee.signature && (
                                 <div className="bg-white rounded-lg border border-black/5 p-1">
                                   <img src={signee.signature} alt="Signature" className="h-20 w-full object-contain" />
                                 </div>
                               )}
                            </div>
                          ))}
                          {!selectedRecord.signees?.some((s: any) => s.name || s.signature) && (
                            <p className="text-xs text-outline italic">{isZh ? '未记录签名' : 'No signatures recorded'}</p>
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 shrink-0">
                <button 
                  onClick={() => setSelectedRecord(null)}
                  className="w-full py-4 rounded-2xl bg-black text-white font-black uppercase tracking-widest hover:bg-primary transition-all shadow-lg active:scale-95"
                >
                  {isZh ? '确认并返回' : 'Go Back'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
