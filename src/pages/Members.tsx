import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMode } from '../contexts/ModeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { memberService, Member, MemberLink as DBLink } from '../services/memberService';
import { getActiveChurchId } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { logActivity } from '../services/activityService';
import { tValue, MINISTRY_SKILLS } from '../lib/valueLabels';
import { tr } from '../lib/uiText';
import * as d3 from 'd3';

type MemberNode = d3.SimulationNodeDatum & Member;

type MemberLink = d3.SimulationLinkDatum<MemberNode> & {
  id: string;
  source: string | MemberNode;
  target: string | MemberNode;
  type: string;
};

const ROLE_COLORS = {
  'Pastor': '#8B7E74',
  'Leader': '#C7BCA1',
  'Member': '#2D5BFF',
  'New Friend': '#10B981'
};

// Palette used only when creating a brand-new group from this page.
const GROUP_PALETTE = ['#2563EB', '#7C3AED', '#059669', '#DC2626', '#D97706', '#0891B2', '#DB2777', '#374151'];
const NO_GROUP_COLOR = '#9CA3AF';

const SKILLS_LIST = MINISTRY_SKILLS;

const INDUSTRIES = [
  'industryEducation',
  'industryHealthcare',
  'industryIT',
  'industryFinance',
  'industryBusiness',
  'industryGov',
  'industryArts',
  'industryConstruction',
  'industryRetired',
  'industryHospitality',
  'industryLooking'
];

