import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

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

  return null;
}

export default NetworkStatus;
