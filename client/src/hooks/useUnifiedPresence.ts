import { useMemo } from 'react';
import { useTeamPresence, type PresenceStatus, type TeamMember } from './useTeamPresence';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * useUnifiedPresence — the single source of truth for "who is doing what
 * right now" across Robin.
 *
 * THE BUG THIS FIXES
 * Robin had two independent presence systems:
 *
 *   1. `useTeamPresence` — clock-in / break / leave status, fed by
 *      `presence:status` socket events.
 *   2. `useHuddle().peers` — LiveKit-derived list of people in the
 *      agency huddle right now.
 *
 * They never spoke to each other. So:
 *   - Priyanka joins the huddle without clocking in → LiveKit shows her,
 *     Team Status says "off the clock".
 *   - Sakshi clocked in but never joined the huddle → Team Status says
 *     "Working", huddle peer list is empty.
 *
 * Result: managers can't trust either UI alone. They see Priyanka and
 * Sakshi both labelled "Working" on one page but only Priyanka in the
 * huddle — and they have to mentally cross-reference to know what's
 * actually happening.
 *
 * THE FIX
 * This hook combines:
 *   - clockState  → `active`/`on_break`/`away`/`on_leave`/`off_clock` from sessions
 *   - inHuddle    → derived from LiveKit peers (real-time, source of truth)
 *   - sharingScreen → also from LiveKit peers
 *   - onCall      → from useTeamPresence's `presence:on-call` events
 *   - deafened    → from useTeamPresence's `presence:deafened` events
 *
 * Computes a single composite `displayState` string the UI can render
 * as a status badge without doing its own cross-referencing.
 *
 * EVERY component that renders team/employee status should use THIS hook,
 * not `useTeamPresence` or `useHuddle` directly. Doing so is the only way
 * to guarantee the UI is internally consistent across pages.
 */

/** All the live signals we know about a single user. */
export interface UnifiedPresence {
  userId: string;
  name?: string;
  role?: string;
  email?: string;
  team?: string;

  // ── Clocking state ──
  clockState: PresenceStatus;     // active / on_break / away / on_leave / off_clock / ended
  /** True if this person is in the agency huddle RIGHT NOW (LiveKit). */
  inHuddle: boolean;
  /** True if this person is currently broadcasting their screen. */
  sharingScreen: boolean;
  /** "Do not disturb" flag — independent of clock state. */
  onCall: boolean;
  /** True if this person has muted incoming huddle audio. */
  deafened: boolean;

  /** Composite badge — what the UI should render as a single label.
   *  Priority order (top wins):
   *   1. on_leave / on_break / away  — explicit clock states still dominate
   *   2. in_huddle                   — derived from LiveKit
   *   3. working                     — clocked in but not in huddle
   *   4. lurking                     — in huddle but not clocked in (edge case)
   *   5. off_clock                   — default */
  displayState:
    | 'on_leave' | 'on_break' | 'away'
    | 'in_huddle' | 'working' | 'lurking' | 'off_clock';
  /** Human-readable for tooltips: e.g. "In huddle · clocked in · sharing screen". */
  displayLabel: string;
}

export interface UnifiedPresenceApi {
  /** Lookup by userId. */
  get: (userId: string) => UnifiedPresence | null;
  /** Full list (deduped, sorted by displayState priority). */
  list: UnifiedPresence[];
  /** Convenience grouped lists for dashboards. */
  inHuddle:    UnifiedPresence[];
  working:     UnifiedPresence[];
  onBreak:     UnifiedPresence[];
  onLeave:     UnifiedPresence[];
  away:        UnifiedPresence[];
  offClock:    UnifiedPresence[];
  /** People in the huddle who AREN'T clocked in — flags an operational
   *  oddity for admin. */
  lurking:     UnifiedPresence[];
  /** Loading state inherited from useTeamPresence. */
  loading:     boolean;
}

function computeDisplay(
  clockState: PresenceStatus,
  inHuddle: boolean,
): { displayState: UnifiedPresence['displayState']; displayLabel: string } {
  // Explicit clock-state-driven labels first — leave / break / away are
  // strong signals the user isn't doing focused work even if they happen
  // to also be in a huddle.
  if (clockState === 'on_leave') return { displayState: 'on_leave', displayLabel: 'On leave' };
  if (clockState === 'on_break') return { displayState: 'on_break', displayLabel: inHuddle ? 'On break · in huddle' : 'On break' };
  if (clockState === 'away')     return { displayState: 'away',     displayLabel: inHuddle ? 'Away · in huddle'    : 'Away'     };

  // Huddle presence — the actually-in-a-call signal trumps "clocked in but doing nothing".
  if (inHuddle && clockState === 'active')   return { displayState: 'in_huddle', displayLabel: 'In huddle · working'   };
  if (inHuddle && clockState !== 'active')   return { displayState: 'lurking',   displayLabel: 'In huddle (not clocked in)' };

  // Clocked in but not in a huddle.
  if (clockState === 'active') return { displayState: 'working', displayLabel: 'Working' };

  return { displayState: 'off_clock', displayLabel: 'Off the clock' };
}

