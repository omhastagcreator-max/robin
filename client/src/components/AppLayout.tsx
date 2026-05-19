import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bird, LayoutDashboard, ListTodo, Video, Bell, User, LogOut,
  Briefcase, Users, Building2, BarChart2, TrendingUp, Menu, X,
  MessageSquare, Monitor, MonitorOff, KeyRound, CalendarOff, Clock,
  BarChart3, Calendar, Bug, CalendarDays, Workflow, UserPlus,
} from 'lucide-react';
import { Avatar } from '@/components/shared/Avatar';
import { dashboardForRole } from '@/components/ProtectedRoute';
import * as api from '@/api';
import { useSocket } from '@/hooks/useSocket';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { toast } from 'sonner';
import { CommandPalette } from '@/components/shared/CommandPalette';
import { PresenceStrip } from '@/components/shared/PresenceStrip';
import { SessionTopBar } from '@/components/shared/SessionTopBar';
import { ScreenShareReminder } from '@/components/shared/ScreenShareReminder';
import { ClientMeetingDock } from '@/components/shared/ClientMeetingDock';
import { MeetingQuickFab } from '@/components/shared/MeetingQuickFab';
import { ScheduleMeetingButton } from '@/components/shared/ScheduleMeetingButton';
import { StartClientMeetingButton } from '@/components/shared/StartClientMeetingButton';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  team?: string;
  anyTeam?: string[];
  /** Show only if user has this delegated permission flag set to true. */
  requiresFlag?: 'canManageWorkroom';
}

const NAV_ITEMS: NavItem[] = [
  // ── Role dashboards ────────────────────────────────────────────────
  { to: '/dashboard',         label: 'Dashboard',    icon: LayoutDashboard, roles: ['employee'] },
  { to: '/admin',             label: 'Dashboard',    icon: LayoutDashboard, roles: ['admin'] },
  { to: '/client',            label: 'Dashboard',    icon: LayoutDashboard, roles: ['client'] },
  { to: '/sales',             label: 'Dashboard',    icon: LayoutDashboard, roles: ['sales'] },
  // Workroom-only role lands here — a tiny page with "Open Workroom" +
  // "Join huddle" buttons. They see no other nav items.
  { to: '/workroom-home',     label: 'Dashboard',    icon: LayoutDashboard, roles: ['workroom'] },

  // ── Employee + admin + sales shared tools ─────────────────────────
  // Restored to pre-restriction state: sales sees everything except the
  // admin-only management pages.
  { to: '/tasks',             label: 'My Tasks',     icon: ListTodo,        roles: ['employee', 'admin', 'sales'] },
  { to: '/admin/projects',    label: 'Projects',     icon: Briefcase,       roles: ['admin'] },
  { to: '/admin/employees',   label: 'Employees',    icon: Users,           roles: ['admin'] },
  { to: '/admin/clients',     label: 'Clients',      icon: Building2,       roles: ['admin'] },
  // Sales CRM (leads kanban) — admin + sales both see it.
  { to: '/sales',             label: 'Sales CRM',    icon: BarChart2,       roles: ['admin'] },
  { to: '/admin/reports',     label: 'Reports',      icon: BarChart2,       roles: ['admin'] },
  { to: '/admin/leaves',      label: 'Leave Approvals', icon: CalendarOff,  roles: ['admin'] },
  { to: '/admin/attendance',  label: 'Attendance',   icon: Clock,           roles: ['admin'] },
  { to: '/admin/crash-logs',  label: 'Crash Logs',   icon: Bug,             roles: ['admin'] },
  // Onboard a workroom teammate — admin always, employees/sales only when
  // admin has flipped canManageWorkroom on their profile. Same nav entry
  // surfaces in both cases via the `requiresFlag` shortcut below.
  { to: '/workroom-onboard',  label: 'Onboard Workroom', icon: UserPlus,    roles: ['admin'] },
  { to: '/workroom-onboard',  label: 'Onboard Workroom', icon: UserPlus,    roles: ['employee', 'sales'], requiresFlag: 'canManageWorkroom' },
  { to: '/leaves',            label: 'My Leaves',    icon: CalendarOff,     roles: ['employee', 'sales'] },
  { to: '/workroom',          label: 'Work Room',    icon: Video,           roles: ['admin', 'employee', 'sales', 'workroom'] },
  { to: '/team/calendar',     label: 'Team Calendar', icon: Calendar,       roles: ['admin', 'employee', 'sales'] },
  { to: '/client-schedule',   label: 'Client Schedule', icon: CalendarDays, roles: ['admin', 'employee', 'sales'] },
  { to: '/clients/pipeline',  label: 'Client Pipeline', icon: Workflow,     roles: ['admin', 'employee', 'sales'] },
  { to: '/vault',             label: 'Client Vault', icon: KeyRound,        roles: ['admin', 'employee', 'sales'] },
  { to: '/chat',              label: 'Group Chat',   icon: MessageSquare,   roles: ['admin', 'employee', 'sales'] },
  { to: '/influencers',       label: 'Influencer Sheet', icon: Users,       roles: ['employee'], team: 'influencer' },
  // Meta Ads — admin sees it always; employees ONLY when their primary
  // team OR teams[] contains 'meta' / 'ads'. If a dev (like Om) is seeing
  // it, an admin previously granted them 'meta' or 'ads' as a secondary
  // team chip — clean it up in Admin → Employees by un-ticking that chip.
  // 'sales' deliberately excluded — that role no longer manages campaigns.
  { to: '/ads/meta',          label: 'Meta Ads',     icon: BarChart3,       roles: ['admin'] },
  { to: '/ads/meta',          label: 'Meta Ads',     icon: BarChart3,       roles: ['employee'], anyTeam: ['meta', 'ads'] },
  // Bottom nav
  { to: '/notifications',    label: 'Notifications', icon: Bell },
  { to: '/profile',          label: 'Profile',      icon: User },
];

