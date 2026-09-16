import { useState, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FolderOpen, GitBranch, CalendarCheck, Stamp, Code2, BookMarked,
  GraduationCap, UsersRound, Target,
  Sparkles, LogOut, Bird, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/shared/Avatar';
import { dashboardForRole } from '@/components/ProtectedRoute';

/**
 * Robin v2 sidebar — 56 px collapsed, 240 px on hover / pinned.
 *
 * Section-grouped nav inspired by Google AI Studio + Linear:
 *   HOME · WORK · COMMUNICATION · SALES · REPORTING · SYSTEM
 *
 * Section labels are visible only when the sidebar is expanded; collapsed
 * mode renders just the icons with a 1 px hairline between sections so the
 * groupings stay discoverable.
 *
 * Pin state persists in localStorage.
 */

type Section = 'core' | 'ops';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  section: Section;
  roles?: string[];
}

const SECTION_LABEL: Record<Section, string> = {
  core: 'Core Navigation',
  ops:  'Operations & Management',
};

const SECTION_ORDER: Section[] = ['core', 'ops'];

/**
 * Sep 2026 — Robin OS reset.
 *
 * Owner ask: "replace the whole Robin with the file, keep only these
 * details." The nav is now EXACTLY the approved Robin OS mockup's two
 * groups — nothing else. Every removed entry's route and page is still
 * mounted in App.tsx (deep links, bookmarks and in-app links all keep
 * working); they're simply no longer surfaced in the sidebar. Restoring
 * one is a single line here.
 *
 * Mockup item → real Robin destination:
 *   CRM             → /crm                (executive client directory)
 *   Decision Tree   → /decision-tree      (gated task execution)
 *   Attendance      → /admin/attendance · /leaves for non-admins
 *   Approvals       → /admin/leaves       (leave sign-offs)
 *   Tech Updates    → /admin/issues       (issue + deployment tracker)
 *   Process Updates → /process-updates    (SOP module — placeholder)
 *   Process Test    → /process-test       (training module — placeholder)
 *   Workroom        → /workroom-home      (team collab hub)
 *   Sales Pipeline  → /sales
 */
