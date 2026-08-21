import { useState, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Video, MessageSquare, Briefcase, Users,
  Building2, BarChart2, CalendarOff, Clock, BarChart3, Calendar,
  Bug, CalendarDays, Workflow, UserPlus, AlertTriangle, KeyRound,
  Sparkles, LogOut, Bird, ChevronsLeft, ChevronsRight, Bell, Settings,
  TrendingUp, Compass, Archive, Activity, MoreHorizontal, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadCounts } from '@/contexts/UnreadCountsContext';
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

type Section = 'home' | 'work' | 'comm' | 'sales' | 'reporting' | 'system';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  section: Section;
  roles?: string[];
  team?: string;
  anyTeam?: string[];
  requiresFlag?: 'canManageWorkroom';
  // Aug 2026 — owner ask: WORK had grown to 8 always-visible rows and
  // felt cluttered. Investigated each one — all 8 turned out to be real,
  // distinct features (confirmed: Task ledger is a permanent audit log
  // w/ CSV export, genuinely different from the live Tasks inbox; owner
  // chose "group the 2 least-used into a submenu" over deleting anything.
  // Items flagged here render under a collapsed "More" row instead of as
  // a top-level link — only when the sidebar is expanded (collapsed/icon
  // rail still shows every item flat, so nothing becomes harder to reach
  // when space is already tight).
  subItem?: boolean;
}

const SECTION_LABEL: Record<Section, string> = {
  home:      'Home',
  work:      'Work',
  comm:      'Communication',
  sales:     'Sales',
  reporting: 'Reporting',
  system:    'System',
};

const SECTION_ORDER: Section[] = ['home', 'work', 'comm', 'sales', 'reporting', 'system'];

