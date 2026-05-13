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

    // Initial: only start if visible. If hidden on mount we'll start on
    // visibilitychange.
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      start();
    }
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mounted = false;
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