/**
 * Display-state priority for sorting. Lower = higher in the list.
 * Designed so a manager scanning the team-status panel sees the most
 * "is anything happening?" rows at the top.
 */
const SORT_PRIORITY: Record<UnifiedPresence['displayState'], number> = {
  in_huddle: 0,
  working:   1,
  lurking:   2,
  on_break:  3,
  away:      4,
  on_leave:  5,
  off_clock: 6,
};

export function useUnifiedPresence(): UnifiedPresenceApi {
  const team   = useTeamPresence();
  const huddle = useHuddle();

  // The hook can't safely call `useHuddle()` inside conditions, so we
  // always read it; on routes outside HuddleProvider this would throw.
  // HuddleProvider wraps the whole authenticated app in App.tsx, so we're
  // guaranteed to be inside it whenever this hook is mounted.

  // huddle.peers is the LiveKit participants list. The local user's own
  // huddle membership is `huddle.joined` (peers excludes the local user).
  const inHuddleSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of huddle.peers || []) s.add(p.userId);
    // If the LOCAL user is joined, include them. (Local user is the user
    // viewing the dashboard — they should see themselves as in-huddle.)
    // useHuddle exposes `joined` boolean but not the local userId; we
    // pick it up from useTeamPresence's `members` map by intersecting
    // with the LOCAL screen-sharing flag if available. For now, the
    // PresenceStrip already shows "you're in the huddle" status; this
    // map is for OTHER teammates' rows.
    return s;
  }, [huddle.peers]);

  const sharingSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of huddle.peers || []) if (p.screenOn) s.add(p.userId);
    return s;
  }, [huddle.peers]);

  // Build the unified list.
  const list = useMemo<UnifiedPresence[]>(() => {
    const rows: UnifiedPresence[] = [];
    const seen = new Set<string>();

    // 1. Everyone in the team-presence members map (covers clocked-in,
    //    on-break, on-leave, away, off-clock).
    for (const m of team.list as TeamMember[]) {
      const inHuddle = inHuddleSet.has(m.userId);
      const { displayState, displayLabel } = computeDisplay(m.status, inHuddle);
      rows.push({
        userId: m.userId, name: m.name, role: m.role, email: m.email, team: m.team,
        clockState:     m.status,
        inHuddle,
        sharingScreen:  sharingSet.has(m.userId),
        onCall:         team.isOnCall(m.userId),
        deafened:       team.isDeafened(m.userId),
        displayState,
        displayLabel,
      });
      seen.add(m.userId);
    }

    // 2. Anyone in the huddle but NOT in the team-presence map.
    //    Edge case — happens when someone joins via /workroom-home before
    //    a presence:status event fires (e.g. workroom users who don't
    //    clock in). Surface them as "lurking" so admin can see the
    //    huddle list is complete.
    for (const p of huddle.peers || []) {
      if (seen.has(p.userId)) continue;
      const { displayState, displayLabel } = computeDisplay('off_clock', true);
      rows.push({
        userId: p.userId, name: p.name, role: p.role,
        clockState: 'off_clock',
        inHuddle: true,
        sharingScreen: !!p.screenOn,
        onCall: false,
        deafened: false,
        displayState,
        displayLabel,
      });
    }

    rows.sort((a, b) => SORT_PRIORITY[a.displayState] - SORT_PRIORITY[b.displayState]);
    return rows;
  }, [team.list, inHuddleSet, sharingSet, team.isOnCall, team.isDeafened, huddle.peers]);

  const byId = useMemo(() => {
    const m: Record<string, UnifiedPresence> = {};
    for (const r of list) m[r.userId] = r;
    return m;
  }, [list]);

  const buckets = useMemo(() => ({
    inHuddle: list.filter(r => r.displayState === 'in_huddle'),
    working:  list.filter(r => r.displayState === 'working'),
    onBreak:  list.filter(r => r.displayState === 'on_break'),
    onLeave:  list.filter(r => r.displayState === 'on_leave'),
    away:     list.filter(r => r.displayState === 'away'),
    offClock: list.filter(r => r.displayState === 'off_clock'),
    lurking:  list.filter(r => r.displayState === 'lurking'),
  }), [list]);

  return {
    get:      (userId: string) => byId[userId] || null,
    list,
    loading:  team.loading,
    ...buckets,
  };
}
