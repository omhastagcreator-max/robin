/**
 * sessionTime — single source of truth for "how much time does this session count?"
 *
 * The rule:
 *   countedEnd = min(endTime || now, lastHeartbeatAt + GRACE_MS)
 *
 * If the user closed their browser at 5:00pm sharp, their last heartbeat
 * arrives ~5:00pm. The grace window (90 seconds) covers the gap between
 * "browser closed" and "we noticed." After that, the clock stops. So even
 * if the dashboard is opened a week later, the report shows ~5:00pm as the
 * effective end.
 *
 * For sessions that never had a heartbeat (e.g., older rows from before we
 * shipped this feature), we fall back to legacy behaviour: count up to
 * endTime || now. New sessions ALL get a heartbeat on creation so this
 * branch only matters for historical rows.
 */

// 180 seconds (was 120s, then 90s originally). The client heartbeat
// fires every 30s and only clamps its own display when hb is >3min
// stale — this server grace must match so admin reports don't disagree
// with what the user saw on the live ticker. A 3min window covers even
// a slow cold-start + one retry cycle without visibly freezing the
// worked-hours display; anything longer than that = the tab is
// genuinely closed and the counter should stop.
// Kept in lockstep with STALE_HB_MS in client/src/hooks/useSession.ts.
const GRACE_MS = 180_000;

/**
 * STANDARD_BREAK_MS — the break allowance everyone gets for free as part
 * of a normal working day. Take 30 minutes off, no penalty. Only the
 * MINUTES BEYOND this allowance get deducted from effective working time.
 *
 * Why: the team complained that a colleague who took 30min for lunch was
 * showing fewer "worked hours" than someone who didn't break at all —
 * which penalised the healthy behaviour. Now the allowance is built in:
 * take 30min → still credited the full clocked-in window; take 1h 15min
 * → only the extra 15min counts against worked hours.
 *
 * Example: clocked in 9:00, out 5:20, took 30min break.
 *   gross elapsed = 8h 20min
 *   break = 30min  (≤ 60min allowance → penalty = 0)
 *   effective working = 8h 20min   (not 7h 50min)
 */
export const STANDARD_BREAK_MS = 60 * 60 * 1000; // 1 hour

export interface SessionLike {
  startTime: Date | string;
  endTime?: Date | string | null;
  lastHeartbeatAt?: Date | string | null;
  breakEvents?: Array<{ startedAt?: Date | string | null; endedAt?: Date | string | null }>;
  status?: 'active' | 'on_break' | 'ended' | string;
  /**
   * Total time the user was offline (closed tab / browser) DURING the
   * session. Accumulated by the heartbeat handler whenever the gap between
   * pings exceeded the away threshold. Subtracted from active time so a
   * lunch where the user closed their laptop doesn't inflate worked hours.
   */
  awayMs?: number;
  /**
   * Cumulative completed huddle attendance for this session, in ms. The
   * agency rule is "working time = time in huddle" — when present, this
   * field is the SOURCE OF TRUTH for activeMs and the elapsed - breaks -
   * away math becomes a fallback for legacy rows / non-huddle workflows.
   */
  huddleMs?: number;
  /** Open huddle interval start (non-null while currently inside). */
  huddleJoinedAt?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) =>
  d ? new Date(d).getTime() : NaN;

/**
 * Effective end of the session for accounting purposes.
 * Returns a millisecond timestamp.
 */
export function effectiveEndMs(s: SessionLike, nowMs = Date.now()): number {
  // Real end takes precedence — clean clock-outs.
  if (s.endTime) return ms(s.endTime);

  // No heartbeat ever? Legacy row — fall back to now.
  if (!s.lastHeartbeatAt) return nowMs;

  // Clamp: we only count time up to the most recent heartbeat + grace.
  const clamp = ms(s.lastHeartbeatAt) + GRACE_MS;
  return Math.min(nowMs, clamp);
}

