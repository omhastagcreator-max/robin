import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PersistentAppLayout } from '@/components/AppLayout';
import { Loader2 } from 'lucide-react';

const Login             = lazy(() => import('@/pages/Login'));
const UpdatePassword    = lazy(() => import('@/pages/UpdatePassword'));
const WorkRoom          = lazy(() => import('@/pages/WorkRoom'));
const ProfilePage       = lazy(() => import('@/pages/ProfilePage'));
const AdminLeaves       = lazy(() => import('@/pages/AdminLeaves'));
const LeavesPage        = lazy(() => import('@/pages/LeavesPage'));
const IncentivesPage    = lazy(() => import('@/pages/IncentivesPage'));
const AdminAttendance   = lazy(() => import('@/pages/AdminAttendance'));
const AdminCrashLogs    = lazy(() => import('@/pages/AdminCrashLogs'));
const AdminOversight    = lazy(() => import('@/pages/AdminOversight'));
const VideoSopPage      = lazy(() => import('@/pages/VideoSopPage'));
const MyAttendancePage  = lazy(() => import('@/pages/MyAttendancePage'));
const TeamRolesPage     = lazy(() => import('@/pages/TeamRolesPage'));
const ClientsCleanupPage = lazy(() => import('@/pages/ClientsCleanupPage'));
const ActivityLogsPage  = lazy(() => import('@/pages/ActivityLogsPage'));
const ClientWorkspacePage      = lazy(() => import('@/pages/ClientWorkspacePage'));
const StageWorkspacePage       = lazy(() => import('@/pages/StageWorkspacePage'));
const MetaShareView     = lazy(() => import('@/pages/MetaShareView'));
const MeetGuest         = lazy(() => import('@/pages/MeetGuest'));
const MeetHost          = lazy(() => import('@/pages/MeetHost'));
const WorkroomOnboardPage = lazy(() => import('@/pages/WorkroomOnboardPage'));
const SalesDashboard    = lazy(() => import('@/pages/SalesDashboard'));
const CRMView           = lazy(() => import('@/pages/ExecutiveDashboard/CRMView').then(m => ({ default: m.CRMView })));
const DecisionTreeView  = lazy(() => import('@/pages/ExecutiveDashboard/DecisionTreeView').then(m => ({ default: m.DecisionTreeView })));
const CommandCenter     = lazy(() => import('@/pages/CommandCenter'));
const WorkroomHome      = lazy(() => import('@/pages/WorkroomHome'));

/**
 * BlankRoot — the public root (robin.hastagcreator.com/) renders nothing.
 * Per agency-owner request: keep the bare domain empty so visitors land on
 * a clean page instead of an automatic login redirect. The actual login
 * page lives at /login, and logged-in users get to their dashboard by
 * navigating there explicitly (or via direct deep-link from email / chat).
 *
 * If we ever want a marketing landing page here later, this is the spot
 * to render it instead of `null`.
 */
function BlankRoot() {
  return <div className="min-h-screen bg-background" />;
}

const E = ({ children }: { children: React.ReactNode }) => (
  <PageErrorBoundary>{children}</PageErrorBoundary>
);

/**
 * White-label guard. The meeting subdomain (meeting.hastagcreator.com)
 * serves the same Vercel build but must NEVER expose the Robin app shell
 * to a prospect. This component is mounted as the Routes wrapper when on
 * the meeting host — it ONLY allows the public /meet/:slug page; every
 * other path 404s to a neutral "Meeting not found" rather than redirecting
 * to /login (which would reveal Robin).
 */
const MEETING_HOSTS = ['meeting.hastagcreator.com'];
const isMeetingHost = () =>
  typeof window !== 'undefined' && MEETING_HOSTS.includes(window.location.hostname);

function MeetingOnlyRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/meet/:slug" element={<E><MeetGuest /></E>} />
        <Route path="*" element={<MeetingNotFound />} />
      </Routes>
    </Suspense>
  );
}

function MeetingNotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-lg font-bold">Meeting not found</h1>
        <p className="text-sm text-muted-foreground">Ask the host to send you a fresh link.</p>
      </div>
    </div>
  );
}

/**
 * AppShell — parent layout route that mounts the persistent AppLayout
 * exactly ONCE for every authenticated page. Inner pages still render
 * their own `<AppLayout>` (which becomes a no-op pass-through via the
 * AppLayoutNestedCtx). The Suspense for lazy chunks lives INSIDE the
 * shell — so when the user navigates between sections, only the inner
 * content swaps. The sidebar, top bar, huddle dock, etc. stay mounted.
 * That's what kills the blank-screen flash on navigation.
 */
function AppShell() {
  return (
    <PersistentAppLayout>
      <Suspense fallback={
        <div className="min-h-[40vh] flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }>
        <Outlet />
      </Suspense>
    </PersistentAppLayout>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* ── Public routes — no chrome ──────────────────────────────── */}
        <Route path="/login"            element={<E><Login /></E>} />
        <Route path="/update-password"  element={<E><UpdatePassword /></E>} />
        {/* Public read-only Meta Ads share — no Robin login required */}
        <Route path="/share/meta/:token" element={<E><MetaShareView /></E>} />
        {/* Public guest meeting page — no Robin login required */}
        <Route path="/meet/:slug"        element={<E><MeetGuest /></E>} />

        {/* Root — anyone landing on robin.hastagcreator.com goes straight
            to the v2 login screen. Login.tsx itself auto-redirects to the
            role-specific dashboard if a JWT is already in localStorage,
            so logged-in users get the same fast-path they had before. */}
        <Route path="/"                 element={<Navigate to="/login" replace />} />

        {/* ── Authenticated routes — persistent chrome via <AppShell /> ─
            All inner routes share a single AppLayout instance, so the
            sidebar/header don't unmount on navigation. */}
        <Route element={<AppShell />}>
          {/* Post-login landing pages — dashboardForRole() (see
              ProtectedRoute.tsx) sends every user here immediately after
              sign-in: admin/sales → /executive-dashboard, everyone else →
              /workroom-home. Both routes MUST exist or every login hits
              the catch-all and loops forever. */}
          <Route path="/executive-dashboard" element={<ProtectedRoute requiredRole={['admin', 'sales']}><E><CommandCenter /></E></ProtectedRoute>} />
          <Route path="/workroom-home"    element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><WorkroomHome /></E></ProtectedRoute>} />
          {/* Employee / Sales / Admin — internal staff only.
              Clients hitting these get bounced to /client. */}
          <Route path="/workroom"         element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><WorkRoom /></E></ProtectedRoute>} />
          {/* Oct 2026 — Decision Tree opened to every staff role: it now
              shows the whole client pipeline ("where is each client
              stuck"), read-only for anyone who isn't the stage owner. */}
          <Route path="/command-center"   element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><DecisionTreeView /></E></ProtectedRoute>} />
          {/* Oct 2026 — apply-for-leave form, reached from "Approvals" in
              the sidebar. Every staff role can apply. */}
          <Route path="/incentives"       element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><IncentivesPage /></E></ProtectedRoute>} />
          <Route path="/leaves"           element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><LeavesPage /></E></ProtectedRoute>} />
          {/* Team Pulse — Om + admin dashboard of every teammate's
              morning / midday / evening checkin. Route gate allows
              admin + sales + employee; the server route further checks
              canManageWorkroom so plain employees who hit the URL get
              a 403 from the API (page renders an empty list). */}
          <Route path="/workroom-onboard" element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><WorkroomOnboardPage /></E></ProtectedRoute>} />
          <Route path="/profile"          element={<E><ProfilePage /></E>} />

          {/* Admin only */}
          <Route path="/admin/leaves"     element={<ProtectedRoute requiredRole="admin"><E><AdminLeaves /></E></ProtectedRoute>} />
          <Route path="/admin/attendance" element={<ProtectedRoute requiredRole="admin"><E><AdminAttendance /></E></ProtectedRoute>} />
          {/* Oct 2026 — Team Oversight: admin + managers (canViewOversight,
              e.g. Rahul). The route lets every staff role through because
              a manager may not hold the admin role; the page itself and
              the /api/oversight server gate enforce the real check. */}
          {/* Oct 2026 — video tasks board: all staff see it, only the assigned video person marks steps (server-enforced). */}
          {/* Oct 2026 — every employee's own attendance calendar; Team & roles + client clean-up (admin / Rahul — pages self-gate, server enforces). */}
          <Route path="/my-attendance"    element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><MyAttendancePage /></E></ProtectedRoute>} />
          <Route path="/admin/team"       element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><TeamRolesPage /></E></ProtectedRoute>} />
          <Route path="/admin/logs"       element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><ActivityLogsPage /></E></ProtectedRoute>} />
          <Route path="/admin/clients-cleanup" element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><ClientsCleanupPage /></E></ProtectedRoute>} />
          <Route path="/video-tasks"        element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><VideoSopPage /></E></ProtectedRoute>} />
          <Route path="/video-sop"        element={<VideoTasksRedirect />} />
          <Route path="/admin/oversight"  element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><AdminOversight /></E></ProtectedRoute>} />
          <Route path="/admin/crash-logs" element={<ProtectedRoute requiredRole="admin"><E><AdminCrashLogs /></E></ProtectedRoute>} />
          <Route path="/clients/pipeline"     element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><CRMView /></E></ProtectedRoute>} />
          {/* Two-layer system (May 2026, v3) */}
          <Route path="/clients/pipeline/:id"                   element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><ClientWorkspacePage /></E></ProtectedRoute>} />
          <Route path="/clients/pipeline/:id/stage/:stageKey"   element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><StageWorkspacePage /></E></ProtectedRoute>} />
          
          {/* Sales */}
          <Route path="/sales"            element={<ProtectedRoute requiredRole={['admin', 'sales']}><E><SalesDashboard /></E></ProtectedRoute>} />
        </Route>

        {/* Catch-all */}
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

