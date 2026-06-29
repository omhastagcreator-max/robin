import { useEffect, useState } from 'react';

/**
 * useNetworkAware — single source of truth for network conditions.
 *
 * Returns:
 *   online             — navigator.onLine
 *   effectiveType      — 'slow-2g' | '2g' | '3g' | '4g' | undefined
 *                        (Network Information API; unsupported in
 *                        Safari → returns undefined which the rest of
 *                        the app treats as "assume good")
 *   intervalMultiplier — recommended factor to multiply poll intervals
 *                        by based on conditions:
 *                          offline           → Infinity (don't poll)
 *                          slow-2g / 2g      → 4
 *                          3g                → 2
 *                          4g / wifi / unk   → 1
 *   slow               — true when effectiveType is slow-2g/2g/3g.
 *                        Used by NetworkStatus to surface a "slow
 *                        connection" banner.
 *
 * Why this exists: every poll site in Robin had a hardcoded interval
 * (30s, 60s). On 2G that's a flood of requests racing the connection
 * speed limit. Adapting one number per poll site cuts request volume
 * 4x on bad connections without changing functionality.
 *
 * Single hook, used everywhere — keeps the heuristic consistent.
 * Re-renders when network changes flip the multiplier so polls
 * automatically retune.
 */

type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g' | undefined;

interface NetworkAware {
  online: boolean;
  effectiveType: EffectiveType;
  downlinkMbps?: number;
  intervalMultiplier: number;
  slow: boolean;
  /**
   * huddleOnlyMode = true when the connection is bad enough that we
   * should ONLY spend bandwidth on the things the agency owner
   * flagged as critical — huddle / voice / screen-share. Every other
   * poll (workroom snapshot, command center, today's activity,
   * notification badge, etc.) pauses entirely so it doesn't fight
   * with the realtime media for the trickle of available bytes.
   *
   * Triggers: offline OR effectiveType === 'slow-2g' / '2g'.
   * 3G stays in adaptive mode (multiplier 2) — fast enough that
   * a polling snapshot doesn't meaningfully tax the call.
   */
  huddleOnlyMode: boolean;
}

function readConnection(): { effectiveType: EffectiveType; downlinkMbps?: number } {
  if (typeof navigator === 'undefined') return { effectiveType: undefined };
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (!conn) return { effectiveType: undefined };
  return {
    effectiveType: conn.effectiveType,
    downlinkMbps:  typeof conn.downlink === 'number' ? conn.downlink : undefined,
  };
}

function multiplierFor(online: boolean, effectiveType: EffectiveType): number {
  if (!online) return Infinity;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 4;
  if (effectiveType === '3g') return 2;
  return 1;
}

export function useNetworkAware(): NetworkAware {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [conn, setConn] = useState<{ effectiveType: EffectiveType; downlinkMbps?: number }>(readConnection());

  useEffect(() => {
    const onOnline  = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    const navConn = (navigator as any).connection;
    const onChange = () => setConn(readConnection());
    if (navConn && typeof navConn.addEventListener === 'function') {
      navConn.addEventListener('change', onChange);
    }
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
      if (navConn && typeof navConn.removeEventListener === 'function') {
        navConn.removeEventListener('change', onChange);
      }
    };
  }, []);

  const huddleOnlyMode =
    !online ||
    conn.effectiveType === 'slow-2g' ||
    conn.effectiveType === '2g';

  return {
    online,
    effectiveType: conn.effectiveType,
    downlinkMbps:  conn.downlinkMbps,
    intervalMultiplier: multiplierFor(online, conn.effectiveType),
    slow:          conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g',
    huddleOnlyMode,
  };
}
