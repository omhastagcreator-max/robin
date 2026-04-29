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

function RootRedirect() {
  const { user, role, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user)   return <Navigate to="/login" replace />;
  return <Navigate to={dashboardForRole(role)} replace />;
}

const E = ({ children }: { children: React.ReactNode }) => (
  <PageErrorBoundary>{children}</PageErrorBoundary>
);

function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Public */}
        <Route path="/login"            element={<E><Login /></E>} />
        <Route path="/update-password"  element={<E><UpdatePassword /></E>} />

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScreenShareProvider>
          <AppRoutes />
          <Toaster position="top-right" richColors expand />
        </ScreenShareProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
