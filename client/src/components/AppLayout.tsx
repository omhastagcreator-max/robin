import { useState, useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bird, LayoutDashboard, ListTodo, Video, Bell, User, LogOut,
  Briefcase, Users, Building2, BarChart2, TrendingUp, Menu, X,
  MessageSquare, Monitor, MonitorOff, KeyRound, CalendarOff
} from 'lucide-react';
import * as api from '@/api';
import { useSocket } from '@/hooks/useSocket';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { toast } from 'sonner';
import { SessionMiniWidget } from '@/components/shared/SessionMiniWidget';
import { CommandPalette } from '@/components/shared/CommandPalette';
import { PresenceStrip } from '@/components/shared/PresenceStrip';

interface NavItem { to: string; label: string; icon: React.ElementType; roles?: string[]; team?: string; }

const NAV_ITEMS: NavItem[] = [
  // Role dashboards
  { to: '/dashboard',        label: 'Dashboard',    icon: LayoutDashboard, roles: ['employee'] },
  { to: '/admin',            label: 'Dashboard',    icon: LayoutDashboard, roles: ['admin'] },
  { to: '/client',           label: 'Dashboard',    icon: LayoutDashboard, roles: ['client'] },
  { to: '/sales',            label: 'Dashboard',    icon: LayoutDashboard, roles: ['sales'] },
  // Shared tools
  { to: '/tasks',            label: 'My Tasks',     icon: ListTodo,        roles: ['employee', 'admin', 'sales'] },
  // Admin management
  { to: '/admin/projects',   label: 'Projects',     icon: Briefcase,       roles: ['admin'] },
  { to: '/admin/employees',  label: 'Employees',    icon: Users,           roles: ['admin'] },
  { to: '/admin/clients',    label: 'Clients',      icon: Building2,       roles: ['admin'] },
  { to: '/admin/reports',    label: 'Reports',      icon: BarChart2,       roles: ['admin'] },
  { to: '/admin/leaves',     label: 'Leave Approvals', icon: CalendarOff,  roles: ['admin'] },
  // Leave applications — employees and sales (private to each user)
  { to: '/leaves',           label: 'My Leaves',    icon: CalendarOff,     roles: ['employee', 'sales'] },
  // Work room
  { to: '/workroom',         label: 'Work Room',    icon: Video,           roles: ['admin', 'employee', 'sales'] },
  // Client credential vault
  { to: '/vault',            label: 'Client Vault', icon: KeyRound,        roles: ['admin', 'employee', 'sales'] },
  // Group Chat — ALL internal roles
  { to: '/chat',             label: 'Group Chat',      icon: MessageSquare,  roles: ['admin', 'employee', 'sales'] },
  // Influencer Sheet — only for influencer team
  { to: '/influencers',      label: 'Influencer Sheet', icon: Users,         roles: ['employee'], team: 'influencer' },
  // Bottom nav
  { to: '/notifications',    label: 'Notifications', icon: Bell },
  { to: '/profile',          label: 'Profile',      icon: User },
];

interface Props { children: ReactNode; requiredRole?: string | string[]; }

export function AppLayout({ children, requiredRole }: Props) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const socket = useSocket();
  const { isSharing, stopSharing } = useScreenShare();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  // ── Poll unread notifications (REST) ─────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api.listNotifications({ limit: 50 });
        setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.isRead).length : 0);
      } catch { /* ignore */ }
    };
    poll();
    const i = setInterval(poll, 30000);
    return () => clearInterval(i);
  }, []);

  // ── Real-time: Socket.io notification + chat unread ───────────────────────
  useEffect(() => {
    if (!socket) return;

    // New push notification arrives
    socket.on('notification:new', (data: { title: string; body?: string; message?: string; type?: string }) => {
      setUnreadCount(c => c + 1);
      toast(data.title, {
        description: data.body || data.message,
        icon: '🔔',
        duration: 6000,
      });
    });

    // Chat mention — increment chat badge if not on /chat page
    socket.on('chat:mention', (data: { from: string; content: string }) => {
      if (!location.pathname.startsWith('/chat')) {
        setChatUnread(c => c + 1);
        toast(`${data.from} mentioned you`, { description: data.content, icon: '💬', duration: 5000 });
      }
    });

    // New chat message badge (if not on /chat)
    socket.on('chat:message', () => {
      if (!location.pathname.startsWith('/chat')) {
        setChatUnread(c => c + 1);
      }
    });

    return () => {
      socket.off('notification:new');
      socket.off('chat:mention');
      socket.off('chat:message');
    };
  }, [socket, location.pathname]);

  // Clear chat unread when visiting /chat
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) setChatUnread(0);
  }, [location.pathname]);

  const visibleNav = NAV_ITEMS.filter(item => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.team  && item.team !== user?.team)   return false;
    return true;
  });

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
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
          active
            ? 'bg-primary/12 text-primary shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
        }`}>
        <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : ''}`} />
        <span className="flex-1">{item.label}</span>
        {badge > 0 && (
          <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] text-white font-bold flex items-center justify-center px-1 ${isChat ? 'bg-green-500' : 'bg-primary'}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-full" />}
      </Link>
    );
  };

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`h-full flex flex-col ${mobile ? 'p-4' : 'p-5'} gap-2`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-3 mb-2">
        <div className="h-8 w-8 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center">
          <Bird className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="font-bold text-sm text-foreground">Robin</p>
          <p className="text-[10px] text-muted-foreground capitalize">{role}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {visibleNav.map(item => <NavLink key={item.to} item={item} />)}
      </nav>

      {/* Quick keyboard shortcut hint — clickable for mouse users, also opens via Cmd/Ctrl-K */}
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        className="flex items-center gap-2 px-3 py-2 mb-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
        title="Open the command palette"
      >
        <span className="flex-1 text-left">Jump anywhere</span>
        <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[10px]">⌘K</kbd>
      </button>

      {/* Session mini-widget — visible across every page for employee/sales */}
      <div className="px-1">
        <SessionMiniWidget />
      </div>

      {/* User + Logout */}
      <div className="border-t border-border pt-3 mt-2">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{(user?.name || user?.email || '?')[0].toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate text-foreground">{user?.name || 'User'}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
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

        {/* Persistent break / leave strip — visible on every page */}
        <PresenceStrip />

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
    </div>
  );
}