interface Props { children: ReactNode; requiredRole?: string | string[]; }

/**
 * Nesting guard — when the layout is already mounted higher in the tree
 * (i.e. a parent route renders it persistently), inner `<AppLayout>`
 * wrappers inside pages become pass-throughs. This is what kills the
 * "screen goes blank on every nav" flash: the chrome (sidebar, top bar,
 * huddle dock) stays mounted once, and only the inner content swaps when
 * the user navigates.
 *
 * Pages don't need to know about this — they keep their existing
 * `<AppLayout>...</AppLayout>` wrappers; this context just makes those
 * inner wrappers no-op when the persistent shell is already rendering.
 */
const AppLayoutNestedCtx = createContext(false);

export function AppLayout({ children, requiredRole }: Props) {
  const isNested = useContext(AppLayoutNestedCtx);
  if (isNested) {
    // Already inside a persistent AppLayout shell — just render children.
    // The shell handles all the chrome and role gating.
    return <>{children}</>;
  }
  return <AppLayoutInner requiredRole={requiredRole}>{children}</AppLayoutInner>;
}

/**
 * Render-prop helper for the persistent shell. Used by the parent layout
 * route in App.tsx — it renders the chrome ONCE and yields an <Outlet />
 * via children, so navigations swap only the inner content.
 */
export function PersistentAppLayout({ children }: { children: ReactNode }) {
  return <AppLayoutInner>{children}</AppLayoutInner>;
}

