import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Monitor } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { useScreenShare } from '@/contexts/ScreenShareContext';

/**
 * ScreenShareReminder
 *
 * Silently mounts at the AppLayout level and fires a toast every 10 minutes
 * if all of the following are true:
 *
 *   1. The user has an active session (clocked in, not on break, not ended)
 *   2. Their role is employee or sales (admins/clients aren't expected to
 *      share their screen continuously)
 *   3. They are NOT currently sharing their screen
 *
 * The toast carries a single "Share now" action that runs startSharing()
 * inside the user-gesture handler so Chrome accepts the getDisplayMedia
 * prompt. The toast also has a sensible duration so it dismisses on its
 * own if ignored — the next 10-minute tick will re-surface it. Tab-hidden
 * ticks are skipped (no point nudging when the user can't see the toast).
 *
 * NB: this is a soft nudge, not a hard policy. Compliance enforcement (if
 * needed) should live server-side, not in a client toast that the user can
 * dismiss with one click.
 */

const REMINDER_INTERVAL_MS  = 10 * 60 * 1000; // 10 minutes
const FIRST_REMINDER_DELAY  = 60 * 1000;       // 1 min after mount/login (give them time to start)

export function ScreenShareReminder() {
  const { role } = useAuth();
  const { isActive, isOnBreak } = useSession();
  const { isSharing, startSharing } = useScreenShare();

  // Refs so the interval can read the latest values without re-binding.
  const isActiveRef  = useRef(isActive);
  const isOnBreakRef = useRef(isOnBreak);
  const isSharingRef = useRef(isSharing);
  const startShareRef = useRef(startSharing);

  useEffect(() => { isActiveRef.current  = isActive;  }, [isActive]);
  useEffect(() => { isOnBreakRef.current = isOnBreak; }, [isOnBreak]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { startShareRef.current = startSharing; }, [startSharing]);

  useEffect(() => {
    // Reminder only applies to internal staff who are expected to share.
    if (!['employee', 'sales'].includes(role)) return;

    let firstTimer:   ReturnType<typeof setTimeout>  | null = null;
    let interval:     ReturnType<typeof setInterval> | null = null;

    const maybeRemind = () => {
      // Don't pester users when they can't see the toast.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Only fire when the user is actively working AND not sharing.
      if (!isActiveRef.current) return;
      if (isOnBreakRef.current) return;
      if (isSharingRef.current) return;

      // Single toast — give it an ID so a second tick replaces (not stacks).
      toast('Your screen isn\'t being shared', {
        id: 'screen-share-reminder',
        description: 'Share your screen so the team can keep an eye on what you\'re working on.',
        icon: <Monitor className="h-4 w-4 text-amber-500" />,
        duration: 15_000,
        action: {
          label: 'Share now',
          // Run inside the click handler — required for getDisplayMedia's
          // user-activation rule on Chrome / Safari.
          onClick: () => { startShareRef.current?.(); },
        },
      });
    };

    // First reminder fires 1 min after mount so we don't immediately nag a
    // user who just clocked in. After that, every 10 min on the dot.
    firstTimer = setTimeout(() => {
      maybeRemind();
      interval = setInterval(maybeRemind, REMINDER_INTERVAL_MS);
    }, FIRST_REMINDER_DELAY);

    return () => {
      if (firstTimer) clearTimeout(firstTimer);
      if (interval)   clearInterval(interval);
    };
  }, [role]);

  return null;
}

export default ScreenShareReminder;
