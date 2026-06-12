import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { getActiveChurchId, isDemoChurch } from '../lib/permissions';
import { memberService, Member } from '../services/memberService';
import { logActivity } from '../services/activityService';

interface AttendanceRecord {
  id: string;
  church_id: string;
  service_date: string;
  headcount: number;
  notes: string;
  present_member_ids: string[];
  created_by?: string;
  created_at?: string;
}

const lsKey = (churchId: string) => `attendance_${churchId}`;

function lsGetRecords(churchId: string): AttendanceRecord[] {
  try { return JSON.parse(localStorage.getItem(lsKey(churchId)) || '[]'); } catch { return []; }
}
function lsSaveRecords(churchId: string, records: AttendanceRecord[]) {
  localStorage.setItem(lsKey(churchId), JSON.stringify(records));
}

function withTimeout<T>(promise: PromiseLike<T>, ms = 5000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const VISIT_TYPE_ICONS: Record<string, string> = {
  hospital: '🏥',
  home: '🏠',
  phone: '📞',
  zoom: '💻',
};

export default function Attendance() {
  const { church, profile } = useAuth();
  const { t } = useLanguage();
  const { mode } = useMode();
  const activeChurchId = getActiveChurchId(profile, church) || profile?.church_id || null;
  const isDemo = isDemoChurch(church);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editDate, setEditDate] = useState('');
  const [editHeadcount, setEditHeadcount] = useState(0);
  const [editNotes, setEditNotes] = useState('');
  const [editPresentIds, setEditPresentIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  // Load records from Supabase with localStorage fallback
  const loadRecords = useCallback(async () => {
    if (!activeChurchId) return;
    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('attendance_records')
          .select('*')
          .eq('church_id', activeChurchId)
          .order('service_date', { ascending: false })
      );
      if (error) throw error;
      const loaded = (data as AttendanceRecord[]) || [];
      lsSaveRecords(activeChurchId, loaded);
      setRecords(loaded);
    } catch {
      // Fallback to localStorage
      setRecords(lsGetRecords(activeChurchId));
    } finally {
      setLoading(false);
    }
  }, [activeChurchId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!activeChurchId) return;
    memberService.getMembers(activeChurchId).then(setMembers).catch(() => {});
  }, [activeChurchId]);

  const startNew = () => {
    const today = new Date().toISOString().split('T')[0];
    setEditDate(today);
    setEditHeadcount(0);
    setEditNotes('');
    setEditPresentIds([]);
    setSelectedRecord(null);
    setIsEditing(true);
    setMemberSearch('');
  };

  const startEdit = (record: AttendanceRecord) => {
    setEditDate(record.service_date);
    setEditHeadcount(record.headcount);
    setEditNotes(record.notes || '');
    setEditPresentIds(record.present_member_ids || []);
    setSelectedRecord(record);
    setIsEditing(true);
    setMemberSearch('');
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setMemberSearch('');
  };

  const toggleMember = (memberId: string) => {
    setEditPresentIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  const saveRecord = async () => {
    if (!activeChurchId || !editDate) return;
    setSaving(true);

    const payload: Omit<AttendanceRecord, 'id' | 'created_at'> = {
      church_id: activeChurchId,
      service_date: editDate,
      headcount: editHeadcount,
      notes: editNotes,
      present_member_ids: editPresentIds,
      created_by: profile?.full_name || profile?.id || 'Unknown',
    };

    try {
      if (selectedRecord && selectedRecord.id && !selectedRecord.id.startsWith('local_')) {
        // Update existing in Supabase
        const { data, error } = await withTimeout(
          supabase
            .from('attendance_records')
            .update(payload)
            .eq('id', selectedRecord.id)
            .select()
            .single()
        );
        if (error) throw error;
        const updated = data as AttendanceRecord;
        setRecords(prev => prev.map(r => r.id === updated.id ? updated : r).sort(
          (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
        ));
        lsSaveRecords(activeChurchId, records.map(r => r.id === updated.id ? updated : r));
        setSelectedRecord(updated);
      } else if (selectedRecord) {
        // Was a local record, update locally
        const updated = { ...selectedRecord, ...payload };
        const newList = records.map(r => r.id === selectedRecord.id ? updated : r).sort(
          (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
        );
        setRecords(newList);
        lsSaveRecords(activeChurchId, newList);
        setSelectedRecord(updated);
      } else {
        // Insert new
        let newRecord: AttendanceRecord;
        if (!isDemo) {
          const { data, error } = await withTimeout(
            supabase
              .from('attendance_records')
              .insert(payload)
              .select()
              .single(),
            10000
          );
          if (error) throw error;
          newRecord = data as AttendanceRecord;
        } else {
          newRecord = { ...payload, id: `local_${Date.now()}`, created_at: new Date().toISOString() };
        }
        const newList = [newRecord, ...records].sort(
          (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
        );
        setRecords(newList);
        lsSaveRecords(activeChurchId, newList);
        setSelectedRecord(newRecord);

        if (activeChurchId) {
          logActivity({
            churchId: activeChurchId,
            userId: profile?.id,
            userName: profile?.full_name || 'Admin',
            userRole: profile?.role || 'Manager',
            action: 'Recorded attendance',
            target: editDate,
            type: 'System',
            note: `Headcount: ${editHeadcount} | Members checked in: ${editPresentIds.length}`,
          });
        }
      }
      setIsEditing(false);
    } catch (err) {
      // Fallback: save to localStorage
      const fallbackRecord: AttendanceRecord = {
        ...payload,
        id: selectedRecord?.id || `local_${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      const newList = selectedRecord
        ? records.map(r => r.id === selectedRecord.id ? fallbackRecord : r)
        : [fallbackRecord, ...records];
      newList.sort((a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime());
      setRecords(newList);
      lsSaveRecords(activeChurchId, newList);
      setSelectedRecord(fallbackRecord);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (record: AttendanceRecord) => {
    if (!activeChurchId) return;
    if (!window.confirm(t('deleteAttendanceConfirm'))) return;
    try {
      if (!record.id.startsWith('local_')) {
        await withTimeout(supabase.from('attendance_records').delete().eq('id', record.id));
      }
    } catch {}
    const newList = records.filter(r => r.id !== record.id);
    setRecords(newList);
    lsSaveRecords(activeChurchId, newList);
    if (selectedRecord?.id === record.id) {
      setSelectedRecord(null);
      setIsEditing(false);
    }
  };

  const filteredMembers = members.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface">
      {/* Header */}
      <div className="p-6 md:p-8 flex flex-col gap-2 border-b border-outline-variant/10 bg-surface shrink-0">
        <h2 className="font-serif font-black text-3xl text-on-surface tracking-tight">
          {t('attendanceTitle')}
        </h2>
        <p className="text-[11px] font-black text-outline uppercase tracking-[0.2em] opacity-60">
          {t('attendanceDesc')}
        </p>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Panel — Service List */}
        <div className="w-80 shrink-0 flex flex-col border-r border-outline-variant/20 bg-surface-container-lowest/50 overflow-hidden">
          {mode === 'Manager' && (
            <div className="p-4 shrink-0">
              <button
                onClick={startNew}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all shadow-xl shadow-black/10 active:scale-95"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                {t('recordAttendance')}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4 space-y-1.5">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-[9px] font-black uppercase tracking-widest text-outline animate-pulse">Loading...</p>
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                <span className="material-symbols-outlined text-4xl text-outline/30">event_available</span>
                <p className="text-[10px] font-black uppercase tracking-widest text-outline/50">
                  {t('noRecordsYet')}
                </p>
                {mode === 'Manager' && (
                  <p className="text-[9px] text-outline/40">
                    {t('clickToStart')}
                  </p>
                )}
              </div>
            ) : (
              records.map(record => {
                const isSelected = selectedRecord?.id === record.id && !isEditing;
                const hasMembers = (record.present_member_ids?.length || 0) > 0;
                return (
                  <motion.button
                    key={record.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setSelectedRecord(record);
                      setIsEditing(false);
                    }}
                    className={`w-full text-left p-4 rounded-2xl border transition-all group ${
                      isSelected
                        ? 'bg-primary/5 border-primary/20 shadow-sm'
                        : 'bg-white/60 border-transparent hover:border-outline-variant/30 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
                        record.headcount > 0 ? 'bg-emerald-500' : 'bg-outline/20'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold truncate ${isSelected ? 'text-primary' : 'text-on-surface'}`}>
                          {formatDate(record.service_date)}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-black text-outline">
                            {record.headcount > 0
                              ? `${record.headcount} people`
                              : t('noHeadcount')}
                          </span>
                          {hasMembers && (
                            <span className="text-[9px] text-primary/60 font-bold">
                              {record.present_member_ids.length} members
                            </span>
                          )}
                        </div>
                        {record.notes && (
                          <p className="text-[9px] text-outline/60 truncate mt-0.5">{record.notes}</p>
                        )}
                      </div>
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel — Detail / Edit */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {isEditing ? (
              <motion.div
                key="edit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-8 space-y-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-serif font-black text-xl text-on-surface">
                    {selectedRecord ? t('editAttendance') : t('newAttendanceRecord')}
                  </h3>
                  <button
                    onClick={cancelEdit}
                    className="w-10 h-10 rounded-xl bg-surface-container hover:bg-black hover:text-white transition-all flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>

                {/* Service Date */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">
                    {t('serviceDate')}
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">calendar_today</span>
                    <input
                      type="date"
                      value={editDate}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={e => {
                        const today = new Date().toISOString().split('T')[0];
                        if (e.target.value > today) {
                          alert(t('futureDateError') || 'Cannot record future attendance');
                          return;
                        }
                        setEditDate(e.target.value);
                      }}
                      className="w-full bg-surface-container-low border-2 border-transparent pl-12 pr-4 py-4 rounded-2xl focus:border-primary focus:bg-white outline-none font-bold transition-all"
                    />
                  </div>
                </div>

                {/* Headcount */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">
                    {t('totalHeadcount')}
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">groups</span>
                    <input
                      type="number"
                      min={0}
                      value={editHeadcount}
                      onChange={e => setEditHeadcount(Number(e.target.value))}
                      placeholder="0"
                      className="w-full bg-surface-container-low border-2 border-transparent pl-12 pr-4 py-4 rounded-2xl focus:border-primary focus:bg-white outline-none font-bold transition-all"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">
                    {t('notesLabel')}
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    rows={2}
                    placeholder={t('notesPlaceholder')}
                    className="w-full bg-surface-container-low border-2 border-transparent px-4 py-4 rounded-2xl focus:border-primary focus:bg-white outline-none font-bold transition-all resize-none"
                  />
                </div>

                {/* Member Checklist */}
                {members.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-1">
                        {t('memberCheckin')}
                        <span className="ml-2 text-primary">({editPresentIds.length}/{members.length})</span>
                      </label>
                    </div>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[16px]">search</span>
                      <input
                        type="text"
                        value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        placeholder={t('searchMembersPlaceholder')}
                        className="w-full bg-surface-container-low border-2 border-transparent pl-10 pr-4 py-2.5 rounded-xl focus:border-primary focus:bg-white outline-none text-sm font-bold transition-all"
                      />
                    </div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto no-scrollbar pr-1">
                      {filteredMembers.map(member => {
                        const isPresent = editPresentIds.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => toggleMember(member.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                              isPresent
                                ? 'border-emerald-400/40 bg-emerald-50 text-emerald-800'
                                : 'border-transparent bg-surface-container-low hover:border-outline-variant/30'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-[20px] transition-colors ${
                              isPresent ? 'text-emerald-500' : 'text-outline/30'
                            }`}>
                              {isPresent ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{member.name}</p>
                              <p className="text-[9px] font-bold text-outline/60 uppercase">{member.status}</p>
                            </div>
                            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg ${
                              isPresent ? 'bg-emerald-100 text-emerald-700' : 'bg-outline/10 text-outline/40'
                            }`}>
                              {isPresent ? t('presentLabel') : t('absentLabel')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <div className="pt-2 pb-8">
                  <button
                    onClick={saveRecord}
                    disabled={saving || !editDate}
                    className="w-full py-5 rounded-[32px] bg-black text-white text-[11px] font-black uppercase tracking-[0.4em] hover:bg-primary transition-all shadow-xl hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {t('savingLabel')}
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[18px]">save</span>
                        {t('saveRecord')}
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            ) : selectedRecord ? (
              <motion.div
                key={selectedRecord.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-8"
              >
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="font-serif font-black text-2xl text-on-surface">
                      {formatDate(selectedRecord.service_date)}
                    </h3>
                    <p className="text-[10px] font-black text-outline uppercase tracking-widest mt-1 opacity-60">
                      {t('sundayService')}
                    </p>
                  </div>
                  {mode === 'Manager' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(selectedRecord)}
                        className="px-4 py-2.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all shadow-md active:scale-95 flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        {t('editLabel')}
                      </button>
                      <button
                        onClick={() => deleteRecord(selectedRecord)}
                        className="w-10 h-10 rounded-xl bg-error/10 text-error hover:bg-error hover:text-white transition-all flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-5 rounded-[24px] bg-white border border-outline-variant/10 shadow-sm">
                    <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-2">
                      {t('headcountLabel')}
                    </p>
                    <p className="text-3xl font-serif font-black text-on-surface">
                      {selectedRecord.headcount || '—'}
                    </p>
                  </div>
                  <div className="p-5 rounded-[24px] bg-white border border-outline-variant/10 shadow-sm">
                    <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-2">
                      {t('checkedInMembers')}
                    </p>
                    <p className="text-3xl font-serif font-black text-on-surface">
                      {selectedRecord.present_member_ids?.length || 0}
                    </p>
                  </div>
                </div>

                {selectedRecord.notes && (
                  <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/10 mb-6">
                    <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-2">
                      {t('notesLabel')}
                    </p>
                    <p className="text-sm font-bold text-on-surface-variant">{selectedRecord.notes}</p>
                  </div>
                )}

                {/* Present Members */}
                {(selectedRecord.present_member_ids?.length || 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-3">
                      {t('presentMembers')}
                    </p>
                    <div className="space-y-1.5">
                      {members
                        .filter(m => selectedRecord.present_member_ids?.includes(m.id))
                        .map(member => (
                          <div
                            key={member.id}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-100"
                          >
                            <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-on-surface">{member.name}</p>
                              <p className="text-[9px] font-bold text-outline/60 uppercase">{member.status}</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {selectedRecord.created_by && (
                  <p className="mt-6 text-[9px] text-outline/40 font-bold">
                    {t('recordedBy')} {selectedRecord.created_by}
                    {selectedRecord.created_at && ` · ${new Date(selectedRecord.created_at).toLocaleDateString()}`}
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center"
              >
                <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center">
                  <span className="material-symbols-outlined text-5xl text-primary/20">event_available</span>
                </div>
                <div>
                  <p className="font-serif font-black text-lg text-on-surface mb-1">
                    {t('selectRecord')}
                  </p>
                  <p className="text-[11px] text-outline uppercase tracking-widest opacity-50">
                    {t('selectRecordDesc')}
                  </p>
                </div>
                {mode === 'Manager' && (
                  <button
                    onClick={startNew}
                    className="mt-2 flex items-center gap-2 px-8 py-4 rounded-2xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary transition-all shadow-xl shadow-black/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    {t('recordAttendance')}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
