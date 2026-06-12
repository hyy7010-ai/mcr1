import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { churchService } from '../services/churchService';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: any | null;
  church: any | null;
  signOut: () => Promise<void>;
  isLoading: boolean;
  switchChurch: (church: any) => void;
  refreshProfile: () => Promise<void>;
  signInAsDemo: (email: string) => void;
  updateChurch: (updates: any) => void;
  updateProfile: (updates: any) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [church, setChurch] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfileAndChurch = async (userId: string, userEmail?: string, googleDisplayName?: string) => {
    const normalizedEmail = userEmail?.toLowerCase()?.trim();

    const demoChurch = {
      id: 'demo-church-id',
      name: 'Demo Grace Church',
      code: 'DEMO-CODE',
      description: 'A thriving community of faith and hope.',
      logo_url: 'https://images.unsplash.com/photo-1438032005730-c7793010b9a9?w=128&h=128&fit=crop'
    };

    const SUPER_ADMIN_ROLES_SET = new Set(['Super Admin', 'SuperAdmin', 'super_admin']);
    const OWNER_EMAILS_SET = new Set(['jzey805@gmail.com', 'hyy7010@gmail.com']);

    const resolveSuperAdminChurch = () => {
      const stored = localStorage.getItem('super_admin_viewing_church');
      if (stored) { try { return JSON.parse(stored); } catch (e) {} }
      // Super Admin with no church chosen yet → neutral placeholder (not "Demo")
      return { ...demoChurch, name: 'Select a Church', description: '' };
    };

    // Owner check: by email. Also checked again later as safety net.
    const isDeveloper = OWNER_EMAILS_SET.has(normalizedEmail ?? '');

    // ─── OWNER FAST PATH ─────────────────────────────────────────────────────────
    // Set Super Admin profile immediately (sync) so spinner disappears fast.
    // Then update name from DB in background without blocking the UI.
    if (isDeveloper) {
      localStorage.removeItem(`church_${userId}`);
      localStorage.removeItem(`profile_${userId}`);
      const activeChurch = resolveSuperAdminChurch();
      const immediateProfile = {
        id: userId, email: userEmail, role: 'Super Admin',
        full_name: googleDisplayName || 'Super Admin',
      };
      setProfile(immediateProfile);
      setChurch(activeChurch);
      localStorage.setItem(`profile_${userId}`, JSON.stringify(immediateProfile));
      localStorage.setItem(`church_${userId}`, JSON.stringify(activeChurch));
      // Fetch real DB name + church_id in background (non-blocking)
      supabase.from('profiles').select('full_name, church_id').eq('id', userId).maybeSingle()
        .then(async ({ data }) => {
          if (data?.full_name) {
            const updated = { ...immediateProfile, full_name: data.full_name, church_id: data.church_id };
            setProfile(updated);
            localStorage.setItem(`profile_${userId}`, JSON.stringify(updated));
          }

          // Resolve church_id: profile → church_members → churches (self-healing)
          let churchId = data?.church_id;

          if (!churchId) {
            // Try church_members table
            const { data: mem } = await supabase
              .from('church_members').select('church_id').eq('user_id', userId).limit(1).maybeSingle();
            churchId = mem?.church_id ?? null;
          }
          if (!churchId) {
            // Try churches table where this user is the creator/admin
            const { data: owned } = await supabase
              .from('churches').select('id').eq('created_by', userId).limit(1).maybeSingle();
            churchId = owned?.id ?? null;
          }
          if (!churchId) {
            // Last resort: pick the most-populated church
            const { data: biggest } = await supabase.rpc
              ? await supabase.from('church_members').select('church_id').limit(1).maybeSingle()
              : { data: null };
            churchId = (biggest as any)?.church_id ?? null;
          }

          // If super admin has a real church AND hasn't manually switched, auto-load it
          if (churchId && activeChurch?.id === 'demo-church-id') {
            const { data: churchData } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle();
            if (churchData) {
              // Permanently fix profile.church_id in the DB so this auto-detection only runs once
              await supabase.from('profiles').update({ church_id: churchId }).eq('id', userId).then(() => {});
              setChurch(churchData);
              setProfile((prev: any) => ({ ...prev, church_id: churchId }));
              localStorage.setItem('super_admin_viewing_church', JSON.stringify(churchData));
              localStorage.setItem(`church_${userId}`, JSON.stringify(churchData));
            }
          }
        }).catch(() => {});
      return; // finally fires immediately → setIsLoading(false) → fast!
    }

    // ─── REGULAR USERS: sync cache phase ─────────────────────────────────────────
    const cachedProfile = localStorage.getItem(`profile_${userId}`);
    const cachedChurch  = localStorage.getItem(`church_${userId}`);
    if (cachedProfile) {
      try {
        const cp = JSON.parse(cachedProfile);
        setProfile(cp);
        if (SUPER_ADMIN_ROLES_SET.has(cp?.role)) setChurch(resolveSuperAdminChurch());
        else if (cachedChurch) setChurch(JSON.parse(cachedChurch));
      } catch (e) {}
    }

    try {
      // ── REGULAR USERS: fetch fresh profile from DB ──────────────────────────
      let { data: profileData, error: profileError } = await Promise.race([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('profile_timeout')), 12000)),
      ]).catch(() => ({ data: null, error: new Error('profile_timeout') }));

      // Safety net: if email matches owner list regardless of DB role → Super Admin
      const dbEmail = profileData?.email?.toLowerCase()?.trim() ?? '';
      if (OWNER_EMAILS_SET.has(dbEmail) || OWNER_EMAILS_SET.has(normalizedEmail ?? '')) {
        const adminProfile = {
          id: userId, email: userEmail || profileData?.email,
          role: 'Super Admin',
          full_name: profileData?.full_name || googleDisplayName || 'Super Admin',
        };
        const activeChurch = resolveSuperAdminChurch();
        setProfile(adminProfile);
        setChurch(activeChurch);
        localStorage.setItem(`profile_${userId}`, JSON.stringify(adminProfile));
        localStorage.setItem(`church_${userId}`, JSON.stringify(activeChurch));
        return;
      }

      // DB-assigned Super Admin (not in hardcoded list but has the role)
      if (SUPER_ADMIN_ROLES_SET.has(profileData?.role)) {
        const adminProfile = {
          id: userId, email: userEmail, role: 'Super Admin',
          full_name: profileData?.full_name || googleDisplayName || 'Super Admin',
        };
        const activeChurch = resolveSuperAdminChurch();
        setProfile(adminProfile);
        setChurch(activeChurch);
        localStorage.setItem(`profile_${userId}`, JSON.stringify(adminProfile));
        localStorage.setItem(`church_${userId}`, JSON.stringify(activeChurch));
        return;
      }

      // New user with pending join code
      if (!profileData && !profileError) {
        const pendingCode = localStorage.getItem('pending_join_code');
        const pendingName = localStorage.getItem('pending_join_name');
        if (pendingCode) {
          const { data: churchData } = await supabase
            .from('churches').select('*').eq('code', pendingCode.toUpperCase()).maybeSingle();
          if (churchData) {
            const { data: createdProfile, error: createError } = await supabase
              .from('profiles')
              .insert({ id: userId, email: userEmail, full_name: pendingName || userEmail?.split('@')[0], church_id: churchData.id, role: 'Pending' })
              .select('*').single();
            if (!createError && createdProfile) {
              profileData = createdProfile;
              localStorage.removeItem('pending_join_code');
              localStorage.removeItem('pending_join_name');
            }
          }
        }
      }

      if (profileError) { console.error('Profile fetch error:', profileError); return; }

      // If profile exists but has no church yet, check for an approved application
      if (profileData && !profileData.church_id && userEmail) {
        const { data: approvedApp } = await supabase
          .from('church_applications')
          .select('*, churches!inner(id)')
          .eq('email', userEmail)
          .eq('status', 'Approved')
          .maybeSingle();
        if (approvedApp?.churches?.id) {
          await supabase.from('profiles')
            .update({ role: 'Manager', church_id: approvedApp.churches.id })
            .eq('id', userId);
          profileData = { ...profileData, role: 'Manager', church_id: approvedApp.churches.id };
        }
      }

      if (profileData) {
        setProfile(profileData);
        // KNOWN LIMITATION: We cache a minimal profile in localStorage to speed up page loads.
        // Sensitive fields (phone, address, dob) are intentionally excluded from the cache.
        const { phone: _phone, address: _address, dob: _dob, ...safeProfile } = profileData;
        localStorage.setItem(`profile_${userId}`, JSON.stringify(safeProfile));
        if (profileData.church_id) {
          const { data: churchData } = await Promise.race([
            supabase.from('churches').select('*').eq('id', profileData.church_id).maybeSingle(),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('church_timeout')), 12000)),
          ]).catch(() => ({ data: null }));
          if (churchData) {
            setChurch(churchData);
            localStorage.setItem(`church_${userId}`, JSON.stringify(churchData));
          }
        }
      } else {
        setProfile({ role: 'Pending' });
      }
    } catch (err) {
      console.error('Error in fetchProfileAndChurch:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const email = user.email || user.user_metadata?.email || user.identities?.[0]?.identity_data?.email || '';
      const googleName = user.user_metadata?.full_name || user.user_metadata?.name;
      await fetchProfileAndChurch(user.id, email, googleName);
    }
  };

  useEffect(() => {
    let mounted = true;

    // One-time migration: if a Super Admin had a stale app_mode saved as 'Member', clear it.
    // (The ModeContext now forces Manager for Super Admin, but this cleans up old caches.)
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(k => {
      if (k.startsWith('profile_')) {
        try {
          const p = JSON.parse(localStorage.getItem(k) || '{}');
          if (p?.role === 'Super Admin' || p?.role === 'SuperAdmin') {
            const uid = k.replace('profile_', '');
            const modeKey = `app_mode_${uid}`;
            if (localStorage.getItem(modeKey) === 'Member') {
              localStorage.removeItem(modeKey); // force ModeContext to re-evaluate
            }
          }
        } catch (e) { /* ignore parse errors */ }
      }
    });

    // Nuke any leftover demo_session — demo mode is fully disabled
    localStorage.removeItem('demo_session');

    // initialize() exclusively owns the INITIAL auth state.
    // onAuthStateChange only fires for SUBSEQUENT events (sign-in, sign-out, token refresh).
    // This prevents the race where INITIAL_SESSION fires null and kicks the user to login
    // before getSession() has a chance to return the real persisted session.
    let initializeDone = false;

    const initialize = async () => {
      try {
        const initTimeout = setTimeout(() => {
          if (mounted) {
            console.warn('Auth initialization timeout');
            setIsLoading(false);
            initializeDone = true;
          }
        }, 20000);

        const { data: { session: initialSession } } = await supabase.auth.getSession();

        if (mounted) {
          if (initialSession) {
            const activeUser = initialSession.user;
            // Extract email from multiple fallback sources — user.email can be null in some OAuth flows
            const email = activeUser.email
              || activeUser.user_metadata?.email
              || activeUser.identities?.[0]?.identity_data?.email
              || '';
            const googleName = activeUser.user_metadata?.full_name || activeUser.user_metadata?.name;
            setSession(initialSession);
            setUser(activeUser);
            console.log('Session found on load, fetching profile...', email);
            fetchProfileAndChurch(activeUser.id, email, googleName).finally(() => {
              if (mounted) { clearTimeout(initTimeout); setIsLoading(false); initializeDone = true; }
            });
          } else {
            console.log('No session found on load');
            setIsLoading(false);
            clearTimeout(initTimeout);
            initializeDone = true;
          }
        }
      } catch (err) {
        console.error('Initial check error:', err);
        if (mounted) { setIsLoading(false); initializeDone = true; }
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      // Let initialize() handle the startup state — skip INITIAL_SESSION entirely
      if (event === 'INITIAL_SESSION') return;

      console.log('Auth state changed:', event, session?.user?.email);
      setSession(session);
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (newUser) {
        const email = newUser.email
          || newUser.user_metadata?.email
          || newUser.identities?.[0]?.identity_data?.email
          || '';
        const googleName = newUser.user_metadata?.full_name || newUser.user_metadata?.name;
        await fetchProfileAndChurch(newUser.id, email, googleName);
        if (mounted) setIsLoading(false);
      } else {
        setProfile(null);
        setChurch(null);
        // Only redirect away if init is done (don't interrupt startup)
        if (initializeDone) setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Clear local state first so UI reacts immediately even if signOut hangs
    localStorage.removeItem('super_admin_cache');
    localStorage.removeItem('super_admin_viewing_church');
    if (user) {
      localStorage.removeItem(`profile_${user.id}`);
      localStorage.removeItem(`church_${user.id}`);
      localStorage.removeItem(`app_mode_${user.id}`);
    }
    setSession(null);
    setUser(null);
    setProfile(null);
    setChurch(null);
    // Then attempt Supabase signOut (ignore errors — local state already cleared)
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
    } catch (e) {
      console.warn('signOut timed out or failed, but local state already cleared', e);
    }
    // Force redirect to login page
    window.location.href = '/';
  };

  // Demo mode is disabled — kept as no-op to avoid breaking imports
  const signInAsDemo = (_email: string) => {
    console.warn('Demo mode is disabled');
  };

  const switchChurch = (newChurch: any) => {
    if (profile?.role === 'Super Admin' || profile?.role === 'SuperAdmin') {
      setChurch(newChurch);
      const target = newChurch ?? { id: 'demo-church-id', name: 'Demo Grace Church', code: 'DEMO-CODE' };
      if (newChurch) {
        localStorage.setItem(`super_admin_viewing_church`, JSON.stringify(newChurch));
      } else {
        localStorage.removeItem(`super_admin_viewing_church`);
      }
      // Keep church_${userId} in sync so the synchronous cache phase is always warm
      if (user) {
        localStorage.setItem(`church_${user.id}`, JSON.stringify(target));
      }
    }
  };

  const updateChurch = (updates: any) => {
    if (church) {
      const updatedChurch = { ...church, ...updates };
      setChurch(updatedChurch);
      if (user) {
        localStorage.setItem(`church_${user.id}`, JSON.stringify(updatedChurch));
        // If super admin is viewing this church, update that too
        const stored = localStorage.getItem(`super_admin_viewing_church`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.id === church.id) {
              localStorage.setItem(`super_admin_viewing_church`, JSON.stringify(updatedChurch));
            }
          } catch (e) {}
        }
      }
    }
  };

  const updateProfile = (updates: any) => {
    if (profile) {
      const updatedProfile = { ...profile, ...updates };
      setProfile(updatedProfile);
      if (user) {
        localStorage.setItem(`profile_${user.id}`, JSON.stringify(updatedProfile));
      }
    }
  };

  return (
    <AuthContext.Provider value={{ 
      session, user, profile, church, signOut, isLoading, 
      switchChurch, refreshProfile, signInAsDemo, updateChurch, updateProfile 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