const NAV: NavItem[] = [
  // ── HOME ────────────────────────────────────────────────────────
  // Dashboard — one entry per role, routed via dashboardForRole. The
  // sidebar dedupes by URL so a user with multiple roles never sees
  // "Dashboard" twice.
  // June 2026 Mission Control — first entry for admin + sales, the
  // agency-wide overview. Admin's actual landing (see ProtectedRoute
  // .dashboardForRole) is this page.
  { to: '/command-center',    label: 'Command Center', icon: Compass,         section: 'home',      roles: ['admin', 'sales'] },
  // Aug 2026 — relabeled "Workroom" → "Dashboard" for this entry
  // specifically: /workroom-home is the actual login landing for
  // sales/employee/workroom roles (see dashboardForRole), but the label
  // "Workroom" collided with the unrelated live-huddle page under
  // Communication (route /workroom) — same word, two different
  // destinations. "Dashboard" also now matches how admin ("Command
  // Center") and client ("Dashboard") each see one clearly-named home.
  { to: '/workroom-home',     label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['admin', 'sales', 'employee', 'workroom'] },
  // Aug 2026 — owner reviewed the actual rendered page and called
  // /dashboard (EmployeeDashboard.tsx) redundant with the real landing
  // (/workroom-home, "Dashboard" above) — removed from nav. The route +
  // component are left in place (not deleted) in case anything still
  // deep-links to it; it's just no longer reachable from the sidebar.
  // /admin ("Old admin") kept for now — only /dashboard was flagged.
  { to: '/admin',             label: 'Detailed view', icon: LayoutDashboard, section: 'home',      roles: ['admin'] },
  { to: '/client',            label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['client'] },
  { to: '/sales',             label: 'Sales pipeline', icon: LayoutDashboard, section: 'home',     roles: ['sales'] },
  { to: '/notifications',     label: 'Notifications', icon: Bell,            section: 'home' },

  // ── WORK ────────────────────────────────────────────────────────
  { to: '/tasks',             label: 'Tasks',         icon: ListTodo,        section: 'work',      roles: ['employee', 'admin', 'sales'] },
  { to: '/tasks/ledger',      label: 'Task ledger',   icon: Archive,         section: 'work',      roles: ['employee', 'admin', 'sales'], subItem: true },
  // Team Pulse — admin + sales see it by role; non-admin "workroom
  // managers" (Om's canManageWorkroom flag) see it via the requiresFlag
  // path, same pattern we use for the workroom-onboard link below.
  { to: '/team-pulse',        label: 'Team Pulse',    icon: Activity,        section: 'work',      roles: ['admin', 'sales'] },
  { to: '/team-pulse',        label: 'Team Pulse',    icon: Activity,        section: 'work',      roles: ['employee'], requiresFlag: 'canManageWorkroom' },
  // Weekly employee scorecards — same visibility as Team Pulse
  // (admin/sales by role, Om via canManageWorkroom). July 2026.
  { to: '/team-progress',     label: 'Progress',      icon: TrendingUp,      section: 'work',      roles: ['admin', 'sales'], subItem: true },
  { to: '/team-progress',     label: 'Progress',      icon: TrendingUp,      section: 'work',      roles: ['employee'], requiresFlag: 'canManageWorkroom', subItem: true },
  { to: '/clients/pipeline',  label: 'Client CRM',    icon: Workflow,        section: 'work',      roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/admin/clients',     label: 'Clients',       icon: Building2,       section: 'work',      roles: ['admin'] },
  { to: '/admin/projects',    label: 'Projects',      icon: Briefcase,       section: 'work',      roles: ['admin'] },
  { to: '/team/calendar',     label: 'Calendar',      icon: Calendar,        section: 'work',      roles: ['admin', 'employee', 'sales'] },
  { to: '/client-schedule',   label: 'Schedule',      icon: CalendarDays,    section: 'work',      roles: ['admin', 'employee', 'sales'] },
  { to: '/leaves',            label: 'Leaves',        icon: CalendarOff,     section: 'work',      roles: ['employee', 'sales'] },

  // ── COMMUNICATION ──────────────────────────────────────────────
  { to: '/chat',              label: 'Chat',          icon: MessageSquare,   section: 'comm',      roles: ['admin', 'employee', 'sales'] },
  { to: '/workroom',          label: 'Workroom',      icon: Video,           section: 'comm',      roles: ['admin', 'employee', 'sales', 'workroom'] },

  // ── SALES ──────────────────────────────────────────────────────
  // Admin sees the sales pipeline from System nav; sales role's own
  // pipeline lives at the same /sales URL but they reach it via Home.
  { to: '/sales',             label: 'Sales pipeline', icon: TrendingUp,     section: 'sales',     roles: ['admin'] },

  // ── REPORTING ──────────────────────────────────────────────────
  { to: '/ads/meta',          label: 'Meta Ads',      icon: BarChart3,       section: 'reporting', roles: ['admin'] },
  { to: '/ads/meta',          label: 'Meta Ads',      icon: BarChart3,       section: 'reporting', roles: ['employee'], anyTeam: ['meta', 'ads'] },
  { to: '/admin/reports',     label: 'Reports',       icon: BarChart2,       section: 'reporting', roles: ['admin'] },
  { to: '/influencers',       label: 'Influencer',    icon: Users,           section: 'reporting', roles: ['employee'], team: 'influencer' },

  // ── SYSTEM ─────────────────────────────────────────────────────
  { to: '/admin/employees',   label: 'Team',          icon: Users,           section: 'system',    roles: ['admin'] },
  { to: '/vault',             label: 'Vault',         icon: KeyRound,        section: 'system',    roles: ['admin', 'employee', 'sales'] },
  { to: '/admin/leaves',      label: 'Approvals',     icon: CalendarOff,     section: 'system',    roles: ['admin'] },
  { to: '/admin/attendance',  label: 'Attendance',    icon: Clock,           section: 'system',    roles: ['admin'] },
  { to: '/admin/crash-logs',  label: 'Crashes',       icon: Bug,             section: 'system',    roles: ['admin'] },
  { to: '/admin/issues',      label: 'Issues',        icon: AlertTriangle,   section: 'system',    roles: ['admin'] },
  { to: '/workroom-onboard',  label: 'Onboard',       icon: UserPlus,        section: 'system',    roles: ['admin'] },
  { to: '/workroom-onboard',  label: 'Onboard',       icon: UserPlus,        section: 'system',    roles: ['employee', 'sales'], requiresFlag: 'canManageWorkroom' },
  { to: '/profile',           label: 'Settings',      icon: Settings,        section: 'system' },
];

const PIN_KEY = 'robin.sidebar.pinned';

export function SlimSidebar({ children }: { children: ReactNode }) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const { chat: chatUnread, notifications: notifUnread } = useUnreadCounts();
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
  // Aug 2026 — which sections have their "More" sub-group expanded.
  // Keyed by section so WORK's More toggle doesn't affect any other
  // section that might grow one later. Starts closed (that's the point).
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
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
  const visible = NAV.filter(item => {
    if (item.roles && !item.roles.some(r => allMyRoles.includes(r))) return false;
    if (item.team) {
      const teams = [user?.team, ...((user as any)?.teams || [])].filter(Boolean);
      if (!teams.includes(item.team)) return false;
    }
    if (item.anyTeam) {
      const teams = [user?.team, ...((user as any)?.teams || [])].filter(Boolean);
      if (!item.anyTeam.some(t => teams.includes(t))) return false;
    }
    if (item.requiresFlag === 'canManageWorkroom') {
      const flag = (user as any)?.canManageWorkroom === true;
      const isOm = /^om(\s|$)/i.test(user?.name || '');
      if (!flag && !isOm) return false;
    }
    return true;
  });

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
    const active = item.to === '/admin'
      ? location.pathname === '/admin'
      : item.to === '/dashboard'
      ? location.pathname === '/dashboard'
      : item.to === '/sales'
      ? location.pathname === '/sales'
      : location.pathname.startsWith(item.to);
    const badge =
      item.to === '/chat'           ? chatUnread :
      item.to === '/notifications'  ? notifUnread :
                                      0;
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
            {expanded && <span className="font-black text-[15px] tracking-tight truncate">Robin</span>}
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
                {/* Aug 2026 — WORK decluttering: when expanded, subItem-
                    flagged entries (Task ledger, Progress) are held back
                    into a "More" toggle instead of listed flat. Collapsed
                    (icon rail) mode ignores the split entirely — every
                    item still shows as its own icon, so nothing is
                    harder to reach when the sidebar is already minimal. */}
                {(expanded ? g.items.filter(i => !i.subItem) : g.items).map(item =>
                  renderNavItem(item),
                )}
                {expanded && g.items.some(i => i.subItem) && (
                  <>
                    <button
                      onClick={() => setMoreOpen(m => ({ ...m, [g.section]: !m[g.section] }))}
                      className="w-full flex items-center gap-2.5 h-8 px-2 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-75"
                    >
                      <MoreHorizontal className="h-[15px] w-[15px] shrink-0" />
                      <span className="text-[12.5px] font-medium flex-1 text-left">More</span>
                      <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${moreOpen[g.section] ? 'rotate-180' : ''}`} />
                    </button>
                    {moreOpen[g.section] && g.items.filter(i => i.subItem).map(item =>
                      renderNavItem(item),
                    )}
                  </>
                )}
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
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-[12px] font-semibold truncate">{user?.name || 'User'}</p>
                <p className="text-[10px] text-muted-foreground truncate capitalize">{role || 'guest'}</p>
              </div>
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
