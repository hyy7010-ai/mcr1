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

/**
 * 懒加载页面，并兜住「部署撞上开着的页面」。
 *
 * 每次构建 chunk 的哈希都会变。用户开着旧页面时我们发了新版本，旧
 * index.html 记着的那个文件名就 404 了，点进任何还没加载过的页面都会炸
 * （TypeError: Failed to fetch dynamically imported module）。
 *
 * 闸门按 **chunk 文件名** 记，不按时间。前两版用时间戳是错的：
 * sessionStorage 在重载后仍然存在，用户重载完很快又点开另一个陈旧页面时，
 * 时间闸门会把这次**全新的**失败误判成死循环，直接抛给 ErrorBoundary ——
 * 线上正是这样白屏的。按文件名记则精确：同一个 chunk 只自救一次（真的
 * 不存在时不会无限重载），换一个 chunk 就重新给一次机会。
 */
function lazyPage(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    factory().catch(async (err) => {
      const KEY = 'chunk_reload_tried';
      const chunk = String(err?.message || '').match(/[^/\s]+\.js/)?.[0] || 'unknown';

      let tried: string[] = [];
      try { tried = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch {}
      if (tried.includes(chunk)) throw err; // 救过一次还失败 → 交给 ErrorBoundary

      try { sessionStorage.setItem(KEY, JSON.stringify([...tried, chunk])); } catch {}

      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update();
      } catch { /* 清缓存失败也要继续重载，总比停在白屏强 */ }

      const url = new URL(window.location.href);
      url.searchParams.set('_r', String(Date.now()));
      window.location.replace(url.toString());
      return new Promise<never>(() => {}); // 等重载接管，永不 resolve
    })
  );
}

// Lazy-load all pages — browser only downloads a page when the user navigates to it
const Dashboard    = lazyPage(() => import('./pages/Dashboard'));
const Songs        = lazyPage(() => import('./pages/Songs'));
const Roster       = lazyPage(() => import('./pages/Roster'));
const Giving       = lazyPage(() => import('./pages/Giving'));
const Members      = lazyPage(() => import('./pages/Members'));
const GraceAI      = lazyPage(() => import('./pages/GraceAI'));
const PrayerWall   = lazyPage(() => import('./pages/PrayerWall'));
const About        = lazyPage(() => import('./pages/About'));
const Tasks        = lazyPage(() => import('./pages/Tasks'));
const ActivityLog  = lazyPage(() => import('./pages/ActivityLog'));
const Bulletin     = lazyPage(() => import('./pages/Bulletin'));
const Groups       = lazyPage(() => import('./pages/Groups'));
const ProfilePage  = lazyPage(() => import('./pages/Profile'));
const SuperAdmin   = lazyPage(() => import('./pages/SuperAdmin'));
const Tools        = lazyPage(() => import('./pages/Tools'));
const Approvals    = lazyPage(() => import('./pages/Approvals'));
const Attendance   = lazyPage(() => import('./pages/Attendance'));
const Calendar     = lazyPage(() => import('./pages/Calendar'));
const Publications = lazyPage(() => import('./pages/Publications'));
const Community    = lazyPage(() => import('./pages/Community'));
const Messages     = lazyPage(() => import('./pages/Messages'));
const Visitation   = lazyPage(() => import('./pages/Visitation'));

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

/**
 * 平台管理控制台只给 Super Admin。
 * 之前只在侧栏隐藏了入口 —— 任何登录用户手输 /app/super-admin 都能进去，
 * 那是真的越权，不是界面问题。
 */
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { profile, user } = useAuth();
  if (!isSuperAdmin(profile, user)) return <Navigate to="/app/dashboard" replace />;
  return <>{children}</>;
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
                <Route path="tools"        element={<Suspense fallback={<PageLoader />}><Tools /></Suspense>} />
                <Route path="approvals"    element={<Suspense fallback={<PageLoader />}><Approvals /></Suspense>} />
                <Route path="super-admin"  element={<SuperAdminRoute><Suspense fallback={<PageLoader />}><SuperAdmin /></Suspense></SuperAdminRoute>} />
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
