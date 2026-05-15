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

const GRACE_MS = 90_000; // 90 seconds — covers network blips between pings

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
  // applied in full.)
  const sessionDurationMs = Math.max(1, ms(s.endTime || effectiveEndMs(s, windowEndMs)) - ms(s.startTime));
  const windowFraction    = Math.max(0, Math.min(1, workedMs / sessionDurationMs));
  const awayInWindowMs    = Math.round((s.awayMs || 0) * windowFraction);

  // Huddle-based active time: when the session has any huddle attendance,
  // working time = time in huddle (not "elapsed minus stuff"). Adds the
  // open interval if currently inside, then subtracts breaks that
  // overlapped huddle time. Falls back to elapsed-minus-breaks-minus-away
  // for sessions / orgs that don't use huddle attendance.
  const hasHuddleData = (s.huddleMs || 0) > 0 || !!s.huddleJoinedAt;
  let activeMs: number;
  if (hasHuddleData) {
    let huddleTotal = s.huddleMs || 0;
    if (s.huddleJoinedAt) {
      const joined = ms(s.huddleJoinedAt);
      const close  = sEnd; // end of session caps any open interval
      if (close > joined) huddleTotal += (close - joined);
    }
    // Don't double-deduct breaks if a break and the huddle overlap.
    // Approximation: subtract breakMs in full (we expect users not to be
    // in huddle while on break — the break overlay covers the UI).
    activeMs = Math.max(0, Math.round(huddleTotal * windowFraction) - breakMs);
  } else {
    activeMs = Math.max(0, workedMs - breakMs - awayInWindowMs);
  }

  return { workedMs, breakMs, awayMs: awayInWindowMs, activeMs };
}

export const SESSION_GRACE_MS = GRACE_MS;