/**
 * Worked + break time for a single session, optionally clamped to a window
 * (e.g., "today only"). Returns milliseconds for everything.
 */
export function sessionTotals(
  s: SessionLike,
  windowStartMs = 0,
  windowEndMs = Date.now()
) {
  const sStart = ms(s.startTime);
  const sEnd = effectiveEndMs(s, windowEndMs);

  // Intersect session with the window.
  const start = Math.max(sStart, windowStartMs);
  const end = Math.min(sEnd, windowEndMs);
  const workedMs = Math.max(0, end - start);

  // Break time from breakEvents — re-derived live (not from `breakTime`
  // field, which is only finalised at clock-out).
  let breakMs = 0;
  for (const b of s.breakEvents || []) {
    if (!b.startedAt) continue;
    const bStart = ms(b.startedAt);
    const bEnd = b.endedAt ? ms(b.endedAt) : sEnd; // open break ends at session-end
    const cs = Math.max(bStart, start);
    const ce = Math.min(bEnd, end);
    if (ce > cs) breakMs += ce - cs;
  }

  // awayMs is whole-session — proportionally clamp it to the requested
  // window so partial-day reports don't subtract more than makes sense.
  // (For most reports the window covers the whole session, so awayMs is
  // applied in full.) Note: effectiveEndMs returns a number, ms() expects
  // a Date/string — branch instead of relying on `||` so TS narrows.
  const sessionEndMs = s.endTime ? ms(s.endTime) : effectiveEndMs(s, windowEndMs);
  const sessionDurationMs = Math.max(1, sessionEndMs - ms(s.startTime));
  const windowFraction    = Math.max(0, Math.min(1, workedMs / sessionDurationMs));
  const awayInWindowMs    = Math.round((s.awayMs || 0) * windowFraction);

  // Break-credit math (May 2026). Up to STANDARD_BREAK_MS of break time
  // is "free" — built into the working day. Only minutes BEYOND that
  // allowance reduce effective working hours. Someone who took 30min for
  // lunch keeps their full clocked-in time as worked hours; someone who
  // took 90min loses 30min. Reverses the older "every minute of break is
  // a minute deducted" rule that was penalising healthy behaviour.
  //
  // Sanity caps (June 2026 — matches the client's useSession
  // computation): breakPenaltyMs is bounded by workedMs so a corrupt
  // break event array (see the 253h open-break bug) can't drive activeMs
  // to zero. awayInWindowMs is bounded by half of workedMs so a runaway
  // heartbeat-gap accumulation can't do the same. Together these keep
  // the reported worked hours believable even while the underlying data
  // is being repaired by the cleanup scripts.
  const rawPenalty     = Math.max(0, breakMs - STANDARD_BREAK_MS);
  const breakPenaltyMs = Math.min(rawPenalty, workedMs);
  const cappedAwayMs   = Math.min(awayInWindowMs, Math.floor(workedMs / 2));
  const activeMs       = Math.max(0, workedMs - breakPenaltyMs - cappedAwayMs);

  return {
    workedMs,                    // gross clocked-in time inside the window
    breakMs,                     // actual break minutes
    awayMs:        awayInWindowMs,
    activeMs,                    // effective working hours (post break-credit)
    breakPenaltyMs,              // 0 when break ≤ allowance; surfaced for UI hints
    breakAllowanceMs: STANDARD_BREAK_MS,
  };
}

/**
 * Time the user was actually in the huddle this session (completed
 * intervals + any open one). Separate from activeMs so reports can show
 * BOTH "worked 8h" AND "of which 4h in huddle" without conflating them.
 */
export function huddleTotalMs(s: SessionLike, nowMs = Date.now()): number {
  let total = s.huddleMs || 0;
  if (s.huddleJoinedAt) {
    const joined = ms(s.huddleJoinedAt);
    const close  = effectiveEndMs(s, nowMs);
    if (close > joined) total += (close - joined);
  }
  return total;
}

export const SESSION_GRACE_MS = GRACE_MS;
