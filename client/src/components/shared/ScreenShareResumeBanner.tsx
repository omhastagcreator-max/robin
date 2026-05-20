import { useEffect, useRef } from 'react';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { Monitor, X, Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';

/**
 * ScreenShareResumeBanner — top-of-page status strip showing the LIFE-CYCLE
 * of the user's screen-share. Replaces the previous single-purpose red bar.
 *
 * Distinct visual treatments per state, so the user is never confused about
 * what just happened:
 *   - blocked    → red, "Permission denied / cross-tab"; no resume button
 *   - recovering → amber, "Reconnecting…" spinner; auto-retries in the
 *                   background, but a manual "Resume now" button is shown
 *   - intent + idle (stopped unexpectedly) → red, "Click anywhere to resume"
 *
 * The banner ONLY renders when there's something the user needs to know.
 * While `isSharing` is true OR there's no intent, the strip disappears.
 *
 * Hidden tab notification reminder is preserved from the previous version.
 */
export function ScreenShareResumeBanner() {
  const {
    persistentIntent, isSharing, startSharing, setPersistentIntent,
    state, blockReason, lastEndReason, recoveryAttempts, trackMuted,
  } = useScreenShare();

  // ── Cross-tab Notification reminder ─────────────────────────────────────
  const lastPingRef = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (!persistentIntent || isSharing) return;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}); } catch { /* old browsers */ }
    }
    const ping = () => {
      if (!persistentIntent || isSharing) return;
      if (document.visibilityState !== 'hidden') return;
      if (Notification.permission !== 'granted') return;
      const now = Date.now();
      if (now - lastPingRef.current < 50_000) return;
      lastPingRef.current = now;
      try {
        const n = new Notification('Robin — screen sharing is OFF', {
          body: 'Click to switch back and resume sharing.',
          tag:  'robin-screen-share-off',
          requireInteraction: false,
          silent: false,
        });
        n.onclick = () => { try { window.focus(); } catch {} ; n.close(); };
      } catch { /* notification API not available */ }
    };
    ping();
    const i = setInterval(ping, 30_000);
    const onVis = () => ping();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onVis); };
  }, [persistentIntent, isSharing]);

  // ── Decide which variant (if any) to show ───────────────────────────────
  // While actively sharing, render an unobtrusive amber strip if the source
  // is currently muted (backgrounded) so the user knows their viewers see
  // a frozen frame.
  if (isSharing) {
    if (trackMuted) {
      return (
        <Strip tone="warn" icon={<AlertTriangle className="h-4 w-4" />} >
          <span className="text-xs font-semibold">Source is paused — bring the captured window to the front to resume your viewers' feed.</span>
        </Strip>
      );
    }
    return null;
  }

  if (state === 'blocked') {
    const reason = blockReason === 'cross-tab'
      ? 'Another Robin tab is already sharing. Close it and try again here.'
      : blockReason === 'unsupported'
      ? 'Your browser doesn\'t support screen capture. Try Chrome, Edge, or Firefox.'
      : 'Permission was denied. On macOS, allow Robin in System Settings → Privacy & Security → Screen Recording.';
    return (
      <Strip tone="danger" icon={<ShieldAlert className="h-4 w-4" />}>
        <p className="text-xs font-semibold flex-1 truncate">Screen sharing blocked — {reason}</p>
        <button
          onClick={() => startSharing()}
          className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 shrink-0"
        >
          Try again
        </button>
      </Strip>
    );
  }

  if (state === 'recovering') {
    const causeCopy: Record<string, string> = {
      'browser-stop-pill': 'You stopped sharing in Chrome\'s toolbar.',
      'source-closed':     'The captured window was closed.',
      'system-sleep':      'Your display went to sleep.',
      'tab-discard':       'A background tab was paused by Chrome.',
      'device-change':     'A display change was detected.',
      'network':           'A brief network drop ended the capture.',
      'unknown':           'The browser ended the share unexpectedly.',
    };
    const cause = causeCopy[lastEndReason || 'unknown'] || causeCopy.unknown;
    return (
      <Strip tone="warn" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">
            Reconnecting screen share — {cause}
          </p>
          <p className="text-[11px] opacity-75 truncate">
            Auto-retry #{recoveryAttempts} · click anywhere on Robin to resume immediately
          </p>
        </div>
        <button
          onClick={() => startSharing()}
          className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 shrink-0"
        >
          Resume now
        </button>
        <button
          onClick={() => setPersistentIntent(false)}
          title="Stop trying to resume"
          className="text-amber-700/70 hover:text-amber-700 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </Strip>
    );
  }

  // Intent on, but state is idle / stopped — show the classic resume bar.
  if (persistentIntent) {
    return (
      <Strip tone="danger" icon={<Monitor className="h-4 w-4" />}>
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
        <p className="text-xs font-semibold truncate flex-1">
          Screen sharing stopped. Click anywhere to resume — the browser picker will pop.
        </p>
        <button
          onClick={() => startSharing()}
          className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 shrink-0"
        >
          Resume now
        </button>
        <button
          onClick={() => setPersistentIntent(false)}
          title="Stop trying to resume"
          className="text-rose-700/70 hover:text-rose-700 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </Strip>
    );
  }

  return null;
}

// ── Reusable strip shell ────────────────────────────────────────────────────
type Tone = 'danger' | 'warn';

function Strip({ tone, icon, children }: { tone: Tone; icon: React.ReactNode; children: React.ReactNode }) {
  const palette = tone === 'danger'
    ? 'bg-rose-500/15 border-rose-500/30 text-rose-700'
    : 'bg-amber-500/15 border-amber-500/30 text-amber-800';
  return (
    <div className={`${palette} border-b px-4 py-2 flex items-center gap-3 sticky top-0 z-30 w-full`}>
      <span className="shrink-0">{icon}</span>
      {children}
    </div>
  );
}
