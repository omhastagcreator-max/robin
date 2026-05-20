import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { useSocket } from '@/hooks/useSocket';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * UnreadCountsContext — single source of truth for notification + chat
 * unread badge counts. Consumed by `SlimSidebar` (which renders the badges
 * next to /notifications and /chat).
 *
 * Sources of truth:
 *   • REST poll every 60 s (silent, visible-only) — seeds the notifications
 *     count and corrects for events we missed while the socket was napping.
 *   • Socket `notification:new`  → notifications++
 *   • Socket `chat:message`      → chat++   (only when not viewing /chat)
 *   • Socket `chat:mention`      → chat++   (only when not viewing /chat)
 *   • Visiting /chat             → chat resets to 0
 *
 * Notifications reset to 0 only when the user actually opens
 * /notifications AND mark-reads the items there — the NotificationsPage
 * handles that flow via api.readNotification, then a fresh REST poll picks
 * up the new state on the next tick.
 *
 * Previously this logic was inline in AppLayout, but it had nowhere to
 * surface the counts after the dead inline Sidebar+NavLink were purged.
 * Lifting it to a context lets SlimSidebar consume it directly.
 */

interface UnreadCounts {
  notifications: number;
  chat: number;
  /** Manually reset the notifications count (call after mark-all-read). */
  resetNotifications: () => void;
  /** Manually reset the chat count. */
  resetChat: () => void;
}

const Ctx = createContext<UnreadCounts>({
  notifications: 0,
  chat: 0,
  resetNotifications: () => {},
  resetChat: () => {},
});

export function UnreadCountsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socket   = useSocket();
  const location = useLocation();

  const [notifications, setNotifications] = useState(0);
  const [chat, setChat]                    = useState(0);

  // REST poll — pauses when tab hidden, silent so a transient 401 doesn't
  // bounce the user to /login mid-session.
  useVisiblePoll(async () => {
    if (!user) return;
    try {
      const data = await api.listNotifications({ limit: 50, silent: true });
      setNotifications(Array.isArray(data) ? data.filter((n: any) => !n.isRead).length : 0);
    } catch { /* swallow — silent header keeps interceptor quiet */ }
  }, 60_000);

  // First fetch on login so the badge appears immediately, not 60 s later.
  useEffect(() => {
    if (!user) { setNotifications(0); setChat(0); return; }
    api.listNotifications({ limit: 50, silent: true })
      .then((data: any) => {
        setNotifications(Array.isArray(data) ? data.filter((n: any) => !n.isRead).length : 0);
      })
      .catch(() => {});
  }, [user?.id]);

  // Socket events.
  useEffect(() => {
    if (!socket) return;
    const onNotification = () => setNotifications(n => n + 1);
    const onChatMessage  = () => {
      if (!location.pathname.startsWith('/chat')) setChat(c => c + 1);
    };
    const onChatMention  = () => {
      if (!location.pathname.startsWith('/chat')) setChat(c => c + 1);
    };
    socket.on('notification:new', onNotification);
    socket.on('chat:message',     onChatMessage);
    socket.on('chat:mention',     onChatMention);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('chat:message',     onChatMessage);
      socket.off('chat:mention',     onChatMention);
    };
  }, [socket, location.pathname]);

  // Visiting /chat clears the chat count (the page itself does the rest).
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) setChat(0);
  }, [location.pathname]);

  const value = useMemo<UnreadCounts>(() => ({
    notifications,
    chat,
    resetNotifications: () => setNotifications(0),
    resetChat:          () => setChat(0),
  }), [notifications, chat]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnreadCounts() {
  return useContext(Ctx);
}
