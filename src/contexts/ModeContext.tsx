import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useAuth } from './AuthContext';

export type Mode = 'Manager' | 'Staff' | 'Member';

interface ModeContextType {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

const ModeContext = createContext<ModeContextType | undefined>(undefined);

export function ModeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [mode, setModeState] = useState<Mode>('Member');

  useEffect(() => {
    if (profile) {
      const isSuperAdmin = profile.role === 'Super Admin' || profile.role === 'SuperAdmin';
      // Super Admins always get Manager mode — never respect a stale saved preference
      if (isSuperAdmin) {
        setModeState('Manager');
        localStorage.setItem(`app_mode_${profile.id}`, 'Manager');
        return;
      }
      const saved = localStorage.getItem(`app_mode_${profile.id}`);
      if (saved) {
        setModeState(saved as Mode);
      } else {
        if (profile.role === 'Admin' || profile.role === 'Leader' || profile.role === 'Manager') {
          setModeState('Manager');
          localStorage.setItem(`app_mode_${profile.id}`, 'Manager');
        } else if (profile.role === 'Staff') {
          setModeState('Staff');
          localStorage.setItem(`app_mode_${profile.id}`, 'Staff');
        } else {
          setModeState('Member');
          localStorage.setItem(`app_mode_${profile.id}`, 'Member');
        }
      }
    }
  }, [profile?.id, profile?.role]);

  const setMode = (newMode: Mode) => {
    setModeState(newMode);
    if (profile) {
      localStorage.setItem(`app_mode_${profile.id}`, newMode);
    }
  };

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) throw new Error('useMode must be used within a ModeProvider');
  return context;
}
