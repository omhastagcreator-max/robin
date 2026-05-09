import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { dashboardForRole } from '@/components/ProtectedRoute';

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
const MetaAdsReport     = lazy(() => import('@/pages/MetaAdsReport'));
const MetaShareView     = lazy(() => import('@/pages/MetaShareView'));
const TeamCalendar      = lazy(() => import('@/pages/TeamCalendar'));
const MeetGuest         = lazy(() => import('@/pages/MeetGuest'));
const MeetHost          = lazy(() => import('@/pages/MeetHost'));

function RootRedirect() {
  const { user, role, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user)   return <Navigate to="/login" replace />;
  return <Navigate to={dashboardForRole(role)} replace />;
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

        {/* Root */}
        <Route path="/"                 element={<RootRedirect />} />

        {/* Employee / Shared */}
        <Route path="/dashboard"        element={<E><EmployeeDashboard /></E>} />
        <Route path="/tasks"            element={<E><TasksPage /></E>} />
        <Route path="/chat"             element={<E><GroupChat /></E>} />
        <Route path="/workroom"         element={<E><WorkRoom /></E>} />
        <Route path="/vault"            element={<E><ClientVault /></E>} />
        <Route path="/leaves"           element={<E><LeavesPage /></E>} />
        <Route path="/notifications"    element={<E><NotificationsPage /></E>} />
        <Route path="/profile"          element={<E><ProfilePage /></E>} />

        {/* Admin */}
        <Route path="/admin"            element={<E><AdminDashboard /></E>} />
        <Route path="/admin/projects"   element={<E><AdminProjects /></E>} />
        <Route path="/admin/employees"  element={<E><AdminEmployees /></E>} />
        <Route path="/admin/clients"    element={<E><AdminClients /></E>} />
        <Route path="/admin/reports"    element={<E><AdminReports /></E>} />
        <Route path="/admin/leaves"     element={<E><AdminLeaves /></E>} />
        <Route path="/admin/attendance" element={<E><AdminAttendance /></E>} />
        <Route path="/ads/meta"         element={<E><MetaAdsReport /></E>} />
        <Route path="/team/calendar"    element={<E><TeamCalendar /></E>} />
        <Route path="/meet/host/:slug"  element={<E><MeetHost /></E>} />

        {/* Client */}
        <Route path="/client"           element={<E><ClientDashboard /></E>} />

        {/* Sales */}
        <Route path="/sales"            element={<E><SalesDashboard /></E>} />
        <Route path="/influencers"       element={<E><InfluencerSheet /></E>} />

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
