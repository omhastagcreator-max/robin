/**
 * screenShareDebug — a ring-buffer logger for the screen-share lifecycle.
 *
 * Replaces ad-hoc `console.log` calls scattered across useWebRTC.ts. The
 * advantage: events stay in memory whether or not DevTools is open, and
 * users / support can dump the recent history with one command when a
 * share dies. Each event carries a high-resolution timestamp + the manager
 * snapshot at the time, which is far more useful than time-of-tail logs.
 *
 * Enable noisy console mirroring by:
 *   localStorage.setItem('robin.screenShare.debug', '1')
 * or by setting `window.__robinScreenShareDebugVerbose = true` in the
 * console. Dump the ring at any time with:
 *   window.robinScreenShareDebug()
 */

export type ShareEventKind =
  | 'start-requested'
  | 'getDisplayMedia-ok'
  | 'getDisplayMedia-fail'
  | 'track-onended'
  | 'track-mute'
  | 'track-unmute'
  | 'watchdog-tick'
  | 'watchdog-ended-detected'
  | 'wake-lock-acquired'
  | 'wake-lock-released'
  | 'wake-lock-failed'
  | 'visibility-change'
  | 'device-change'
  | 'recovery-scheduled'
  | 'recovery-attempt'
  | 'recovery-cancelled'
  | 'recovery-blocked-no-activation'
  | 'broadcast-channel-rejected'
  | 'socket-reconnect-republish'
  | 'livekit-reconnect-republish'
  | 'state-change'
  | 'stop-requested'
  | 'stopped'
  | 'coord'                 // cross-system coordination (LiveKit ↔ manager handoff)
  | 'error'
  | 'note';

export interface ShareEvent {
  ts: number;             // performance.now() — monotonic, survives clock changes
  iso: string;            // wall-clock ISO for human reading
  kind: ShareEventKind;
  message: string;
  data?: Record<string, unknown>;
}

const RING_LIMIT = 200;
const ring: ShareEvent[] = [];
const listeners = new Set<(e: ShareEvent) => void>();

function isVerbose(): boolean {
  try {
    if (typeof window !== 'undefined' && (window as any).__robinScreenShareDebugVerbose) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('robin.screenShare.debug') === '1') return true;
  } catch { /* private mode */ }
  return false;
}

export function logShareEvent(kind: ShareEventKind, message: string, data?: Record<string, unknown>) {
  const ev: ShareEvent = {
    ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    iso: new Date().toISOString(),
    kind,
    message,
    data,
  };
  ring.push(ev);
  if (ring.length > RING_LIMIT) ring.shift();
  listeners.forEach(l => { try { l(ev); } catch { /* listener bug — don't break logging */ } });

  // Always emit warnings + errors regardless of verbose flag — these are the
  // ones a user needs to see in DevTools without enabling debug mode first.
  const isImportant = kind === 'error' || kind === 'getDisplayMedia-fail'
    || kind === 'watchdog-ended-detected' || kind === 'track-onended';
  if (isImportant) {
    // eslint-disable-next-line no-console
    console.warn(`[screen-share] ${kind}: ${message}`, data || '');
  } else if (isVerbose()) {
    // eslint-disable-next-line no-console
    console.log(`[screen-share] ${kind}: ${message}`, data || '');
  }
}

export function getShareEvents(): ShareEvent[] {
  return ring.slice();
}

export function subscribeShareEvents(fn: (e: ShareEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function clearShareEvents() {
  ring.length = 0;
}

/**
 * Pretty-printed dump intended for the browser console. Returns the events
 * so callers can also feed it into a bug-report file.
 */
export function dumpShareEvents(): ShareEvent[] {
  // eslint-disable-next-line no-console
  console.group('[screen-share] event ring (' + ring.length + '/' + RING_LIMIT + ')');
  ring.forEach((e) => {
    // eslint-disable-next-line no-console
    console.log(`${e.iso}  ${e.kind.padEnd(28, ' ')}  ${e.message}`, e.data || '');
  });
  // eslint-disable-next-line no-console
  console.groupEnd();
  return ring.slice();
}

// Expose the dumper on window so non-developers can paste a single
// command into DevTools to capture a transcript for support tickets.
if (typeof window !== 'undefined') {
  (window as any).robinScreenShareDebug = dumpShareEvents;
}
