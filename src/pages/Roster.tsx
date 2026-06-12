import React, { useState, useMemo, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { UPCOMING_EVENTS, ChurchEvent } from '../constants/events';
import { addMonths, subMonths, subWeeks, addWeeks, format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { rosterService } from '../services/rosterService';
import { memberService } from '../services/memberService';
import { socialService } from '../services/socialService';
import { supabase } from '../lib/supabase';
import { churchService } from '../services/churchService';
import { isDemoChurch, getActiveChurchId } from '../lib/permissions';
import { tValue } from '../lib/valueLabels';
import { tr } from '../lib/uiText';
import { jsPDF } from 'jspdf';

type RoleTag = string;

interface Staff {
  id: string;
  name: string;
  initials: string;
  avatar?: string;
  roles: RoleTag[];
  onLeave?: boolean;
  birthday?: string; // M-D format like "05-15"
  isTeamLeader?: boolean;
  leaderOf?: string; // The role they lead
}

interface Assignment {
  id: string;
  staffId: string;
  role: RoleTag;
  color?: string;
}

const ROLES_LIST = [
  'Preaching', 'Worship', 'Lead Singer', 'Musician', 'Usher', 
  'Sunday School Teacher', 'Kitchen', 'Cleaning', 'IT', 'Giving'
];

export default function Roster() {
  const { mode } = useMode();
  const { t, language } = useLanguage();
  const isZh = language.startsWith('zh');
  const { church, user, profile, updateChurch } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const [view, setView] = useState<'Monthly' | 'Weekly' | 'Table' | 'Personnel' | 'MyRoster'>('Monthly');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'All' | string>('All');
  const [editingAssignment, setEditingAssignment] = useState<{dateStr: string, assignment: Assignment} | null>(null);
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);
  const [modalPreselectedRole, setModalPreselectedRole] = useState<string | null>(null);
  const [modalStaffId, setModalStaffId] = useState('');
  const [modalRoleId, setModalRoleId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [globalUnavailabilities, setGlobalUnavailabilities] = useState<any[]>([]);
  const [showRoleSettings, setShowRoleSettings] = useState(false);
  const [editingRoleList, setEditingRoleList] = useState<string[]>([]);
  const [newCustomRole, setNewCustomRole] = useState('');

  const churchRoles = useMemo(() => {
    return church?.roster_roles || ROLES_LIST;
  }, [church?.roster_roles]);

  useEffect(() => {
    if (showRoleSettings) setEditingRoleList(churchRoles);
  }, [showRoleSettings, churchRoles]);

  const saveChurchRoles = async () => {
    if (!church?.id) {
      alert(language.startsWith('zh') ? '未选择教会，请重新登录' : 'No church selected, please log in again');
      return;
    }
    setIsLoading(true);
    try {
      // Automatically add any pending custom role in the input box
      let rolesToSave = [...editingRoleList];
      const trimmedNewRole = newCustomRole.trim();
      if (trimmedNewRole && !rolesToSave.includes(trimmedNewRole)) {
        rolesToSave.push(trimmedNewRole);
        setNewCustomRole('');
      }

      // Skip DB write for demo church (no real record to update)
      if (!isDemoChurch(church)) {
        try {
          await churchService.updateChurch(activeChurchId, { roster_roles: rolesToSave });
        } catch (dbErr) {
          console.warn('Database update failed, but proceeding with local update:', dbErr);
        }
      }
      
      updateChurch({ roster_roles: rolesToSave });
      setShowRoleSettings(false);
      alert(language.startsWith('zh') ? '角色设置已保存' : 'Role settings saved successfully');
    } catch (err: any) {
      console.error(err);
      alert(language.startsWith('zh') ? `保存失败: ${err.message || '未知错误'}` : `Save failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!activeChurchId) { console.warn('⚠️ Roster: no activeChurchId, skipping load'); return; }
      setIsLoading(true);
      console.log('📥 Roster loading data for churchId:', activeChurchId, 'month:', format(currentDate, 'yyyy-MM'));
      try {
        const [members, rosterData, unavailData, profilesResult] = await Promise.all([
          memberService.getMembers(activeChurchId),
          rosterService.getRosterByMonth(activeChurchId, format(currentDate, 'yyyy-MM')),
          rosterService.getUnavailabilities(activeChurchId, format(currentDate, 'yyyy-MM')),
          supabase.from('profiles').select('id, full_name, role, dob').eq('church_id', activeChurchId)
        ]);
        console.log('📥 Roster loaded:', { rosterCount: rosterData?.length, membersCount: members?.length, profilesCount: (profilesResult as any)?.data?.length });

        const profilesData: any[] = (profilesResult as any)?.data || [];

        // Try to merge church_members skills with profiles real UUIDs
        // Match by name since local church_members may not have a real UUID
        let resolvedMembers: any[] = [];

        if (profilesData.length > 0) {
          resolvedMembers = profilesData
            .filter((p: any) => p.role && p.role !== 'Pending')
            .map((p: any) => {
              // Find matching church_member by name to get their skills
              const matched = (members || []).find((m: any) =>
                m.name?.toLowerCase() === p.full_name?.toLowerCase()
              );
              return {
                id: p.id, // always use real UUID from profiles
                church_id: activeChurchId,
                name: p.full_name || p.id,
                initials: (p.full_name || '?').charAt(0).toUpperCase(),
                role: matched ? matched.role : [p.role],
                skills: matched?.skills || [],
                joined: matched?.joined || '',
                family: matched?.family || '',
                status: matched?.status || p.role as any,
                dob: p.dob || matched?.dob || null,
              };
            });
        } else {
          // No profiles — use church_members with valid UUIDs only
          resolvedMembers = (members || []).filter((m: any) => !m.id?.startsWith('local_'));
        }

        if (resolvedMembers) {
           setStaffList(resolvedMembers.map((m: any) => ({
             id: m.id,
             name: m.name,
             initials: m.initials || m.name.charAt(0),
             // skills = what this person can serve (Preaching, Worship, etc.)
             // role = membership status (Pastor, Leader, Member...)
             // Use skills as primary, fall back to role array for legacy data
             // Use skills (service abilities) only — NOT membership role (Pastor/Member/Admin)
             // If no skills set, leave empty so autoSchedule treats as eligible for any role
             roles: (m.skills && m.skills.length > 0) ? m.skills : [],
             onLeave: m.status === 'Pending',
             birthday: m.dob ? String(m.dob).slice(5, 10) : undefined, // MM-DD for birthday markers
           })));
        }

        if (rosterData) {
           const grouped: Record<string, Assignment[]> = {};
           rosterData.forEach(r => {
             if (!grouped[r.date]) grouped[r.date] = [];
             grouped[r.date].push({
               id: r.id,
               staffId: r.staff_id,
               role: r.role,
               color: r.color
             });
           });
           setAssignments(grouped);
        }

        if (unavailData) {
          setGlobalUnavailabilities(unavailData);
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [activeChurchId, format(currentDate, 'yyyy-MM')]);

  const activeRoles = useMemo(() => {
    if (selectedRoleFilter !== 'All') return [selectedRoleFilter];
    return churchRoles;
  }, [selectedRoleFilter, churchRoles]);

  const [availableRoles, setAvailableRoles] = useState<RoleTag[]>([]);
  useEffect(() => {
    setAvailableRoles(churchRoles);
  }, [churchRoles]);

  const [newRoleStr, setNewRoleStr] = useState('');

  const sundays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    return days.filter(d => d.getDay() === 0);
  }, [currentDate]);

  const [staffList, setStaffList] = useState<Staff[]>([]);

  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({});
  const [availability, setAvailability] = useState<Record<string, 'busy' | 'available' | 'none'>>({});
  const currentUser = useMemo(() => {
    if (staffList.length === 0) return null;
    return staffList.find(s => s.id === user?.id) || staffList[0];
  }, [staffList, user?.id]);

  // Non-managers can't use the Table / Personnel views
  useEffect(() => {
    if (mode !== 'Manager' && (view === 'Table' || view === 'Personnel')) setView('MyRoster');
  }, [mode, view]);
  const [draggedStaffId, setDraggedStaffId] = useState<string | null>(null);
  const [highlightedStaffId, setHighlightedStaffId] = useState<string | null>(null);
  const [showStaffPool, setShowStaffPool] = useState(true);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<{ dateStr: string, staffId: string } | null>(null);

  const toggleAvailability = async (dateStr: string) => {
    if (mode !== 'Staff' || !church?.id || !user?.id) return;
    const isCurrentlyUnavailable = globalUnavailabilities.some(u => u.date === dateStr && u.user_id === user.id);

    // Optimistic update — reflect the change immediately
    const prev = globalUnavailabilities;
    if (isCurrentlyUnavailable) {
      setGlobalUnavailabilities(prev.filter(u => !(u.date === dateStr && u.user_id === user.id)));
    } else {
      setGlobalUnavailabilities([...prev, { church_id: activeChurchId, user_id: user.id, date: dateStr }]);
    }

    try {
      await rosterService.toggleUnavailability(activeChurchId, user.id, dateStr, !isCurrentlyUnavailable);
      // When REQUESTING leave (newly marking unavailable), notify the managers.
      if (!isCurrentlyUnavailable && activeChurchId) {
        socialService.addNotification({
          church_id: activeChurchId,
          recipient_id: null,
          recipient_role: 'Manager',
          sender_id: user.id,
          sender_name: profile?.full_name || 'Staff',
          type: 'leave',
          title: (profile?.full_name || 'Staff') + (language.startsWith('zh') ? ' 申请请假' : ' requested leave'),
          body: (language.startsWith('zh') ? '日期：' : 'Date: ') + dateStr,
          link: '/app/roster',
        }).catch(() => {});
      }
    } catch (err) {
      console.error(err);
      // Roll back on failure
      setGlobalUnavailabilities(prev);
      alert(language.startsWith('zh') ? '更新失败，请检查网络连接' : 'Update failed. Please check your connection.');
    }
  };

  const handlePrev = () => {
    setCurrentDate(prev => view === 'Monthly' ? subMonths(prev, 1) : subWeeks(prev, 1));
  };
  
  const handleNext = () => {
    setCurrentDate(prev => view === 'Monthly' ? addMonths(prev, 1) : addWeeks(prev, 1));
  };

  const handlePrint = () => {
    handleExportPDF();
  };

  // Export the roster as an iCal (.ics) file — imports into Apple / Google / Outlook
  const exportRosterICS = () => {
    const p2 = (n: number) => String(n).padStart(2, '0');
    const entries = Object.entries(assignments).filter(([, a]) => (a as Assignment[])?.length > 0).sort();
    if (entries.length === 0) { alert(isZh ? '本月暂无排班' : 'No assignments this month'); return; }
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`;
    const esc = (s: string) => (s || '').replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GraceFlow//Roster//EN', 'CALSCALE:GREGORIAN'];
    entries.forEach(([dateStr, asgns]) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const desc = (asgns as Assignment[]).map(a => `${tValue(a.role, language)}: ${staffList.find(s => s.id === a.staffId)?.name || '?'}`).join('\n');
      lines.push('BEGIN:VEVENT', `UID:roster-${dateStr}@graceflow`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${y}${p2(m)}${p2(d)}`,
        `SUMMARY:${esc(isZh ? '教会服事排班' : 'Church Service Roster')}`,
        `DESCRIPTION:${esc(desc)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `roster-${format(currentDate, 'yyyy-MM')}.ics`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    const element = document.getElementById('roster-pdf-export-source');
    if (!element) return;

    // Show a simple loading indicator
    const btn = document.querySelector('[title="Export as PDF"]');
    const originalContent = btn?.innerHTML;
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>';

    try {
      const { toCanvas } = await import('html-to-image');
      
      // Temporarily reveal the element for html-to-image
      element.style.position = 'static';
      element.style.left = '0';
      element.style.zIndex = '1000';
      
      const canvas = await toCanvas(element, {
        pixelRatio: 2,
        backgroundColor: '#F4F1EE',
      });
      
      // Hide it back
      element.style.position = 'fixed';
      element.style.left = '-5000px';
      element.style.zIndex = '-1000';
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'l' : 'p',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });

      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`roster-${format(currentDate, 'yyyy-MM')}.pdf`);
    } catch (error) {
      console.error('PDF generation failed:', error);
      alert(tr('PDF production failed. Try printing the page or use a desktop browser.', language));
    } finally {
      if (btn && originalContent) btn.innerHTML = originalContent;
    }
  };

  const calendarDays = useMemo(() => {
    if (view === 'Monthly') {
      const start = startOfWeek(startOfMonth(currentDate));
      const end = endOfWeek(endOfMonth(currentDate));
      return eachDayOfInterval({ start, end });
    } else {
      const start = startOfWeek(currentDate);
      const end = endOfWeek(currentDate);
      return eachDayOfInterval({ start, end });
    }
  }, [currentDate, view]);

  const handleDragStart = (e: React.DragEvent, staffId: string) => {
    if (mode !== 'Manager') return;
    setDraggedStaffId(staffId);
    e.dataTransfer.setData('text/plain', staffId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (mode !== 'Manager') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent, targetDateStr: string) => {
    if (mode !== 'Manager') return;
    e.preventDefault();
    const sourceDate = e.dataTransfer.getData('sourceDate');
    const asgnId = e.dataTransfer.getData('asgnId');
    const staffId = e.dataTransfer.getData('text/plain');

    if (sourceDate && asgnId) {
      // Move existing assignment
      setAssignments(prev => {
        const next = { ...prev };
        const sourceDay = prev[sourceDate] || [];
        const asgnToMove = sourceDay.find(a => a.id === asgnId);
        
        if (asgnToMove) {
          next[sourceDate] = sourceDay.filter(a => a.id !== asgnId);
          const targetDay = next[targetDateStr] || [];
          next[targetDateStr] = [...targetDay, asgnToMove];
        }
        return next;
      });
      return;
    }

    if (!staffId) return;

    const staff = staffList.find(s => s.id === staffId);
    if (!staff || staff.onLeave) return;

    if (staff.roles.length === 1) {
      addAssignment(targetDateStr, staffId, staff.roles[0]);
    } else if (staff.roles.length > 1) {
      setPendingAssignment({ dateStr: targetDateStr, staffId });
      setShowRoleModal(true);
    }
  };

  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS' | 'ERROR'>('IDLE');

  const addAssignment = async (dateStr: string, staffId: string, role: RoleTag) => {
    if (mode !== 'Manager' || !church?.id) return;

    // Block scheduling someone who marked themselves unavailable (请假) that day.
    const isUnavailable = globalUnavailabilities.some(u => u.date === dateStr && u.user_id === staffId);
    if (isUnavailable) {
      const who = staffList.find(s => s.id === staffId)?.name || '';
      alert(isZh
        ? `${who} 在这一天标记了「不可用」，无法安排服事。`
        : `${who} marked themselves unavailable on this day and cannot be scheduled.`);
      return;
    }

    setSaveStatus('SAVING');
    const newAsgn = { id: Date.now().toString(), staffId, role };
    const dayAssignments = [...(assignments[dateStr] || []), newAsgn];
    
    setAssignments(prev => ({
      ...prev,
      [dateStr]: dayAssignments
    }));

    // Persist
    try {
      await rosterService.saveAssignments(activeChurchId, dateStr, dayAssignments);
      setSaveStatus('SUCCESS');
      setTimeout(() => setSaveStatus('IDLE'), 2000);
    } catch (err) {
      console.error('Failed to save assignment:', err);
      setSaveStatus('ERROR');
      setTimeout(() => setSaveStatus('IDLE'), 3000);
    }
  };

  const handleRemoveAssignment = async (dateStr: string, assignmentId: string) => {
    if (mode !== 'Manager' || !church?.id) return;
    
    const dayAssignments = (assignments[dateStr] || []).filter(a => a.id !== assignmentId);
    setAssignments(prev => ({
      ...prev,
      [dateStr]: dayAssignments
    }));

    // Persist
    try {
      await rosterService.saveAssignments(activeChurchId, dateStr, dayAssignments);
    } catch (err) {
      console.error('Failed to remove assignment:', err);
    }
  };

  const toggleStaffRole = (staffId: string, role: RoleTag) => {
    setStaffList(prev => prev.map(staff => {
      if (staff.id === staffId) {
        const hasRole = staff.roles.includes(role);
        return {
          ...staff,
          roles: hasRole ? staff.roles.filter(r => r !== role) : [...staff.roles, role]
        };
      }
      return staff;
    }));
  };

  const getBackgroundColor = (role: RoleTag, overrideColor?: string) => {
    if (overrideColor) return overrideColor;
    const roleMap: Record<string, string> = {
      'Preaching': '#000000',
      'Worship': '#2D5BFF',
      'Lead Singer': '#60A5FA',
      'Sunday School Teacher': '#10B981',
      'Usher': '#F59E0B',
      'Kitchen': '#F97316',
      'IT': '#475569',
    };
    return roleMap[role] || '#8D9494';
  };

  const getHoliday = (date: Date) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();

    // Fixed dates & Australian Public Holidays
    if (month === 1 && day === 1) return 'New Year';
    if (month === 1 && day === 26) return 'Australia Day';
    if (month === 2 && day === 14) return "Valentine's";
    if (month === 4 && day === 25) return 'ANZAC Day';
    if (month === 10 && day === 1) return 'National Day';
    if (month === 12 && day === 25) return 'Christmas';
    if (month === 12 && day === 26) return 'Boxing Day';
    
    // Mothers Day (2nd Sunday of May) - AU/US
    if (month === 5) {
      const firstDay = new Date(year, 4, 1);
      const firstSundayOffset = (7 - firstDay.getDay()) % 7;
      const firstSunday = 1 + firstSundayOffset;
      const secondSunday = firstSunday + 7;
      if (day === secondSunday) return "Mother's Day";
      
      // Labor Day (QLD/NT - 1st Monday in May)
      const firstMonday = 1 + (8 - firstDay.getDay()) % 7;
      if (day === firstMonday) return "Labor Day";
    }

    // King's Birthday (2nd Monday of June - typical for AU)
    if (month === 6) {
      const firstDay = new Date(year, 5, 1);
      const firstMonday = 1 + (8 - firstDay.getDay()) % 7;
      const secondMonday = firstMonday + 7;
      if (day === secondMonday) return "King's Birthday";
    }

    // Fathers Day (1st Sunday of September for AU)
    if (month === 9) {
      const firstDay = new Date(year, 8, 1);
      const firstSunday = 1 + (7 - firstDay.getDay()) % 7;
      if (day === firstSunday) return "Father's Day";
    }

    // Christian calendar - fixed dates every year
    if (month === 12 && day === 1)  return '🕯 Advent Begins';
    if (month === 12 && day === 24) return '🎄 Christmas Eve';
    if (month === 12 && day === 31) return '🎆 New Year\'s Eve';
    if (month === 1  && day === 6)  return '✨ Epiphany';
    if (month === 2  && day === 2)  return '🕯 Candlemas';
    if (month === 11 && day === 1)  return '✝️ All Saints\' Day';
    if (month === 11 && day === 2)  return '✝️ All Souls\' Day';

    // Christian calendar - year-specific (moveable feasts)
    if (year === 2025) {
      if (month === 3  && day === 5)  return '✝️ Ash Wednesday';
      if (month === 4  && day === 13) return '✝️ Palm Sunday';
      if (month === 4  && day === 17) return '✝️ Maundy Thursday';
      if (month === 4  && day === 18) return '✝️ Good Friday';
      if (month === 4  && day === 19) return '✝️ Holy Saturday';
      if (month === 4  && day === 20) return '🌅 Easter Sunday';
      if (month === 4  && day === 21) return '✝️ Easter Monday';
      if (month === 5  && day === 29) return '✝️ Ascension Day';
      if (month === 6  && day === 8)  return '🕊 Pentecost';
      if (month === 6  && day === 15) return '✝️ Trinity Sunday';
    } else if (year === 2026) {
      if (month === 2  && day === 18) return '✝️ Ash Wednesday';
      if (month === 3  && day === 29) return '✝️ Palm Sunday';
      if (month === 4  && day === 2)  return '✝️ Maundy Thursday';
      if (month === 4  && day === 3)  return '✝️ Good Friday';
      if (month === 4  && day === 4)  return '✝️ Holy Saturday';
      if (month === 4  && day === 5)  return '🌅 Easter Sunday';
      if (month === 4  && day === 6)  return '✝️ Easter Monday';
      if (month === 5  && day === 14) return '✝️ Ascension Day';
      if (month === 5  && day === 24) return '🕊 Pentecost';
      if (month === 5  && day === 31) return '✝️ Trinity Sunday';
    } else if (year === 2027) {
      if (month === 2  && day === 10) return '✝️ Ash Wednesday';
      if (month === 3  && day === 21) return '✝️ Palm Sunday';
      if (month === 3  && day === 25) return '✝️ Maundy Thursday';
      if (month === 3  && day === 26) return '✝️ Good Friday';
      if (month === 3  && day === 27) return '✝️ Holy Saturday';
      if (month === 3  && day === 28) return '🌅 Easter Sunday';
      if (month === 3  && day === 29) return '✝️ Easter Monday';
      if (month === 5  && day === 6)  return '✝️ Ascension Day';
      if (month === 5  && day === 16) return '🕊 Pentecost';
      if (month === 5  && day === 23) return '✝️ Trinity Sunday';
    }

    return null;
  };

  const getBirthday = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const md = `${month}-${day}`;
    return staffList.filter(s => s.birthday === md);
  };


  const getRoleColor = (role: RoleTag) => {
    const roleMap: Record<string, string> = {
      'Preaching': 'bg-black text-white',
      'Worship': 'bg-primary text-on-primary',
      'Lead Singer': 'bg-primary/20 text-primary border border-primary/30',
      'Sunday School Teacher': 'bg-secondary text-on-secondary',
      'Usher': 'bg-tertiary text-on-tertiary',
      'Kitchen': 'bg-orange-500 text-white',
      'IT': 'bg-slate-700 text-white',
    };
    return roleMap[role] || 'bg-surface-container-highest text-on-surface';
  };

  const filteredStaffPool = useMemo(() => {
    if (selectedRoleFilter === 'All') return staffList;
    return staffList.filter(s => s.roles.includes(selectedRoleFilter));
  }, [staffList, selectedRoleFilter]);

  // Map Chinese role names to English equivalents (and vice versa) for matching
  const ROLE_ALIASES: Record<string, string[]> = {
    '讲道': ['Preaching', 'Sermon', 'Pastor'],
    '敬拜': ['Worship'],
    '主唱': ['Lead Singer', 'Vocalist'],
    '乐手': ['Musician', 'Instrumentalist'],
    '招待': ['Usher'],
    '主日学老师': ['Sunday School Teacher'],
    '厨房': ['Kitchen'],
    '清洁': ['Cleaning'],
    'IT': ['IT'],
    '奉献': ['Giving'],
    'Preaching': ['讲道', 'Sermon'],
    'Worship': ['敬拜'],
    'Lead Singer': ['主唱', '主唱'],
    'Musician': ['乐手'],
    'Usher': ['招待'],
    'Sunday School Teacher': ['主日学老师'],
    'Kitchen': ['厨房'],
    'Cleaning': ['清洁'],
    'Giving': ['奉献'],
  };

  const roleMatches = (personRoles: string[], targetRole: string): boolean => {
    const target = targetRole.toLowerCase();
    return personRoles.some(r => {
      if (r.toLowerCase() === target) return true;
      const aliases = ROLE_ALIASES[targetRole] || [];
      const reverseAliases = ROLE_ALIASES[r] || [];
      return aliases.some(a => a.toLowerCase() === r.toLowerCase()) ||
             reverseAliases.some(a => a.toLowerCase() === target);
    });
  };

  const autoSchedule = async () => {
    if (!activeChurchId) { console.error('❌ No activeChurchId'); return; }
    console.log('🚀 AutoFill start', { activeChurchId, staffList, activeRoles, sundays: sundays.map(d => format(d, 'yyyy-MM-dd')) });
    const newAssignments: Record<string, Assignment[]> = { ...assignments };

    for (const date of sundays) {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayAsgns = [...(newAssignments[dateStr] || [])];
      const unavailIds = globalUnavailabilities.filter(u => u.date === dateStr).map(u => u.user_id);

      // Track how many roles each person is assigned this day (max 2)
      const personRoleCount: Record<string, number> = {};
      dayAsgns.forEach(a => {
        personRoleCount[a.staffId] = (personRoleCount[a.staffId] || 0) + 1;
      });

      // Only include staff with real UUIDs (not local_ temp IDs)
      const shuffledStaff = [...staffList]
        .filter(s => !s.id.startsWith('local_'))
        .sort(() => Math.random() - 0.5);

      activeRoles.forEach(role => {
        if (dayAsgns.some(a => a.role === role)) return;

        // Find someone who has this skill (with CN/EN alias matching), is available, and hasn't hit the 2-role limit
        // If a person has NO skills set, treat them as eligible for any role (skills not configured yet)
        const candidate = shuffledStaff.find(s =>
          (s.roles.length === 0 || roleMatches(s.roles, role)) &&
          !s.onLeave &&
          !unavailIds.includes(s.id) &&
          (personRoleCount[s.id] || 0) < 2
        );

        if (candidate) {
          console.log(`✅ Assigned ${candidate.name} to ${role} on ${dateStr}`);
          dayAsgns.push({ id: `auto-${Date.now()}-${Math.random()}`, staffId: candidate.id, role });
          personRoleCount[candidate.id] = (personRoleCount[candidate.id] || 0) + 1;
        } else {
          console.warn(`⚠️ No candidate for ${role} on ${dateStr}`, shuffledStaff.map(s => ({ name: s.name, roles: s.roles, onLeave: s.onLeave })));
        }
      });
      newAssignments[dateStr] = dayAsgns;

      try {
        await rosterService.saveAssignments(activeChurchId, dateStr, dayAsgns);
        console.log(`💾 Saved ${dateStr}`, dayAsgns.length, 'assignments to churchId:', activeChurchId);
      } catch (e: any) {
        console.error(`❌ Save failed for ${dateStr}:`, e);
        alert(`保存失败 (${dateStr}): ${e?.message || JSON.stringify(e)}\n\nchurchId: ${activeChurchId}`);
      }
    }

    setAssignments(newAssignments);
    setView('Table');
    const totalSaved = Object.values(newAssignments).reduce((sum, arr) => sum + arr.length, 0);
    alert(language.startsWith('zh')
      ? `✅ Auto Fill 完成！已保存 ${totalSaved} 条排班记录到数据库。`
      : `✅ Auto Fill complete! Saved ${totalSaved} assignments to the database.`);
  };

  const [notifyingStaff, setNotifyingStaff] = useState(false);
  const notifyRosterToStaff = async () => {
    if (mode !== 'Manager' || !activeChurchId || notifyingStaff) return;
    setNotifyingStaff(true);
    try {
      const monthLabel = format(currentDate, 'yyyy-MM');
      await socialService.addNotification({
        church_id: activeChurchId,
        recipient_id: null,
        recipient_role: 'Staff',
        sender_id: user?.id || null,
        sender_name: profile?.full_name || 'Manager',
        type: 'roster',
        title: language.startsWith('zh') ? `${monthLabel} 服事排班已发布` : `${monthLabel} roster published`,
        body: language.startsWith('zh') ? '请查看你的服事排班。' : 'Please check your service assignments.',
        link: '/app/roster',
      });
      alert(language.startsWith('zh') ? '✅ 已通知所有同工！' : '✅ All staff notified!');
    } finally {
      setNotifyingStaff(false);
    }
  };

  const clearSchedule = () => {
    if (mode !== 'Manager') return;
    if (!window.confirm('Clear all assignments for this month?')) return;
    setAssignments(prev => {
      const next = { ...prev };
      sundays.forEach(date => {
        delete next[format(date, 'yyyy-MM-dd')];
      });
      return next;
    });
  };

  return (
    <div className="flex w-full flex-col bg-surface min-h-full">
      {/* Dynamic Print Styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\:hidden { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .table-container { width: 100% !important; overflow: visible !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          th, td { border: 1px solid #eee !important; padding: 12px !important; }
          .sticky { position: static !important; }
          .shadow-xl, .shadow-md, .shadow-sm { shadow: none !important; box-shadow: none !important; }
        }
      `}</style>

      {/* Page Header - Re-designed for clarity */}
      <div className="flex flex-col gap-6 p-6 sm:p-8 bg-white border-b border-outline-variant/10 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] sticky top-0 z-[30] print:hidden">
        {/* Top Row: Title, Date Nav, and View Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-3 lg:gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary/[0.06] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary text-[22px]">calendar_month</span>
              </div>
              <div className="flex flex-col">
                <h2 className="text-xl font-serif font-black tracking-tight text-on-surface leading-none">
                  {t('serviceRoster')}
                </h2>
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mt-1.5">
                  {church?.name || 'GraceFlow'}
                </p>
              </div>
            </div>

            <div className="h-10 w-px bg-outline-variant/20 hidden sm:block" />

            {mode === 'Manager' && (
              <button
                onClick={autoSchedule}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-black text-white hover:bg-primary transition-all text-[10px] font-black uppercase tracking-widest shadow-xl shadow-black/10 active:scale-95 group relative overflow-hidden h-[44px] whitespace-nowrap shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">magic_button</span>
                <span>{tr('Auto Fill', language)}</span>
              </button>
            )}

            {mode === 'Manager' && (
              <button
                onClick={notifyRosterToStaff}
                disabled={notifyingStaff}
                title={language.startsWith('zh') ? '发送排班通知给所有同工' : 'Notify all staff about the roster'}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-primary/10 text-primary hover:bg-primary/20 transition-all text-[10px] font-black uppercase tracking-widest active:scale-95 h-[44px] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {notifyingStaff
                  ? <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  : <span className="material-symbols-outlined text-[18px]">campaign</span>}
                <span>{language.startsWith('zh') ? '通知同工' : 'Notify Staff'}</span>
              </button>
            )}

            <div className="flex bg-surface-container rounded-2xl p-1 shadow-inner h-[44px] shrink-0">
              {(mode === 'Manager'
                ? [
                    { id: 'Monthly', icon: 'calendar_view_month', title: tr('Month View', language) },
                    { id: 'Table', icon: 'view_list', title: tr('Table List', language) },
                    { id: 'Personnel', icon: 'person', title: tr('Personnel List', language) },
                  ]
                : [
                    { id: 'Monthly', icon: 'calendar_view_month', title: tr('Month View', language) },
                    { id: 'MyRoster', icon: 'event_available', title: isZh ? '我的排班' : 'My Roster' },
                  ]
              ).map(v => (
                <button 
                  key={v.id}
                  onClick={() => setView(v.id as any)} 
                  className={`p-2.5 rounded-xl transition-all ${view === v.id ? 'bg-white text-primary shadow-sm' : 'text-outline hover:text-on-surface'}`}
                  title={v.title}
                >
                  <span className="material-symbols-outlined text-lg">{v.icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Center: Date Navigation */}
          <div className="flex items-center justify-between lg:justify-center flex-1">
            <div className="flex items-center bg-surface-container rounded-2xl p-1 h-11 shadow-sm min-w-[210px] justify-between border border-outline-variant/10">
              <button 
                onClick={handlePrev}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white text-outline hover:text-primary transition-all active:scale-90"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <div className="px-6 flex flex-col items-center">
                <span className="text-xs font-black uppercase tracking-[0.3em] text-on-surface">
                  {format(currentDate, 'MMMM')}
                </span>
                <span className="text-[8px] font-black text-outline/50 tracking-widest">
                  {format(currentDate, 'yyyy')}
                </span>
              </div>
              <button 
                onClick={handleNext}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white text-outline hover:text-primary transition-all active:scale-90"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>

          {/* Right: Export & Print */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={exportRosterICS}
              title={isZh ? '下载日历 (.ics) — 可导入 Apple / Google 日历' : 'Download calendar (.ics) — import into Apple / Google Calendar'}
              className="flex items-center justify-center gap-2 h-11 px-4 rounded-2xl bg-white text-on-surface transition-all text-[10px] font-black uppercase tracking-widest border border-outline-variant/30 shadow-sm hover:border-primary/50 hover:bg-surface-container-low group shrink-0 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-lg text-outline group-hover:text-primary">calendar_add_on</span>
              <span className="hidden xl:inline whitespace-nowrap">{isZh ? '导出日历' : 'Export iCal'}</span>
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center justify-center gap-2 h-11 px-4 rounded-2xl bg-white text-on-surface transition-all text-[10px] font-black uppercase tracking-widest border border-outline-variant/30 shadow-sm hover:border-primary/50 hover:bg-surface-container-low group shrink-0 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-lg text-outline group-hover:text-primary">picture_as_pdf</span>
              <span className="hidden xl:inline whitespace-nowrap">{t('exportPDF') || 'Export PDF'}</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Management Actions & Filters */}
        <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-outline-variant/10">
          {mode === 'Manager' && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button 
                onClick={() => setShowRoleSettings(true)}
                className="flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-surface-container text-on-surface transition-all border border-outline-variant/20 shadow-sm hover:bg-white hover:text-primary active:scale-95 group"
                title={tr('Role Settings', language)}
              >
                <span className="material-symbols-outlined text-[20px] group-hover:rotate-45 transition-transform">settings</span>
                <span className="text-[10px] font-black uppercase tracking-widest">{tr('Role Settings', language)}</span>
              </button>

              {saveStatus !== 'IDLE' && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest ${
                  saveStatus === 'SAVING' ? 'bg-surface-container text-outline' :
                  saveStatus === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                  'bg-error/5 text-error border border-error/20'
                }`}>
                  <span className={`material-symbols-outlined text-sm ${saveStatus === 'SAVING' ? 'animate-spin' : ''}`}>
                    {saveStatus === 'SAVING' ? 'progress_activity' : saveStatus === 'SUCCESS' ? 'check_circle' : 'error'}
                  </span>
                  {saveStatus === 'SAVING' ? (tr('Saving...', language)) : saveStatus === 'SUCCESS' ? (tr('All Saved', language)) : (tr('Save Error', language))}
                </div>
              )}
            </div>
          )}

          {mode === 'Staff' && (
            <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-primary/5 border border-primary/10">
              <span className="material-symbols-outlined text-primary text-[20px]">info</span>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                {language.startsWith('zh') 
                  ? '点击日历日期可切换您的不可用状态。您的排班通过红色背景突出显示。' 
                  : 'Click on a calendar day to toggle your unavailability. Your assignments are highlighted in red.'
                }
              </p>
            </div>
          )}

          <div className="h-8 w-px bg-outline-variant/20 hidden sm:block mx-2" />

          <div className="flex flex-col sm:flex-row items-center gap-3 flex-1 w-full sm:w-auto">
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm flex-1 group hover:border-primary/50 transition-all w-full sm:w-auto">
              <span className="material-symbols-outlined text-lg text-outline group-hover:text-primary transition-colors">person_search</span>
              <select 
                value={highlightedStaffId || ''} 
                onChange={(e) => setHighlightedStaffId(e.target.value || null)}
                className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-on-surface focus:ring-0 cursor-pointer w-full appearance-none outline-none"
              >
                <option value="">{tr('Search Member...', language)}</option>
                {staffList.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {highlightedStaffId && (
                <button onClick={() => setHighlightedStaffId(null)} className="text-outline hover:text-error transition-colors">
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm flex-1 group hover:border-primary/50 transition-all w-full sm:w-auto">
              <span className="material-symbols-outlined text-lg text-outline group-hover:text-primary transition-colors">filter_list</span>
              <select 
                value={selectedRoleFilter} 
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-on-surface focus:ring-0 cursor-pointer w-full appearance-none outline-none"
              >
                <option value="All">{tr('All Departments', language)}</option>
                {availableRoles.map(role => (
                  <option key={role} value={role}>{tValue(role, language)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest/50 relative">
        {/* Hidden Table for PDF Export - Optimized for high-fidelity mirroring of UI */}
        <div id="roster-pdf-export-source" className="fixed -left-[5000px] top-0 bg-[#F4F1EE] p-12 min-w-[1400px]" style={{ zIndex: -1000 }}>
            <div className="mb-10">
              <h1 className="text-4xl font-serif font-black text-[#2C2C2C] mb-2">GraceFlow Church</h1>
              <p className="text-[12px] font-black uppercase tracking-[0.25em] text-[#8B7E74]">Monthly Service Roster • {format(currentDate, 'MMMM yyyy')}</p>
            </div>
            
            <table className="w-full border-separate border-spacing-y-4 border-spacing-x-2">
                <thead>
                    <tr>
                        <th className="p-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8B7E74]">Date</th>
                        {activeRoles.map(role => (
                            <th key={role} className="p-4 text-center text-[10px] font-black uppercase tracking-widest text-[#8B7E74]">{tValue(role, language)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sundays.map(date => {
                        const dateStr = format(date, 'yyyy-MM-dd');
                        const dayAsgns = assignments[dateStr] || [];
                        return (
                            <tr key={dateStr}>
                                <td className="p-4 bg-white rounded-l-[24px] border-y border-l border-[#E5E0DA] min-w-[140px]">
                                    <div className="flex items-center gap-4">
                                        <span className="text-4xl font-serif font-black text-[#2C2C2C] leading-none mb-1">{format(date, 'd')}</span>
                                        <div className="flex flex-col justify-center">
                                            <span className="text-[9px] font-black uppercase tracking-tighter text-[#8B7E74] leading-none">{format(date, 'MMMM')}</span>
                                            <span className="text-[8px] font-black uppercase tracking-widest text-[#2D5BFF] mt-1 leading-none">{format(date, 'EEEE')}</span>
                                        </div>
                                    </div>
                                </td>
                                {activeRoles.map((role, idx) => {
                                    const asgn = dayAsgns.find(a => a.role === role);
                                    const staff = asgn ? staffList.find(s => s.id === asgn.staffId) : null;
                                    const isLast = idx === activeRoles.length - 1;
                                    
                                    return (
                                        <td key={role} className={`p-4 bg-white ${isLast ? 'rounded-r-[24px] border-r' : ''} border-y border-[#E5E0DA] align-middle text-center`}>
                                            {asgn ? (
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="text-[12px] font-bold text-[#2C2C2C] uppercase tracking-tight">{staff?.name}</div>
                                                </div>
                                            ) : (
                                                <div className="h-8 border-b border-dashed border-[#F4F1EE]"></div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="mt-12 pt-8 border-t border-[#E5E0DA] flex justify-between items-center opacity-50">
                <p className="text-[10px] font-bold uppercase tracking-widest">GraceFlow System • Service Roster</p>
                <p className="text-[10px] font-bold uppercase tracking-widest">Generated {format(new Date(), 'yyyy-MM-dd HH:mm')}</p>
            </div>
        </div>

        {/* Main View Area - Optimized for one-page view */}
        <div className="flex-1 overflow-hidden bg-surface-container/10 p-2 md:p-4">
           <div className={`h-full w-full max-w-[1600px] mx-auto ${view !== 'Personnel' ? 'rounded-2xl border border-outline-variant/10 bg-white shadow-xl transition-all flex flex-col overflow-hidden' : ''}`} id="roster-table-container">
              {/* Day Modal */}
              <AnimatePresence>
                {selectedDayDetail && (
                  <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        onClick={() => setSelectedDayDetail(null)} 
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
                    />
                    <motion.div 
                        initial={{ scale: 0.9, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 30 }}
                        className="relative bg-white w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                    >
                        <div className="p-8 pb-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-[24px] bg-primary/10 flex items-center justify-center text-primary font-serif font-black text-2xl">
                                    {format(parseISO(selectedDayDetail), 'd')}
                                </div>
                                <div>
                                    <h3 className="text-xl font-serif font-black">{format(parseISO(selectedDayDetail), 'MMMM d, yyyy')}</h3>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-outline/50">{getHoliday(parseISO(selectedDayDetail)) || 'Service Day'}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedDayDetail(null)} className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center transition-all">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 pt-4 space-y-6">
                            {mode === 'Manager' && (
                                <section>
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-3">Add Staff Assignment</h4>
                                    <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl bg-surface-container shadow-inner">
                                        <select 
                                            value={modalStaffId}
                                            className="bg-white border-none rounded-xl text-xs p-2.5 focus:ring-2 ring-primary/20"
                                            onChange={(e) => {
                                                const staffId = e.target.value;
                                                const role = modalRoleId || modalPreselectedRole || (selectedRoleFilter !== 'All' ? selectedRoleFilter : (availableRoles[0] ?? ''));
                                                if (staffId && role) {
                                                    addAssignment(selectedDayDetail || '', staffId, role);
                                                    setModalStaffId('');
                                                } else {
                                                    setModalStaffId(staffId);
                                                }
                                            }}
                                        >
                                            <option value="">{tr('Select Member...', language)}</option>
                                            {staffList.filter(s => !s.onLeave).sort((a,b) => a.name.localeCompare(b.name)).map(s => {
                                                const isBusy = globalUnavailabilities.some(u => u.date === selectedDayDetail && u.user_id === s.id);
                                                return (
                                                  <option key={s.id} value={s.id} disabled={isBusy}>
                                                    {s.name} {isBusy ? (isZh ? '— 不可用，无法安排' : '— Unavailable') : ''}
                                                  </option>
                                                );
                                            })}
                                        </select>
                                        <select 
                                            value={modalRoleId || modalPreselectedRole || (selectedRoleFilter !== 'All' ? selectedRoleFilter : availableRoles[0])}
                                            className="bg-white border-none rounded-xl text-xs p-2.5 focus:ring-2 ring-primary/20"
                                            onChange={(e) => setModalRoleId(e.target.value)}
                                        >
                                            {availableRoles.map(r => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>
                                </section>
                            )}

                            <section>
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-outline/60 mb-4">Personnel on Duty</h4>
                                <div className="space-y-3">
                                    {assignments[selectedDayDetail]?.length > 0 ? (
                                        assignments[selectedDayDetail].map(asgn => {
                                            const staff = staffList.find(s => s.id === asgn.staffId);
                                            const conflict = globalUnavailabilities.some(u => u.date === selectedDayDetail && u.user_id === asgn.staffId);
                                            return (
                                                <div key={asgn.id} className={`flex items-center gap-4 p-4 rounded-[28px] border group/item ${conflict ? 'bg-error/5 border-error/30' : 'bg-surface-container-low border-outline-variant/10'}`}>
                                                    <div className="w-12 h-12 rounded-[18px] bg-white shadow-sm flex items-center justify-center font-serif font-black text-xs overflow-hidden border border-primary/10">
                                                        {staff?.avatar ? <img src={staff.avatar} className="w-full h-full object-cover" alt="" /> : staff?.initials}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[13px] font-bold text-on-surface uppercase tracking-tight">{staff?.name}</span>
                                                            {staff?.isTeamLeader && (
                                                                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[7px] font-black uppercase tracking-widest">Lead</span>
                                                            )}
                                                            {conflict && (
                                                                <span className="px-2 py-0.5 rounded-full bg-error text-white text-[7px] font-black uppercase tracking-widest flex items-center gap-0.5">
                                                                    <span className="material-symbols-outlined text-[10px]">warning</span>
                                                                    {isZh ? '已请假' : 'Unavailable'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-outline/60">{tValue(asgn.role, language)}</span>
                                                    </div>
                                                    {mode === 'Manager' && (
                                                        <button 
                                                            onClick={() => handleRemoveAssignment(selectedDayDetail, asgn.id)}
                                                            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-error hover:text-white transition-all text-outline/20"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                        </button>
                                                    )}
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getBackgroundColor(asgn.role) }} />
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="py-20 text-center">
                                            <span className="material-symbols-outlined text-[48px] text-outline/20 mb-4">event_busy</span>
                                            <p className="text-sm font-medium text-outline/40">No personnel assigned for this day.</p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>

                        <div className="p-8 bg-surface-container-lowest border-t border-outline-variant/10">
                            <button 
                                onClick={() => setSelectedDayDetail(null)}
                                className="w-full py-4 rounded-2xl bg-on-surface text-white text-[11px] font-black uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all"
                            >
                                Done
                            </button>
                        </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {view === 'MyRoster' ? (
                <div className="h-full overflow-y-auto p-4 md:p-6 space-y-3 pb-20">
                  {(() => {
                    const myId = user?.id;
                    const mine = Object.entries(assignments)
                      .flatMap(([dateStr, asgns]) => (asgns as Assignment[])
                        .filter(a => a.staffId === myId)
                        .map(a => ({ dateStr, role: a.role })))
                      .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
                    if (mine.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-24 text-center text-outline">
                          <span className="material-symbols-outlined text-6xl text-outline/20 mb-4">event_busy</span>
                          <p className="font-bold">{isZh ? '本月还没有你的排班' : 'No assignments for you this month'}</p>
                        </div>
                      );
                    }
                    return mine.map((m, i) => (
                      <div key={i} className="flex items-center justify-between bg-white rounded-2xl p-5 border border-outline-variant/10 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-surface-container">
                            <span className="text-lg font-black text-on-surface leading-none">{format(parseISO(m.dateStr), 'd')}</span>
                            <span className="text-[9px] font-bold uppercase text-outline">{format(parseISO(m.dateStr), 'MMM')}</span>
                          </div>
                          <span className="text-sm font-bold text-on-surface">{format(parseISO(m.dateStr), 'EEEE')}</span>
                        </div>
                        <span className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white" style={{ background: getBackgroundColor(m.role) }}>
                          {tValue(m.role, language)}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              ) : view === 'Personnel' && mode === 'Manager' ? (
                <div className="h-full overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20 p-4">
                  {filteredStaffPool.map(staff => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={staff.id}
                      className="group relative p-8 rounded-[40px] bg-white border border-outline-variant/20 shadow-xl shadow-black/[0.02] hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-[100px] -z-10 group-hover:bg-primary/10 transition-colors"></div>
                      
                      <div className="flex flex-col items-center mb-8">
                        {staff.isTeamLeader && (
                          <div className="mb-4 px-4 py-1.5 rounded-full bg-primary text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 flex items-center gap-2">
                             <span className="material-symbols-outlined text-[14px]">stars</span>
                             {staff.leaderOf} Team Leader
                          </div>
                        )}
                        <div className="relative mb-6">
                           <div className="w-28 h-28 rounded-[36px] bg-white shadow-2xl p-1.5 ring-1 ring-black/[0.03]">
                                 <div className="w-full h-full rounded-[30px] border-2 border-primary/10 flex items-center justify-center font-serif font-black text-3xl text-primary overflow-hidden bg-surface-container-low/30 uppercase">
                                    {staff.avatar ? (
                                      <img src={staff.avatar} className="w-full h-full object-cover" alt="" />
                                    ) : staff.initials}
                                 </div>
                           </div>
                           {staff.onLeave && (
                             <div className="absolute -bottom-2 -right-2 bg-error text-white px-3 py-1 rounded-xl text-[8px] font-black uppercase tracking-widest shadow-lg ring-4 ring-white">
                               Leave
                             </div>
                           )}
                        </div>
                        <h4 className="font-serif text-2xl font-black text-on-surface mb-1 group-hover:text-primary transition-colors">{staff.name}</h4>
                        {staff.isTeamLeader ? (
                          <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] bg-primary/5 px-4 py-1.5 rounded-full inline-block mb-1 border border-primary/10">
                             <span className="material-symbols-outlined text-[12px] align-middle mr-1">stars</span>
                             {staff.leaderOf} Leader
                          </p>
                        ) : (
                          <p className="text-[10px] font-black text-outline/50 uppercase tracking-[0.2em]">Pastor / Member</p>
                        )}
                      </div>

                      <div className="space-y-4">
                         <div className="flex flex-wrap justify-center gap-1.5">
                           {staff.roles.map(role => (
                             <span key={role} className="px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest bg-surface-container-low text-outline border border-outline-variant/10">
                               {t(role.charAt(0).toLowerCase() + role.slice(1).replace(/ /g, '')) || role}
                             </span>
                           ))}
                         </div>
                      </div>

                      <div className="mt-10 pt-8 border-t border-outline-variant/10 flex items-center justify-center gap-4">
                         <button className="h-11 w-11 rounded-2xl flex items-center justify-center bg-surface-container-low text-on-surface hover:bg-primary hover:text-white transition-all">
                            <span className="material-symbols-outlined text-[20px]">mail</span>
                         </button>
                         <button className="h-11 w-11 rounded-2xl flex items-center justify-center bg-surface-container-low text-on-surface hover:bg-primary hover:text-white transition-all">
                            <span className="material-symbols-outlined text-[20px]">calendar_today</span>
                         </button>
                         <button className="h-11 w-11 rounded-2xl flex items-center justify-center bg-surface-container-low text-on-surface hover:bg-primary hover:text-white transition-all">
                            <span className="material-symbols-outlined text-[20px]">more_horiz</span>
                         </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : view === 'Table' ? (
                <div className="overflow-x-auto w-full pb-32">
                  {(() => {
                    const staffRoles = (mode === 'Staff' && currentUser?.roles?.length) ? currentUser.roles : null;
                    const tableRoles = staffRoles
                      ?? (selectedRoleFilter === 'All' ? activeRoles : activeRoles.filter(r => r === selectedRoleFilter));
                    return (
                      <table className="w-full border-separate border-spacing-x-0 border-spacing-y-0">
                        <thead>
                          <tr className="sticky top-0 z-40 bg-white">
                            <th className="sticky left-0 z-50 bg-white p-4 text-left w-[120px] border-b border-outline-variant/20 border-r border-outline-variant/10 shadow-[2px_0_10px_rgba(0,0,0,0.05)]">
                              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Service Date</span>
                            </th>
                            {tableRoles.map((role) => (
                              <th key={role} className="p-4 text-center border-b border-outline-variant/20 min-w-[220px] bg-white">
                                <div className="flex flex-col items-center justify-center gap-1 group">
                                   <span className="material-symbols-outlined text-[18px] text-primary/40">
                                     {
                                       role === 'Preaching' ? 'campaign' : 
                                       role === 'Worship' ? 'music_note' : 
                                       role === 'Usher' ? 'hail' : 
                                       role === 'Kitchen' ? 'local_dining' : 
                                       role === 'Cleaning' ? 'mop' : 
                                       role === 'IT' ? 'terminal' : 
                                       role === 'Giving' ? 'payments' :
                                       role === 'Sunday School Teacher' ? 'school' :
                                       role === 'Lead Singer' ? 'record_voice_over' :
                                       role === 'Musician' ? 'music_note' :
                                       role.toUpperCase().includes('PIANO') ? 'piano' :
                                       role.toUpperCase().includes('GUITAR') ? 'music_note' :
                                       role.toUpperCase().includes('BASS') ? 'music_note' :
                                       role.toUpperCase().includes('DRUM') ? 'music_note' :
                                       'person'
                                     }
                                   </span>
                                   <span className="text-[9px] font-black uppercase tracking-widest text-on-surface">{t(role.charAt(0).toLowerCase() + role.slice(1).replace(/ /g, '')) || role}</span>
                                </div>
                              </th>
                            ))}
                            {/* Filler cell */}
                            <th className="border-b border-outline-variant/20 bg-white w-full"></th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {sundays.map(date => {
                            const dateStr = format(date, 'yyyy-MM-dd');
                            const dayAsgns = assignments[dateStr] || [];
                            return (
                              <tr key={dateStr} className="group hover:bg-surface-container-lowest/50 transition-colors">
                                <td className="sticky left-0 z-40 bg-white p-4 group-hover:bg-surface-container-lowest transition-all border-b border-outline-variant/10 border-r border-outline-variant/10 shadow-[2px_0_10px_rgba(0,0,0,0.02)] service-date-cell">
                                  <div className="flex flex-row items-center gap-3 leading-none">
                                    <span className="text-3xl font-serif font-black text-on-surface tracking-tighter date-number">{format(date, 'd')}</span>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase tracking-tighter text-outline/60 date-month">{format(date, 'MMMM')}</span>
                                        <span className="text-[8px] font-black uppercase tracking-widest text-primary mt-0.5">{format(date, 'EEEE')}</span>
                                    </div>
                                  </div>
                                </td>
                                {tableRoles.map(role => {
                                  const roleAsgn = dayAsgns.find(a => a.role === role);
                                  const isUserAsgn = roleAsgn?.staffId === currentUser?.id;
                                  const staff = roleAsgn ? staffList.find(s => s.id === roleAsgn.staffId) : null;
                                  const isHighlighted = highlightedStaffId && staff?.id === highlightedStaffId;
                                  
                                  if (mode === 'Staff' && roleAsgn && !isUserAsgn) {
                                    return <td key={role} className="p-3 border-b border-outline-variant/10 min-w-[220px]"></td>;
                                  }

                                  return (
                                <td 
                                  key={role} 
                                  className="p-3 border-b border-outline-variant/10 min-w-[220px]"
                                >
                                  {roleAsgn ? (
                                    <div 
                                      className={`p-3 rounded-2xl flex items-center gap-3 shadow-sm border transition-all duration-300 assignment-card ${isHighlighted ? 'bg-primary text-white border-primary shadow-xl scale-[1.05] ring-4 ring-primary/20 z-10' : 'bg-surface-container-low border-outline-variant/5'}`}
                                    >
                                       <div className="h-10 w-10 rounded-xl bg-white shadow-sm flex items-center justify-center font-serif font-black text-xs shrink-0 overflow-hidden text-primary avatar-mini">
                                          {staff?.avatar ? <img src={staff.avatar} className="w-full h-full object-cover" alt="" /> : staff?.initials}
                                       </div>
                                      <div className="flex-1 min-w-0">
                                        <h5 className={`text-[11px] font-bold uppercase tracking-tight truncate staff-name ${isHighlighted ? 'text-white' : 'text-on-surface'}`}>{staff?.name}</h5>
                                        <p className={`text-[8px] font-black uppercase tracking-widest truncate role-name ${isHighlighted ? 'text-white/60' : 'text-outline/60'}`}>{tValue(role, language)}</p>
                                      </div>
                                      {mode === 'Manager' && (
                                        <button 
                                          onClick={() => handleRemoveAssignment(dateStr, roleAsgn.id)}
                                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all print:hidden ${isHighlighted ? 'bg-white/20 hover:bg-white/40 text-white' : 'hover:bg-error hover:text-white text-outline/20'}`}
                                        >
                                          <span className="material-symbols-outlined text-[14px]">close</span>
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <div 
                                      onClick={() => {
                                        setModalPreselectedRole(role);
                                        setSelectedDayDetail(dateStr);
                                      }}
                                      className="h-14 rounded-2xl border-2 border-dashed border-outline-variant/5 flex items-center justify-center hover:bg-surface-container-low transition-colors cursor-pointer group/add placeholder-box"
                                    >
                                      <span className="material-symbols-outlined text-outline/10 group-hover/add:text-primary/30 transition-colors print:hidden">add_circle</span>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td className="border-b border-outline-variant/10"></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 border-b border-outline-variant/10 bg-surface-container-low/40 shrink-0">
                    {[t('sunday'), t('mon'), t('tue'), t('wed'), t('thu'), t('friday'), t('saturday')].map((day, i) => (
                      <div key={day} className={`py-2.5 text-center text-[9px] font-black uppercase tracking-[0.2em] border-r border-outline-variant/5 last:border-r-0 ${i === 0 ? 'text-primary' : 'text-on-surface-variant'}`}>{day}</div>
                    ))}
                  </div>

                  <div className={`grid grid-cols-7 h-full grow divide-x divide-y divide-outline-variant/10 border-t border-outline-variant/10 bg-white overflow-hidden`}>
                    {calendarDays.map((date) => {
                        const dateStr = format(date, 'yyyy-MM-dd');
                        const dayAsgns = assignments[dateStr] || [];
                        const userAvailability = availability[dateStr];
                        
                        // In Staff mode, only show current user's assignments
                        const displayAssignments = mode === 'Staff' 
                          ? dayAsgns.filter(a => a.staffId === currentUser?.id)
                          : dayAsgns.filter(asgn => selectedRoleFilter === 'All' || asgn.role === selectedRoleFilter);

                        const isSunday = date.getDay() === 0;
                        const isCurrentMonth = isSameMonth(date, currentDate);
                        const dayUnavail = globalUnavailabilities.filter(u => u.date === dateStr);
                        const isMeBusy = dayUnavail.some(u => u.user_id === user?.id);

                        return (
                          <div 
                            key={dateStr}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, dateStr)}
                            onClick={() => {
                              if (mode === 'Staff') {
                                toggleAvailability(dateStr);
                              } else {
                                setSelectedDayDetail(dateStr);
                              }
                            }}
                            className={`p-1.5 transition-all group flex flex-col cursor-pointer ring-inset hover:ring-2 hover:ring-primary/40 ${!isCurrentMonth ? 'bg-surface-container-low/30 opacity-30 shadow-inner' : isSunday ? 'bg-primary/[0.02]' : 'hover:bg-primary/[0.01]'} ${isMeBusy ? 'bg-error/5 ring-1 ring-inset ring-error/20' : ''}`}
                          >
                            <div className="flex flex-col gap-1 mb-1">
                                <div className="flex items-center justify-between text-[9px]">
                                    <div className="flex items-center gap-1">
                                      {isSunday ? (
                                        <div className={`flex flex-col items-center leading-none px-1 py-0.5 rounded-md transition-all ${isToday(date) ? 'bg-primary text-white shadow-sm' : 'text-primary'}`}>
                                          <span className="text-[11px] font-black">{format(date, 'd')}</span>
                                          <span className="text-[7px] font-black opacity-70 uppercase">{format(date, 'MMM')}</span>
                                        </div>
                                      ) : (
                                        <span className={`w-5 h-5 rounded-md flex items-center justify-center font-black transition-all ${isToday(date) ? 'bg-primary text-white shadow-sm' : 'text-outline/40'}`}>
                                          {format(date, 'd')}
                                        </span>
                                      )}
                                      {isMeBusy && (
                                        <div className="px-2 py-0.5 rounded-md bg-error text-white text-[9px] font-black uppercase tracking-tight shadow-sm flex items-center gap-0.5">
                                          <span className="material-symbols-outlined text-[11px]">block</span>
                                          {isZh ? '不可用' : 'OFF'}
                                        </div>
                                      )}
                                    </div>
                                    {displayAssignments.length > 0 && <span className="w-1 h-1 rounded-full bg-primary/40" />}
                                </div>
                                
                                <div className="flex flex-wrap gap-1 min-h-[14px]">
                                  {getHoliday(date) && (
                                    <span className="text-[9px] font-black uppercase text-amber-800 bg-amber-100 border border-amber-200/70 px-2 py-1 rounded-md shrink-0 whitespace-nowrap">
                                      {getHoliday(date)}
                                    </span>
                                  )}
                                  {getBirthday(date).length > 0 && (
                                    <span className="text-[6px] font-black uppercase text-secondary bg-secondary/5 px-1 py-0.5 rounded border border-secondary/5 flex items-center gap-0.5 shrink-0 whitespace-nowrap">
                                      <span className="material-symbols-outlined text-[8px]">cake</span>
                                      {getBirthday(date).length === 1 ? getBirthday(date)[0].name : `${getBirthday(date).length} Birthdays`}
                                    </span>
                                  )}
                                </div>
                            </div>

                             <div className="flex-1 space-y-1 overflow-y-auto no-scrollbar">
                                {/* Assignments */}
                                {displayAssignments.map(asgn => {
                                  const staff = staffList.find(s => s.id === asgn.staffId);
                                  const isHighlighted = highlightedStaffId === staff?.id;
                                  return (
                                    <motion.div 
                                        initial={{ scale: 0.98, opacity: 0 }}
                                        animate={{ 
                                          scale: isHighlighted ? 1.02 : 1, 
                                          opacity: 1 
                                        }}
                                        key={asgn.id}
                                        onClick={() => {
                                          if (mode === 'Manager') {
                                            setEditingAssignment({ dateStr, assignment: asgn });
                                          }
                                        }}
                                        className={`px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase tracking-tight flex items-center justify-between shadow-sm group/item border border-black/5 transition-all text-white cursor-pointer
                                          ${isHighlighted ? 'ring-4 ring-primary/40 z-10 scale-[1.05] brightness-125' : ''}
                                        `}
                                        style={{ backgroundColor: getBackgroundColor(asgn.role, asgn.color) }}
                                    >
                                        <div className="flex-1 min-w-0 flex flex-col py-0.5">
                                          <span className={`truncate leading-tight text-[9px] font-bold ${isHighlighted ? 'text-white drop-shadow-md' : 'text-white'}`}>{staff?.name}</span>
                                          <span className={`text-[7px] opacity-80 leading-tight mt-0.5 ${isHighlighted ? 'text-white drop-shadow-sm' : 'text-white/70'}`}>{tValue(asgn.role, language)}</span>
                                        </div>
                                        {mode === 'Manager' && (
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRemoveAssignment(dateStr, asgn.id);
                                            }}
                                            className="opacity-0 group-hover/item:opacity-100 transition-all text-white/60 hover:text-white"
                                          >
                                            <span className="material-symbols-outlined text-[8px]">close</span>
                                          </button>
                                        )}
                                    </motion.div>
                                  );
                                })}
                            </div>
                          </div>
                        );
                    })}
                  </div>
                </>
              )}
           </div>
        </div>
      </div>

      {/* Multiple Roles Modal */}
      <AnimatePresence>
         {showRoleModal && pendingAssignment && (
           <div className="fixed inset-0 z-[200] flex items-center justify-center p-8">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowRoleModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="relative bg-white w-full max-w-md rounded-[48px] p-12 shadow-2xl overflow-hidden"
              >
                 <header className="mb-10 text-center">
                    <div className="w-20 h-20 rounded-[30px] bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6 text-3xl font-black">
                       {staffList.find(s => s.id === pendingAssignment.staffId)?.initials}
                    </div>
                    <h3 className="text-2xl font-serif font-black mb-2">Assign Role</h3>
                    <p className="text-sm text-outline font-medium tracking-tight">Select which role {staffList.find(s => s.id === pendingAssignment.staffId)?.name} will perform.</p>
                 </header>

                 <div className="space-y-3">
                    {staffList.find(s => s.id === pendingAssignment.staffId)?.roles.map(role => (
                      <button 
                        key={role}
                        onClick={() => {
                          addAssignment(pendingAssignment.dateStr, pendingAssignment.staffId, role);
                          setShowRoleModal(false);
                          setPendingAssignment(null);
                        }}
                        className={`w-full p-6 rounded-[32px] text-xs font-black uppercase tracking-[0.2em] transition-all border-2 text-center ${getRoleColor(role)} hover:scale-[1.02] active:scale-95`}
                      >
                        {role}
                      </button>
                    ))}
                 </div>

                 <button onClick={() => setShowRoleModal(false)} className="mt-8 w-full text-[10px] font-black uppercase tracking-widest text-outline py-4 hover:text-on-surface">Cancel</button>
              </motion.div>
           </div>
         )}
      </AnimatePresence>

      {/* Assignment Editor Modal */}
      <AnimatePresence>
        {editingAssignment && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setEditingAssignment(null)}
               className="absolute inset-0 bg-black/60 backdrop-blur-xl"
            />
            <motion.div 
               initial={{ scale: 0.9, opacity: 0, y: 30 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 30 }}
               className="relative w-full max-w-sm bg-white rounded-[40px] shadow-2xl p-10 overflow-hidden border border-white/20"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-2xl font-serif font-black tracking-tight mb-2">Edit Colors</h3>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-outline bg-surface-container w-fit px-3 py-1 rounded-full">{editingAssignment.dateStr}</p>
                </div>
                <button onClick={() => setEditingAssignment(null)} className="h-12 w-12 rounded-2xl bg-surface-container hover:bg-black hover:text-white flex items-center justify-center transition-all group">
                  <span className="material-symbols-outlined text-[20px] transition-transform group-hover:rotate-90">close</span>
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.3em] text-on-surface-variant mb-6 block text-center">Select Label Color</label>
                  <div className="flex flex-wrap justify-center gap-4">
                    {['#000000', '#2D5BFF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'].map(color => (
                      <button 
                        key={color}
                        onClick={() => {
                          setAssignments(prev => {
                            const dayAssignments = prev[editingAssignment.dateStr] || [];
                            return {
                              ...prev,
                              [editingAssignment.dateStr]: dayAssignments.map(a => 
                                a.id === editingAssignment.assignment.id ? { ...a, color } : a
                              )
                            };
                          });
                          setEditingAssignment(null);
                        }}
                        className={`w-14 h-14 rounded-full transition-all hover:scale-110 flex items-center justify-center border-4 border-white shadow-[0_8px_16px_rgba(0,0,0,0.1)] active:scale-95`}
                        style={{ backgroundColor: color }}
                      >
                        {editingAssignment.assignment.color === color && <span className="material-symbols-outlined text-white text-[24px] drop-shadow-md">check</span>}
                      </button>
                    ))}
                    <button 
                      onClick={() => {
                        setAssignments(prev => {
                          const dayAssignments = prev[editingAssignment.dateStr] || [];
                          return {
                            ...prev,
                            [editingAssignment.dateStr]: dayAssignments.map(a => 
                              a.id === editingAssignment.assignment.id ? { ...a, color: undefined } : a
                            )
                          };
                        });
                        setEditingAssignment(null);
                      }}
                      className={`w-14 h-14 rounded-full flex flex-col items-center justify-center bg-surface-container text-[8px] font-black uppercase border-4 border-white shadow-[0_8px_16px_rgba(0,0,0,0.1)] hover:scale-110 active:scale-95 transition-all outline-dashed outline-1 outline-offset-2 outline-outline-variant/50`}
                    >
                      <span className="material-symbols-outlined text-[16px] mb-0.5">format_color_reset</span>
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Role Settings Modal */}
      <AnimatePresence>
        {showRoleSettings && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowRoleSettings(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-[48px] p-10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <header className="mb-8">
                <h3 className="text-2xl font-serif font-black mb-2 px-2">Manage Service Roles</h3>
                <p className="text-xs text-outline font-medium px-2">Add or remove roles for your church roster.</p>
              </header>

              <div className="flex-1 overflow-y-auto px-2 space-y-3 mb-8">
                {editingRoleList.map(role => (
                  <div key={role} className="flex items-center justify-between p-4 rounded-2xl bg-surface-container-low border border-outline-variant/5">
                    <span className="text-xs font-black uppercase tracking-widest">{tValue(role, language)}</span>
                    <button 
                      onClick={() => setEditingRoleList(prev => prev.filter(r => r !== role))}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-error hover:text-white transition-all text-outline/20"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-2 space-y-4">
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={newCustomRole}
                    onChange={(e) => setNewCustomRole(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCustomRole.trim()) {
                        setEditingRoleList(prev => [...prev, newCustomRole.trim()]);
                        setNewCustomRole('');
                      }
                    }}
                    placeholder={tr('e.g. Guitarist, Bassist...', language)}
                    className="flex-1 bg-surface-container rounded-2xl px-6 py-4 text-xs font-bold focus:ring-2 ring-primary/20 border-none uppercase tracking-widest"
                  />
                  <button 
                    onClick={() => {
                      if (newCustomRole.trim()) {
                        setEditingRoleList(prev => [...prev, newCustomRole.trim()]);
                        setNewCustomRole('');
                      }
                    }}
                    className="px-6 rounded-2xl bg-on-surface text-white hover:bg-primary transition-all flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined">add</span>
                  </button>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setShowRoleSettings(false)} className="flex-1 py-5 rounded-[24px] text-[10px] font-black uppercase tracking-widest text-outline border border-outline-variant/20 hover:bg-white transition-all">Cancel</button>
                  <button 
                    disabled={isLoading}
                    onClick={saveChurchRoles} 
                    className="flex-[2] py-5 rounded-[24px] bg-primary text-white text-[10px] font-black uppercase tracking-widest shadow-xl hover:scale-105 transition-all disabled:opacity-50"
                  >
                    {isLoading ? '...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
