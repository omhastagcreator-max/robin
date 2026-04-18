import { useState, useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bird, LayoutDashboard, ListTodo, Video, Bell, User, LogOut,
  Briefcase, Users, Building2, BarChart2, TrendingUp, Menu, X, ChevronRight
} from 'lucide-react';
import * as api from '@/api';

interface NavItem { to: string; label: string; icon: React.ElementType; roles?: string[]; }

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',        label: 'Dashboard',  icon: LayoutDashboard, roles: ['employee'] },
  { to: '/admin',            label: 'Dashboard',  icon: LayoutDashboard, roles: ['admin'] },
  { to: '/client',           label: 'Dashboard',  icon: LayoutDashboard, roles: ['client'] },
  { to: '/sales',            label: 'Dashboard',  icon: LayoutDashboard, roles: ['sales'] },
  { to: '/tasks',            label: 'My Tasks',   icon: ListTodo,        roles: ['employee', 'admin', 'sales'] },
  { to: '/admin/projects',   label: 'Projects',   icon: Briefcase,       roles: ['admin'] },
  { to: '/admin/employees',  label: 'Employees',  icon: Users,           roles: ['admin'] },
  { to: '/admin/clients',    label: 'Clients',    icon: Building2,       roles: ['admin'] },
  { to: '/admin/reports',    label: 'Reports',    icon: BarChart2,       roles: ['admin'] },
  { to: '/workroom',         label: 'Work Room',  icon: Video,           roles: ['admin', 'employee', 'sales'] },
  { to: '/notifications',    label: 'Notifications', icon: Bell },
  { to: '/profile',          label: 'Profile',    icon: User },
];

interface Props { children: ReactNode; requiredRole?: string | string[]; }

export function AppLayout({ children, requiredRole }: Props) {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Poll unread notifications
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api.listNotifications({ page: 1, limit: 50 });
        setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.isRead).length : 0);
      } catch { /* ignore */ }
    };
    poll();
    const i = setInterval(poll, 30000);
    return () => clearInterval(i);
  }, []);

  const visibleNav = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(role));

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = location.pathname === item.to;
    return (
      <Link to={item.to} onClick={() => setSidebarOpen(false)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
          active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}>
        <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'group-hover:text-foreground'}`} />
        <span className="flex-1">{item.label}</span>
        {item.to === '/notifications' && unreadCount > 0 && (
          <span className="h-4.5 w-4.5 rounded-full bg-primary text-[10px] text-primary-foreground font-bold flex items-center justify-center px-1">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
        {active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-full" />}
      </Link>
    );
  };

  const Sidebar = ({ mobile = false }) => (
    <div className={`h-full flex flex-col ${mobile ? ' p-4' : 'p-5'} gap-2`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-3 mb-2">
        <div className="h-8 w-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
          <Bird className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="font-bold text-sm">Robin</p>
          <p className="text-[10px] text-muted-foreground capitalize">{role}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5">
        {visibleNav.map(item => <NavLink key={item.to} item={item} />)}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-border pt-3 mt-2">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{(user?.name || user?.email || '?')[0].toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
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
      <aside className="hidden lg:flex flex-col w-60 xl:w-64 border-r border-border shrink-0 sticky top-0 h-screen overflow-y-auto">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 30 }}
              className="fixed top-0 left-0 h-full w-72 bg-card border-r border-border z-50 lg:hidden overflow-y-auto">
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
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-lg sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Bird className="h-5 w-5 text-primary" />
            <span className="font-bold text-sm">Robin</span>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
