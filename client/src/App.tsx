import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';

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
const MetaAdsReport     = lazy(() => import('@/pages/MetaAdsReport'));
const MetaShareView     = lazy(() => import('@/pages/MetaShareView'));
const TeamCalendar      = lazy(() => import('@/pages/TeamCalendar'));
const MeetGuest         = lazy(() => import('@/pages/MeetGuest'));
const MeetHost          = lazy(() => import('@/pages/MeetHost'));

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

function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Public */}
        <Route path="/login"            element={<E><Login /></E>} />
        <Route path="/update-password"  element={<E><UpdatePassword /></E>} />
        {/* Public read-only Meta Ads share — no Robin login required */}
        <Route path="/share/meta/:token" element={<E><MetaShareView /></E>} />
        {/* Public guest meeting page — no Robin login required */}
        <Route path="/meet/:slug"        element={<E><MeetGuest /></E>} />

        {/* Root — intentionally blank. Users go to /login or deep-link to
            their dashboard. Old auto-redirect to /login removed per req. */}
        <Route path="/"                 element={<BlankRoot />} />

        {/* Employee / Sales / Admin — internal staff only.
            Clients hitting these get bounced to /client (their own dashboard). */}
        <Route path="/dashboard"        element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><EmployeeDashboard /></E></ProtectedRoute>} />
        <Route path="/tasks"            element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TasksPage /></E></ProtectedRoute>} />
        <Route path="/chat"             element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><GroupChat /></E></ProtectedRoute>} />
        <Route path="/workroom"         element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><WorkRoom /></E></ProtectedRoute>} />
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
        <Route path="/client-schedule"  element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><ClientSchedulePage /></E></ProtectedRoute>} />
        <Route path="/ads/meta"         element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><MetaAdsReport /></E></ProtectedRoute>} />
        <Route path="/team/calendar"    element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><TeamCalendar /></E></ProtectedRoute>} />
        <Route path="/meet/host/:slug"  element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><MeetHost /></E></ProtectedRoute>} />

        {/* Client only */}
        <Route path="/client"           element={<ProtectedRoute requiredRole="client"><E><ClientDashboard /></E></ProtectedRoute>} />

        {/* Sales / Influencer */}
        <Route path="/sales"            element={<ProtectedRoute requiredRole={['admin', 'sales']}><E><SalesDashboard /></E></ProtectedRoute>} />
        <Route path="/influencers"       element={<ProtectedRoute requiredRole={['admin', 'employee', 'sales']}><E><InfluencerSheet /></E></ProtectedRoute>} />

        {/* Catch-all */}
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

import { ScreenShareProvider } from '@/contexts/ScreenShareContext';
import { HuddleProvider } from '@/contexts/HuddleContext';
import { BreakOverlay } from '@/components/shared/BreakOverlay';
import { NetworkStatus } from '@/components/shared/NetworkStatus';

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
        <ScreenShareProvider>
          <HuddleProvider>
            <AppRoutes />
            {/* Top-most break overlay — freezes the UI while user is on break. */}
            <BreakOverlay />
            <Toaster position="top-right" richColors expand />
          </HuddleProvider>
        </ScreenShareProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
