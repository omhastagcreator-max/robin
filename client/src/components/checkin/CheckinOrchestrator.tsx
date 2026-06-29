import { useEffect, useState } from 'react';
import { useCheckin } from '@/contexts/CheckinContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { MorningCheckinModal } from './MorningCheckinModal';
import { MiddayCheckinModal } from './MiddayCheckinModal';
import { EndOfDayCheckinModal } from './EndOfDayCheckinModal';
import { CheckinBanner } from './CheckinBanner';

/**
 * CheckinOrchestrator — single mount point that:
 *   1. Renders all three modals (each guards itself by openKind).
 *   2. Renders the sticky "checkin required" banner.
 *   3. Auto-opens the morning popup as soon as the user lands with an
 *      active session AND no morning record yet.
 *   4. Auto-opens the midday popup the first time the user is online
 *      between 13:00 and 14:30 IST and the morning is done.
 *
 * The evening popup is NOT auto-opened by time — it's opened by the
 * logout flow (and by an explicit "Wrap day" button in the banner).
 */
export function CheckinOrchestrator() {
  const { user, role } = useAuth();
  const { session } = useSession();
  const { status, morningDone, middayDone, eveningDone, open } = useCheckin();
  const [autoMorningShown, setAutoMorningShown] = useState(false);
  const [autoMiddayShown, setAutoMiddayShown]   = useState(false);

  const isStaff = !!user && ['admin', 'employee', 'sales', 'workroom'].includes(role);

  // Morning: open as soon as status is loaded + morning not done +
  // there's an active session (we want them clocked in first so we
  // know they're starting work, not just glancing).
  useEffect(() => {
    if (!isStaff) return;
    if (!status) return;
    if (autoMorningShown) return;
    if (morningDone) return;
    if (!session) return;
    if (session.status !== 'active' && session.status !== 'on_break') return;
    setAutoMorningShown(true);
    // Defer one tick so the layout finishes mounting.
    setTimeout(() => { open('morning'); }, 200);
  }, [isStaff, status, morningDone, session, autoMorningShown, open]);

  // Midday: only after morning is done, only between 1pm-2:30pm IST,
  // only once per day (status.dateIST tracked via state). Re-check every
  // minute so we catch the moment the user crosses 1pm.
  useEffect(() => {
    if (!isStaff) return;
    if (!status) return;
    if (autoMiddayShown) return;
    if (!morningDone || middayDone) return;

    const tick = () => {
      const ist = new Date(Date.now() + 330 * 60_000);
      const hour = ist.getUTCHours();
      const min  = ist.getUTCMinutes();
      const minutesSinceMidnight = hour * 60 + min;
      // 13:00 → 14:30 window. Outside this we don't auto-fire (banner
      // still nudges, but no modal interruption).
      if (minutesSinceMidnight >= 13 * 60 && minutesSinceMidnight < 14 * 60 + 30) {
        setAutoMiddayShown(true);
        open('midday');
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isStaff, status, morningDone, middayDone, autoMiddayShown, open]);

  // Reset the auto-shown latches when the IST day rolls. Cheap because
  // status.dateIST changes are rare (once per day per user).
  useEffect(() => {
    setAutoMorningShown(false);
    setAutoMiddayShown(false);
  }, [status?.dateIST]);

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
