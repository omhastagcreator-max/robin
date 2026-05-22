import { useNavigate } from 'react-router-dom';
import { useShortcut } from '@/hooks/useShortcut';
import { useAuth } from '@/contexts/AuthContext';
import { useDrawer } from '@/components/ui/RightDrawer';
import { dashboardForRole } from '@/components/ProtectedRoute';
import { useRobinCopilot } from '@/components/ai/RobinCopilot';

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
  const openCopilot = useRobinCopilot();

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

  // ⌘M (Mac) / Ctrl+M (Win/Linux) — talk to Robin. Opens the Copilot
  // drawer and immediately starts the voice recogniser. Internal-staff
  // only; clients don't have access to the Copilot. The drawer listens
  // for 'robin:voice-start' and kicks off voice.start() once mounted.
  //
  // inInputs: true is essential. The first ⌘M opens the drawer and
  // focus lands on the textarea inside it. Without inInputs, the
  // SECOND ⌘M press would be swallowed by useShortcut's default
  // "don't fire inside typing targets" rule — which is exactly the bug
  // the owner reported. With inInputs: true we get consistent
  // behaviour: ⌘M works the same regardless of where focus is.
  //
  // useShortcut calls e.preventDefault() on match, which suppresses the
  // browser's default Cmd+M = minimise window. Works in Chrome / Edge
  // / Safari.
  useShortcut('mod+m', () => {
    if (role === 'client') return;
    openCopilot();
    // Give the drawer a tick to mount + the voice hook to subscribe,
    // then dispatch. Robust to slow re-renders on cold mount.
    setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('robin:voice-start')); }
      catch { /* swallow — old browser */ }
    }, 250);
  }, { inInputs: true });

  return null;
}
