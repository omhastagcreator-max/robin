import { useEffect, useRef, useState } from 'react';
import { useCheckin } from '@/contexts/CheckinContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { MorningCheckinModal } from './MorningCheckinModal';
import { MiddayCheckinModal } from './MiddayCheckinModal';
import { EndOfDayCheckinModal } from './EndOfDayCheckinModal';
import { CheckinBanner } from './CheckinBanner';

/**
 * CheckinOrchestrator — decides WHEN each check-in popup auto-opens.
 *
 * Owner journey (June 2026):
 *   1st ask: "make it mandatory"                 → aggressive re-fires
 *   2nd ask: "popup coming every hour" (annoying) → back to ONCE per event
 *
 * Final policy — fire ONCE per (kind, IST day), full stop:
 *
 *   Morning  → fires on first mount after login if morning is undone.
 *              If the user dismisses (via successful submit only —
 *              modals are locked), no re-fire. Missed / left open:
 *              the always-visible topbar pill + sticky CheckinBanner
 *              nag them until submitted. That's THREE independent
 *              surfaces (pop, pill, banner) which is plenty.
 *
 *   Midday   → fires ONCE at the first tick where IST time is inside
 *              the 13:00-14:30 window AND midday is undone. After
 *              that, banner + pill only.
 *
 *   Evening  → fires ONCE at the first tick past 19:00 IST when
 *              evening is undone. Also fires on the logout flow
 *              (handled inside AuthContext.logout, not here).
 *
 * The per-kind latch is stored in localStorage keyed by today's IST
 * date so a tab-refresh doesn't re-fire what a previous mount already
 * showed. The latch resets on day rollover.
 */
export function CheckinOrchestrator() {
  const { user, role } = useAuth();
  const { session } = useSession();
  const { status, morningDone, middayDone, eveningDone, open } = useCheckin();

  const isStaff = !!user && ['admin', 'employee', 'sales', 'workroom'].includes(role);

  // Latch state — has THIS BROWSER TAB shown this kind's popup today?
  // Backed by localStorage so a page reload doesn't re-fire.
  const [autoShown, setAutoShown] = useState<{ morning: boolean; midday: boolean; evening: boolean; dateIST: string }>({
    morning: false, midday: false, evening: false, dateIST: '',
  });

  // Sync latch with today's date + any localStorage record.
  useEffect(() => {
    if (!status?.dateIST) return;
    const key = `robin.checkin.autoshown.${status.dateIST}`;
    try {
      const raw = localStorage.getItem(key);
      const cached = raw ? JSON.parse(raw) : {};
      setAutoShown({
        morning: !!cached.morning,
        midday:  !!cached.midday,
        evening: !!cached.evening,
        dateIST: status.dateIST,
      });
    } catch {
      setAutoShown({ morning: false, midday: false, evening: false, dateIST: status.dateIST });
    }
  }, [status?.dateIST]);

  // Persist any change to localStorage.
  useEffect(() => {
    if (!autoShown.dateIST) return;
    try {
      localStorage.setItem(
        `robin.checkin.autoshown.${autoShown.dateIST}`,
        JSON.stringify({
          morning: autoShown.morning,
          midday:  autoShown.midday,
          evening: autoShown.evening,
        }),
      );
    } catch { /* quota / private mode */ }
  }, [autoShown]);

  /* ─────────────────── MORNING — once on arrival ────────────────────── */
  useEffect(() => {
    if (!isStaff || !status || morningDone) return;
    if (autoShown.morning) return;
    setAutoShown(prev => ({ ...prev, morning: true }));
    const t = window.setTimeout(() => { open('morning'); }, 250);
    return () => window.clearTimeout(t);
  }, [isStaff, status, morningDone, autoShown.morning, open]);

  /* ───────────────── MIDDAY — once at 13:00-14:30 IST ──────────────── */
  useEffect(() => {
    if (!isStaff || !status) return;
    if (!morningDone || middayDone) return;
    if (autoShown.midday) return;

    const tick = () => {
      const ist = new Date(Date.now() + 330 * 60_000);
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      const inWindow = mins >= 13 * 60 && mins < 14 * 60 + 30;
      if (inWindow) {
        setAutoShown(prev => ({ ...prev, midday: true }));
        open('midday');
      }
    };

    // Check immediately in case user opens Robin already inside the window.
    tick();
    // Poll every minute but the latch above ensures we only actually
    // fire once — subsequent ticks bail because autoShown.midday is now true.
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [isStaff, status, morningDone, middayDone, autoShown.midday, open]);

  /* ─────────────── EVENING — once at 19:00 IST ─────────────────────── */
  useEffect(() => {
    if (!isStaff || !status) return;
    if (!morningDone || eveningDone) return;
    if (autoShown.evening) return;

    const tick = () => {
      const ist = new Date(Date.now() + 330 * 60_000);
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (mins >= 19 * 60) {
        setAutoShown(prev => ({ ...prev, evening: true }));
        open('evening');
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [isStaff, status, morningDone, eveningDone, autoShown.evening, open]);

  // The evening popup is also fired by AuthContext.logout — that's the
  // enforcement gate for "no logout without wrapping". We deliberately
  // do NOT install a beforeunload prompt here anymore — it interacted
  // badly with normal in-app navigations and contributed to the
  // "popup coming every hour" feel. Users who close the tab without
  // wrapping simply get prompted on their next login (evening remains
  // undone → next-day morning wraps yesterday's mess as part of its
  // own flow).

  // session unused in the gates above; referenced to satisfy noUnusedLocals.
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
