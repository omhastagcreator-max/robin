import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PersistentAppLayout } from '@/components/AppLayout';
import { Loader2 } from 'lucide-react';

const Login             = lazy(() => import('@/pages/Login'));
const UpdatePassword    = lazy(() => import('@/pages/UpdatePassword'));
const EmployeeDashboard = lazy(() => import('@/pages/EmployeeDashboard'));
const AdminDashboard    = lazy(() => import('@/pages/AdminDashboard'));
const AdminProjects     = lazy(() => import('@/pages/AdminProjects'));
const AdminEmployees    = lazy(() => import('@/pages/AdminEmployees'));
const AdminClients      = lazy(() => import('@/pages/AdminClients'));
const AdminReports      = lazy(() => import('@/pages/AdminReports'));
const ClientDashboard   = lazy(() => import('@/pages/ClientDashboard'));
const SalesDashboard    = lazy(() => import('@/pages/SalesDashboard'));
const TasksPage         = lazy(() => import('@/pages/TasksPage'));
const WorkRoom          = lazy(() => import('@/pages/WorkRoom'));
const GroupChat         = lazy(() => import('@/pages/GroupChat'));
const InfluencerSheet   = lazy(() => import('@/pages/InfluencerSheet'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ProfilePage       = lazy(() => import('@/pages/ProfilePage'));
const ClientVault       = lazy(() => import('@/pages/ClientVault'));
const LeavesPage        = lazy(() => import('@/pages/LeavesPage'));
const AdminLeaves       = lazy(() => import('@/pages/AdminLeaves'));
const AdminAttendance   = lazy(() => import('@/pages/AdminAttendance'));
const AdminCrashLogs    = lazy(() => import('@/pages/AdminCrashLogs'));
const ClientSchedulePage = lazy(() => import('@/pages/ClientSchedulePage'));
const ClientPipelinePage = lazy(() => import('@/pages/ClientPipelinePage'));
const ClientWorkflowDetailPage = lazy(() => import('@/pages/ClientWorkflowDetailPage'));
const ClientWorkspacePage      = lazy(() => import('@/pages/ClientWorkspacePage'));
const StageWorkspacePage       = lazy(() => import('@/pages/StageWorkspacePage'));
const MetaAdsReport     = lazy(() => import('@/pages/MetaAdsReport'));
const MetaShareView     = lazy(() => import('@/pages/MetaShareView'));
const TeamCalendar      = lazy(() => import('@/pages/TeamCalendar'));
const MeetGuest         = lazy(() => import('@/pages/MeetGuest'));
const MeetHost          = lazy(() => import('@/pages/MeetHost'));
const WorkroomHome      = lazy(() => import('@/pages/WorkroomHome'));
const WorkroomOnboardPage = lazy(() => import('@/pages/WorkroomOnboardPage'));
const AdminIssues       = lazy(() => import('@/pages/AdminIssues'));
// June 2026 Mission Control build.
const CommandCenter     = lazy(() => import('@/pages/CommandCenter'));
const TaskLedgerPage    = lazy(() => import('@/pages/TaskLedgerPage'));
const TeamPulsePage     = lazy(() => import('@/pages/TeamPulsePage'));

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
          {/* Employee / Sales / Admin — internal staff only.
              Clients hitting these get bounced to /client. */}
          <Route path="/dashboard"        element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><EmployeeDashboard /></E></ProtectedRoute>} />
          <Route path="/tasks"            element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TasksPage /></E></ProtectedRoute>} />
          <Route path="/chat"             element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><GroupChat /></E></ProtectedRoute>} />
          <Route path="/workroom"         element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><WorkRoom /></E></ProtectedRoute>} />
          <Route path="/workroom-home"    element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales', 'workroom']}><E><WorkroomHome /></E></ProtectedRoute>} />
          {/* Mission Control — admin landing (June 2026). Sales can
              also view; employees / workroom keep their Workroom. */}
          <Route path="/command-center"   element={<ProtectedRoute requiredRole={['admin', 'sales']}><E><CommandCenter /></E></ProtectedRoute>} />
          {/* Task ledger — permanent searchable history of every
              assigned task. Internal roles. */}
          <Route path="/tasks/ledger"     element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TaskLedgerPage /></E></ProtectedRoute>} />
          {/* Team Pulse — Om + admin dashboard of every teammate's
              morning / midday / evening checkin. Route gate allows
              admin + sales + employee; the server route further checks
              canManageWorkroom so plain employees who hit the URL get
              a 403 from the API (page renders an empty list). */}
          <Route path="/team-pulse"       element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TeamPulsePage /></E></ProtectedRoute>} />
          {/* Onboard a workroom teammate — admin OR any user the admin
              has flagged with canManageWorkroom (e.g. Om). The page itself
              re-checks the flag and bounces if accessed directly. */}
          <Route path="/workroom-onboard" element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><WorkroomOnboardPage /></E></ProtectedRoute>} />
          <Route path="/vault"            element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientVault /></E></ProtectedRoute>} />
          <Route path="/leaves"           element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><LeavesPage /></E></ProtectedRoute>} />
          <Route path="/notifications"    element={<E><NotificationsPage /></E>} />
          <Route path="/profile"          element={<E><ProfilePage /></E>} />

          {/* Admin only */}
          <Route path="/admin"            element={<ProtectedRoute requiredRole="admin"><E><AdminDashboard /></E></ProtectedRoute>} />
          <Route path="/admin/projects"   element={<ProtectedRoute requiredRole="admin"><E><AdminProjects /></E></ProtectedRoute>} />
          <Route path="/admin/employees"  element={<ProtectedRoute requiredRole="admin"><E><AdminEmployees /></E></ProtectedRoute>} />
          <Route path="/admin/clients"    element={<ProtectedRoute requiredRole="admin"><E><AdminClients /></E></ProtectedRoute>} />
          <Route path="/admin/reports"    element={<ProtectedRoute requiredRole="admin"><E><AdminReports /></E></ProtectedRoute>} />
          <Route path="/admin/leaves"     element={<ProtectedRoute requiredRole="admin"><E><AdminLeaves /></E></ProtectedRoute>} />
          <Route path="/admin/attendance" element={<ProtectedRoute requiredRole="admin"><E><AdminAttendance /></E></ProtectedRoute>} />
          <Route path="/admin/crash-logs" element={<ProtectedRoute requiredRole="admin"><E><AdminCrashLogs /></E></ProtectedRoute>} />
          <Route path="/admin/issues"     element={<ProtectedRoute requiredRole="admin"><E><AdminIssues /></E></ProtectedRoute>} />
          <Route path="/client-schedule"  element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientSchedulePage /></E></ProtectedRoute>} />
          <Route path="/clients/pipeline"     element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientPipelinePage /></E></ProtectedRoute>} />
          {/* Two-layer system (May 2026, v3):
              :id              → ClientWorkspacePage  (Layer 1 — project command center)
              :id/stage/:stageKey → StageWorkspacePage (Layer 2 — checklist + per-stage detail)
              :id/legacy       → old ClientWorkflowDetailPage as a rollback escape hatch */}
          <Route path="/clients/pipeline/:id"                   element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientWorkspacePage /></E></ProtectedRoute>} />
          <Route path="/clients/pipeline/:id/stage/:stageKey"   element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><StageWorkspacePage /></E></ProtectedRoute>} />
          <Route path="/clients/pipeline/:id/legacy"            element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientWorkflowDetailPage /></E></ProtectedRoute>} />
          <Route path="/ads/meta"         element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><MetaAdsReport /></E></ProtectedRoute>} />
          <Route path="/team/calendar"    element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TeamCalendar /></E></ProtectedRoute>} />
          <Route path="/meet/host/:slug"  element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><MeetHost /></E></ProtectedRoute>} />

          {/* Client only */}
          <Route path="/client"           element={<ProtectedRoute requiredRole="client"><E><ClientDashboard /></E></ProtectedRoute>} />

          {/* Sales / Influencer */}
          <Route path="/sales"            element={<ProtectedRoute requiredRole={['admin', 'sales']}><E><SalesDashboard /></E></ProtectedRoute>} />
          <Route path="/influencers"      element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><InfluencerSheet /></E></ProtectedRoute>} />
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
