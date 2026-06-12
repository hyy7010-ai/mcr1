import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { churchService, Church } from "../services/churchService";
import { useLanguage } from "../contexts/LanguageContext";

import {
  applicationService,
  ChurchApplication,
} from "../services/applicationService";
import { supabase } from "../lib/supabase";
import { isSuperAdmin } from "../lib/permissions";

export default function SuperAdmin() {
  const { profile, switchChurch, user, church: currentChurch } = useAuth();
  const { t, language, isZh } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if ((location.state as any)?.tab) {
      setActiveTab((location.state as any).tab);
    }
  }, [location.state]);

  // Is the Super Admin currently "inside" a real church (not demo)?
  const isViewingChurch = currentChurch && currentChurch.id !== 'demo-church-id';

  const handleExitChurch = () => {
    switchChurch(null);  // returns to demo / platform view
  };

  const [churches, setChurches] = useState<Church[]>(() => {
    const cached = localStorage.getItem('super_admin_cache');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return data.churches || [];
      } catch (e) { return []; }
    }
    return [];
  });
  const [applications, setApplications] = useState<ChurchApplication[]>(() => {
    const cached = localStorage.getItem('super_admin_cache');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return data.applications || [];
      } catch (e) { return []; }
    }
    return [];
  });
  const [pendingUsers, setPendingUsers] = useState<any[]>(() => {
    const cached = localStorage.getItem('super_admin_cache');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return data.pendingUsers || [];
      } catch (e) { return []; }
    }
    return [];
  });
  const [loading, setLoading] = useState(() => !localStorage.getItem('super_admin_cache'));
  const [activeTab, setActiveTab] = useState<"churches" | "applications" | "users" | "debug">(
    "churches",
  );
  const [debugLog, setDebugLog] = useState<any>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [showAddChurchModal, setShowAddChurchModal] = useState(false);
  const [newChurchForm, setNewChurchForm] = useState({
    name: "",
    code: "",
    domain: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const [appToApprove, setAppToApprove] = useState<ChurchApplication | null>(
    null,
  );
  const [approveForm, setApproveForm] = useState({ name: "", code: "" });
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [churchToEdit, setChurchToEdit] = useState<Church | null>(null);
  const [editChurchForm, setEditChurchForm] = useState({
    name: "",
    code: "",
    domain: "",
  });
  const [isEditingChurch, setIsEditingChurch] = useState(false);
  const [editChurchError, setEditChurchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Delete church state
  const [churchToDelete, setChurchToDelete] = useState<Church | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [isDeletingChurch, setIsDeletingChurch] = useState(false);
  const [deleteChurchError, setDeleteChurchError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [isSyncing, setIsSyncing] = useState(false);
  const isFetchingRef = React.useRef(false);

  // User approval modal state
  const [userToApprove, setUserToApprove] = useState<any | null>(null);
  const [approveUserForm, setApproveUserForm] = useState({ role: 'Manager', church_id: '' });
  const [isApprovingUser, setIsApprovingUser] = useState(false);
  const [approveUserMsg, setApproveUserMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load from cache initially
  useEffect(() => {
    const cached = localStorage.getItem('super_admin_cache');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        setChurches(data.churches || []);
        setApplications(data.applications || []);
        setPendingUsers(data.pendingUsers || []);
        setDebugLog(data.debugLog || null);
        setLoading(false); // Can show content immediately
      } catch (e) {
        console.warn('Failed to load super admin cache');
      }
    }
  }, []);

  // Fetch data in background if cache is present
  const fetchData = async (isBackground = false) => {
    if (isFetchingRef.current) return;
    
    const isAdmin = isSuperAdmin(profile, user);

    if (!isAdmin) {
      if (profile) setLoading(false);
      return;
    }

    isFetchingRef.current = true;
    try {
      // ONLY set loading to true if we have NO data at all
      if (!isBackground && churches.length === 0 && applications.length === 0) {
        setLoading(true);
      }
      setIsSyncing(true);
      setError(null);

      const fetchDataWithTimeout = async () => {
        // Run all 3 queries in PARALLEL — ~3× faster than sequential
        const [churchRes, appRes, usersRes] = await Promise.all([
          supabase.from('churches').select('*').order('created_at', { ascending: false }),
          supabase.from('church_applications').select('*').eq('status', 'Pending').order('created_at', { ascending: false }),
          supabase.from('profiles').select('id, full_name, email, role, church_id, created_at').in('role', ['Pending', 'Manager', 'Staff', 'Member']).limit(100),
        ]);

        if (churchRes.error) console.error("Churches error:", churchRes.error);
        if (appRes.error) console.error("Applications error:", appRes.error);
        if (usersRes.error) console.error("Users error:", usersRes.error);

        return { churchRes, appRes, usersRes };
      };

      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), 40000));
      
      const result: any = await Promise.race([fetchDataWithTimeout(), timeout]).catch(err => {
        console.warn('SuperAdmin fetch failed or timed out', err);
        throw err;
      });

      if (result) {
        const { churchRes, appRes, usersRes } = result;

        setChurches(churchRes.data || []);
        // Cache for PendingApproval join-code lookup fallback
        if (churchRes.data?.length) {
          localStorage.setItem('all_churches_cache', JSON.stringify(churchRes.data));
        }
        setApplications(appRes.data || []);
        setPendingUsers(usersRes.data || []);
        
        setDebugLog({
          profile: profile,
          user: user,
          churches: { count: churchRes.data?.length, error: churchRes.error },
          apps: { count: appRes.data?.length, error: appRes.error },
          pendingUsers: { count: usersRes.data?.length, error: usersRes.error },
          timestamp: new Date().toISOString(),
        });

        if (churchRes.error || appRes.error || usersRes.error) {
          setError("Data transfer completed with errors. Check console.");
        }

        // Cache the successful results
        localStorage.setItem('super_admin_cache', JSON.stringify({
          churches: churchRes.data || [],
          applications: appRes.data || [],
          pendingUsers: usersRes.data || [],
          debugLog: {
            profile: profile,
            user: user,
            churches: { count: churchRes.data?.length, error: churchRes.error },
            apps: { count: appRes.data?.length, error: appRes.error },
            pendingUsers: { count: usersRes.data?.length, error: usersRes.error },
            timestamp: new Date().toISOString(),
          }
        }));
      }
    } catch (err: any) {
      console.error("SuperAdmin sync failed:", err);
      setError(err.message === 'Fetch timeout' 
        ? "Synchronization timeout. The database is taking too long to respond. Please check your internet connection or RLS policies." 
        : "Sync Failed: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setIsSyncing(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (profile?.role || user?.email) {
      const hasCached = churches.length > 0;
      fetchData(hasCached);
    }
  }, [profile?.role, user?.email]);

  const handleApproveUser = async () => {
    if (!userToApprove) return;
    if (!approveUserForm.church_id) {
      setApproveUserMsg({ type: 'error', text: '请选择一个教会 / Please select a church.' });
      return;
    }
    setIsApprovingUser(true);
    setApproveUserMsg(null);
    try {
      console.log('[ApproveUser] Updating profile:', userToApprove.id, approveUserForm);
      const { data, error } = await supabase
        .from('profiles')
        .update({ role: approveUserForm.role, church_id: approveUserForm.church_id })
        .eq('id', userToApprove.id)
        .select();
      console.log('[ApproveUser] Result:', { data, error });
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('更新失败：数据库权限不足。请在 Supabase SQL Editor 运行 Debug 标签页里显示的 RLS 策略，然后重试。\n\nUpdate failed: RLS may be blocking this. Run the SQL shown in the Debug tab in Supabase SQL Editor, then try again.');
      }
      setApproveUserMsg({ type: 'success', text: '✅ 审核已通过！/ Approved successfully!' });
      await fetchData();
      setTimeout(() => {
        setUserToApprove(null);
        setApproveUserMsg(null);
      }, 1500);
    } catch (err: any) {
      console.error('[ApproveUser] Error:', err);
      setApproveUserMsg({ type: 'error', text: err.message });
    } finally {
      setIsApprovingUser(false);
    }
  };

  const handleApproveClick = (app: ChurchApplication) => {
    const suggestedCode = (app.church_name.substring(0, 3).toUpperCase() + Math.floor(Math.random() * 100)).replace(/\s/g, "");
    setApproveForm({ code: suggestedCode, name: app.church_name });
    setAppToApprove(app);
  };

  const handleApproveConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appToApprove || !appToApprove.id || !approveForm.code) return;
    setIsApproving(true);
    setApproveError(null);
    try {
      const newChurch = await churchService.createChurch(approveForm.name, approveForm.code, {
        address: appToApprove.address,
        phone: appToApprove.phone,
        website: appToApprove.source_link
      });
      
      // Find profile by email (works for email/password users)
      // For Google OAuth users, email is stored in profiles by AuthContext on first login
      const { data: userData } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', appToApprove.email)
        .maybeSingle();
      if (userData) {
        await supabase.from('profiles')
          .update({ role: 'Manager', church_id: newChurch.id })
          .eq('id', userData.id);
      }
      await applicationService.updateStatus(appToApprove.id, "Approved", approveForm.name);
      await fetchData();
      setAppToApprove(null);
    } catch (err: any) {
       setApproveError(err.message);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!window.confirm('Confirm Reject?')) return;
    try {
      await applicationService.updateStatus(id, "Rejected");
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleManageChurch = (church: Church) => {
    switchChurch(church);
    navigate("/app");
  };

  const handleEditChurchClick = (church: Church) => {
    setChurchToEdit(church);
    setEditChurchForm({ name: church.name, code: church.code, domain: church.domain || "" });
  };

  const handleEditChurchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!churchToEdit) return;
    setIsEditingChurch(true);
    setEditChurchError(null);
    try {
      const { error } = await supabase.from("churches").update({ name: editChurchForm.name, code: editChurchForm.code, domain: editChurchForm.domain }).eq("id", churchToEdit.id);
      if (error) throw error;
      await fetchData();
      setChurchToEdit(null);
    } catch (err: any) {
      setEditChurchError(err.message);
    } finally {
      setIsEditingChurch(false);
    }
  };

  const handleDeleteChurchConfirm = async () => {
    if (!churchToDelete) return;
    setIsDeletingChurch(true);
    setDeleteChurchError(null);
    try {
      // Delete the church record — Supabase cascade rules handle related data
      const { error } = await supabase.from('churches').delete().eq('id', churchToDelete.id);
      if (error) throw error;
      // Update local state
      setChurches(prev => prev.filter(c => c.id !== churchToDelete.id));
      // Update cache
      const cached = localStorage.getItem('super_admin_cache');
      if (cached) {
        try {
          const data = JSON.parse(cached);
          data.churches = (data.churches || []).filter((c: Church) => c.id !== churchToDelete.id);
          localStorage.setItem('super_admin_cache', JSON.stringify(data));
        } catch {}
      }
      setChurchToDelete(null);
      setDeleteConfirmInput('');
    } catch (err: any) {
      setDeleteChurchError(err.message || 'Delete failed');
    } finally {
      setIsDeletingChurch(false);
    }
  };

  const handleCreateChurch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChurchForm.name || !newChurchForm.code) return;
    setIsCreating(true);
    setCreateMsg(null);
    try {
      await churchService.createChurch(newChurchForm.name, newChurchForm.code);
      await fetchData();
      setShowAddChurchModal(false);
      setNewChurchForm({ name: "", code: "", domain: "" });
    } catch (err: any) {
      setCreateMsg({ type: "error", text: err.message });
    } finally {
      setIsCreating(false);
    }
  };

  const isPlatformAdmin = isSuperAdmin(profile, user);
  
  const filteredChurches = churches.filter(c => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    const manager = (c as any).profiles?.find((p: any) => p.role === 'Manager');
    return c.name.toLowerCase().includes(s) || 
           c.code.toLowerCase().includes(s) || 
           manager?.email?.toLowerCase().includes(s) || 
           manager?.full_name?.toLowerCase().includes(s);
  });

  if (loading && !profile) {
    return (
      <div className="flex flex-col items-center justify-center p-20 h-full">
         <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh] flex-col gap-4">
        <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center text-error">
          <span className="material-symbols-outlined text-3xl">lock</span>
        </div>
        <p className="text-outline font-bold uppercase tracking-widest text-xs">Access Denied</p>
        <p className="text-[10px] text-outline/60">Role: {profile?.role || "None"}</p>
        <button onClick={() => fetchData()} className="text-[10px] underline text-primary">Retry Sync</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* ── Currently-viewing-church banner ── */}
      {isViewingChurch && (
        <div className="mb-6 flex items-center justify-between gap-4 px-5 py-3 rounded-2xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-500 text-[18px]">visibility</span>
            <span className="text-sm font-bold text-amber-800">
              {isZh ? `正在查看教会：` : 'Viewing church: '}
              <span className="text-amber-600">{currentChurch.name}</span>
              <span className="ml-2 text-xs font-mono text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full">{currentChurch.code}</span>
            </span>
          </div>
          <button
            onClick={handleExitChurch}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-700 font-black text-[11px] uppercase tracking-widest transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">logout</span>
            {isZh ? '退出该教会' : 'Exit Church'}
          </button>
        </div>
      )}

      <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-on-surface tracking-tight font-serif italic mb-2">Super Admin</h1>
          <p className="text-xs font-bold text-outline uppercase tracking-widest opacity-60">Platform Management Console</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline/40 group-focus-within:text-primary transition-colors text-xl">search</span>
            <input 
              type="text"
              placeholder={isZh ? "搜索教会、代码或管理员邮箱..." : "Search churches, codes or manager emails..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64 h-12 pl-12 pr-6 rounded-2xl bg-surface-container-low border border-outline-variant/10 focus:border-primary/30 outline-none text-xs font-bold transition-all shadow-inner"
            />
          </div>
          <div className="flex gap-2 bg-surface-container-low p-2 rounded-2xl border border-outline-variant/10">
            {["churches", "applications", "users", "debug"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? "bg-primary text-white shadow-lg shadow-primary/20" : "hover:bg-surface-container text-outline"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <button 
            onClick={() => {
              localStorage.removeItem('super_admin_cache');
              fetchData(false);
            }}
            disabled={isSyncing}
            className={`h-12 px-4 rounded-2xl border border-outline-variant/30 flex items-center justify-center gap-2 hover:bg-black hover:text-white transition-all ${isSyncing ? 'bg-surface-container' : ''}`}
            title="Force Global Sync"
          >
            <span className={`material-symbols-outlined text-[20px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
            {isSyncing && <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">Syncing...</span>}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 gap-6">
           <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
           <p className="text-outline font-black uppercase tracking-[0.3em] text-[10px] animate-pulse">Synchronizing Data...</p>
        </div>
      ) : activeTab === "churches" ? (
        <div className="flex flex-col gap-8">
          {error && (
            <div className="p-6 bg-error/5 border border-error/10 text-error rounded-3xl text-sm flex items-center gap-4">
               <span className="material-symbols-outlined">error</span>
               <div className="flex-1">
                 <p className="font-bold">Sync Error</p>
                 <p className="text-xs opacity-70">{error}</p>
               </div>
               <button onClick={() => fetchData()} className="px-4 py-2 bg-error text-white rounded-xl text-[10px] font-black uppercase">Retry</button>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Add New Church Card */}
            {!searchTerm && (
              <button 
                onClick={() => setShowAddChurchModal(true)}
                className="group h-full min-h-[220px] bg-surface-container-low rounded-[40px] border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center p-8 transition-all hover:bg-white hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5"
              >
                 <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center text-outline group-hover:bg-primary group-hover:text-white transition-all shadow-inner">
                    <span className="material-symbols-outlined text-3xl">add_home</span>
                 </div>
                 <p className="mt-4 font-serif text-lg font-black text-on-surface group-hover:text-primary transition-colors">Add Church</p>
                 <p className="text-[10px] font-bold text-outline uppercase tracking-widest opacity-60">Onboard new congregation</p>
              </button>
            )}

            {filteredChurches.map((church) => (
              <div key={church.id} className="bg-white rounded-[40px] p-8 border border-outline-variant/10 shadow-sm hover:shadow-xl transition-all group flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined filled">church</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleEditChurchClick(church)} className="material-symbols-outlined text-outline/40 hover:text-on-surface transition-colors">edit</button>
                    <button
                      onClick={() => { setChurchToDelete(church); setDeleteConfirmInput(''); setDeleteChurchError(null); }}
                      className="material-symbols-outlined text-outline/40 hover:text-error transition-colors"
                      title="Delete church"
                    >delete</button>
                  </div>
                </div>
                <h3 className="text-2xl font-serif font-black text-on-surface mb-2 leading-tight">{church.name}</h3>
                <div className="flex items-center gap-2 mb-4">
                   <span className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-mono font-bold text-outline">{church.code}</span>
                   {church.domain && <span className="text-[10px] text-outline opacity-60 truncate">@{church.domain}</span>}
                </div>

                {/* Manager Info */}
                <div className="mb-6 p-4 rounded-3xl bg-surface-container-low border border-outline-variant/10 space-y-3">
                  {(() => {
                    const manager = (church as any).profiles?.find((p: any) => p.role === 'Manager');
                    if (!manager) return <p className="text-[10px] font-bold text-outline/40 italic">No Manager Assigned</p>;
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <span className="material-symbols-outlined text-sm">person</span>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary leading-none mb-1">Manager</p>
                            <p className="text-xs font-bold text-on-surface">{manager.full_name || 'Unnamed'}</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 ml-11">
                          <div className="flex items-center gap-2 text-outline">
                            <span className="material-symbols-outlined text-[14px]">mail</span>
                            <span className="text-[10px] font-medium truncate">{manager.email}</span>
                          </div>
                          {manager.phone && (
                            <div className="flex items-center gap-2 text-outline">
                              <span className="material-symbols-outlined text-[14px]">phone</span>
                              <span className="text-[10px] font-medium">{manager.phone}</span>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="mt-auto flex gap-3">
                  <button onClick={() => handleManageChurch(church)} className="flex-1 py-3.5 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-primary transition-all active:scale-95 shadow-lg shadow-black/10">Manage</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : activeTab === "applications" ? (
        <div className="space-y-6 max-w-4xl">
          {applications.length === 0 ? (
            <div className="bg-surface-container-low p-20 rounded-[40px] border border-dashed border-outline-variant/30 text-center">
               <p className="text-outline font-serif italic">No pending applications found.</p>
            </div>
          ) : applications.map((app) => (
            <div key={app.id} className="bg-white p-8 rounded-[40px] border border-outline-variant/10 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
               <div className="flex gap-6 items-center">
                  <div className="h-14 w-14 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                     <span className="material-symbols-outlined text-3xl">pending_actions</span>
                  </div>
                  <div>
                    <h4 className="text-xl font-serif font-black text-on-surface">{app.church_name}</h4>
                    <p className="text-xs font-bold text-outline mt-1">{app.leader_name} • {app.email}</p>
                    <p className="text-[10px] text-outline/50 mt-2 flex items-center gap-1">
                       <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                       {new Date(app.created_at).toLocaleDateString()}
                    </p>
                  </div>
               </div>
               <div className="flex gap-2 w-full md:w-auto">
                 <button onClick={() => handleReject(app.id)} className="flex-1 md:px-6 py-3 bg-surface-container text-outline rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-error/10 hover:text-error transition-all">Reject</button>
                 <button onClick={() => handleApproveClick(app)} className="flex-2 md:px-8 py-3 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all">Review & Approve</button>
               </div>
            </div>
          ))}
        </div>
      ) : activeTab === "users" ? (
        <div className="space-y-4 max-w-4xl">
          {pendingUsers.filter(u => u.role === 'Pending').length === 0 ? (
            <div className="bg-surface-container-low p-20 rounded-[40px] border border-dashed border-outline-variant/30 text-center">
               <p className="text-outline font-serif italic">No pending users awaiting role assignment.</p>
            </div>
          ) : pendingUsers.filter(u => u.role === 'Pending').map((pUser) => (
            <div key={pUser.id} className="bg-white p-6 rounded-[32px] border border-outline-variant/10 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-8">
               <div className="flex items-center gap-5">
                  <div className="h-12 w-12 rounded-xl bg-surface-container flex items-center justify-center font-serif text-lg font-black text-outline">
                     {pUser.full_name?.[0] || 'U'}
                  </div>
                  <div>
                    <h4 className="font-bold text-on-surface">{pUser.full_name}</h4>
                    <p className="text-[10px] font-bold text-outline uppercase tracking-widest truncate max-w-[200px]">{pUser.email}</p>
                    {pUser.created_at && (
                      <p className="text-[10px] text-outline/50 mt-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">schedule</span>
                        申请时间 / Submitted: {new Date(pUser.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
               </div>
               <div className="flex gap-2">
                 <button
                  onClick={() => {
                    setUserToApprove(pUser);
                    setApproveUserForm({ role: 'Manager', church_id: churches[0]?.id || '' });
                    setApproveUserMsg(null);
                  }}
                  className="px-6 py-3 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all"
                 >
                   Approve as Manager
                 </button>
               </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-surface-container-low rounded-[40px] p-10 border border-outline-variant/10 shadow-inner">
             <h3 className="font-serif text-2xl font-black mb-6 flex items-center gap-3">
               <span className="material-symbols-outlined text-primary">terminal</span>
               Diagnostic Log
             </h3>
             <div className="p-8 bg-[#0D0D0D] rounded-3xl text-[#4ADE80] font-mono text-xs overflow-auto max-h-[500px] shadow-2xl border border-white/5">
                <pre>{JSON.stringify(debugLog, null, 2)}</pre>
             </div>
          </div>

          <div className="bg-error/5 border border-error/10 rounded-[40px] p-10">
             <h3 className="font-serif text-2xl font-black text-error mb-4">RLS Patching</h3>
             <p className="text-sm text-on-surface-variant mb-6 max-w-2xl">If data is not appearing, your Supabase project likely needs explicit RLS policies created for your developer account. Copy and run this SQL in your Supabase SQL Editor:</p>
             <pre className="p-8 bg-white/50 border border-error/20 rounded-3xl text-[11px] font-mono whitespace-pre-wrap select-all shadow-inner leading-relaxed overflow-x-auto">
{`-- Drop old policies if they exist, then re-create
DROP POLICY IF EXISTS "admin_manage_churches" ON public.churches;
DROP POLICY IF EXISTS "admin_manage_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admin_manage_apps" ON public.church_applications;

-- Allow full access for your Super Admin account
CREATE POLICY "admin_manage_churches" ON public.churches
  FOR ALL USING (auth.jwt()->>'email' = '${user?.email}')
  WITH CHECK (auth.jwt()->>'email' = '${user?.email}');

CREATE POLICY "admin_manage_profiles" ON public.profiles
  FOR ALL USING (auth.jwt()->>'email' = '${user?.email}')
  WITH CHECK (auth.jwt()->>'email' = '${user?.email}');

CREATE POLICY "admin_manage_apps" ON public.church_applications
  FOR ALL USING (auth.jwt()->>'email' = '${user?.email}')
  WITH CHECK (auth.jwt()->>'email' = '${user?.email}');`}
             </pre>
          </div>
        </div>
      )}

      {/* Modals Selection */}
      <AnimatePresence>
        {/* APPROVE USER MODAL */}
        {userToApprove && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setUserToApprove(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[48px] p-10 shadow-2xl border border-outline-variant/10"
            >
              <div className="mb-8">
                <h3 className="text-3xl font-serif font-black text-on-surface">审核用户 / Approve User</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-60 mt-1">Assign role and church</p>
              </div>

              {/* User info */}
              <div className="flex items-center gap-4 bg-surface-container-low p-4 rounded-2xl mb-6">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center font-serif text-lg font-black text-primary">
                  {userToApprove.full_name?.[0] || 'U'}
                </div>
                <div>
                  <p className="font-bold text-on-surface">{userToApprove.full_name}</p>
                  <p className="text-[10px] text-outline uppercase tracking-widest">{userToApprove.email}</p>
                  {userToApprove.created_at && (
                    <p className="text-[10px] text-outline/50 mt-0.5">
                      申请时间: {new Date(userToApprove.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                {/* Role selector */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">角色 / Role</label>
                  <select
                    value={approveUserForm.role}
                    onChange={e => setApproveUserForm({ ...approveUserForm, role: e.target.value })}
                    className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                  >
                    <option value="Manager">Manager 管理员</option>
                    <option value="Staff">Staff 同工</option>
                    <option value="Member">Member 成员</option>
                  </select>
                </div>

                {/* Church selector */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">教会 / Church</label>
                  <select
                    value={approveUserForm.church_id}
                    onChange={e => setApproveUserForm({ ...approveUserForm, church_id: e.target.value })}
                    className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                  >
                    <option value="">-- 请选择教会 / Select a church --</option>
                    {churches.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {approveUserMsg && (
                <div className={`mt-4 p-4 rounded-xl text-xs font-bold whitespace-pre-wrap ${approveUserMsg.type === 'error' ? 'bg-error/10 text-error' : 'bg-green-50 text-green-700'}`}>
                  {approveUserMsg.text}
                </div>
              )}

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setUserToApprove(null)}
                  className="flex-1 py-4 bg-surface-container text-outline rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-high transition-all"
                >
                  取消 / Cancel
                </button>
                <button
                  disabled={isApprovingUser}
                  onClick={handleApproveUser}
                  className="flex-2 px-8 py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isApprovingUser ? '处理中...' : '确认审核 / Confirm Approve'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ADD CHURCH MODAL */}
        {showAddChurchModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddChurchModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
             <motion.form 
               initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
               onSubmit={handleCreateChurch}
               className="relative w-full max-w-md bg-white rounded-[48px] p-10 shadow-2xl border border-outline-variant/10 overflow-hidden"
             >
                <div className="mb-8">
                   <h3 className="text-3xl font-serif font-black text-on-surface">Add Church</h3>
                   <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-60">Register new congregation</p>
                </div>

                {createMsg && <div className={`p-4 rounded-xl text-xs font-bold mb-6 ${createMsg.type === 'error' ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}`}>{createMsg.text}</div>}

                <div className="space-y-6">
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Church Name</label>
                      <input 
                        required type="text" value={newChurchForm.name} onChange={e => setNewChurchForm({...newChurchForm, name: e.target.value})} 
                        placeholder="e.g. Hope Community"
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                      />
                   </div>
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Join Code (Unique)</label>
                      <input 
                        required type="text" value={newChurchForm.code} onChange={e => setNewChurchForm({...newChurchForm, code: e.target.value.toUpperCase()})}
                        placeholder="e.g. HOPE123"
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-mono font-bold"
                      />
                   </div>
                </div>

                <div className="mt-10 flex gap-3">
                   <button type="button" onClick={() => setShowAddChurchModal(false)} className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-outline hover:bg-surface-container rounded-2xl transition-all">Cancel</button>
                   <button type="submit" disabled={isCreating} className="flex-[2] py-4 bg-primary text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                      {isCreating ? 'Creating...' : 'Create Church'}
                   </button>
                </div>
             </motion.form>
          </div>
        )}

        {/* APPROVE APPLICATION MODAL */}
        {appToApprove && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAppToApprove(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
             <motion.form 
               initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
               onSubmit={handleApproveConfirm}
               className="relative w-full max-w-md bg-white rounded-[48px] p-10 shadow-2xl border border-outline-variant/10 overflow-hidden"
             >
                <div className="mb-8">
                   <h3 className="text-3xl font-serif font-black text-on-surface">Approve App</h3>
                   <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-60">Provisioning {appToApprove.church_name}</p>
                </div>

                {approveError && <div className="p-4 bg-error/10 text-error rounded-xl text-xs font-bold mb-6">{approveError}</div>}

                <div className="space-y-6">
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Official Name</label>
                      <input 
                        required type="text" value={approveForm.name} onChange={e => setApproveForm({...approveForm, name: e.target.value})} 
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                      />
                   </div>
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Generated Code</label>
                      <input 
                        required type="text" value={approveForm.code} onChange={e => setApproveForm({...approveForm, code: e.target.value.toUpperCase()})}
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-mono font-bold"
                      />
                   </div>
                </div>

                <div className="mt-10 flex gap-3">
                   <button type="button" onClick={() => setAppToApprove(null)} className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-outline hover:bg-surface-container rounded-2xl transition-all">Cancel</button>
                   <button type="submit" disabled={isApproving} className="flex-[2] py-4 bg-primary text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                      {isApproving ? 'Provisioning...' : 'Provision Church'}
                   </button>
                </div>
             </motion.form>
          </div>
        )}

        {/* DELETE CHURCH MODAL */}
        {churchToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isDeletingChurch && setChurchToDelete(null)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[48px] p-10 shadow-2xl border border-error/20"
            >
              {/* Warning header */}
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-2xl bg-error/10 text-error flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-3xl">warning</span>
                </div>
                <div>
                  <h3 className="text-2xl font-serif font-black text-on-surface">删除教会</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-error opacity-70">Irreversible Action</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-error/5 border border-error/15 mb-6">
                <p className="text-sm text-on-surface font-bold mb-1">{churchToDelete.name}</p>
                <p className="text-[10px] text-outline font-mono">{churchToDelete.code} · {churchToDelete.domain || 'no domain'}</p>
              </div>

              <p className="text-sm text-on-surface-variant mb-2">
                {isZh
                  ? '此操作将永久删除该教会及其所有数据，无法恢复。请输入教会名称确认：'
                  : 'This will permanently delete the church and all its data. Type the church name to confirm:'}
              </p>
              <p className="text-xs font-black text-error mb-3 font-mono">{churchToDelete.name}</p>

              <input
                type="text"
                value={deleteConfirmInput}
                onChange={e => setDeleteConfirmInput(e.target.value)}
                placeholder={churchToDelete.name}
                className="w-full bg-surface-container-low p-4 rounded-2xl border-2 border-outline-variant/30 focus:border-error outline-none font-bold text-sm mb-4 transition-all"
              />

              {deleteChurchError && (
                <div className="p-3 rounded-xl bg-error/10 text-error text-xs font-bold mb-4">{deleteChurchError}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setChurchToDelete(null)}
                  disabled={isDeletingChurch}
                  className="flex-1 py-4 bg-surface-container text-outline rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-high transition-all disabled:opacity-50"
                >
                  {isZh ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={handleDeleteChurchConfirm}
                  disabled={isDeletingChurch || deleteConfirmInput.trim() !== churchToDelete.name}
                  className="flex-[2] py-4 bg-error text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-error/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-error/20"
                >
                  {isDeletingChurch ? (isZh ? '删除中...' : 'Deleting...') : (isZh ? '确认永久删除' : 'Confirm Delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* EDIT CHURCH MODAL */}
        {churchToEdit && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChurchToEdit(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
             <motion.form 
               initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
               onSubmit={handleEditChurchSubmit}
               className="relative w-full max-w-md bg-white rounded-[48px] p-10 shadow-2xl border border-outline-variant/10 overflow-hidden"
             >
                <div className="mb-8">
                   <h3 className="text-3xl font-serif font-black text-on-surface">Edit Church</h3>
                   <p className="text-[10px] font-black uppercase tracking-widest text-outline opacity-60">Modify {churchToEdit.name}</p>
                </div>

                {editChurchError && <div className="p-4 bg-error/10 text-error rounded-xl text-xs font-bold mb-6">{editChurchError}</div>}

                <div className="space-y-6">
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Church Name</label>
                      <input 
                        required type="text" value={editChurchForm.name} onChange={e => setEditChurchForm({...editChurchForm, name: e.target.value})} 
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                      />
                   </div>
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Join Code</label>
                      <input 
                        required type="text" value={editChurchForm.code} onChange={e => setEditChurchForm({...editChurchForm, code: e.target.value.toUpperCase()})}
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-mono font-bold"
                      />
                   </div>
                   <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">Domain (Optional)</label>
                      <input 
                        type="text" value={editChurchForm.domain} onChange={e => setEditChurchForm({...editChurchForm, domain: e.target.value.toLowerCase()})}
                        placeholder="e.g. gracecommunity.org"
                        className="w-full bg-surface-container-low p-4 rounded-2xl border border-outline-variant/20 focus:border-primary outline-none font-bold"
                      />
                   </div>
                </div>

                <div className="mt-10 flex gap-3">
                   <button type="button" onClick={() => setChurchToEdit(null)} className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-outline hover:bg-surface-container rounded-2xl transition-all">Cancel</button>
                   <button type="submit" disabled={isEditingChurch} className="flex-[2] py-4 bg-primary text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                      {isEditingChurch ? 'Saving...' : 'Save Changes'}
                   </button>
                </div>
             </motion.form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
