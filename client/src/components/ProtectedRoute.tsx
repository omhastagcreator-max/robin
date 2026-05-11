import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import { ShieldOff, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props { children: ReactNode; requiredRole?: string | string[]; }

/**
 * Map a role to its canonical landing page. Anything we don't recognise
 * (legacy data with role='' or odd values like 'meta', 'guest') falls back
 * to /dashboard — but ProtectedRoute also has a same-path guard so we
 * never get into a Navigate loop if /dashboard itself rejects the role.
 */
export function dashboardForRole(role: string): string {
  switch (role) {
    case 'admin':    return '/admin';
    case 'client':   return '/client';
    case 'sales':    return '/sales';
    case 'employee': return '/dashboard';
    default:         return '/dashboard';
  }
}

/**
 * AccessDenied — terminal page shown when we'd otherwise be redirecting in
 * a circle (e.g. user with role 'guest' lands on /dashboard which only
 * allows admin/employee/sales — sending them to dashboardForRole('guest')
 * = /dashboard is the same page they came from).
 *
 * This is the SAFETY NET that broke production before: the previous
 * ProtectedRoute would Navigate to itself, exhausting React Router's
 * history depth and freezing the tab.
 */
function AccessDenied({ role }: { role: string }) {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 text-center shadow-sm">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center mb-3">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold">You don't have access here</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your account role <code className="bg-muted px-1.5 py-0.5 rounded">{role || 'unknown'}</code> doesn't have a default dashboard
          assigned. Ask your admin to set a role (employee, sales, admin or client) on your profile, then sign in again.
        </p>
        <button
          onClick={logout}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, role, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user)   return <Navigate to="/login" replace />;
  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    // Treat the user's primary role AND any granted secondary roles as
    // candidates for access — matches the server-side requireRole check so
    // a user with role='employee' + roles=['sales'] can hit /sales.
    const userRoles = [role, ...((user as any).roles || [])].filter(Boolean);
    const hasAccess = userRoles.some(r => allowed.includes(r));
    if (!hasAccess) {
      const target = dashboardForRole(role);
      // SAFETY: if redirecting would land on the same path we're already on,
      // the Navigate would loop and freeze the tab (this is what crashed
      // Robin for everyone). Render AccessDenied instead — terminal state.
      if (target === location.pathname) {
        return <AccessDenied role={role} />;
      }
      return <Navigate to={target} replace />;
    }
  }
  return <>{children}</>;
}