function AppLayoutInner({ children, requiredRole }: Props) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const socket = useSocket();
  const { isSharing, stopSharing } = useScreenShare();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  // ── Poll unread notifications (REST) — visible-only, silent ─────────────
  // Was a plain setInterval that fired every 30s even on backgrounded tabs.
  // useVisiblePoll pauses when document.hidden — saves CPU + battery.
  // Stretched to 60s and marked silent so a transient 401 on a background
  // tick can never bounce the user to /login mid-session.
  useVisiblePoll(async () => {
    try {
      const data = await api.listNotifications({ limit: 50, silent: true });
      setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.isRead).length : 0);
    } catch { /* swallow — silent header keeps interceptor quiet */ }
  }, 60_000);

  // ── Today's client schedule reminder ────────────────────────────────────
  // Fires ONCE per session (per logged-in user, per IST day) when the user
  // first lands in the app. Surfaces a single toast listing the clients
  // they're scheduled to serve today, with a quick-link to the schedule
  // page. Uses sessionStorage so navigating around doesn't re-fire it; uses
  // an IST-day key so a tab left open across midnight re-fires next day.
  useEffect(() => {
    // Workroom role doesn't own client schedules — skip the daily toast.
    if (!user || !['admin', 'employee', 'sales'].includes(role)) return;
    // (workroom intentionally excluded — they don't see schedule pages)
    const istNow = new Date(Date.now() + 330 * 60_000);
    const istDayKey = istNow.toISOString().slice(0, 10);
    const flagKey = `robin.todaySchedule.shown.${user.id}.${istDayKey}`;
    if (sessionStorage.getItem(flagKey) === '1') return;
    sessionStorage.setItem(flagKey, '1');

    api.todaysClientSchedule()
      .then((items: any[]) => {
        if (!Array.isArray(items) || items.length === 0) return;
        const names = items
          .filter(i => i.status !== 'done' && i.status !== 'skipped')
          .map(i => i.clientName)
          .filter(Boolean);
        if (names.length === 0) return;
        const description = names.length <= 3
          ? names.join(', ')
          : `${names.slice(0, 3).join(', ')} + ${names.length - 3} more`;
        toast(`Today's clients · ${names.length}`, {
          description,
          icon: '📋',
          duration: 9000,
          action: {
            label: 'Open schedule',
            onClick: () => { window.location.href = '/client-schedule'; },
          },
        });
      })
      .catch(() => { /* silent — interceptor handles real errors */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role]);

  // ── Real-time: Socket.io notification + chat unread ───────────────────────
  useEffect(() => {
    if (!socket) return;

    // CRITICAL: `socket.off('event')` with no handler unbinds EVERY listener
    // for that event across the whole app. GroupChat, HuddlePingChat, and
    // others all listen to chat:message — wiping them silently is what
    // caused "chat goes dead after I navigate around" complaints.
    // Use named handlers + `socket.off(event, handler)` so we only remove
    // OUR listener.
    const onNotification = (data: { title: string; body?: string; message?: string; type?: string }) => {
      setUnreadCount(c => c + 1);
      toast(data.title, {
        description: data.body || data.message,
        icon: '🔔',
        duration: 6000,
      });
    };
    const onChatMention = (data: { from: string; content: string }) => {
      if (!location.pathname.startsWith('/chat')) {
        setChatUnread(c => c + 1);
        toast(`${data.from} mentioned you`, { description: data.content, icon: '💬', duration: 5000 });
      }
    };
    const onChatMessage = () => {
      if (!location.pathname.startsWith('/chat')) {
        setChatUnread(c => c + 1);
      }
    };

    socket.on('notification:new', onNotification);
    socket.on('chat:mention',     onChatMention);
    socket.on('chat:message',     onChatMessage);

    return () => {
      socket.off('notification:new', onNotification);
      socket.off('chat:mention',     onChatMention);
      socket.off('chat:message',     onChatMessage);
    };
  }, [socket, location.pathname]);

  // Clear chat unread when visiting /chat
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) setChatUnread(0);
  }, [location.pathname]);

  const visibleNav = (() => {
    const matched = NAV_ITEMS.filter(item => {
      if (item.roles && !item.roles.includes(role)) return false;
      if (item.team) {
        const userTeams = [user?.team, ...((user as any)?.teams || [])].filter(Boolean);
        if (!userTeams.includes(item.team)) return false;
      }
      if (item.anyTeam) {
        const userTeams = [user?.team, ...((user as any)?.teams || [])].filter(Boolean);
        if (!item.anyTeam.some(t => userTeams.includes(t))) return false;
      }
      // Delegated permission flag — currently only canManageWorkroom.
      if (item.requiresFlag === 'canManageWorkroom' && (user as any)?.canManageWorkroom !== true) return false;
      return true;
    });
    // Dedupe by URL — some pages (e.g. Meta Ads) have two entries so a
    // user can match via admin role OR team-grant. Without this, an admin
    // who's also granted the 'meta' team would see 'Meta Ads' twice.
    const seen = new Set<string>();
    return matched.filter(i => seen.has(i.to) ? false : (seen.add(i.to), true));
  })();

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = item.to === '/admin'
      ? location.pathname === '/admin'
      : item.to === '/dashboard'
      ? location.pathname === '/dashboard'
      : location.pathname.startsWith(item.to);

    const isNotif = item.to === '/notifications';
    const isChat  = item.to === '/chat';
    const badge = isNotif ? unreadCount : isChat ? chatUnread : 0;

    return (
      <Link to={item.to} onClick={() => setSidebarOpen(false)}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors group relative ${
          active
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        }`}>
        <item.icon className={`h-[15px] w-[15px] shrink-0 ${active ? 'text-primary' : ''}`} />
        <span className="flex-1 truncate">{item.label}</span>
        {badge > 0 && (
          <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] text-white font-bold flex items-center justify-center px-1 ${isChat ? 'bg-green-500' : 'bg-primary'}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  };

  /**
   * Cleaner sidebar — calm, single-color, minimal chrome.
   * - Logo gets real breathing room (was crammed into 3 rows of header text).
   * - Nav items lose the shadow + accent bar; the active state is just a
   *   tint of primary — quieter, easier to scan.
   * - Quick actions section + ⌘K hint kept but visually de-emphasised.
   * - User block at the bottom no longer has a hard border separator —
   *   the natural whitespace does the job.
   */
  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`h-full flex flex-col ${mobile ? 'p-4' : 'p-4'} gap-1`}>
      {/* Logo — single line, more confident */}
      <Link to={dashboardForRole(role)} className="flex items-center gap-2.5 px-2 py-3 mb-3 rounded-lg hover:bg-muted/40 transition-colors">
        <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
          <Bird className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-black text-base text-foreground leading-tight">Robin</p>
          <p className="text-[10px] text-muted-foreground capitalize leading-tight">{role || 'guest'}</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto -mx-1 px-1">
        {visibleNav.map(item => <NavLink key={item.to} item={item} />)}
      </nav>

      {/* Quick actions — meeting shortcuts available from every page */}
      {['admin', 'employee', 'sales'].includes(role) && (
        <div className="space-y-1 mt-3 mb-1 px-1">
          <p className="text-[9px] uppercase font-semibold tracking-[0.14em] text-muted-foreground/70 px-2 mb-1">Quick actions</p>
          <div className="flex flex-col gap-1">
            <ScheduleMeetingButton />
            <StartClientMeetingButton />
          </div>
        </div>
      )}

      {/* ⌘K hint — calmer; no dashed border noise */}
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
        title="Open the command palette"
      >
        <span className="flex-1 text-left">Jump anywhere</span>
        <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">⌘K</kbd>
      </button>

      {/* User + Logout — no hard divider, breathing room does the job */}
      <div className="pt-2 mt-1">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={user?.name} email={user?.email} url={user?.avatarUrl} size="sm" tone="primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold truncate text-foreground leading-tight">{user?.name || 'User'}</p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">{user?.email}</p>
          </div>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <LogOut className="h-[15px] w-[15px]" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <AppLayoutNestedCtx.Provider value={true}>
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-60 xl:w-64 border-r border-border shrink-0 sticky top-0 h-screen overflow-y-auto bg-card shadow-sm">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 30 }}
              className="fixed top-0 left-0 h-full w-72 bg-card border-r border-border z-50 lg:hidden overflow-y-auto shadow-xl">
              <button onClick={() => setSidebarOpen(false)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
              <Sidebar mobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card sticky top-0 z-30 shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Bird className="h-5 w-5 text-primary" />
            <span className="font-bold text-sm text-foreground">Robin</span>
          </div>
          {/* Mobile notification badge */}
          {unreadCount > 0 && (
            <Link to="/notifications" className="ml-auto relative">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[9px] text-white font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </Link>
          )}
        </header>

        {/* If host is in a client meeting, sticky pill on every page with
            mute / end / back-to-meeting controls. Hidden on the meeting
            page itself (full controls already there). */}
        <ClientMeetingDock />

        {/* Sticky session controls — timer + start/break/end on every page */}
        <SessionTopBar />

        {/* Persistent break / leave strip — visible on every page */}
        <PresenceStrip />

        {/* Headless reminder — toasts every 10 min if the user is on the
            clock, not on break, and not currently sharing. employee/sales
            roles only (admins/clients aren't expected to share). */}
        <ScreenShareReminder />

        {isSharing && (
          <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 flex items-center justify-between sticky top-0 z-20 w-full animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <p className="text-xs font-bold text-green-600">Your screen is currently being broadcasted live to your teammates</p>
            </div>
            <button onClick={stopSharing} className="text-xs flex items-center gap-1.5 bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600 shadow-sm">
              <MonitorOff className="h-3 w-3" /> Stop Sharing
            </button>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {children}
        </div>
      </main>

      {/* Global command palette — Cmd-K / Ctrl-K from anywhere */}
      <CommandPalette />
      {/* Floating "Start meeting" button — one tap from any page. Hidden
          on the meeting page itself; collapses to a green "Back to meeting"
          pill when a meeting is already in progress. */}
      <MeetingQuickFab />
    </div>
    </AppLayoutNestedCtx.Provider>
  );
}
