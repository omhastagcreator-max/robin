import { useState, useRef, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus, Sparkles, ChevronDown, Sunrise, CloudSun, Moon, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadCounts } from '@/contexts/UnreadCountsContext';
import { useRobinCopilot } from '@/components/ai/RobinCopilot';
import { HuddleQuickPill } from '@/components/shared/HuddleQuickPill';
import { useCheckin, type CheckinKind } from '@/contexts/CheckinContext';

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
  pipeline: 'Client CRM', sales: 'Sales', workroom: 'Workroom', 'workroom-home': 'Workroom',
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
  const openCopilot = useRobinCopilot();
  const segs = location.pathname.split('/').filter(Boolean);

  // Global hotkey ⌘⇧K / Ctrl-Shift-K to open the Copilot drawer from any
  // page. Pairs with the Sparkles button below — both hit the same opener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCopilot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCopilot]);

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
    createItems.push({ label: 'New project', to: '/admin/projects', hint: 'Client CRM' });
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
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Persistent Huddle pill — always visible so the team's "join the
              room" button is one click away on every page, not buried in the
              Workroom tab. Hidden on /workroom because HuddleStage already
              shows the full controls there (avoid duplicate UI). The pill
              auto-adapts to mode: Join / Connecting / In-huddle. */}
          {role !== 'client' && !location.pathname.startsWith('/workroom') && (
            <div className="hidden md:block">
              <HuddleQuickPill />
            </div>
          )}

          {/* Daily check-in quick pill — owner ask (June 2026): when the
              auto-popup silently skips (timing race, status load failure,
              tab reopened mid-day), this gives every teammate a permanent
              one-click way to open whichever check-in is pending. Pulses
              when something needs filling so it's impossible to miss; goes
              quiet (just a green tick) when the whole day's been logged. */}
          {role !== 'client' && <CheckinQuickPill />}

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

          {/* Robin Copilot — context-aware AI drawer. Reads the current
              route + role on the server side to pull the right slice of
              operational data (workflow / leads / tasks / at-risk projects)
              into the prompt. Hotkey: ⌘⇧K. */}
          <button
            onClick={openCopilot}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/15 hover:text-accent transition-colors"
            title="Robin Copilot — ⌘⇧K"
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

/* ────────────────────── CheckinQuickPill ──────────────────────────── */

/**
 * Topbar pill that opens the next pending check-in (morning → midday →
 * evening). Always visible for internal roles so users never have to
 * wonder "where did the popup go" when the auto-open silently skips.
 *
 * States:
 *   - morning pending → amber pulse, label "Morning check-in"
 *   - midday  pending (and after 1pm IST) → sky pulse, "Midday check-in"
 *   - evening pending (and morning done)   → indigo pulse, "Wrap day"
 *   - all done → green tick, "All check-ins done"
 *
 * The pulse animation is critical — without it, the button blends into
 * the row of icons and gets ignored. With it, eyes track straight to it.
 */
function CheckinQuickPill() {
  const { status, morningDone, middayDone, eveningDone, open } = useCheckin();

  if (!status) return null;          // not loaded yet — render nothing
  // Decide which check-in to point at first.
  let kind: CheckinKind | null = null;
  let label = '';
  let pulse = '';
  let bg    = '';
  let Icon  = Sunrise;

  if (!morningDone) {
    kind = 'morning';
    label = 'Morning check-in';
    pulse = 'animate-pulse';
    bg    = 'bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 border-amber-500/40';
    Icon  = Sunrise;
  } else {
    // Midday is "due" only after 1pm IST.
    const ist = new Date(Date.now() + 330 * 60_000);
    const istHour = ist.getUTCHours();
    if (!middayDone && istHour >= 13) {
      kind = 'midday';
      label = 'Midday check-in';
      pulse = 'animate-pulse';
      bg    = 'bg-sky-500/15 text-sky-800 hover:bg-sky-500/25 border-sky-500/40';
      Icon  = CloudSun;
    } else if (!eveningDone) {
      // Evening is always offerable once morning is done.
      kind = 'evening';
      label = 'Wrap day';
      pulse = istHour >= 18 ? 'animate-pulse' : '';
      bg    = 'bg-indigo-500/15 text-indigo-800 hover:bg-indigo-500/25 border-indigo-500/40';
      Icon  = Moon;
    } else {
      // All three done — render a quiet acknowledgement instead of nothing
      // so the user has feedback that the system is tracking them.
      return (
        <span
          className="hidden md:inline-flex h-7 px-2 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 text-[11.5px] font-semibold"
          title="All three check-ins done today"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Day logged</span>
        </span>
      );
    }
  }

  if (!kind) return null;

  return (
    <button
      onClick={() => open(kind!)}
      className={`hidden md:inline-flex h-7 px-2.5 items-center gap-1.5 rounded-md border text-[11.5px] font-semibold transition-colors ${bg}`}
      title={`Open ${label.toLowerCase()} — required`}
    >
      <span className={`relative inline-flex h-2 w-2 rounded-full bg-current ${pulse}`} />
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
