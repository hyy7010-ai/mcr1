import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, fontFamily: 'monospace', background: '#fff', color: '#c00'}}>
          <h2>App Error</h2>
          <pre style={{whiteSpace: 'pre-wrap', fontSize: 13}}>{this.state.error.message}{'\n\n'}{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{marginTop: 16, padding: '8px 16px'}}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Eagerly load critical path (login + layout shell)
import Layout from './components/Layout';
import Login from './pages/Login';
import { isSuperAdmin } from './lib/permissions';
import PendingApproval from './pages/PendingApproval';
import { ModeProvider } from './contexts/ModeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Lazy-load all pages — browser only downloads a page when the user navigates to it
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Songs        = lazy(() => import('./pages/Songs'));
const Roster       = lazy(() => import('./pages/Roster'));
const Giving       = lazy(() => import('./pages/Giving'));
const Members      = lazy(() => import('./pages/Members'));
const GraceAI      = lazy(() => import('./pages/GraceAI'));
const PrayerWall   = lazy(() => import('./pages/PrayerWall'));
const About        = lazy(() => import('./pages/About'));
const Tasks        = lazy(() => import('./pages/Tasks'));
const ActivityLog  = lazy(() => import('./pages/ActivityLog'));
const ReadyPPT     = lazy(() => import('./pages/ReadyPPT'));
const Bulletin     = lazy(() => import('./pages/Bulletin'));
const Groups       = lazy(() => import('./pages/Groups'));
const ProfilePage  = lazy(() => import('./pages/Profile'));
const SuperAdmin   = lazy(() => import('./pages/SuperAdmin'));
const Tools        = lazy(() => import('./pages/Tools'));
const Approvals    = lazy(() => import('./pages/Approvals'));
const Attendance   = lazy(() => import('./pages/Attendance'));
const Calendar     = lazy(() => import('./pages/Calendar'));
const Publications = lazy(() => import('./pages/Publications'));
const Community    = lazy(() => import('./pages/Community'));
const Messages     = lazy(() => import('./pages/Messages'));
const Visitation   = lazy(() => import('./pages/Visitation'));

// Minimal spinner shown while a lazy page chunk is loading
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-widest text-outline animate-pulse">Loading…</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, profile, isLoading, user } = useAuth();
  const isDev = isSuperAdmin(profile, user);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-outline animate-pulse">Initializing GraceFlow...</p>
        </div>
      </div>
    );
  }

  if (!session && !isLoading) {
    return <Navigate to="/" replace />;
  }

  if (profile?.role === 'Pending' || (!profile?.church_id && !isDev)) {
    return <PendingApproval />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <LanguageProvider>
        <ModeProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Navigate to="/app/dashboard" replace />} />
                <Route path="dashboard"    element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
                <Route path="about"        element={<Suspense fallback={<PageLoader />}><About /></Suspense>} />
                <Route path="songs"        element={<Suspense fallback={<PageLoader />}><Songs /></Suspense>} />
                <Route path="roster"       element={<Suspense fallback={<PageLoader />}><Roster /></Suspense>} />
                <Route path="bulletin"     element={<Suspense fallback={<PageLoader />}><Bulletin /></Suspense>} />
                <Route path="members"      element={<Suspense fallback={<PageLoader />}><Members /></Suspense>} />
                <Route path="ai"           element={<Suspense fallback={<PageLoader />}><GraceAI /></Suspense>} />
                <Route path="tasks"        element={<Suspense fallback={<PageLoader />}><Tasks /></Suspense>} />
                <Route path="giving"       element={<Suspense fallback={<PageLoader />}><Giving /></Suspense>} />
                <Route path="groups"       element={<Suspense fallback={<PageLoader />}><Groups /></Suspense>} />
                <Route path="prayer"       element={<Suspense fallback={<PageLoader />}><PrayerWall /></Suspense>} />
                <Route path="profile"      element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
                <Route path="activity"     element={<Suspense fallback={<PageLoader />}><ActivityLog /></Suspense>} />
                <Route path="ready"        element={<Suspense fallback={<PageLoader />}><ReadyPPT /></Suspense>} />
                <Route path="tools"        element={<Suspense fallback={<PageLoader />}><Tools /></Suspense>} />
                <Route path="approvals"    element={<Suspense fallback={<PageLoader />}><Approvals /></Suspense>} />
                <Route path="super-admin"  element={<Suspense fallback={<PageLoader />}><SuperAdmin /></Suspense>} />
                <Route path="attendance"   element={<Suspense fallback={<PageLoader />}><Attendance /></Suspense>} />
                <Route path="calendar"     element={<Suspense fallback={<PageLoader />}><Calendar /></Suspense>} />
                <Route path="publications" element={<Suspense fallback={<PageLoader />}><Publications /></Suspense>} />
                <Route path="community"    element={<Suspense fallback={<PageLoader />}><Community /></Suspense>} />
                <Route path="messages"     element={<Suspense fallback={<PageLoader />}><Messages /></Suspense>} />
                <Route path="visitation"   element={<Suspense fallback={<PageLoader />}><Visitation /></Suspense>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ModeProvider>
      </LanguageProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
