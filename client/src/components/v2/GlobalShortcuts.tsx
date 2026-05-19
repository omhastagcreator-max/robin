import { useNavigate } from 'react-router-dom';
import { useShortcut } from '@/hooks/useShortcut';
import { useAuth } from '@/contexts/AuthContext';
import { useDrawer } from '@/components/ui/RightDrawer';
import { dashboardForRole } from '@/components/ProtectedRoute';

/**
 * Robin v2 — global app shortcuts. Mounted once inside AppLayout so every
 * page inherits them.
 *
 * Conventions: Gmail / Linear style.
 *   ⌘K          Command palette (handled by the existing CommandPalette)
 *   g d         Go → Dashboard (role-aware destination)
 *   g p         Go → Project Pipeline
 *   g t         Go → Tasks
 *   g w         Go → Workroom
 *   g s         Go → Sales
 *   g c         Go → Calendar
 *   g i         Go → Issues (admin)
 *   esc         Close right drawer (backstop for components that swallow Esc)
 *
 * IMPORTANT: hooks are registered unconditionally; role gating happens
 * inside the handlers. Conditional hook registration would break the rules
 * of hooks the moment a user's role changes mid-session.
 */
export function GlobalShortcuts() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const drawer = useDrawer();

  // Universal navigation.
  useShortcut('g d', () => navigate(dashboardForRole(role)));
  useShortcut('g w', () => { if (role !== 'client') navigate('/workroom'); });

  // Internal-staff destinations — handler-gated.
  useShortcut('g p', () => {
    if (['admin', 'employee', 'sales'].includes(role)) navigate('/clients/pipeline');
  });
  useShortcut('g t', () => {
    if (['admin', 'employee', 'sales'].includes(role)) navigate('/tasks');
  });
  useShortcut('g c', () => {
    if (['admin', 'employee', 'sales'].includes(role)) navigate('/team/calendar');
  });
  useShortcut('g s', () => {
    if (role === 'admin' || role === 'sales') navigate('/sales');
  });
  useShortcut('g i', () => {
    if (role === 'admin') navigate('/admin/issues');
  });

  // Esc backstop — RightDrawer handles its own Esc, but if a child
  // component swallows the event we still want to close the drawer.
  useShortcut('escape', () => { if (drawer.isOpen) drawer.close(); }, { inInputs: true });

  return null;
}
