import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { MonitorOff } from 'lucide-react';
import * as api from '@/api';
import { useSocket } from '@/hooks/useSocket';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { toast } from 'sonner';
import { CommandPalette } from '@/components/shared/CommandPalette';
import { PresenceStrip } from '@/components/shared/PresenceStrip';
import { SessionTopBar } from '@/components/shared/SessionTopBar';
import { HuddleAutoBreak } from '@/components/shared/HuddleAutoBreak';
import { RobinOrb } from '@/components/shared/RobinOrb';
import { ScreenShareRequiredBanner } from '@/components/shared/ScreenShareRequiredBanner';
import { HuddleRequiredBanner } from '@/components/shared/HuddleRequiredBanner';
import { ScreenShareReminder } from '@/components/shared/ScreenShareReminder';
import { ScreenShareResumeBanner } from '@/components/shared/ScreenShareResumeBanner';
import { ClientMeetingDock } from '@/components/shared/ClientMeetingDock';
import { MeetingQuickFab } from '@/components/shared/MeetingQuickFab';
import { HelpBubble } from '@/components/shared/HelpBubble';
import { AiCopilotPanel } from '@/components/shared/AiCopilotPanel';
import { GlobalSearch } from '@/components/shared/GlobalSearch';
import { AssignTaskModal } from '@/components/shared/AssignTaskModal';
import { SlimSidebar }     from '@/components/v2/SlimSidebar';
import { TopBar }          from '@/components/v2/TopBar';
import { GlobalShortcuts } from '@/components/v2/GlobalShortcuts';
import { CheckinOrchestrator } from '@/components/checkin/CheckinOrchestrator';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { useKnock }        from '@/hooks/useKnock';
import { useAppUpdater }   from '@/hooks/useAppUpdater';
import { celebrate }       from '@/lib/celebrate';

/**
 * AppLayout — the persistent application shell.
 *
 * One sidebar (`SlimSidebar` v2), one topbar (`TopBar` v2), one set of
 * persistent chrome (session strip, presence strip, meeting dock, screen-
 * share banners, command palette, help bubble, global shortcuts). Every
 * authenticated route renders inside this shell exactly once — pages that
 * still wrap their content in `<AppLayout>` become pass-throughs via the
 * AppLayoutNestedCtx guard, so the chrome doesn't double-mount.
 *
 * Historical note: there used to be an inline `Sidebar` + `NavLink` here
 * (~90 lines of dead code) from before the persistent-shell refactor.
 * Removed in May 2026 — never rendered, only confused audits.
 */

interface Props {
  children: ReactNode;
  /** Legacy prop — no-op. Route gating now lives in <ProtectedRoute>.
   *  Accepted for backwards compat so we don't need to touch every page
   *  that still passes it. Delete on the next sweep through pages. */
  requiredRole?: string | string[];
}

/**
 * Nesting guard — when the layout is already mounted higher in the tree
 * (i.e. a parent route renders it persistently), inner `<AppLayout>`
 * wrappers inside pages become pass-throughs. This is what kills the
 * "screen goes blank on every nav" flash: the chrome (sidebar, top bar,
 * huddle dock) stays mounted once, and only the inner content swaps when
 * the user navigates.
 */
const AppLayoutNestedCtx = createContext(false);

export function AppLayout({ children }: Props) {
  const isNested = useContext(AppLayoutNestedCtx);
  if (isNested) return <>{children}</>;
  return <AppLayoutInner>{children}</AppLayoutInner>;
}

/**
 * Render-prop helper for the persistent shell. Used by the parent layout
 * route in App.tsx — renders the chrome ONCE and yields an <Outlet />
 * via children, so navigations swap only the inner content.
 */
export function PersistentAppLayout({ children }: { children: ReactNode }) {
  return <AppLayoutInner>{children}</AppLayoutInner>;
}

