import { useEffect, useRef } from 'react';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { Monitor, X } from 'lucide-react';

/**
 * ScreenShareResumeBanner — sticky red strip at the top of every page when
 * the user had screen sharing ON but the browser killed the track
 * (display sleep, Stop pill, tab discard, etc.). Pairs with the click-
 * armed auto-resume in useWebRTC.ts: any pointer interaction on the
 * page is treated as a fresh user gesture for getDisplayMedia, so the
 * picker re-pops immediately. The big "Resume now" button is the
 * obvious one-tap recovery; the X button gives up and clears the intent.
 *
 * Designed to be impossible to miss — full-width, red, persistent until
 * resolved. That's the "brute force" the owner asked for.
 */
export function ScreenShareResumeBanner() {
  const { persistentIntent, isSharing, startSharing, setPersistentIntent } = useScreenShare();
  // ── Cross-tab Notification reminder ─────────────────────────────────
  // When the tab is HIDDEN (user switched away) AND intent is on but
  // sharing is off, fire a desktop Notification every 60 s so they're
  // reminded even without coming back to Robin. Clicking the notification
  // focuses the Robin tab. Requires permission — we request it the first
  // time the banner becomes visible.
  const lastPingRef = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (!persistentIntent || isSharing) return;
    // Request permission once when the banner first appears.
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}); } catch { /* old browsers */ }
    }
    const ping = () => {
      if (!persistentIntent || isSharing) return;
      // Only ping when the tab is actually hidden — visible tab already
      // shows the loud red banner and toast.
      if (document.visibilityState !== 'hidden') return;
      if (Notification.permission !== 'granted') return;
      const now = Date.now();
      if (now - lastPingRef.current < 50_000) return;     // throttle to ~once a minute
      lastPingRef.current = now;
      try {
        const n = new Notification('Robin — screen sharing is OFF', {
          body: 'Click to switch back and resume sharing.',
          tag:  'robin-screen-share-off',                 // single re-usable notification
          requireInteraction: false,
          silent: false,
        });
        n.onclick = () => { try { window.focus(); } catch {} ; n.close(); };
      } catch { /* notification API not available */ }
    };
    ping();
    const i = setInterval(ping, 30_000);
    // Also fire immediately when the tab goes hidden / shown.
    const onVis = () => ping();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onVis); };
  }, [persistentIntent, isSharing]);

  if (!persistentIntent || isSharing) return null;

  return (
    <div className="bg-rose-500/15 border-b border-rose-500/30 px-4 py-2 flex items-center gap-3 sticky top-0 z-30 w-full">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
        <Monitor className="h-4 w-4 text-rose-700 shrink-0" />
        <p className="text-xs font-semibold text-rose-700 truncate">
          Screen sharing stopped. Click anywhere to resume — the browser picker will pop.
        </p>
      </div>
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
    </div>
  );
}
