import { useEffect, useState } from 'react';
import { WifiOff, Wifi, Signal } from 'lucide-react';
import { useNetworkAware } from '@/hooks/useNetworkAware';

/**
 * NetworkStatus — top-of-screen banner that appears when the browser
 * thinks it's offline, plus a brief "back online" confirmation when it
 * reconnects.
 *
 * Why bother: on flaky mobile data, nothing's worse than tapping a button
 * that does nothing. A clear "you're offline" banner reframes the
 * silence as a known state, not a broken app.
 *
 * Implementation uses the standard navigator.onLine API + the 'online'
 * and 'offline' window events. Note: navigator.onLine is conservative —
 * it goes false when there's NO network at all, but a captive-portal /
 * super-slow connection can still report online. That's fine; the axios
 * timeout/retry layer covers those cases separately.
 */
export function NetworkStatus() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    const goOnline  = () => {
      setOnline(true);
      setShowBackOnline(true);
      window.setTimeout(() => setShowBackOnline(false), 3000);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Slow-connection signal — separate from online/offline. Driven by
  // the Network Information API (Chrome/Edge support it; Safari
  // doesn't). When effectiveType is 2g/slow-2g we surface a thin
  // banner so users on bad mobile data understand why things feel
  // sluggish AND know Robin's polls are auto-throttled to save
  // bandwidth (the useVisiblePoll + useNetworkAware path).
  const { slow, effectiveType, huddleOnlyMode } = useNetworkAware();

  // Owner ask (June 2026): "when the internet is low make sure three
  // things work properly — huddle, voice, screen sharing." Set a
  // window-level flag that useVisiblePoll reads. When huddleOnlyMode
  // is true (offline or slow-2g/2g), every regular poll skips its
  // tick so LiveKit gets the bandwidth.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__robinHuddleOnly = huddleOnlyMode;
    return () => { (window as any).__robinHuddleOnly = false; };
  }, [huddleOnlyMode]);

  if (!online) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-500 text-white text-center text-xs font-semibold py-2 px-4 shadow-lg flex items-center justify-center gap-2 animate-pulse">
        <WifiOff className="h-3.5 w-3.5" />
        <span>You're offline. Changes will sync once you reconnect.</span>
      </div>
    );
  }

  if (showBackOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[200] bg-green-600 text-white text-center text-xs font-semibold py-2 px-4 shadow-lg flex items-center justify-center gap-2">
        <Wifi className="h-3.5 w-3.5" />
        <span>Back online — syncing…</span>
      </div>
    );
  }

  if (huddleOnlyMode && online) {
    // 2G / slow-2G: huddle-only mode. Tell the user EXACTLY what's
    // happening so they don't think Robin is broken: dashboards paused,
    // huddle/voice/screen-share kept active.
    return (
      <div className="fixed top-0 left-0 right-0 z-[200] bg-rose-600/95 text-white text-center text-[11px] font-semibold py-1.5 px-4 shadow-lg flex items-center justify-center gap-2">
        <Signal className="h-3 w-3" />
        <span>
          Very slow connection ({effectiveType?.toUpperCase()}) — Robin paused dashboards.
          Huddle, voice + screen-share stay active.
        </span>
      </div>
    );
  }

  if (slow) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[200] bg-orange-500/95 text-white text-center text-[11px] font-semibold py-1 px-4 shadow-lg flex items-center justify-center gap-2">
        <Signal className="h-3 w-3" />
        <span>
          Slow connection ({effectiveType?.toUpperCase()}) — Robin is conserving bandwidth.
          Some live updates may lag.
        </span>
      </div>
    );
  }

  return null;
}

export default NetworkStatus;