function AppLayoutInner({ children }: Props) {
  const { user, role } = useAuth();
  const location = useLocation();
  const socket = useSocket();
  const { isSharing, stopSharing } = useScreenShare();
  // Global "assign a task" modal — accessible from a topbar button
  // (rendered below) AND from the keyboard ('t' shortcut). Anyone on
  // Robin can open it from anywhere.
  const [assignTaskOpen, setAssignTaskOpen] = useState(false);

  // 't' keyboard shortcut to open the assign-task modal. We skip the
  // listener when an input/textarea is focused or a modifier key is
  // held so it doesn't fire while someone is typing.
  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 't' && e.key !== 'T') return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (target && target.isContentEditable) return;
      e.preventDefault();
      setAssignTaskOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  // Proactively ask for OS notification permission once per user so
  // we can fire desktop alerts when a task is assigned and Robin
  // isn't the focused tab. Best-effort; failure is silent.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}); } catch { /* */ }
    }
  }, [user]);
  // Mount the knock receiver once at the shell level so the chime +
  // toast fire wherever the user is in Robin — even on a page that
  // never instantiated a huddle / chat component.
  useKnock();
  // Poll /api/version every minute. If the server is on a newer build
  // than this tab, toast a "new version — reload" prompt (auto-reloads
  // if the user has been idle for 5+ min). Stops "I had to refresh
  // for it to show up" forever.
  useAppUpdater();

  // (Notification poll lives in UnreadCountsProvider now — that's where the
  // sidebar + topbar badges get their counts. The toast-on-new logic below
  // is independent and runs off the socket event directly.)

  // ── Today's client schedule reminder ────────────────────────────────────
  // Fires ONCE per session (per logged-in user, per IST day) when the user
  // first lands in the app. Surfaces a single toast listing the clients
  // they're scheduled to serve today.
  useEffect(() => {
    if (!user || !['admin', 'employee', 'sales'].includes(role)) return;
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

  // ── Real-time toasts — notification:new, chat:mention ───────────────────
  // We deliberately use named handlers + socket.off(event, handler) so we
  // only remove OUR listener. Calling socket.off('event') with no handler
  // wipes EVERY listener for that event across the app (GroupChat,
  // HuddlePingChat, etc. all listen to chat:message). That bug used to
  // cause "chat dies after navigating around".
  useEffect(() => {
    if (!socket) return;
    const onNotification = (data: { title: string; body?: string; message?: string }) => {
      toast(data.title, { description: data.body || data.message, icon: '🔔', duration: 6000 });
    };
    const onChatMention = (data: { from: string; content: string }) => {
      if (!location.pathname.startsWith('/chat')) {
        toast(`${data.from} mentioned you`, { description: data.content, icon: '💬', duration: 5000 });
      }
    };
    // Org-wide confetti. When ANY teammate fires celebrateBroadcast(),
    // the server fans `celebrate:fire` out to everyone else in the same
    // org. We fire the confetti locally and surface a small toast naming
    // who triggered it (when provided) so the team gets the social cue,
    // not just a mystery explosion.
    const onCelebrate = (data: { reason?: string; actorName?: string }) => {
      celebrate();
      const title = data?.actorName ? `${data.actorName} is celebrating` : 'Celebration!';
      toast(title, {
        description: data?.reason,
        icon: '🎉',
        duration: 4500,
      });
    };
    // Real-time data refresh signal — server emits 'data:changed'
    // after any mutation that affects the agency-wide snapshot
    // (checklist tick, service complete, task create/accept/done,
    // workflow update). We re-dispatch as a DOM custom event so
    // pages can listen without each needing a useSocket import.
    // Coalesced — pages debounce their refresh internally.
    const onDataChanged = (data: { kind?: string; entity?: string }) => {
      try {
        window.dispatchEvent(new CustomEvent('robin:data-changed', { detail: data }));
      } catch { /* old browser */ }
    };

    // Task-assignment promptness: when the bell event type is one of
    // the task.* types AND the OS notification permission is granted,
    // fire a desktop notification too. That way the assignee sees
    // "New task to accept" even when Robin isn't the focused tab.
    // Falls back silently when permission is 'default' or 'denied'.
    const onTaskBellNotification = (data: any) => {
      try {
        if (!data?.type || !String(data.type).startsWith('task.')) return;
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        if (document.visibilityState === 'visible') return;     // user is here; toast covers it
        const n = new Notification(`Robin · ${data.title || 'Task update'}`, {
          body: data.body || '',
          icon: '/favicon.ico',
          tag:  data.entityId ? `task-${data.entityId}` : 'task',
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* old browser / private mode */ }
    };

    socket.on('notification:new', onNotification);
    socket.on('notification:new', onTaskBellNotification);
    socket.on('chat:mention',     onChatMention);
    socket.on('celebrate:fire',   onCelebrate);
    socket.on('data:changed',     onDataChanged);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('notification:new', onTaskBellNotification);
      socket.off('chat:mention',     onChatMention);
      socket.off('celebrate:fire',   onCelebrate);
      socket.off('data:changed',     onDataChanged);
    };
  }, [socket, location.pathname]);

  return (
    <AppLayoutNestedCtx.Provider value={true}>
    <SlimSidebar>
      <TopBar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* If host is in a client meeting, sticky pill on every page with
            mute / end / back-to-meeting controls. */}
        <ClientMeetingDock />

        {/* Sticky session controls — timer + start/break/end on every page */}
        <SessionTopBar />

        {/* Daily 3-popup orchestrator (morning/midday/evening) + its
            "checkin required" banner. Mounted here so it sits sticky
            right under the session strip — same visual lane as the
            huddle-required + screen-share-required banners. The
            CheckinProvider higher up the tree owns state.

            Wrapped in PageErrorBoundary so a future modal crash (a
            cascade of React #310-style hook bugs, an axios shape
            change, a missing icon import) can't take down the whole
            app shell. The orchestrator just disappears; sidebar +
            topbar + page content keep working. */}
        <PageErrorBoundary fallback={null}>
          <CheckinOrchestrator />
        </PageErrorBoundary>

        {/* Sticky "huddle required" banner. Visible whenever a clocked-in
            teammate (any non-client role) is NOT currently in the huddle.
            Owner rule: huddle attendance is mandatory during work. Click
            → joins the huddle. Cannot be dismissed; complements the auto-
            rejoin in HuddleContext + the 3-min auto-break threshold. */}
        <HuddleRequiredBanner />

        {/* Sticky "screen share required" banner. Visible only when an
            internal teammate is clocked-in active AND not currently sharing
            their screen. Owner rule: screen sharing is mandatory during
            work. Click → starts the share picker. Cannot be dismissed. */}
        <ScreenShareRequiredBanner />

        {/* Watchdog: auto-pauses the timer when the user has been out of the
            huddle for 10+ min, auto-resumes when they come back. Renders
            nothing — pure side-effect component. */}
        <HuddleAutoBreak />

        {/* Hands-free assistant orb. Click once to enable continuous
            listening; say "Hey Robin <command>" to run any action,
            "Hey Robin <question>" to get a spoken answer. */}
        <RobinOrb />

        {/* Persistent break / leave strip */}
        <PresenceStrip />

        {/* Headless 10-min screen-share reminder (employee/sales only) */}
        <ScreenShareReminder />

        {/* Sticky red banner when sharing was killed by the browser. */}
        <ScreenShareResumeBanner />

        {/* "You're broadcasting" sticky banner — emerald/rose tones to
            align with StatusPill, not generic green/red. */}
        {isSharing && (
          <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2 flex items-center justify-between sticky top-0 z-20 w-full animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-xs font-bold text-emerald-700">Your screen is currently being broadcasted live to your teammates</p>
            </div>
            <button onClick={stopSharing} className="text-xs flex items-center gap-1.5 bg-rose-500 text-white px-3 py-1.5 rounded-lg hover:bg-rose-600 shadow-sm">
              <MonitorOff className="h-3 w-3" /> Stop Sharing
            </button>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {children}
        </div>
      </main>

      <CommandPalette />
      <MeetingQuickFab />
      <HelpBubble />
      {/* Robin Copilot — always-on AI assistant. Internal roles only. */}
      {user && ['admin', 'sales', 'employee'].includes(role) && <AiCopilotPanel />}
      {/* Cmd-K instant entity search. Cheap; no AI call. */}
      {user && ['admin', 'sales', 'employee'].includes(role) && <GlobalSearch />}
      {/* Global "Assign a task" — accessible from a fixed pill at the
          bottom-left of every internal page + via the 't' keyboard
          shortcut. Internal roles only (clients don't assign tasks). */}
      {user && ['admin', 'sales', 'employee'].includes(role) && (
        <>
          <button
            type="button"
            onClick={() => setAssignTaskOpen(true)}
            className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full shadow-lg bg-card border border-border text-[12px] font-semibold hover:bg-muted/40 transition-transform hover:scale-[1.03]"
            title="Assign a task to anyone (press 't' anywhere)"
            aria-label="Assign a task"
          >
            <span className="h-5 w-5 rounded-md inline-flex items-center justify-center text-white text-[12px] font-bold"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}>+</span>
            Assign task
          </button>
          <AssignTaskModal open={assignTaskOpen} onClose={() => setAssignTaskOpen(false)} />
        </>
      )}
      <GlobalShortcuts />
    </SlimSidebar>
    </AppLayoutNestedCtx.Provider>
  );
}
