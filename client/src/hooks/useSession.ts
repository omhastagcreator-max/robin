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

  // Auto-start was reverted (owner request, May 2026): the team prefers
  // explicit Log In / Log Out buttons over a magic auto-clock-in. See
  // SessionTopBar / SessionClockCard for the buttons.

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

    // Fire once immediately, then every 30s (was 60s — June 2026
    // bug-fix: the heartbeat clamp window of +90s gave only 30s of
    // headroom between pings. A single slow ping (server cold-start,
    // CDN hiccup) tripped the clamp and visibly froze the work timer
    // until the next successful ping. 30s pings + 120s clamp window
    // = 90s of headroom which is enough to absorb any normal blip.
    ping();
    const i = setInterval(ping, 30_000);

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
  //
  // The "253h on break today" bug (June 2026):
  //   When a user clicked Break, closed the laptop, and reopened Robin the
  //   next day, the open break event was never closed server-side. The
  //   client then computed (now − startedAt) and displayed days of break
  //   time. Two guards now prevent that:
  //
  //     1. UPPER CLAMP — same as workedMs: never count past
  //        lastHeartbeatAt + 120s grace. A break that was open when the
  //        laptop closed effectively ended at the last heartbeat.
  //
  //     2. PER-EVENT CAP (4h) — no legitimate break runs more than 4
  //        hours. Anything longer is broken-data drift; cap it so the
  //        UI never reports nonsense even if the server hasn't been
  //        cleaned up yet.
  //
  //     3. TODAY-WINDOW CLAMP (totalBreakMs only) — the strip says
  //        "today: X" so we anchor to IST midnight. Yesterday's breaks
  //        on a cross-day session no longer leak into today's total.
  //
  // Together these make the UI self-healing — even if a session has bad
  // breakEvents data on the server, the user sees correct numbers.
  const MAX_SINGLE_BREAK_MS = 4 * 60 * 60 * 1000;   // 4h hard cap per event

  // IST midnight (start of today) in unix ms — used to clip cross-day
  // break events to today's slice only.
  const todayIstStartMs = useMemo(() => {
    const istNow = new Date(now + 330 * 60_000);
    const utcMid = Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0, 0, 0,
    );
    return utcMid - 330 * 60_000;   // back to UTC ms
  }, [now]);

  // Upper bound — clamp at lastHeartbeatAt + grace when present so the
  // counter freezes inside ~2min of going offline.
  const upperBoundMs = useMemo(() => {
    if (!session) return now;
    if (!session.lastHeartbeatAt) return now;
    const hb = new Date(session.lastHeartbeatAt).getTime();
    return Math.min(now, hb + 120_000);
  }, [session, now]);

  const currentBreakMs = useMemo(() => {
    if (!session || session.status !== 'on_break') return 0;
    const last = session.breakEvents?.[session.breakEvents.length - 1];
    if (!last?.startedAt || last.endedAt) return 0;
    const start = new Date(last.startedAt).getTime();
    const elapsed = Math.max(0, upperBoundMs - start);
    // Hard cap so a stale session with a months-old open break can't
    // display 253h. The cleanup script + server-side auto-close will
    // bring the data back into line; this is the UI safety net.
    return Math.min(elapsed, MAX_SINGLE_BREAK_MS);
  }, [session, upperBoundMs]);

  const totalBreakMs = useMemo(() => {
    if (!session) return 0;
    return (session.breakEvents || []).reduce((sum, b) => {
      if (!b.startedAt) return sum;
      let start = new Date(b.startedAt).getTime();
      let end = b.endedAt
        ? new Date(b.endedAt).getTime()
        : (session.status === 'on_break' ? upperBoundMs : start);
      // Clamp to today AND to the heartbeat window.
      start = Math.max(start, todayIstStartMs);
      end   = Math.min(end,   upperBoundMs);
      if (end <= start) return sum;
      // Per-event cap so one broken row can't blow up the total.
      const dur = Math.min(end - start, MAX_SINGLE_BREAK_MS);
      return sum + dur;
    }, 0);
  }, [session, upperBoundMs, todayIstStartMs]);

  // STANDARD_BREAK_MS — the break allowance built into a working day.
  // Mirrors server/src/services/sessionTime.ts. Up to this much break is
  // free; only minutes BEYOND it reduce effective working hours. Keep in
  // lockstep with the server (1 hour today).
  const STANDARD_BREAK_MS = 60 * 60 * 1000;

  const workedMs = useMemo(() => {
    if (!session) return 0;
    const start = new Date(session.startTime).getTime();
    // Working time with break-credit:
    //   gross elapsed - max(0, breakMs - 1h) - awayMs
    //
    // i.e. up to 1h of break is "free" (built into the working day).
    // Take 30min → no penalty; take 90min → 30min comes off. Matches the
    // server's sessionTotals() so the live ticker and the daily report
    // never disagree.
    //
    // Three other pause sources still apply:
    //   1. Breaks ABOVE the standard allowance (the credit math above)
    //   2. Away time (session.awayMs) — gaps between heartbeats > 90s
    //   3. Heartbeat clamp — once the tab is closed, the upper bound
    //      stops at lastHeartbeatAt + 90s grace so the live counter
    //      freezes within ~90s of going offline.
    let upper = now;
    if (session.lastHeartbeatAt) {
      const hb = new Date(session.lastHeartbeatAt).getTime();
      // 120s clamp (was 90s). Combined with the new 30s heartbeat
      // cadence above, the visible timer stays smooth through any
      // single network blip and only freezes if the tab has been
      // genuinely closed / idle for >2min.
      upper = Math.min(now, hb + 120_000);
    }
    const breakPenaltyMs = Math.max(0, totalBreakMs - STANDARD_BREAK_MS);
    return Math.max(0, (upper - start) - breakPenaltyMs - (session.awayMs || 0));
  }, [session, now, totalBreakMs]);

  // Bonus surfaced for the UI hint chip — "+30m credited for short break".
  // Positive value = the difference between what would have been counted
  // under the OLD strict rule and the NEW credit-included rule. Zero when
  // the break exceeded the allowance.
  const breakCreditMs = useMemo(() => {
    if (!session) return 0;
    return Math.max(0, Math.min(totalBreakMs, STANDARD_BREAK_MS));
  }, [session, totalBreakMs]);

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
    breakCreditMs,
    breakAllowanceMs: STANDARD_BREAK_MS,
  };
}
