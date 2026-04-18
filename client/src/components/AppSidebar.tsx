import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Video, Users, BarChart3, LogOut, Briefcase,
  TrendingUp, Bell, User, ChevronRight, ChevronLeft, Building2, MessageSquare, Bird
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const employeeItems = [
  { title: 'Dashboard',     url: '/dashboard', icon: LayoutDashboard },
  { title: 'My Tasks',      url: '/tasks',     icon: ListTodo },
  { title: 'Work Room',     url: '/workroom',  icon: Video },
  { title: 'Group Chat',    url: '/chat',      icon: MessageSquare },
];
const adminItems = [
  { title: 'Overview',      url: '/admin',             icon: LayoutDashboard },
  { title: 'Projects',      url: '/admin/projects',    icon: Briefcase },
  { title: 'Clients',       url: '/admin/clients',     icon: Building2 },
  { title: 'Employees',     url: '/admin/employees',   icon: Users },
  { title: 'Reports',       url: '/admin/reports',     icon: BarChart3 },
  { title: 'Work Room',     url: '/workroom',          icon: Video },
  { title: 'Group Chat',    url: '/chat',              icon: MessageSquare },
  { title: 'All Tasks',     url: '/tasks',             icon: ListTodo },
];
const clientItems = [
  { title: 'My Dashboard',  url: '/client',    icon: TrendingUp },
  { title: 'Work Room',     url: '/workroom',  icon: Video },
];
const salesItems = [
  { title: 'Sales CRM',     url: '/sales',     icon: LayoutDashboard },
  { title: 'Work Room',     url: '/workroom',  icon: Video },
  { title: 'Group Chat',    url: '/chat',      icon: MessageSquare },
];
const sharedBottom = [
  { title: 'Profile',       url: '/profile',       icon: User },
  { title: 'Notifications', url: '/notifications', icon: Bell },
];

export function AppSidebar({ unreadCount = 0, chatUnread = 0 }: { unreadCount?: number; chatUnread?: number }) {
  const { role, user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const items = role === 'admin' ? adminItems : role === 'client' ? clientItems : role === 'sales' ? salesItems : employeeItems;
  const all = [...items, ...sharedBottom];

  return (
    <aside className={cn(
      'hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur transition-all duration-300 shrink-0',
      collapsed ? 'w-16' : 'w-56'
    )}>
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Bird className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && <span className="font-bold text-sm text-foreground">Robin</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {all.map(item => {
          const active = item.url === '/admin'
            ? location.pathname === '/admin'
            : item.url === '/dashboard'
            ? location.pathname === '/dashboard'
            : location.pathname.startsWith(item.url);
          const isNotif = item.url === '/notifications';
          const isChat  = item.url === '/chat';
          return (
            <Link
              key={item.url}
              to={item.url}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors relative',
                active
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.title}</span>}
              {isNotif && unreadCount > 0 && (
                <span className={cn(
                  'rounded-full bg-primary text-primary-foreground text-[10px] font-bold',
                  collapsed ? 'absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center' : 'ml-auto px-1.5'
                )}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
              {isChat && chatUnread > 0 && (
                <span className={cn(
                  'rounded-full bg-green-500 text-white text-[10px] font-bold',
                  collapsed ? 'absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center' : 'ml-auto px-1.5'
                )}>
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border space-y-1">
        {!collapsed && user && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground truncate">
            <span className="block font-medium text-foreground">{user.name}</span>
            <span className="capitalize">{user.role}{user.team ? ` · ${user.team}` : ''}</span>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && 'Sign Out'}
        </button>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-center py-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
