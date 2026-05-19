import { useState, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Video, MessageSquare, Briefcase, Users,
  Building2, BarChart2, CalendarOff, Clock, BarChart3, Calendar,
  Bug, CalendarDays, Workflow, UserPlus, AlertTriangle, KeyRound,
  Sparkles, LogOut, Bird, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/shared/Avatar';
import { dashboardForRole } from '@/components/ProtectedRoute';

/**
 * Robin v2 sidebar — 56px collapsed, 240px on hover, 240px when pinned.
 *
 * Linear / Vercel / Arc-Browser pattern: icons are always visible, labels
 * appear on hover. Reclaims ~184px of horizontal space on every page
 * compared to the previous 240px-fixed sidebar. Power users learn the
 * icons in a week.
 *
 * Pin state ("expanded by default") persists in localStorage so the
 * user's preference survives reload.
 */

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  team?: string;
  anyTeam?: string[];
  requiresFlag?: 'canManageWorkroom';
  groupAt?: number;
}

const NAV: NavItem[] = [
  // Dashboard — role aware
  { to: '/dashboard',         label: 'Dashboard',  icon: LayoutDashboard, roles: ['employee'] },
  { to: '/admin',             label: 'Dashboard',  icon: LayoutDashboard, roles: ['admin'] },
  { to: '/client',            label: 'Dashboard',  icon: LayoutDashboard, roles: ['client'] },
  { to: '/sales',             label: 'Dashboard',  icon: LayoutDashboard, roles: ['sales'] },
  { to: '/workroom-home',     label: 'Dashboard',  icon: LayoutDashboard, roles: ['workroom'] },

  // Work
  { to: '/tasks',             label: 'Tasks',      icon: ListTodo,      roles: ['employee', 'admin', 'sales'] },
  { to: '/clients/pipeline',  label: 'Pipeline',   icon: Workflow,      roles: ['admin', 'employee', 'sales'] },
  { to: '/sales',             label: 'Sales',      icon: BarChart2,     roles: ['admin'] },

  // Collaboration
  { to: '/workroom',          label: 'Huddle',     icon: Video,         roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/chat',              label: 'Chat',       icon: MessageSquare, roles: ['admin', 'employee', 'sales'] },
  { to: '/team/calendar',     label: 'Calendar',   icon: Calendar,      roles: ['admin', 'employee', 'sales'] },
  { to: '/client-schedule',   label: 'Schedule',   icon: CalendarDays,  roles: ['admin', 'employee', 'sales'] },

  // Resources
  { to: '/vault',             label: 'Vault',      icon: KeyRound,      roles: ['admin', 'employee', 'sales'] },
  { to: '/ads/meta',          label: 'Meta Ads',   icon: BarChart3,     roles: ['admin'] },
  { to: '/ads/meta',          label: 'Meta Ads',   icon: BarChart3,     roles: ['employee'], anyTeam: ['meta', 'ads'] },
  { to: '/influencers',       label: 'Influencer', icon: Users,         roles: ['employee'], team: 'influencer' },
  { to: '/leaves',            label: 'Leaves',     icon: CalendarOff,   roles: ['employee', 'sales'] },

  // Admin
  { to: '/admin/projects',    label: 'Projects',   icon: Briefcase,     roles: ['admin'] },
  { to: '/admin/employees',   label: 'Employees',  icon: Users,         roles: ['admin'] },
  { to: '/admin/clients',     label: 'Clients',    icon: Building2,     roles: ['admin'] },
  { to: '/admin/reports',     label: 'Reports',    icon: BarChart2,     roles: ['admin'] },
  { to: '/admin/leaves',      label: 'Approvals',  icon: CalendarOff,   roles: ['admin'] },
  { to: '/admin/attendance',  label: 'Attendance', icon: Clock,         roles: ['admin'] },
  { to: '/admin/crash-logs',  label: 'Crashes',    icon: Bug,           roles: ['admin'] },
  { to: '/admin/issues',      label: 'Issues',     icon: AlertTriangle, roles: ['admin'] },
  { to: '/workroom-onboard',  label: 'Onboard',    icon: UserPlus,      roles: ['admin'] },
  { to: '/workroom-onboard',  label: 'Onboard',    icon: UserPlus,      roles: ['employee', 'sales'], requiresFlag: 'canManageWorkroom' },
];

const PIN_KEY = 'robin.sidebar.pinned';

export function SlimSidebar({ children }: { children: ReactNode }) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const [pinned, setPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
  });
  const [hover, setHover] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = pinned || hover;

  const togglePin = () => {
    setPinned(p => {
      const v = !p;
      try { v ? localStorage.setItem(PIN_KEY, '1') : localStorage.removeItem(PIN_KEY); } catch {}
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

  // Filter NAV by role + team + flag
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
  // Dedupe by URL
  const seen = new Set<string>();
  const navItems = visible.filter(i => seen.has(i.to) ? false : (seen.add(i.to), true));

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
            <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}>
              <Bird className="h-3.5 w-3.5 text-white" />
            </div>
            {expanded && <span className="font-black text-[15px] tracking-tight truncate">Robin</span>}
          </Link>
          {expanded && (
            <button onClick={togglePin} className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title={pinned ? 'Collapse' : 'Pin sidebar'}>
              {pinned ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {navItems.map(item => {
            const active = item.to === '/admin'
              ? location.pathname === '/admin'
              : item.to === '/dashboard'
              ? location.pathname === '/dashboard'
              : location.pathname.startsWith(item.to);
            return (
              <Link key={item.to + item.label} to={item.to}
                className={`
                  group relative flex items-center gap-2.5 h-8 px-2 rounded
                  transition-colors duration-75
                  ${active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                `}
                title={!expanded ? item.label : undefined}
              >
                {active && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-primary" />}
                <item.icon className={`h-[15px] w-[15px] shrink-0 ${active ? 'text-primary' : ''}`} />
                {expanded && (
                  <span className="text-[12.5px] font-medium truncate whitespace-nowrap">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer — Cmd-K + user */}
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

          <Link to="/profile"
            className="w-full flex items-center gap-2 h-9 px-1.5 rounded hover:bg-muted transition-colors">
            <Avatar name={user?.name} email={user?.email} url={user?.avatarUrl} size="sm" tone="primary" />
            {expanded && (
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-[12px] font-semibold truncate">{user?.name || 'User'}</p>
                <p className="text-[10px] text-muted-foreground truncate capitalize">{role || 'guest'}</p>
              </div>
            )}
          </Link>

          {expanded && (
            <button onClick={logout}
              className="w-full flex items-center gap-2 h-8 px-2 rounded text-muted-foreground hover:text-rose-700 hover:bg-rose-500/10 transition-colors">
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
