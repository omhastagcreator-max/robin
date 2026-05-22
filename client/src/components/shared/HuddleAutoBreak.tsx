import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useHuddle } from '@/contexts/HuddleContext';
import { useSession } from '@/hooks/useSession';

/**
 * HuddleAutoBreak — pauses the work timer when a teammate leaves the
 * huddle for 10+ minutes, auto-resumes when they come back.
 *
 * The agency rule is "you're at work when you're in the huddle." If
 * someone walks away from their desk without clicking the Break button,
 * their working hours used to keep ticking — which the owner asked us
 * to fix.
 *
 * Implementation:
 *   - Watches `meeting.joined` from HuddleContext and `session.status`
 *     from useSession.
 *   - When the user is OUT of the huddle AND the session is active,
 *     starts a 10-minute timer.
 *   - At fire time, if they're still out + still active, calls
 *     startBreak() — same primitive as the manual Break button — and
 *     fires a toast so they understand why.
 *   - Sets a localStorage flag `robin.session.autoBrokenByHuddle` so
 *     we know we're responsible for ending it later (vs. a manual
 *     break they took during the same window).
 *   - When they rejoin the huddle, if our flag is set, auto-calls
 *     endBreak() → resume work.
 *   - localStorage (not sessionStorage) so a tab reload doesn't lose
 *     the flag and accidentally end a real manual break.
 *
 * Mount once at the AppLayout level so the logic runs on every page.
 * Returns null — no UI of its own.
 *
 * THRESHOLD_MS — 10 minutes. Easy to tune later if the team wants
 * shorter (5 min) or longer (15 min) tolerance.
 */
const THRESHOLD_MS = 10 * 60 * 1000;          // 10 minutes
const FLAG_KEY      = 'robin.session.autoBrokenByHuddle';

export function HuddleAutoBreak() {
  const { joined: huddleJoined, joining: huddleJoining } = useHuddle();
  const { session, startBreak, endBreak } = useSession();

  // Stable across renders so we don't accidentally fire multiple timers.
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Nothing to do if there's no active work session.
    if (!session) return;

    // ── Rejoin path: auto-resume if WE started the break ──────────
    if (huddleJoined && session.status === 'on_break') {
      let weStartedThis = false;
      try { weStartedThis = localStorage.getItem(FLAG_KEY) === '1'; }
      catch { /* private mode */ }
      if (weStartedThis) {
        endBreak().catch(() => { /* user can hit Resume manually */ });
        try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
        toast.success('Welcome back — timer resumed.');
      }
      // In any case, cancel any pending out-of-huddle timer.
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      return;
    }

    // ── Already in huddle and not on break: cancel any pending timer ──
    if (huddleJoined) {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      return;
    }

    // ── Not in huddle. Three cases below: ──────────────────────────
    // 1. Currently joining — give LiveKit a moment, no timer yet.
    if (huddleJoining) return;
    // 2. Session is already on_break — manual break, leave it alone.
    if (session.status === 'on_break') return;
    if (session.status === 'ended')    return;

    // 3. Session is ACTIVE and user is OUT of huddle. Schedule the auto-
    //    break for THRESHOLD_MS from now. If anything changes meanwhile
    //    (rejoin, manual break, session end), the cleanup below cancels.
    if (pendingTimerRef.current) return;  // already scheduled

    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      // Re-check the world at fire time. Avoid the race where the user
      // rejoined a millisecond ago and we'd auto-break right after.
      // (We can't read fresh state from inside the closure, so we trust
      // React to have re-run this effect's cleanup on state change. If
      // the state didn't change, our state-at-schedule was still valid.)
      try { localStorage.setItem(FLAG_KEY, '1'); } catch { /* private mode */ }
      startBreak()
        .then(() => {
          toast(
            'Auto-paused — you\'ve been out of the huddle for 10 min. Rejoin to resume the timer.',
            { duration: 6000 }
          );
        })
        .catch(() => {
          // Server refused — clean the flag so the rejoin path doesn't
          // try to "resume" a break that never started.
          try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
        });
    }, THRESHOLD_MS);

    // Cleanup on any dep change.
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [huddleJoined, huddleJoining, session?.status, session?._id, startBreak, endBreak]);

  return null;
}

export default HuddleAutoBreak;
