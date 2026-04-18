import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/shared/Spinner';
import type { ReactNode } from 'react';

interface Props { children: ReactNode; requiredRole?: string | string[]; }

export function dashboardForRole(role: string): string {
  switch (role) {
    case 'admin':    return '/admin';
    case 'client':   return '/client';
    case 'sales':    return '/sales';
    default:         return '/dashboard';
  }
}

export function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, role, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user)   return <Navigate to="/login" replace />;
  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowed.includes(role)) return <Navigate to={dashboardForRole(role)} replace />;
  }
  return <>{children}</>;
}
