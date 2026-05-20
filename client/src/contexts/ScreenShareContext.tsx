import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useWebRTCSender } from '@/hooks/useWebRTC';
import { useAuth } from '@/contexts/AuthContext';
import { screenShareManager, type ManagerSnapshot } from '@/lib/screenShareManager';

/**
 * ScreenShareContext — thin React wrapper around the screenShareManager
 * singleton + the useWebRTCSender peer-connection mesh.
 *
 * The MediaStream itself lives in the manager (framework-agnostic), so this
 * context is mostly a passthrough. The reason we still keep it is:
 *   1. `useWebRTCSender` needs to be instantiated exactly once for the
 *      whole app (one signaling hook per browser, not per consumer), and a
 *      provider is the cleanest enforcement.
 *   2. Existing call sites import `useScreenShare` and expect the old
 *      shape — keeping the context preserves the API.
 */

interface ScreenShareContextValue {
  isSharing: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
  /** True when the user has consciously turned sharing on; only an
   *  explicit Stop click clears it. Drives the sticky resume banner. */
  persistentIntent: boolean;
  setPersistentIntent: (on: boolean) => void;
  /** Fine-grained manager state for UI to distinguish sharing /
   *  recovering / blocked / stopped. */
  state: ManagerSnapshot['state'];
  blockReason: ManagerSnapshot['blockReason'];
  lastEndReason: ManagerSnapshot['lastEndReason'];
  recoveryAttempts: number;
  trackMuted: boolean;
}

const ScreenShareContext = createContext<ScreenShareContextValue | null>(null);

export function ScreenShareProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // We invoke the sender hook globally so the stream and socket persist
  // across routing. It internally subscribes to screenShareManager.
  const { isSharing, startSharing, stopSharing, persistentIntent, setPersistentIntent } = useWebRTCSender(user?.id || '');

  // Mirror the full manager snapshot for callers that need more granular UI.
  const [snap, setSnap] = useState<ManagerSnapshot>(() => screenShareManager.getSnapshot());
  useEffect(() => screenShareManager.subscribe(() => setSnap(screenShareManager.getSnapshot())), []);

  return (
    <ScreenShareContext.Provider
      value={{
        isSharing,
        startSharing,
        stopSharing,
        persistentIntent,
        setPersistentIntent,
        state:            snap.state,
        blockReason:      snap.blockReason,
        lastEndReason:    snap.lastEndReason,
        recoveryAttempts: snap.recoveryAttempts,
        trackMuted:       snap.trackMuted,
      }}
    >
      {children}
    </ScreenShareContext.Provider>
  );
}

export function useScreenShare() {
  const ctx = useContext(ScreenShareContext);
  if (!ctx) throw new Error('useScreenShare must be used within ScreenShareProvider');
  return ctx;
}
