import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamPresence } from '@/hooks/useTeamPresence';
import * as api from '@/api';

/**
 * useOnCall — single source of truth for "am I on a call right now?"
 *
 * Works for ALL roles (admin / employee / sales) because the underlying
 * persistence is on User, not Session. We seed initial state from
 * useAuth() (which already pulls /auth/me on mount) and then keep it in
 * sync with the team-presence socket broadcast — so flipping the toggle
 * in another tab or device updates this tab too.
 *
 * Optimistic UI: clicking toggle flips instantly, reverts only if the
 * server call fails.
 */
export function useOnCall() {
  const { user } = useAuth();
  const presence = useTeamPresence();
  const myId = user?.id || '';

  // Local optimistic flag. Reconciled with presence.isOnCall(myId) as the
  // socket broadcast arrives.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  // If presence map updates and our optimistic value matches it, drop the
  // optimistic override so subsequent broadcasts win.
  useEffect(() => {
    if (optimistic === null) return;
    if (presence.isOnCall(myId) === optimistic) setOptimistic(null);
  }, [presence, myId, optimistic]);

  // Initial seed from /auth/me payload (only runs once when user loads).
  useEffect(() => {
    if (!user?.onCallSince) return;
    // Mirror it into the presence map by piggybacking on the public API —
    // simplest: do nothing here; the server's broadcast on next toggle
    // will sync. We just expose the seed via `isOnCall` below.
  }, [user]);

  // Authoritative read: server broadcast > optimistic > seed from auth.
  const isOnCall = optimistic !== null
    ? optimistic
    : presence.isOnCall(myId) || !!user?.onCallSince;

  const toggle = useCallback(async () => {
    const next = !isOnCall;
    setOptimistic(next);
    try {
      await api.setOnCall(next);
      // Broadcast will arrive shortly and the effect above clears optimistic.
    } catch {
      // Revert
      setOptimistic(prev => (prev === next ? !next : prev));
    }
  }, [isOnCall]);

  return { isOnCall, toggle };
}
