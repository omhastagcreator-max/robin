import { useLocation, Link } from 'react-router-dom';
import { Search, Bell } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadCounts } from '@/contexts/UnreadCountsContext';

/**
 * Robin v2 topbar — 44px tall, sticky, dense.
 *
 * Layout:
 *   [breadcrumbs]                [⌘K search]                [bell] [profile]
 *
 * Breadcrumbs are auto-derived from the URL path. The search is a visible
 * surface — clicking opens the existing command palette via ⌘K key dispatch
 * (same as the sidebar Cmd-K button). No more hidden surface.
 */

// Map URL segments → human breadcrumb labels.
const SEG_LABELS: Record<string, string> = {
  admin: 'Admin', dashboard: 'Dashboard', tasks: 'Tasks', clients: 'Clients',
  pipeline: 'Pipeline', sales: 'Sales', workroom: 'Workroom', 'workroom-home': 'Workroom',
  'workroom-onboard': 'Onboard', chat: 'Chat', vault: 'Vault', leaves: 'Leaves',
  team: 'Team', calendar: 'Calendar', 'client-schedule': 'Schedule',
  ads: 'Ads', meta: 'Meta', influencers: 'Influencers',
  profile: 'Profile', notifications: 'Notifications',
  reports: 'Reports', projects: 'Projects', employees: 'Employees',
  attendance: 'Attendance', 'crash-logs': 'Crashes', issues: 'Issues',
  meet: 'Meet', host: 'Host',
};

function labelize(seg: string) {
  return SEG_LABELS[seg] || seg.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

export function TopBar() {
  const location = useLocation();
  const { user } = useAuth();
  const { notifications: notifUnread } = useUnreadCounts();
  const segs = location.pathname.split('/').filter(Boolean);

  return (
    <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border"
      style={{ height: 'var(--h-topbar)' }}>
      <div className="h-full px-4 flex items-center gap-4">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-[12.5px] min-w-0">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">Robin</Link>
          {segs.map((seg, i) => {
            const path = '/' + segs.slice(0, i + 1).join('/');
            const isLast = i === segs.length - 1;
            // Skip ID-like segments (Mongo ObjectIds) for cleaner crumbs.
            const isId = /^[a-f0-9]{20,}$/i.test(seg);
            return (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                <span className="text-muted-foreground/40">/</span>
                {isLast || isId
                  ? <span className="font-semibold truncate text-foreground">{isId ? 'detail' : labelize(seg)}</span>
                  : <Link to={path} className="text-muted-foreground hover:text-foreground transition-colors truncate">{labelize(seg)}</Link>}
              </span>
            );
          })}
        </nav>

        {/* Search — visible, not hidden */}
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="hidden sm:flex flex-1 max-w-md mx-auto items-center gap-2 h-7 px-2.5 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[12px]"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Jump to anything…</span>
          <kbd className="px-1 h-4 text-[9px] rounded bg-card font-mono border border-border">⌘K</kbd>
        </button>

        {/* Right: notifications + profile */}
        <div className="flex items-center gap-1 ml-auto">
          <Link
            to="/notifications"
            className="relative h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={notifUnread > 0 ? `${notifUnread} unread notification${notifUnread === 1 ? '' : 's'}` : 'Notifications'}
          >
            <Bell className="h-4 w-4" />
            {notifUnread > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9.5px] font-bold tabular-nums ring-2 ring-card">
                {notifUnread > 99 ? '99+' : notifUnread}
              </span>
            )}
          </Link>
        </div>

        {/* Mobile — show name */}
        <span className="sm:hidden text-[11px] text-muted-foreground truncate">{user?.name || ''}</span>
      </div>
    </header>
  );
}
