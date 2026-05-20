import { useEffect, createContext, useContext, type ReactNode } from 'react';
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
import { ScreenShareReminder } from '@/components/shared/ScreenShareReminder';
import { ScreenShareResumeBanner } from '@/components/shared/ScreenShareResumeBanner';
import { ClientMeetingDock } from '@/components/shared/ClientMeetingDock';
import { MeetingQuickFab } from '@/components/shared/MeetingQuickFab';
import { HelpBubble } from '@/components/shared/HelpBubble';
import { SlimSidebar }     from '@/components/v2/SlimSidebar';
import { TopBar }          from '@/components/v2/TopBar';
import { GlobalShortcuts } from '@/components/v2/GlobalShortcuts';

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
    socket.on('notification:new', onNotification);
    socket.on('chat:mention',     onChatMention);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('chat:mention',     onChatMention);
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
      <GlobalShortcuts />
    </SlimSidebar>
    </AppLayoutNestedCtx.Provider>
  );
}
