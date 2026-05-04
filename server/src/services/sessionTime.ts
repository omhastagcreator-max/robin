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

  const activeMs = Math.max(0, workedMs - breakMs);
  return { workedMs, breakMs, activeMs };
}

export const SESSION_GRACE_MS = GRACE_MS;
