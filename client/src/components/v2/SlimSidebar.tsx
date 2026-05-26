import { useState, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Video, MessageSquare, Briefcase, Users,
  Building2, BarChart2, CalendarOff, Clock, BarChart3, Calendar,
  Bug, CalendarDays, Workflow, UserPlus, AlertTriangle, KeyRound,
  Sparkles, LogOut, Bird, ChevronsLeft, ChevronsRight, Bell, Settings,
  TrendingUp,
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
  { to: '/dashboard',         label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['employee'] },
  { to: '/admin',             label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['admin'] },
  { to: '/client',            label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['client'] },
  { to: '/sales',             label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['sales'] },
  { to: '/workroom-home',     label: 'Dashboard',     icon: LayoutDashboard, section: 'home',      roles: ['workroom'] },
  { to: '/notifications',     label: 'Notifications', icon: Bell,            section: 'home' },

  // ── WORK ────────────────────────────────────────────────────────
  { to: '/tasks',             label: 'Tasks',         icon: ListTodo,        section: 'work',      roles: ['employee', 'admin', 'sales'] },
  { to: '/clients/pipeline',  label: 'Client CRM',    icon: Workflow,        section: 'work',      roles: ['admin', 'employee', 'sales'] },
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
  // Default: PINNED OPEN. Owner-mandated — Robin is an operational system,
  // not a focus app. The sidebar carries critical real-time signals
  // (chat/notif badges, role-grouped sections); hiding it behind a hover
  // forces an extra mental hop on every page nav. Users who want it
  // collapsed can still toggle the pin; we just persist their choice via
  // localStorage. The flag stored is now an explicit "0" vs "1" instead
  // of "presence vs absence" so first-load = pinned without a missing key.
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(PIN_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const [hover, setHover] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = pinned || hover;

  const togglePin = () => {
    setPinned(p => {
      const v = !p;
      // Persist explicit '0' so a user who CHOSE to collapse stays collapsed
      // across reloads (a missing key now defaults back to pinned open).
      try { localStorage.setItem(PIN_KEY, v ? '1' : '0'); } catch {}
      return v;
    });
  };

  const onMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHover(true), 60);
  };
  const onMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHover(false);
  };

  // Filter NAV by role + team + flag.
  const visible = NAV.filter(item => {
    if (item.roles && !item.roles.includes(role)) return false;
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

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
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
                {g.items.map(item => {
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
                })}
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