export default function Members() {
  const { mode } = useMode();
  const { t, isZh, language } = useLanguage();
  const { church, profile } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church) || profile?.church_id || null;
  const [nodes, setNodes] = useState<MemberNode[]>([]);
  const [links, setLinks] = useState<MemberLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<MemberNode | null>(null);
  const [phoneCopied, setPhoneCopied] = useState(false);
  // Real groups + memberships, shared with the 小组 (Groups) page.
  const [churchGroups, setChurchGroups] = useState<{ id: string; name: string; color: string }[]>([]);
  const [memberships, setMemberships] = useState<{ profile_id: string; group_id: string }[]>([]);
  const [profilesList, setProfilesList] = useState<{ id: string; full_name: string }[]>([]);

  // Resolve a group name → its real color (from the 小组 page).
  const colorForGroup = (name?: string) => churchGroups.find(g => g.name === name)?.color || NO_GROUP_COLOR;

  useEffect(() => {
    const fetchData = async () => {
      if (!activeChurchId) return;
      setLoading(true);
      try {
        const [dbMembers, dbLinks, profilesResult, groupsResult, membershipsResult] = await Promise.all([
          memberService.getMembers(activeChurchId),
          memberService.getMemberLinks(activeChurchId),
          // NOTE: only columns that exist on `profiles` (no occupation/family there).
          supabase.from('profiles').select('id, full_name, role, skills, phone, email, dob, age, avatar_url').eq('church_id', activeChurchId),
          supabase.from('church_groups').select('id, name, color').eq('church_id', activeChurchId),
          supabase.from('church_group_members').select('profile_id, group_id').eq('church_id', activeChurchId),
        ]);

        // Real groups (source of truth = 小组 page)
        const groupsData: any[] = (groupsResult as any)?.data || [];
        const membershipsData: any[] = (membershipsResult as any)?.data || [];
        const profilesData: any[] = ((profilesResult as any)?.data || []).filter((p: any) => p.role && p.role !== 'Pending');
        setChurchGroups(groupsData);
        setMemberships(membershipsData);
        setProfilesList(profilesData.map((p: any) => ({ id: p.id, full_name: p.full_name })));

        // profile id → its group name (via the shared 小组 membership table)
        const groupNameForProfile = (pid: string) => {
          const mem = membershipsData.find((m: any) => m.profile_id === pid);
          return groupsData.find((g: any) => g.id === mem?.group_id)?.name || '';
        };

        // 1) One node per profile (stable id → can sync to church_group_members)
        const profileNodes = profilesData.map((p: any) => {
          const matched = (dbMembers || []).find((m: any) =>
            m.name?.toLowerCase() === p.full_name?.toLowerCase()
          );
          return {
            id: p.id,
            isProfile: true,
            churchMemberId: matched?.id || null,
            avatar_url: p.avatar_url || (matched as any)?.avatar_url || '',
            name: p.full_name || p.id,
            initials: (p.full_name || '?').charAt(0).toUpperCase(),
            role: matched ? matched.role : [p.role],
            skills: (p.skills && p.skills.length > 0) ? p.skills : (matched?.skills || []),
            status: matched?.status || p.role,
            joined: matched?.joined || '',
            family: groupNameForProfile(p.id), // real membership only → in sync with 小组
            age: p.age ?? matched?.age,
            phone: p.phone || matched?.phone || '',
            email: p.email || matched?.email || '',
            occupation: matched?.occupation || '',
            jobTitle: matched?.jobTitle || '',
            dob: p.dob || matched?.dob || '',
            x: (matched as any)?.x,
            y: (matched as any)?.y,
          };
        });

        // 2) Manually-added church_members that have no login profile (keep them visible)
        const profileNames = new Set(profilesData.map((p: any) => p.full_name?.toLowerCase()));
        const cmOnlyNodes = (dbMembers || [])
          .filter((m: any) => !m.id?.startsWith('local_') && !profileNames.has(m.name?.toLowerCase()))
          .map((m: any) => ({ ...m, isProfile: false, churchMemberId: m.id, avatar_url: m.avatar_url || '', family: m.family || '' }));

        const resolvedNodes = [...profileNodes, ...cmOnlyNodes];

        setNodes(resolvedNodes as any);
        setLinks(dbLinks.map(l => ({
          id: l.id,
          source: l.source_id,
          target: l.target_id,
          type: l.type,
        })) as any);
      } catch (error) {
        console.error('Error fetching members:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeChurchId]);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close profile panel on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setSelectedNode(null);
      }
    }
    if (selectedNode) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedNode]);
  const [viewMode, setViewMode] = useState<'Graph' | 'List'>('Graph');
  const [searchQuery, setSearchQuery] = useState('');
  const [occupationFilter, setOccupationFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberNode | null>(null);
  const [referralSearch, setReferralSearch] = useState('');
  const [showReferralDropdown, setShowReferralDropdown] = useState(false);
  const referralRef = useRef<HTMLDivElement>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [showGraphInstructions, setShowGraphInstructions] = useState(true);
  const [droppedLinkCount, setDroppedLinkCount] = useState(0);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (referralRef.current && !referralRef.current.contains(event.target as Node)) {
        setShowReferralDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filters
  const filteredNodeIds = useMemo(() => {
    return new Set(nodes.filter(node => {
      const roleArr = Array.isArray(node.role) ? node.role : [node.role].filter(Boolean);
      const matchesSearch = node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          roleArr.some((r: string) => r.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          node.skills?.some((s: string) => s.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesOccupation = occupationFilter ? node.occupation === occupationFilter : true;
      const matchesGroup = groupFilter ? node.family === groupFilter : true;
      const matchesSkill = skillFilter ? node.skills?.includes(skillFilter) : true;
      return matchesSearch && matchesOccupation && matchesGroup && matchesSkill;
    }).map(n => n.id));
  }, [nodes, searchQuery, occupationFilter, groupFilter, skillFilter]);

  // D3 Visualization logic
  useEffect(() => {
    if (!svgRef.current || viewMode !== 'Graph') return;

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Resolve a stored link endpoint to the current node id.
    // A member can move from a church_members id → profile UUID; alias the old id so the
    // arrow survives instead of being treated as "dropped".
    const nodeIdSet = new Set(nodes.map(n => n.id));
    const aliasMap = new Map<string, string>();
    nodes.forEach((n: any) => {
      if (n.churchMemberId && n.id) aliasMap.set(n.churchMemberId, n.id);
    });
    // D3 mutates link.source/.target from an id string into the actual node object.
    // Always pull the raw id back out first, THEN alias old church_member ids → profile ids.
    const rawId = (v: any) => (typeof v === 'object' && v !== null) ? v.id : v;
    const resolveId = (v: any) => { const id = rawId(v); return nodeIdSet.has(id) ? id : (aliasMap.get(id) || id); };

    // Re-point each link to current node ids, then keep only the ones whose both ends exist.
    const remapped = links.map(l => ({ ...l, source: resolveId(l.source), target: resolveId(l.target) }));
    const validLinks = remapped.filter(l => nodeIdSet.has(l.source as string) && nodeIdSet.has(l.target as string));
    const droppedCount = remapped.length - validLinks.length;
    // NOTE: we DO NOT delete links from the DB here. A link may look "dropped" only because the
    // other person is temporarily filtered out (Pending, search, etc.). Deleting was destroying
    // relationships permanently — instead we just skip rendering them this pass.
    setDroppedLinkCount(droppedCount);

    const simulation = d3.forceSimulation<MemberNode>(nodes)
      .force("link", d3.forceLink<MemberNode, MemberLink>(validLinks).id(d => d.id).distance(170))
      .force("charge", d3.forceManyBody().strength(-700))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.2))
      .force("collision", d3.forceCollide().radius(85))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(validLinks)
      .enter().append("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0.85)
      .attr("marker-end", "url(#arrowhead)")
      // Relationships (lines) are visible to Managers only
      .style("display", mode === 'Manager' ? null : "none");

    const nodeState = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter().append("g")
      .attr("class", "node-group")
      .style("cursor", "pointer")
      .on("click", (_event, d: MemberNode) => {
        setSelectedNode(d);
      })
      .call(d3.drag<SVGGElement, MemberNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    nodeState.append("rect")
      .attr("width", 80)
      .attr("height", 80)
      .attr("x", -40)
      .attr("y", -40)
      .attr("rx", 20)
      .attr("fill", "#ffffff")
      .attr("stroke", (d: MemberNode) => colorForGroup(d.family))
      .attr("stroke-width", 2.5)
      .attr("class", "node-bg shadow-sm");

    nodeState.append("text")
      .text((d: MemberNode) => d.initials)
      .attr("text-anchor", "middle")
      .attr("dy", ".35em")
      .attr("font-size", "18px")
      .attr("font-weight", "black")
      .attr("fill", (d: MemberNode) => colorForGroup(d.family));

    // Avatar photo (covers the initials when the member has uploaded one) — clipped to a circle
    const avatarDefs = svg.append("defs");
    avatarDefs.append("clipPath")
      .attr("id", "avatarClip")
      .attr("clipPathUnits", "objectBoundingBox")
      .append("circle").attr("cx", 0.5).attr("cy", 0.5).attr("r", 0.5);
    nodeState.filter((d: any) => !!d.avatar_url)
      .append("image")
      .attr("href", (d: any) => d.avatar_url)
      .attr("x", -38).attr("y", -38)
      .attr("width", 76).attr("height", 76)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("clip-path", "url(#avatarClip)")
      .attr("pointer-events", "none");

    nodeState.append("text")
      .text((d: MemberNode) => d.name)
      .attr("text-anchor", "middle")
      .attr("dy", "58")
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("class", "node-label")
      .attr("fill", "#111827");

    nodeState.append("text")
      .text((d: MemberNode) => tValue(d.status, language))
      .attr("text-anchor", "middle")
      .attr("dy", "74")
      .attr("font-size", "9px")
      .attr("font-weight", "black")
      .attr("letter-spacing", "0.1em")
      .attr("fill", (d: MemberNode) => colorForGroup(d.family))
      .attr("class", "uppercase opacity-70");

    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 35)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#94a3b8");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeState
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      
      nodeState.style("opacity", (d: any) => filteredNodeIds.has(d.id) ? 1 : 0.1)
          .style("filter", (d: any) => filteredNodeIds.has(d.id) ? "none" : "grayscale(1) blur(1px)");
      link.style("opacity", (d: any) => filteredNodeIds.has(d.source.id) && filteredNodeIds.has(d.target.id) ? 0.6 : 0.05);

      nodeState.select(".node-bg")
          .attr("stroke-width", (d: any) => selectedNode?.id === d.id ? 4 : 2)
          .attr("fill", (d: any) => selectedNode?.id === d.id ? (colorForGroup(d.family) + '18') : "#ffffff");
    });

    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      // NOTE: dragging only repositions a node. We intentionally do NOT auto-create a
      // relationship when two nodes end up close — that produced lines nobody asked for.
      // Relationships are created only via the "经由哪位介绍 / referral" field when editing a member.
    }

    return () => {
      simulation.stop();
    };
  }, [nodes, links, viewMode, selectedNode, filteredNodeIds, mode, activeChurchId, churchGroups, isZh]);

  const allOccupations = Array.from(new Set(nodes.map(n => n.occupation).filter(Boolean)));
  const allGroups = Array.from(new Set(nodes.map(n => n.family).filter(Boolean)));
  
  const handleExport = () => {
    alert(t('exportSuccess'));
  };

  const [referrals, setReferrals] = useState<string[]>([]);
  const [skillsList, setSkillsList] = useState<string[]>(SKILLS_LIST);
  const [customGroupInput, setCustomGroupInput] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedFamilyGroup, setSelectedFamilyGroup] = useState('');
  // Group options come from the real 小组 groups (shared source of truth).
  const allGroupOptions = useMemo(() => churchGroups.map(g => g.name), [churchGroups]);

  // ── Create a brand-new group from here → also appears on the 小组 page ───────
  const handleCreateGroupInline = async () => {
    const name = customGroupInput.trim();
    if (!name || !activeChurchId) return;
    if (churchGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      setSelectedFamilyGroup(name);
      setCustomGroupInput('');
      return;
    }
    setCreatingGroup(true);
    const color = GROUP_PALETTE[churchGroups.length % GROUP_PALETTE.length];
    const { data, error } = await supabase
      .from('church_groups')
      .insert({ church_id: activeChurchId, name, description: '', color })
      .select().single();
    setCreatingGroup(false);
    if (!error && data) {
      setChurchGroups(prev => [...prev, { id: data.id, name: data.name, color: data.color }]);
      setSelectedFamilyGroup(name);
      setCustomGroupInput('');
    } else {
      console.warn('Create group failed:', error?.message);
    }
  };

  // ── Sync a member's group into the shared church_group_members table ─────────
  const syncMembership = async (profileId: string, groupName: string) => {
    if (!activeChurchId) return;
    const g = churchGroups.find(gg => gg.name === groupName);
    await supabase.from('church_group_members').delete().eq('profile_id', profileId).eq('church_id', activeChurchId);
    if (g) {
      await supabase.from('church_group_members').insert({ church_id: activeChurchId, group_id: g.id, profile_id: profileId });
      setMemberships(prev => [...prev.filter(m => m.profile_id !== profileId), { profile_id: profileId, group_id: g.id }]);
    } else {
      setMemberships(prev => prev.filter(m => m.profile_id !== profileId));
    }
  };

  useEffect(() => {
    if (church?.roster_roles && church.roster_roles.length > 0) {
      // Keep "Custom" (the + tile) last, after any custom roles like Piano.
      const base = SKILLS_LIST.filter(s => s !== 'Custom');
      const roles = church.roster_roles.filter((r: string) => r !== 'Custom');
      const merged = [...Array.from(new Set([...base, ...roles])), 'Custom'];
      setSkillsList(merged);
    }
  }, [church?.roster_roles]);

  // Reflect the edited member's current group when the add/edit modal opens.
  useEffect(() => {
    setSelectedFamilyGroup(editingMember?.family || '');
    setCustomGroupInput('');
  }, [editingMember?.id, isAddModalOpen]);

  const [newTagInput, setNewTagInput] = useState('');

  const handleAddMember = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    
    let newMemberId = editingMember ? editingMember.id : Date.now().toString();

    // Check for custom tags on submit
    const currentSkills = formData.getAll('skills') as string[];
    
    if (editingMember) {
      const updates: Partial<Member> = {
        name,
        initials: name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?',
        role: [formData.get('role') as string],
        occupation: formData.get('occupation') as string,
        jobTitle: formData.get('jobTitle') as string,
        family: formData.get('family') as string,
        status: formData.get('status') as any || 'Member',
        age: Number(formData.get('age')),
        dob: formData.get('dob') as string,
        referral_source: referrals.join(', '),
        friends_with: referrals.map(name => nodes.find(n => n.name === name)?.id).filter(Boolean) as string[],
        skills: currentSkills,
        email: formData.get('email') as string,
        phone: formData.get('phone') as string,
      };

      const isProfileNode = (editingMember as any).isProfile;

      // Save skills/contact to profiles (ONLY columns that exist there) — profile members only
      if (isProfileNode) {
        supabase.from('profiles').update({
          skills: updates.skills || [],
          phone: updates.phone,
          email: updates.email,
        }).eq('id', editingMember.id).then(({ error }) => {
          if (error) console.warn('profiles update error:', error.message);
        });
      }

      // Sync group membership into the shared 小组 table.
      // Resolve the person's profile id (profile node → its id; otherwise match by name).
      const targetProfileId = isProfileNode
        ? editingMember.id
        : profilesList.find(p => p.full_name?.toLowerCase() === editingMember.name?.toLowerCase())?.id;
      if (targetProfileId) syncMembership(targetProfileId, updates.family || '');

      // Update the church_members row (skills/contact/family) if one exists — no addMember (avoids duplicates)
      const existingCMId = (editingMember as any).churchMemberId;
      if (existingCMId) {
        memberService.updateMember(existingCMId, updates).catch(err => console.warn('church_members update error:', err));
      }
      // Always update UI immediately
      setNodes(prev => prev.map(n => n.id === editingMember.id ? { ...n, ...updates } : n));

      // Create relationship links from "认识谁" referrals so they show as lines on the graph
      referrals.forEach(async (refName) => {
        const refNode = nodes.find(n => n.name === refName && n.id !== editingMember.id);
        if (!refNode || !activeChurchId) return;
        const exists = links.some(l => {
          const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
          const tg = typeof l.target === 'object' ? (l.target as any).id : l.target;
          return (s === editingMember.id && tg === refNode.id) || (s === refNode.id && tg === editingMember.id);
        });
        if (exists) return;
        try {
          const saved = await memberService.upsertMemberLink({ church_id: activeChurchId, source_id: editingMember.id, target_id: refNode.id, type: 'Friend' });
          setLinks(prev => [...prev, { id: saved.id, source: saved.source_id, target: saved.target_id, type: saved.type } as any]);
        } catch (err) { console.warn('link create error:', err); }
      });

      logActivity({ churchId: activeChurchId, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: 'Updated member profile', target: name, type: 'Member' });
      setEditingMember(null);
    } else {
      const newMember: Omit<Member, 'id'> = {
        church_id: activeChurchId,
        name,
        initials: name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?',
        role: [formData.get('role') as string],
        occupation: formData.get('occupation') as string,
        jobTitle: formData.get('jobTitle') as string,
        family: formData.get('family') as string,
        joined: new Date().getFullYear().toString(),
        status: formData.get('status') as any || 'Member',
        age: Number(formData.get('age')),
        dob: formData.get('dob') as string,
        referral_source: referrals.join(', '),
        friends_with: referrals.map(name => nodes.find(n => n.name === name)?.id).filter(Boolean) as string[],
        skills: currentSkills,
        email: formData.get('email') as string,
        phone: formData.get('phone') as string,
      };
      
      memberService.addMember(newMember).then(added => {
        setNodes(prev => [...prev, { ...added, x: (containerRef.current?.clientWidth || 800) / 2, y: (containerRef.current?.clientHeight || 600) / 2 }]);
        logActivity({ churchId: activeChurchId, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: 'Added new member', target: name, type: 'Member' });
        
        // Sync links for referrals
        referrals.forEach(async (refName) => {
          const refNode = nodes.find(n => n.name === refName);
          if (refNode) {
            const link = await memberService.upsertMemberLink({
               church_id: activeChurchId,
               source_id: refNode.id,
               target_id: added.id,
               type: 'Invited'
            });
            setLinks(prev => [...prev, { id: link.id, source: link.source_id, target: link.target_id, type: link.type } as any]);
          }
        });
      });
    }

    setIsAddModalOpen(false);
  };

  return (
    <div className="flex w-full flex-col bg-surface min-h-full">
      {/* Header */}
      <div className="p-6 md:p-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-outline-variant/10 bg-surface">
        <div>
          <h2 className="mb-2 font-headline-md text-on-surface">{t('memberNetwork')}</h2>
          <p className="font-label-sm text-sm text-on-surface-variant uppercase tracking-widest opacity-70">{t('memberNetworkDesc')}</p>
        </div>
        
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">search</span>
            <input 
              type="text"
              placeholder={t('searchMembers')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full md:w-64 rounded-xl border border-outline-variant bg-surface py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all font-medium"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex rounded-xl border border-outline-variant p-1 bg-surface-container-lowest shadow-sm">
              <button 
                onClick={() => setViewMode('Graph')}
                className={`flex items-center justify-center w-10 h-9 rounded-lg transition-all ${viewMode === 'Graph' ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-primary/5'}`}
              >
                <span className="material-symbols-outlined text-[20px]">hub</span>
              </button>
              <button 
                onClick={() => setViewMode('List')}
                className={`flex items-center justify-center w-10 h-9 rounded-lg transition-all ${viewMode === 'List' ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-primary/5'}`}
              >
                <span className="material-symbols-outlined text-[20px]">list</span>
              </button>
            </div>

            {mode === 'Manager' && (
               <button
                onClick={() => {
                  setEditingMember(null);
                  setReferrals([]);
                  setIsAddModalOpen(true);
                }}
                className="flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-xl hover:bg-primary transition-all"
               >
                 <span className="material-symbols-outlined text-[18px]">person_add</span>
                 {t('addMember')}
               </button>
            )}

            {mode === 'Manager' && (
              <button 
                onClick={handleExport}
                className="flex items-center gap-2 rounded-xl bg-surface-container border border-outline-variant px-4 py-2 text-[10px] font-black uppercase tracking-widest text-on-surface hover:bg-surface-container-high transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">ios_share</span>
                {t('exportNetwork')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <div className="flex-1 relative bg-surface overflow-hidden" ref={containerRef}>
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-widest text-outline animate-pulse">Loading members...</p>
              </div>
            ) : viewMode === 'Graph' ? (
              nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-5 pointer-events-none select-none">
                  <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center">
                    <span className="material-symbols-outlined text-5xl text-primary/30">hub</span>
                  </div>
                  <div className="text-center">
                    <p className="text-on-surface font-serif font-black text-xl mb-1">{t('memberNetwork') || '会友网络'}</p>
                    <p className="text-[11px] text-outline uppercase tracking-widest mb-6">还没有会友 · Add your first member</p>
                  </div>
                  {mode === 'Manager' && (
                    <button
                      onClick={() => { setEditingMember(null); setReferrals([]); setIsAddModalOpen(true); }}
                      className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-primary px-8 py-4 font-black text-[11px] uppercase tracking-widest text-white shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">person_add</span>
                      {t('addMember') || '添加会友'}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {droppedLinkCount > 0 && (
                    <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-2 px-4 py-2 bg-warning/10 border border-warning/30 rounded-xl text-xs font-bold text-warning">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      {droppedLinkCount} relationship link{droppedLinkCount > 1 ? 's' : ''} could not be displayed (member ID mismatch)
                    </div>
                  )}
                  <svg ref={svgRef} className="w-full h-full" />
                </>
              )
            ) : (
              <div className="p-6 md:p-8 space-y-6">
                {nodes.filter(n => filteredNodeIds.has(n.id)).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-[40px] border-2 border-dashed border-outline-variant/20">
                    <span className="material-symbols-outlined text-outline text-6xl mb-4">person_search</span>
                    <p className="text-outline font-black uppercase tracking-widest text-xs">No members found</p>
                    <p className="text-[10px] text-outline/60 mt-1">Try adjusting your filters or adding a new member.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-[40px] border border-outline-variant/10 overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-outline-variant/10 bg-surface-container-low/50">
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline">{t('member')}</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline hidden md:table-cell">{t('role')}</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline hidden lg:table-cell">{t('industry')}</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline hidden xl:table-cell">{t('phoneLabel')}</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline">{t('status')}</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-outline text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.filter(n => filteredNodeIds.has(n.id)).map(node => (
                          <tr 
                            key={node.id} 
                            onClick={() => setSelectedNode(node)}
                            className={`group cursor-pointer border-b border-outline-variant/5 transition-all ${selectedNode?.id === node.id ? 'bg-primary/5' : 'hover:bg-primary/5'}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black border" style={{ borderColor: colorForGroup(node.family), color: colorForGroup(node.family) }}>
                                  {node.initials}
                                </div>
                                <div>
                                  <p className="font-bold text-sm text-on-surface">{node.name}</p>
                                  <p className="text-[10px] text-outline font-medium">{node.email || 'No email'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 hidden md:table-cell">
                              <div className="flex flex-wrap gap-1">
                                {node.role.map(r => (
                                  <span key={r} className="px-2 py-0.5 rounded-lg bg-surface-container text-[8px] font-black uppercase tracking-tighter text-outline">{r}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 hidden lg:table-cell text-xs font-bold text-outline">
                              {t(node.occupation || '') || node.occupation}
                            </td>
                            <td className="px-6 py-4 hidden xl:table-cell text-xs font-bold text-outline">
                              {node.phone || '—'}
                            </td>
                            <td className="px-6 py-4">
                               <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border" style={{ borderColor: colorForGroup(node.family) + '60', color: colorForGroup(node.family), backgroundColor: colorForGroup(node.family) + '15' }}>
                                 {tValue(node.status, language)}
                               </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {mode === 'Manager' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(t('confirmDeleteMember') || 'Delete this member?')) {
                                      memberService.deleteMember(node.id).then(() => {
                                        setNodes(prev => prev.filter(n => n.id !== node.id));
                                      });
                                    }
                                  }}
                                  className="w-8 h-8 rounded-lg bg-error/10 text-error hover:bg-error hover:text-white transition-all inline-flex items-center justify-center opacity-0 group-hover:opacity-100"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

        </div>

      <AnimatePresence>
        {selectedNode && (
          <motion.div 
            ref={popoverRef}
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-24 right-6 bottom-6 w-80 bg-white/70 backdrop-blur-2xl rounded-[40px] shadow-[0_20px_80px_rgba(0,0,0,0.15)] border border-white/40 overflow-hidden z-[100] flex flex-col"
          >
            <div className="flex-1 overflow-y-auto no-scrollbar p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="w-16 h-16 rounded-3xl p-1 bg-white shadow-lg ring-4 ring-primary/[0.03]">
                  <div className="w-full h-full rounded-2xl border-4 flex items-center justify-center text-xl font-serif font-black" style={{ borderColor: colorForGroup(selectedNode.family), color: colorForGroup(selectedNode.family) }}>
                    {selectedNode.initials}
                  </div>
                </div>
                <button onClick={() => setSelectedNode(null)} className="h-10 w-10 rounded-xl bg-white/50 hover:bg-black hover:text-white transition-all flex items-center justify-center group shadow-sm border border-white/20">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="mb-6">
                <h2 className="text-2xl font-bold text-on-surface tracking-tight leading-tight">{selectedNode.name}</h2>
                {mode !== 'Member' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-black text-outline uppercase tracking-widest">{t(selectedNode.occupation || '')}</span>
                    <div className="h-1 w-1 rounded-full bg-outline opacity-20"></div>
                    <span className="text-[10px] font-black text-primary uppercase tracking-widest">{tValue(selectedNode.status, language)}</span>
                  </div>
                )}
              </div>

              {/* Details — Staff & Manager only (Members see names only) */}
              {mode === 'Member' && (
                <p className="text-xs text-outline/60 italic mb-4">{isZh ? '仅同工/管理员可查看详情' : 'Details visible to staff & managers only'}</p>
              )}
              {mode !== 'Member' && (<>
              <div className="p-4 rounded-2xl mb-3 border border-white/20 shadow-sm" style={{ backgroundColor: colorForGroup(selectedNode.family) + '12' }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[8px] font-black text-outline uppercase tracking-widest">{tr('Role', language)}</p>
                  {selectedNode.family && (
                    <span className="px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider text-white" style={{ backgroundColor: colorForGroup(selectedNode.family) }}>
                      {selectedNode.family}
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold" style={{ color: colorForGroup(selectedNode.family) }}>{tValue(selectedNode.status, language) || '—'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-4 rounded-2xl bg-white/40 border border-white/20 shadow-sm">
                  <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-1">{t('age')}</p>
                  <p className="text-sm font-bold text-on-surface">{selectedNode.age || '—'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white/40 border border-white/20 shadow-sm">
                  <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-1">{tr('Group', language)}</p>
                  <p className="text-sm font-bold text-on-surface truncate">{selectedNode.family || '—'}</p>
                </div>
              </div>

              {/* Birthday (staff/manager view) */}
              {selectedNode.dob && mode !== 'Member' && (
                <div className="p-4 rounded-2xl bg-pink-50/60 border border-pink-100 shadow-sm mb-4 flex items-center gap-3">
                  <span className="material-symbols-outlined text-pink-500 text-[20px]">cake</span>
                  <div>
                    <p className="text-[8px] font-black text-outline uppercase tracking-widest">{isZh ? '生日' : 'Birthday'}</p>
                    <p className="text-sm font-bold text-on-surface">{selectedNode.dob}</p>
                  </div>
                </div>
              )}

              {selectedNode.jobTitle && (
                <div className="p-4 rounded-2xl bg-white/40 border border-white/20 shadow-sm mb-4">
                  <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-1">{tr('Job Title', language)}</p>
                  <p className="text-sm font-bold text-on-surface">{selectedNode.jobTitle}</p>
                </div>
              )}

              <div className="mb-6 p-4 rounded-2xl bg-primary/5 border border-primary/10">
                  <p className="text-[8px] font-black text-primary/60 uppercase tracking-widest mb-3">{tr('Skills & Ministry', language)}</p>
                  {selectedNode.skills && selectedNode.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedNode.skills.map(skill => (
                      <span key={skill} className="px-3 py-1.5 rounded-xl bg-primary text-white text-[9px] font-black uppercase tracking-wide shadow-sm">
                        {tValue(skill, language)}
                      </span>
                    ))}
                  </div>
                  ) : (
                    <p className="text-xs text-outline/50 italic">{tr('No skills added yet', language)}</p>
                  )}
                </div>

              {/* Phone — shows the number; click to copy */}
              <button
                type="button"
                onClick={() => { if (selectedNode.phone) { navigator.clipboard?.writeText(selectedNode.phone); setPhoneCopied(true); setTimeout(() => setPhoneCopied(false), 1500); } }}
                className={`w-full mb-3 mt-2 px-4 py-3 rounded-2xl flex items-center justify-between gap-2 transition-all border border-primary/20 hover:bg-primary/10 ${!selectedNode.phone ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <div className="flex flex-col items-start">
                  <span className="text-[8px] font-black uppercase tracking-widest text-outline">{isZh ? '电话' : 'Phone'}</span>
                  <span className="text-sm font-bold text-on-surface">{selectedNode.phone || '—'}</span>
                </div>
                <span className="flex items-center gap-1 text-[9px] font-black uppercase text-primary">
                  <span className="material-symbols-outlined text-primary text-[18px]">{phoneCopied ? 'check' : 'content_copy'}</span>
                  {phoneCopied ? tr('Copied', language) : tr('Copy', language)}
                </span>
              </button>
              <div className="flex gap-2 mb-8">
                <a
                  href={`mailto:${selectedNode.email}`}
                  className={`flex-1 py-4 rounded-2xl flex items-center justify-center gap-2 transition-all border border-blue-200 hover:bg-blue-50 ${!selectedNode.email ? 'opacity-30 pointer-events-none' : ''}`}
                >
                  <span className="material-symbols-outlined text-blue-600 text-xl">alternate_email</span>
                  <span className="text-[10px] font-black uppercase text-blue-600">{tr('Email', language)}</span>
                </a>
              </div>
              </>)}

              {mode === 'Manager' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingMember(selectedNode);
                      setReferrals(selectedNode.friends_with?.map(id => nodes.find(n => n.id === id)?.name || id) || selectedNode.referral_source?.split(',').map((s: string)=>s.trim()).filter(Boolean) || []);
                      setIsAddModalOpen(true);
                    }}
                    className="flex-[2] py-4 rounded-2xl bg-black text-white text-[10px] font-black uppercase tracking-[0.2em] hover:bg-primary transition-all shadow-xl shadow-black/10 active:scale-95"
                  >
                    Quick Edit
                  </button>
                  <button 
                    onClick={async () => {
                      if (window.confirm('Delete this member from network?')) {
                        const deletedName = selectedNode.name;
                        await memberService.deleteMember(selectedNode.id);
                        setNodes(prev => prev.filter(n => n.id !== selectedNode.id));
                        setSelectedNode(null);
                        logActivity({ churchId: activeChurchId, userId: profile?.id, userName: profile?.full_name || 'Manager', userRole: profile?.role || 'Manager', action: 'Removed member', target: deletedName, type: 'Member' });
                      }
                    }}
                    className="flex-1 py-4 rounded-2xl bg-error/10 text-error hover:bg-error hover:text-white transition-all flex items-center justify-center shadow-inner"
                  >
                    <span className="material-symbols-outlined text-xl">delete</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      </div>

      {/* Add Member Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsAddModalOpen(false)}
               className="absolute inset-0 bg-black/60 backdrop-blur-xl"
            />
            <motion.div 
               initial={{ scale: 0.9, opacity: 0, y: 30 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 30 }}
               className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-[48px] shadow-2xl p-8 md:px-16 md:py-16 overflow-y-auto border border-white/20"
            >
               <div className="flex items-center justify-between mb-12">
                  <div>
                    <h2 key={editingMember?.id || 'new'} className="text-4xl font-serif font-black text-on-surface mb-2">{editingMember ? 'Edit Profile' : t('addMember')}</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Community Growth & Registration</p>
                  </div>
                  <button onClick={() => { setIsAddModalOpen(false); setEditingMember(null); }} className="w-14 h-14 rounded-2xl bg-surface-container hover:bg-black hover:text-white transition-all flex items-center justify-center group">
                     <span className="material-symbols-outlined text-3xl group-hover:rotate-90 transition-transform">close</span>
                  </button>
               </div>

               <form key={editingMember?.id || 'new'} onSubmit={handleAddMember} className="space-y-16">
                  {/* Personal Info */}
                  <section>
                    <div className="flex items-center gap-6 mb-10">
                       <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary shrink-0">{t('personalInfo')}</span>
                       <div className="h-px flex-1 bg-gradient-to-r from-primary/20 to-transparent"></div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('fullName')} *</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">person</span>
                          <input name="name" required defaultValue={editingMember?.name} placeholder="e.g. John Doe" className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('industry')}</label>
                        <div className="relative group/select">
                          <select name="occupation" defaultValue={editingMember?.occupation || 'industryEducation'} className="w-full bg-surface-container-low border-2 border-transparent px-8 py-5 rounded-[32px] focus:border-primary focus:bg-white outline-none font-bold text-sm md:text-base transition-all appearance-none cursor-pointer hover:bg-surface-container shadow-inner">
                             {INDUSTRIES.map(occKey => (
                               <option key={occKey} value={occKey}>{t(occKey)}</option>
                             ))}
                          </select>
                          <span className="material-symbols-outlined absolute right-6 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none group-focus-within/select:rotate-180 transition-transform">expand_more</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{tr('Job Title', language)}</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">work</span>
                          <input name="jobTitle" defaultValue={editingMember?.jobTitle} placeholder={tr('e.g. Software Engineer', language)} className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('phoneLabel')}</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">call</span>
                          <input name="phone" defaultValue={editingMember?.phone} placeholder="+61 ..." className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('email')}</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">alternate_email</span>
                          <input name="email" defaultValue={editingMember?.email} type="email" placeholder="email@example.com" className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('age')}</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">cake</span>
                          <input name="age" defaultValue={editingMember?.age} type="number" placeholder="25" className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline ml-4">{t('dobLabel')}</label>
                        <div className="relative group/input">
                          <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within/input:text-primary transition-colors">calendar_today</span>
                          <input name="dob" defaultValue={editingMember?.dob} type="date" className="w-full bg-surface-container-low border-2 border-transparent pl-14 pr-8 py-5 rounded-3xl focus:border-primary focus:bg-white outline-none font-bold transition-all shadow-inner hover:bg-surface-container px-4" />
                        </div>
                      </div>
                    </div>
                  </section>


                  {/* Church Context */}
                  <section>
                    <div className="flex items-center gap-6 mb-10">
                       <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary shrink-0">{t('churchInfo')}</span>
                       <div className="h-px flex-1 bg-gradient-to-r from-primary/20 to-transparent"></div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-outline ml-4">
                          {tr('Spiritual Family / Group', language)}
                        </label>
                        {/* Hidden input carries the actual value */}
                        <input type="hidden" name="family" value={selectedFamilyGroup} />
                        <div className="flex flex-wrap gap-2 mb-2">
                          {/* "No group" option */}
                          <button
                            type="button"
                            onClick={() => setSelectedFamilyGroup('')}
                            className="px-4 py-2 rounded-2xl text-sm font-bold border-2 transition-all"
                            style={{
                              borderColor: NO_GROUP_COLOR,
                              color: selectedFamilyGroup === '' ? '#fff' : NO_GROUP_COLOR,
                              backgroundColor: selectedFamilyGroup === '' ? NO_GROUP_COLOR : NO_GROUP_COLOR + '15',
                            }}
                          >
                            {tr('No group', language)}
                          </button>
                          {allGroupOptions.map(g => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setSelectedFamilyGroup(g)}
                              className="px-4 py-2 rounded-2xl text-sm font-bold border-2 transition-all"
                              style={{
                                borderColor: colorForGroup(g),
                                color: selectedFamilyGroup === g ? '#fff' : colorForGroup(g),
                                backgroundColor: selectedFamilyGroup === g ? colorForGroup(g) : colorForGroup(g) + '15',
                              }}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                        {/* Create a new group (also appears on the 小组 page) */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder={tr('New group name...', language)}
                            value={customGroupInput}
                            onChange={e => setCustomGroupInput(e.target.value)}
                            className="flex-1 bg-surface-container-low border-2 border-transparent px-5 py-3 rounded-2xl focus:border-primary outline-none text-sm font-bold transition-all"
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); handleCreateGroupInline(); }
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleCreateGroupInline}
                            disabled={creatingGroup || !customGroupInput.trim()}
                            className="px-4 py-3 rounded-2xl bg-primary text-white text-sm font-bold hover:bg-primary/80 transition-all disabled:opacity-40"
                          >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                          </button>
                        </div>
                        <p className="text-[9px] text-outline/60 ml-2">{tr('New groups sync to the Groups page', language)}</p>
                      </div>
                      <div className="space-y-4">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-outline ml-4">{tr('Membership Status', language)}</label>
                        <div className="relative group/select">
                          <select name="status" defaultValue={editingMember?.status || "Member"} className="w-full bg-surface-container-low border-2 border-transparent px-8 py-5 rounded-[32px] focus:border-primary focus:bg-white outline-none font-bold text-lg transition-all appearance-none cursor-pointer hover:bg-surface-container shadow-inner">
                             <option value="Member">{tValue('Member', language)}</option>
                             <option value="Leader">{tValue('Leader', language)}</option>
                             <option value="Pastor">{tValue('Pastor', language)}</option>
                             <option value="New Friend">{tValue('New Friend', language)}</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-6 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none group-focus-within/select:rotate-180 transition-transform">expand_more</span>
                        </div>
                      </div>
                      
                      <div className="space-y-4 md:col-span-2 relative">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-outline ml-4">{t('referralSource')}</label>
                        <div className="relative group/referral flex flex-col gap-2 bg-surface-container-low border-2 border-transparent px-6 py-5 rounded-[32px] focus-within:border-primary focus-within:bg-white transition-all shadow-inner hover:bg-surface-container" ref={referralRef}>
                          <div className="flex flex-wrap gap-2">
                             {referrals.map(ref => (
                               <span key={ref} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                                 {ref}
                                 <button type="button" onClick={() => setReferrals(prev => prev.filter(r => r !== ref))} className="text-primary hover:text-error ml-1"><span className="material-symbols-outlined text-[14px]">close</span></button>
                               </span>
                             ))}
                          </div>
                          <div className="flex items-center w-full relative">
                            <input 
                              id="referralInput"
                              autoComplete="off"
                              value={referralSearch}
                              onFocus={() => setShowReferralDropdown(true)}
                              onChange={(e) => {
                                setReferralSearch(e.target.value);
                                setShowReferralDropdown(true);
                              }}
                              placeholder="Type to search existing members or 'Self'..." 
                              className="w-full bg-transparent outline-none font-bold text-xl px-4 py-2" 
                            />
                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-black/20 group-focus-within/referral:text-primary transition-all text-3xl">diversity_3</span>
                          </div>
                          
                          <AnimatePresence>
                            {showReferralDropdown && (
                              <motion.div 
                                initial={{ opacity: 0, y: 0, scale: 0.98 }}
                                animate={{ opacity: 1, y: 12, scale: 1 }}
                                exit={{ opacity: 0, y: 0, scale: 0.98 }}
                                className="absolute left-0 right-0 top-full bg-white/80 backdrop-blur-3xl rounded-[40px] shadow-2xl border border-white/40 overflow-hidden z-[110] max-h-72 overflow-y-auto no-scrollbar py-6 px-4"
                              >
                                <div className="mb-4 px-4 flex items-center justify-between">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-primary">Suggestions</span>
                                </div>
                                <div className="space-y-1">
                                  {['Self', ...nodes.map(n => n.name)]
                                    .filter(name => name.toLowerCase().includes(referralSearch.toLowerCase()) && !referrals.includes(name))
                                    .map((name, i) => (
                                      <button 
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                          if (!referrals.includes(name)) {
                                            setReferrals(prev => [...prev, name]);
                                          }
                                          setReferralSearch('');
                                          setShowReferralDropdown(false);
                                        }}
                                        className="w-full text-left px-6 py-4 rounded-2xl hover:bg-primary hover:text-white transition-all text-base font-bold flex items-center justify-between group"
                                      >
                                        <span>{name}</span>
                                        <span className="material-symbols-outlined text-[20px] opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">add</span>
                                      </button>
                                    ))
                                  }
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <p className="text-[9px] font-medium text-outline opacity-50 ml-6 italic">This helps build the community connections graph automatically</p>
                      </div>

                    </div>
                  </section>

                  {/* Skills / Ministries */}
                  <section>
                    <div className="flex items-center gap-4 mb-10">
                       <div className="h-0.5 flex-1 bg-outline-variant/20"></div>
                       <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-primary shrink-0">{t('skillsMinistries')}</h3>
                       <div className="h-0.5 flex-1 bg-outline-variant/20"></div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                       {skillsList.map(skill => (
                         <label key={skill} className="relative flex flex-col items-center justify-center p-6 rounded-[32px] border-2 border-outline-variant/10 cursor-pointer transition-all hover:border-primary/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5 group">
                            <input 
                              type="checkbox" 
                              name="skills" 
                              value={skill} 
                              defaultChecked={editingMember?.skills?.includes(skill)}
                              className="absolute opacity-0" 
                            />
                            <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center mb-3 group-hover:bg-primary/10 group-has-[:checked]:bg-primary group-has-[:checked]:text-white transition-all">
                               <span className="material-symbols-outlined text-[20px]">
                                  {skill === 'Sunday School Teacher' ? 'school' : 
                                   skill === 'Worship' ? 'music_note' : 
                                   skill === 'Usher' ? 'person_pin' : 
                                   skill === 'Preaching' ? 'campaign' : 
                                   skill === 'Kitchen' ? 'restaurant' : 
                                   skill.toUpperCase().includes('PIANO') ? 'piano' :
                                   skill.toUpperCase().includes('GUITAR') ? 'music_note' :
                                   skill.toUpperCase().includes('LEAD SINGER') ? 'record_voice_over' :
                                   skill.toUpperCase().includes('IT') ? 'terminal' :
                                   'star'}
                               </span>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-center">{tValue(skill, language)}</span>
                            {mode === 'Manager' && !SKILLS_LIST.includes(skill) && (
                              <button type="button" onClick={(e) => { e.preventDefault(); setSkillsList(prev => prev.filter(s => s !== skill)); }} className="absolute top-2 right-2 text-error hover:scale-110 opacity-0 group-hover:opacity-100 transition-all p-1 bg-white rounded-full"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            )}
                         </label>
                       ))}
                       {mode === 'Manager' && (
                         <div className="relative flex flex-col items-center justify-center p-6 rounded-[32px] border-2 border-dashed border-outline-variant/30 hover:border-primary/50 transition-all group">
                           <input type="text" value={newTagInput} onChange={e => setNewTagInput(e.target.value)} onKeyDown={(e) => {
                             if (e.key === 'Enter') {
                               e.preventDefault();
                               if (newTagInput.trim() && !skillsList.includes(newTagInput.trim())) {
                                 setSkillsList(prev => [...prev, newTagInput.trim()]);
                                 setNewTagInput('');
                               }
                             }
                           }} placeholder="Add new tag" className="w-full bg-transparent text-center outline-none text-[10px] font-black uppercase tracking-widest" />
                           <p className="text-[8px] text-outline mt-2 italic">Press Enter</p>
                         </div>
                       )}
                    </div>
                  </section>

                  <div className="pt-8">
                     <button type="submit" className="w-full bg-black text-white h-24 rounded-[40px] text-sm font-black uppercase tracking-[0.5em] hover:bg-primary transition-all shadow-2xl hover:shadow-primary/30 active:scale-[0.98]">
                        {t('saveMember')}
                     </button>
                  </div>
               </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
