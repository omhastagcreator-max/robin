import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCheckin } from '@/contexts/CheckinContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { MorningCheckinModal } from './MorningCheckinModal';
import { MiddayCheckinModal } from './MiddayCheckinModal';
import { EndOfDayCheckinModal } from './EndOfDayCheckinModal';
import { CheckinBanner } from './CheckinBanner';

/**
 * CheckinOrchestrator — the single mount that decides WHEN each
 * check-in popup auto-opens.
 *
 * Owner ask (June 2026): "I want it to appear daily when I log in,
 * half day, log out." Earlier iteration showed the morning popup
 * once on mount and silently never again if the user dismissed it
 * or the effect's session-gate raced. This version is RELIABLE:
 *
 *   ─ Morning (LOGIN)
 *     Auto-opens whenever the user is in the app AND morning isn't
 *     done AND we haven't shown it in the last 60s. Re-fires on
 *     every page navigation so dismissing it just buys you one
 *     navigation worth of grace.
 *
 *   ─ Midday (HALF DAY, 13:00-14:30 IST)
 *     Polls every 30s. Inside the 13:00-14:30 window, re-prompts
 *     every 5 minutes if midday is still undone (this is the half-
 *     day half-hour the owner asked for). After 14:30, drops to a
 *     30-min cadence so it nudges without nagging.
 *
 *   ─ Evening (LOG OUT, 19:00 IST trigger + tab-close guard)
 *     Polls every 60s. Auto-fires at the first poll past 19:00 IST,
 *     re-prompts every 15 min until filled. ALSO installs a
 *     beforeunload listener so any attempt to close the tab after
 *     morning-done-but-evening-pending opens the modal AND shows
 *     the browser's "leave page?" confirmation. AuthContext.logout
 *     already awaits the evening modal — this is for users who
 *     close the tab without clicking sign-out.
 *
 * Per-kind cooldowns live in a ref so reopening doesn't re-render
 * the orchestrator. Cooldowns are reset on IST day rollover so a
 * "last shown yesterday at 6pm" stamp doesn't suppress today's
 * morning popup.
 */
export function CheckinOrchestrator() {
  const { user, role } = useAuth();
  const { session } = useSession();
  const location = useLocation();
  const { status, morningDone, middayDone, eveningDone, open } = useCheckin();

  const isStaff = !!user && ['admin', 'employee', 'sales', 'workroom'].includes(role);

  // Cooldown tracker — last time each kind was auto-opened, ms since epoch.
  // 0 = never shown today.
  const lastShownRef = useRef<{ morning: number; midday: number; evening: number; dateIST: string }>({
    morning: 0, midday: 0, evening: 0, dateIST: '',
  });

  // Reset cooldowns on IST day rollover so yesterday's stamps don't suppress
  // today's popups.
  useEffect(() => {
    if (!status?.dateIST) return;
    if (lastShownRef.current.dateIST !== status.dateIST) {
      lastShownRef.current = { morning: 0, midday: 0, evening: 0, dateIST: status.dateIST };
    }
  }, [status?.dateIST]);

  /* ───────────── MORNING — fires on login + every nav until done ───────── */
  useEffect(() => {
    if (!isStaff || !status || morningDone) return;
    // 60s cooldown between auto-opens (route changes during fill won't
    // re-pop; dismissing buys you one navigation of grace).
    const now = Date.now();
    if (now - lastShownRef.current.morning < 60_000) return;
    lastShownRef.current.morning = now;
    // Slight defer so layout settles before the modal mounts.
    const t = window.setTimeout(() => { open('morning'); }, 200);
    return () => window.clearTimeout(t);
  }, [isStaff, status, morningDone, location.pathname, open]);

  /* ───────── MIDDAY — actively polled 13:00-14:30 IST window ──────────── */
  useEffect(() => {
    if (!isStaff || !status) return;
    if (!morningDone || middayDone) return;

    const tick = () => {
      const ist = new Date(Date.now() + 330 * 60_000);
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      const inWindow  = mins >= 13 * 60 && mins < 14 * 60 + 30;
      const pastWindow = mins >= 14 * 60 + 30;
      const cool = Date.now() - lastShownRef.current.midday;

      if (inWindow && cool >= 5 * 60_000) {
        lastShownRef.current.midday = Date.now();
        open('midday');
      } else if (pastWindow && cool >= 30 * 60_000) {
        // Still pending well past window — nudge every 30 min until end of day.
        lastShownRef.current.midday = Date.now();
        open('midday');
      }
    };

    // Fire immediately on mount + on every page nav, then every 30s.
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [isStaff, status, morningDone, middayDone, location.pathname, open]);

  /* ─────── EVENING — fires at 19:00 IST + beforeunload guard ─────────── */
  useEffect(() => {
    if (!isStaff || !status) return;
    if (!morningDone || eveningDone) return;

    const tick = () => {
      const ist = new Date(Date.now() + 330 * 60_000);
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (mins >= 19 * 60) {
        const cool = Date.now() - lastShownRef.current.evening;
        if (cool >= 15 * 60_000) {
          lastShownRef.current.evening = Date.now();
          open('evening');
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [isStaff, status, morningDone, eveningDone, location.pathname, open]);

  /* ─── beforeunload — block tab close if evening is owed ──────────────── */
  useEffect(() => {
    if (!isStaff) return;
    if (!morningDone || eveningDone) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Open the modal so when the user cancels the close they see it.
      try { open('evening'); } catch { /* */ }
      // Modern browsers ignore the custom message string but the presence
      // of returnValue triggers the native "Leave site?" confirmation.
      e.preventDefault();
      e.returnValue =
        "You haven't wrapped your day yet. Fill the evening check-in before leaving?";
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isStaff, morningDone, eveningDone, open]);

  // session intentionally unused in the gates above — kept in deps in case
  // a future revision wants to re-gate. Referenced here for noUnusedLocals.
  void session;

  return (
    <>
      <CheckinBanner
        morningDone={morningDone}
        middayDone={middayDone}
        eveningDone={eveningDone}
        onOpen={open}
        hasMorningSession={!!session}
        sessionActive={session?.status === 'active' || session?.status === 'on_break'}
      />
      <MorningCheckinModal />
      <MiddayCheckinModal />
      <EndOfDayCheckinModal />
    </>
  );
}

export default CheckinOrchestrator;