const NAV: NavItem[] = [
  // ── CORE NAVIGATION ─────────────────────────────────────────────
  { to: '/crm',               label: 'CRM',              icon: FolderOpen,     section: 'core', roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/decision-tree',     label: 'Decision Tree',    icon: GitBranch,      section: 'core', roles: ['admin', 'employee', 'sales', 'workroom'] },

  // ── OPERATIONS & MANAGEMENT ─────────────────────────────────────
  // Attendance: admins get the agency-wide register, everyone else
  // gets their own attendance/leave record under the same label.
  { to: '/admin/attendance',  label: 'Attendance',       icon: CalendarCheck,  section: 'ops',  roles: ['admin'] },
  { to: '/leaves',            label: 'Attendance',       icon: CalendarCheck,  section: 'ops',  roles: ['employee', 'sales', 'workroom'] },
  { to: '/admin/leaves',      label: 'Approvals',        icon: Stamp,          section: 'ops',  roles: ['admin'] },
  { to: '/admin/issues',      label: 'Tech Updates',     icon: Code2,          section: 'ops',  roles: ['admin'] },
  { to: '/process-updates',   label: 'Process Updates',  icon: BookMarked,     section: 'ops',  roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/process-test',      label: 'Process Test',     icon: GraduationCap,  section: 'ops',  roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/workroom-home',     label: 'Workroom',         icon: UsersRound,     section: 'ops',  roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/sales',             label: 'Sales Pipeline',   icon: Target,         section: 'ops',  roles: ['admin', 'sales'] },
];

const PIN_KEY = 'robin.sidebar.pinned';

export function SlimSidebar({ children }: { children: ReactNode }) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  // Default: COLLAPSED rail. Owner ask (June 2026 redesign) — the
  // sidebar should default to an icon-only column and only expand on
  // hover OR explicit click. Users who want it permanently visible
  // can click the pin in the header; we persist that choice in
  // localStorage. Storage convention: '1' = pinned open, '0' or
  // missing = default-collapsed.
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(PIN_KEY);
      return v === '1';
    } catch { return false; }
  });
  const [hover, setHover]       = useState(false);
  const [clickOpen, setClickOpen] = useState(false);
  const hoverTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expanded if pinned, hovered, OR user explicitly clicked the rail.
  // clickOpen sticks until mouse leaves so a single click can be
  // followed by moving over the items, even briefly off the bar.
  const expanded = pinned || hover || clickOpen;

  const togglePin = () => {
    setPinned(p => {
      const v = !p;
      try { localStorage.setItem(PIN_KEY, v ? '1' : '0'); } catch {}
      return v;
    });
  };

  const onMouseEnter = () => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Tiny delay prevents flicker on accidental edge brushes.
    hoverTimerRef.current = setTimeout(() => setHover(true), 80);
  };
  const onMouseLeave = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    // Delay collapse so the rail doesn't slam shut the instant a
    // pointer skips over a 2px gap mid-nav. Snappy but forgiving.
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setHover(false);
      setClickOpen(false);
    }, 180);
  };
  // Bar click (anywhere not specifically handled below) toggles
  // clickOpen — useful on touch devices where hover doesn't exist.
  const onBarClick = () => {
    if (expanded) return;     // already open
    setClickOpen(true);
  };

  // Filter NAV by role + team + flag.
  // Aug 2026 — this only ever checked the PRIMARY role, so a user granted
  // a secondary role (e.g. Om given `roles: ['sales']` so he can reach
  // /sales) would pass ProtectedRoute's own check (which already treats
  // primary + secondary roles as candidates — see ProtectedRoute.tsx) but
  // never see the nav entry to get there. Matches that same pattern now.
  const allMyRoles = [role, ...((user as any)?.roles || [])].filter(Boolean);
  const visible = NAV.filter(item =>
    !item.roles || item.roles.some(r => allMyRoles.includes(r)),
  );

  // Dedupe by URL — a user with multi-role might match the same /sales row
  // twice (once via /admin, once via /sales role).
  const seen = new Set<string>();
  const navItems = visible.filter(i => seen.has(i.to) ? false : (seen.add(i.to), true));

  // Group by section, preserving SECTION_ORDER, dropping empty groups.
  const groups: { section: Section; items: NavItem[] }[] = SECTION_ORDER
    .map(section => ({ section, items: navItems.filter(i => i.section === section) }))
    .filter(g => g.items.length > 0);

  // Aug 2026 — extracted from the old inline .map so the same Link markup
  // can be reused for both top-level items and the "More" sub-group.
  const renderNavItem = (item: NavItem) => {
    const active = item.to === '/sales'
      ? location.pathname === '/sales'
      : location.pathname.startsWith(item.to);
    // No nav row carries an unread badge in the Robin OS layout — chat
    // and notifications live in the top bar. Kept as a constant so the
    // badge markup below stays intact for whenever one returns.
    const badge = 0;
    return (
      <Link
        key={item.to + item.label}
        to={item.to}
        className={`
          group relative flex items-center gap-2.5 h-8 px-2 rounded
          transition-colors duration-75
          ${active
            ? 'bg-primary/12 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
        `}
        title={!expanded ? `${item.label}${badge > 0 ? ` · ${badge}` : ''}` : undefined}
      >
        {active && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-primary" />}
        <div className="relative shrink-0">
          <item.icon className={`h-[15px] w-[15px] ${active ? 'text-primary' : ''}`} />
          {!expanded && badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-1 ring-card" />
          )}
        </div>
        {expanded && (
          <>
            <span className="text-[12.5px] font-medium truncate whitespace-nowrap flex-1">
              {item.label}
            </span>
            {badge > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onBarClick}
        className="fixed left-0 top-0 h-screen z-40 flex flex-col bg-card border-r border-border transition-[width] overflow-hidden"
        style={{
          width: expanded ? 'var(--w-sidebar-expanded)' : 'var(--w-sidebar-collapsed)',
          transitionDuration: 'var(--t-base)',
          transitionTimingFunction: 'var(--e-out)',
        }}
      >
        {/* Logo + pin */}
        <div className="h-11 flex items-center justify-between px-3 border-b border-border">
          <Link to={dashboardForRole(role)} className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
            >
              <Bird className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            {expanded && (
              <span className="min-w-0 leading-tight">
                <span className="block font-black text-[15px] tracking-tight truncate">Robin OS</span>
                <span className="block text-[10px] text-muted-foreground truncate">Hashtag Creator Agency</span>
              </span>
            )}
          </Link>
          {expanded && (
            <button
              onClick={togglePin}
              className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title={pinned ? 'Collapse' : 'Pin sidebar'}
            >
              {pinned ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* Nav — section-grouped */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5">
          {groups.map((g, gi) => (
            <div key={g.section} className={gi > 0 ? 'mt-3' : ''}>
              {/* Section label — only shown when expanded. Collapsed mode
                  uses a hairline divider instead. */}
              {expanded ? (
                <p className="text-[9.5px] uppercase tracking-[0.16em] font-bold text-muted-foreground/80 px-2 mb-1">
                  {SECTION_LABEL[g.section]}
                </p>
              ) : gi > 0 ? (
                <div className="border-t border-border/60 mx-2 mb-2" />
              ) : null}

              <div className="space-y-0.5">
                {g.items.map(item => renderNavItem(item))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — ⌘K + user + sign-out */}
        <div className="border-t border-border p-1.5 space-y-1">
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="w-full flex items-center gap-2 h-8 px-2 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Jump anywhere (⌘K)"
          >
            <Sparkles className="h-[15px] w-[15px] shrink-0" />
            {expanded && (
              <>
                <span className="text-[12.5px] flex-1 text-left">Jump anywhere</span>
                <kbd className="px-1 h-4 text-[9px] rounded bg-muted-foreground/15 font-mono">⌘K</kbd>
              </>
            )}
          </button>

          <Link
            to="/profile"
            className="w-full flex items-center gap-2 h-9 px-1.5 rounded hover:bg-muted transition-colors"
          >
            <Avatar name={user?.name} email={user?.email} url={user?.avatarUrl} size="sm" tone="primary" />
            {expanded && (
              <>
                <div className="flex-1 min-w-0 leading-tight">
                  <p className="text-[12px] font-semibold truncate">{user?.name || 'User'}</p>
                  <p className="text-[10px] text-muted-foreground truncate capitalize">{role || 'guest'}</p>
                </div>
                <span className="relative flex h-2 w-2 shrink-0" title="Online">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              </>
            )}
          </Link>

          {expanded && (
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 h-8 px-2 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-[14px] w-[14px] shrink-0" />
              <span className="text-[12px] font-medium">Sign out</span>
            </button>
          )}
        </div>
      </aside>

      {/* Spacer so the content doesn't sit under the absolute sidebar. */}
      <div
        className="shrink-0 transition-[width]"
        style={{
          width: pinned ? 'var(--w-sidebar-expanded)' : 'var(--w-sidebar-collapsed)',
          transitionDuration: 'var(--t-base)',
          transitionTimingFunction: 'var(--e-out)',
        }}
      />

      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