import { ScreenShareProvider } from '@/contexts/ScreenShareContext';
import { HuddleProvider } from '@/contexts/HuddleContext';
import { ClientMeetingProvider } from '@/contexts/ClientMeetingContext';
import { UnreadCountsProvider } from '@/contexts/UnreadCountsContext';
import { CheckinProvider } from '@/contexts/CheckinContext';
import { BreakOverlay } from '@/components/shared/BreakOverlay';
import { NetworkStatus } from '@/components/shared/NetworkStatus';
import { RightDrawerProvider } from '@/components/ui/RightDrawer';

function VideoTasksRedirect() {
  const loc = useLocation();
  return <Navigate to={`/video-tasks${loc.search}`} replace />;
}

export default function App() {
  // White-label: on meeting.hastagcreator.com, render ONLY the public guest
  // page. No AuthProvider, no Robin chrome, no huddle dock — just the
  // agency-branded meet UI. This is what protects Robin from leaking.
  if (isMeetingHost()) {
    return (
      <BrowserRouter>
        <NetworkStatus />
        <MeetingOnlyRoutes />
        <Toaster position="top-right" richColors expand />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <NetworkStatus />
      <AuthProvider>
        <CheckinProvider>
        <ScreenShareProvider>
          <HuddleProvider>
            {/* Client-meeting room state lives here so navigation between
                Robin pages doesn't kick the host out mid-call. */}
            <ClientMeetingProvider>
              <UnreadCountsProvider>
                {/* RightDrawer (v2) — contextual side panel, opened from
                    any page via useDrawer(). Mounted at the app root so
                    state survives navigation. */}
                <RightDrawerProvider>
                  <AppRoutes />
                  {/* Top-most break overlay — freezes the UI while user is on break. */}
                  <BreakOverlay />
                  <Toaster position="top-right" richColors expand />
                </RightDrawerProvider>
              </UnreadCountsProvider>
            </ClientMeetingProvider>
          </HuddleProvider>
        </ScreenShareProvider>
        </CheckinProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
