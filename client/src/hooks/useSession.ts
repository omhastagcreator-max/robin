import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

export interface SessionData {
  _id: string;
  userId: string;
  startTime: string;
  endTime?: string;
  breakTime: number;
  status: 'active' | 'on_break' | 'ended';
  breakEvents: { startedAt: string; endedAt?: string }[];
  createdAt: string;
  onCallSince?: string | null;
  /** Server-tracked total time the user was offline / had Robin closed. */
  awayMs?: number;
  /** Bumped every heartbeat. Used to clamp the live timer locally. */
  lastHeartbeatAt?: string;
  /** Cumulative completed time spent in the agency huddle this session. */
  huddleMs?: number;
  /** Non-null while currently in the huddle — start of open interval. */
  huddleJoinedAt?: string | null;
}

/**
 * Live session hook. Adds a 1-second ticker while a session is active so the
 * UI can show breaks in real time:
 *
 *   - currentBreakMs  : elapsed time of the in-progress break (0 otherwise)
 *   - totalBreakMs    : cumulative break time today, including the in-progress
 *                       break, in milliseconds
 *
 * The hook also patches local breakEvents on startBreak/endBreak so timers
 * tick correctly without waiting on a refetch round-trip.
 */
export function useSession() {
  const { user } = useAuth();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const fetchActiveSession = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getActiveSession();
      setSession(data || null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchActiveSession(); }, [fetchActiveSession]);

  // Per-second tick while we have a live session — drives all timer UIs.
  useEffect(() => {
    if (!session || session.status === 'ended') return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [session?.status, session?._id]);

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  // While a session is active or on break, ping the server every 60s so it
  // knows the user is still around. When the tab closes, the interval stops
  // and the server's clock pauses for this user (~90s grace later). When the
  // tab is hidden in background (other tab focused), we keep pinging — that
  // counts as "still here." But if the browser is fully closed, no ping.
  useEffect(() => {
    if (!session || session.status === 'ended') return;
    let cancelled = false;

    const ping = async () => {
      if (cancelled) return;
      // Skip when the browser is reporting offline — save bandwidth and avoid
      // building up a queue of failed requests. The next interval will pick
      // up automatically when connectivity returns.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        const r: any = await api.sessionHeartbeat();
        // Server returns updated awayMs + lastHeartbeatAt — merge into local
        // state so workedMs immediately reflects any away-time the server
        // detected during a gap (e.g., user closed tab, came back, first
        // ping detected the gap and bumped awayMs). Also pick up huddleMs/
        // huddleJoinedAt periodically so the timer reconciles with what
        // the server thinks (e.g. another tab joined the huddle).
        if (r && (r.awayMs !== undefined || r.lastHeartbeatAt !== undefined)) {
          setSession(prev => prev ? {
            ...prev,
            awayMs: r.awayMs !== undefined ? r.awayMs : prev.awayMs,
            lastHeartbeatAt: r.lastHeartbeatAt || prev.lastHeartbeatAt,
          } : prev);
        }
      } catch { /* swallow — next interval will retry */ }
    };

    // Also re-fetch the full session every 60s so huddleMs / huddleJoinedAt
    // stay in sync with what the server thinks. Cheap (single-doc lookup)
    // and removes the dependency on api.sessionHeartbeat returning huddle
    // fields. This is also what makes the "joined huddle in another tab"
    // case eventually-consistent in this tab.
    const reconcile = setInterval(() => {
      if (cancelled || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      api.getActiveSession().then((s: SessionData | null) => {
        if (cancelled || !s) return;
        setSession(prev => prev ? { ...prev, huddleMs: s.huddleMs, huddleJoinedAt: s.huddleJoinedAt } : s);
      }).catch(() => {});
    }, 60_000);

    // Fire once immediately, then every 60s.
    ping();
    const i = setInterval(ping, 60_000);

    return () => {
      cancelled = true;
      clearInterval(i);
      clearInterval(reconcile);
    };
  }, [session?.status, session?._id]);

  const startSession = async () => {
    if (session) return;
    const data = await api.startSession();
    setSession(data);
  };

  const startBreak = async () => {
    if (!session || session.status === 'on_break') return;
    await api.startBreak();
    // Patch local state synchronously so the timer starts immediately rather
    // than waiting for a refetch.
    setSession(prev => {
      if (!prev) return prev;
      const events = [...(prev.breakEvents || []), { startedAt: new Date().toISOString() }];
      return { ...prev, status: 'on_break', breakEvents: events };
    });
  };

  const endBreak = async () => {
    if (!session || session.status !== 'on_break') return;
    const updated = await api.endBreak();
    setSession(updated);
  };

  const endSession = async () => {
    if (!session) return;
    if (session.status === 'on_break') await endBreak();
    await api.endSession();
    setSession(null);
  };

  // Toggle On Call. Optimistic update so the UI flips instantly; server
  // event will reconcile if there's a mismatch.
  const toggleOnCall = async () => {
    if (!session) return;
    const next = !session.onCallSince;
    setSession(prev => prev ? { ...prev, onCallSince: next ? new Date().toISOString() : null } : prev);
    try {
      await api.setOnCall(next);
    } catch {
      // Revert on failure
      setSession(prev => prev ? { ...prev, onCallSince: next ? null : new Date().toISOString() } : prev);
    }
  };

  // ── Derived live timers ──────────────────────────────────────────────────
  const currentBreakMs = useMemo(() => {
    if (!session || session.status !== 'on_break') return 0;
    const last = session.breakEvents?.[session.breakEvents.length - 1];
    if (!last?.startedAt || last.endedAt) return 0;
    return Math.max(0, now - new Date(last.startedAt).getTime());
  }, [session, now]);

  const totalBreakMs = useMemo(() => {
    if (!session) return 0;
    return (session.breakEvents || []).reduce((sum, b) => {
      if (!b.startedAt) return sum;
      const start = new Date(b.startedAt).getTime();
      const end = b.endedAt
        ? new Date(b.endedAt).getTime()
        : (session.status === 'on_break' ? now : start);
      return sum + Math.max(0, end - start);
    }, 0);
  }, [session, now]);

  const workedMs = useMemo(() => {
    if (!session) return 0;
    // Working time = time spent in the agency huddle.
    //
    // Counter starts when the user joins the huddle (HuddleContext pings
    // /sessions/huddle-joined) and pauses the moment they leave. Outside
    // of the huddle the timer doesn't tick at all — the agency rule is
    // "you're at work when you're in the room with the team."
    //
    //   workedMs = huddleMs (completed intervals so far)
    //            + (now - huddleJoinedAt) if currently in the huddle
    //
    // Breaks still apply on top — if the user takes a break while in the
    // huddle, that time gets subtracted. Away time is implicit (closing
    // the tab also drops you from the huddle on the server).
    const completed = session.huddleMs || 0;
    let openInterval = 0;
    if (session.huddleJoinedAt) {
      const joined = new Date(session.huddleJoinedAt).getTime();
      // Clamp against lastHeartbeatAt + grace so the live counter still
      // freezes within ~90s of going offline (matches server logic).
      let upper = now;
      if (session.lastHeartbeatAt) {
        const hb = new Date(session.lastHeartbeatAt).getTime();
        upper = Math.min(now, hb + 90_000);
      }
      openInterval = Math.max(0, upper - joined);
    }
    return Math.max(0, completed + openInterval - totalBreakMs);
  }, [session, now, totalBreakMs]);

  return {
    session,
    loading,
    startSession,
    startBreak,
    endBreak,
    endSession,
    toggleOnCall,
    refreshSession: fetchActiveSession,
    // Convenience getters
    isActive:  session?.status === 'active',
    isOnBreak: session?.status === 'on_break',
    isOnCall:  !!session?.onCallSince,
    // Live timers
    currentBreakMs,
    totalBreakMs,
    workedMs,
  };
}
