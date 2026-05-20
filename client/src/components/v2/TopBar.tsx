import { useState, useRef, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus, Sparkles, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadCounts } from '@/contexts/UnreadCountsContext';

/**
 * Robin v2 topbar — 44 px tall, sticky, dense.
 *
 * Layout (Google AI Studio inspired, but operational):
 *   [breadcrumbs]                [⌘K search]            [+ create] [✨ AI] [bell] [profile]
 *
 * Breadcrumbs auto-derived from URL. Search opens the command palette
 * via the ⌘K key dispatch. Quick-create surfaces a small menu of the
 * objects an admin/sales user might add fastest (lead, task, client,
 * credential). AI Copilot triggers the help-bubble or the AI-command
 * parser in the command palette.
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
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { notifications: notifUnread } = useUnreadCounts();
  const segs = location.pathname.split('/').filter(Boolean);

  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement | null>(null);

  // Close the create menu when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (createOpen && createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [createOpen]);

  // Build the quick-create menu by role. Clients see nothing here.
  const createItems: Array<{ label: string; to?: string; onClick?: () => void; hint?: string }> = [];
  if (['admin', 'sales'].includes(role)) {
    createItems.push({ label: 'New lead', to: '/sales', hint: 'Sales pipeline' });
    createItems.push({ label: 'New client', to: '/admin/clients', hint: 'Onboard' });
  }
  if (['admin', 'employee', 'sales'].includes(role)) {
    createItems.push({ label: 'New task', to: '/tasks', hint: 'Add / assign' });
    createItems.push({ label: 'New project', to: '/admin/projects', hint: 'Pipeline' });
    createItems.push({ label: 'Add credential', to: '/vault', hint: 'Vault' });
  }
  const hasCreate = createItems.length > 0;

  return (
    <header
      className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border"
      style={{ height: 'var(--h-topbar)' }}
    >
      <div className="h-full px-4 flex items-center gap-3">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-[12.5px] min-w-0 shrink">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">Robin</Link>
          {segs.map((seg, i) => {
            const path = '/' + segs.slice(0, i + 1).join('/');
            const isLast = i === segs.length - 1;
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

        {/* Search */}
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="hidden sm:flex flex-1 max-w-md mx-auto items-center gap-2 h-7 px-2.5 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[12px]"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Jump to anything…</span>
          <kbd className="px-1 h-4 text-[9px] rounded bg-card font-mono border border-border">⌘K</kbd>
        </button>

        {/* Right cluster */}
        <div className="flex items-center gap-1 ml-auto">
          {/* Quick create */}
          {hasCreate && (
            <div className="relative" ref={createRef}>
              <button
                onClick={() => setCreateOpen(v => !v)}
                className={`h-7 inline-flex items-center gap-1 px-2 rounded-md text-[12px] font-semibold transition-colors ${
                  createOpen
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-primary/12 text-primary hover:bg-primary/20'
                }`}
                title="Quick create"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Create</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${createOpen ? 'rotate-180' : ''}`} />
              </button>

              {createOpen && (
                <div className="absolute right-0 mt-1.5 w-56 rounded-lg border border-border bg-card shadow-lg overflow-hidden z-40">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground border-b border-border">
                    Quick create
                  </div>
                  {createItems.map(item => (
                    <button
                      key={item.label}
                      onClick={() => {
                        setCreateOpen(false);
                        if (item.to) navigate(item.to);
                        else item.onClick?.();
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-[12.5px] hover:bg-primary/[0.06] transition-colors text-left"
                    >
                      <span className="font-medium">{item.label}</span>
                      {item.hint && <span className="text-[10.5px] text-muted-foreground">{item.hint}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Copilot — opens the global command palette in AI mode.
              The palette already supports natural-language → action via
              aiParseCommand; this button surfaces it as an explicit entry
              point rather than buried behind ⌘K. */}
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, shiftKey: true }))}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/15 hover:text-accent transition-colors"
            title="AI Copilot — ⌘⇧K"
          >
            <Sparkles className="h-4 w-4" />
          </button>

          {/* Notifications */}
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
