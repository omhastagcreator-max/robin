import { useEffect, useRef } from 'react';

/**
 * useVisiblePoll — runs `fn` on a setInterval, but pauses when the tab is
 * hidden (document.visibilityState === 'hidden'). Resumes — and fires once
 * immediately to catch up — when the tab becomes visible again.
 *
 * The audit found ~6 polls (notification badge, presence, meta-ads card,
 * client-meetings card, sheet preview, schedule meetings strip) firing
 * every 30-60 seconds even when the tab was minimized — eating CPU and
 * battery while never updating anything the user could see.
 *
 * Usage:
 *   useVisiblePoll(load, 60_000);             // fires once on mount, then
 *                                             // every 60s while visible
 *   useVisiblePoll(load, 30_000, [orgId]);   // restarts when orgId changes
 */
export function useVisiblePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  deps: React.DependencyList = [],
) {
  // Keep `fn` in a ref so identity changes (eg. new closure each render)
  // don't restart the interval. The deps array controls restarts.
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    const tick = () => {
      // Don't tick while hidden — saves CPU/battery on backgrounded tabs.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Don't tick while offline — there's no point hammering an
      // unreachable server, and on flaky mobile data each failed
      // request burns more battery than a tick does. The 'online'
      // listener below catches us up the moment connectivity returns.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try { fnRef.current(); } catch { /* poll failures are fn's problem */ }
    };
    const start = () => {
      if (timer) return;
      tick(); // catch-up fire on (re)start
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (mounted) start();
    };
    // 'online' fires when the browser transitions from offline → online.
    // We catch up with a single tick and let the interval take over.
    const onOnline = () => { if (mounted) tick(); };

    // Initial: only start if visible. If hidden on mount we'll start on
    // visibilitychange.
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      start();
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);

    return () => {
      mounted = false;
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
