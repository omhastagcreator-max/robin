/**
 * screenShareManager — singleton, framework-agnostic, owns the MediaStream.
 *
 * The previous implementation lived inside a React hook. That meant every
 * React re-render or remount risked stomping on the lifecycle. By lifting
 * the state machine out of React, the stream survives every UI churn —
 * route change, AppLayout remount, HuddleDock collapse, even React 18
 * StrictMode double-mounting in dev. React subscribes via getSnapshot().
 *
 * Goals:
 *   - One canonical MediaStream / video track at a time (no duplicates).
 *   - Robust classification of WHY the track ended (user / pill / sleep /
 *     source-closed / discard / unknown).
 *   - Exponential-backoff recovery driven by user activation (click /
 *     key) — getDisplayMedia hard-requires that.
 *   - Watchdog catches dead tracks the browser failed to fire onended for.
 *   - BroadcastChannel cross-tab guard so two tabs can't fight over the
 *     same camera/screen.
 *   - devicechange listener so monitor swap / unplug recovers cleanly.
 *   - Persistent intent in sessionStorage (reload survives; logout doesn't).
 *   - Wake-lock acquire + visibility re-acquire (Mac display-sleep kills capture).
 *   - Detailed ring-buffer logging via screenShareDebug.
 *
 * What this manager DELIBERATELY doesn't own:
 *   - The RTCPeerConnection mesh (useWebRTC.ts:useWebRTCSender still does
 *     that — it sees the manager's track and attaches it to admin viewers).
 *   - LiveKit publishing (useMeetingRoom.ts owns its own LiveKit screen
 *     publication; it should still call `manager.start()` / `manager.stop()`
 *     in a follow-up unification, but for now we leave it independent and
 *     just coordinate via `isSharing()` so the two paths don't double-pop
 *     getDisplayMedia).
 */

import { logShareEvent } from './screenShareDebug';

export type EndReason =
  | 'user'                 // user clicked our Stop button — manualStop was set
  | 'browser-stop-pill'    // user clicked Chrome's "Stop sharing" pill
  | 'source-closed'        // captured window/tab closed
  | 'system-sleep'         // OS display sleep / lock — track ended + wake-lock dropped
  | 'tab-discard'          // Chrome Memory Saver discarded the source tab
  | 'device-change'        // monitor unplugged / device change cascade
  | 'network'              // best-effort attribution (PC closed by signaling)
  | 'unknown';

export type ShareState =
  | 'idle'                 // user has never started a share this session
  | 'starting'             // getDisplayMedia in flight
  | 'sharing'              // active capture
  | 'recovering'           // we want to restart but waiting for user activation
  | 'stopped'              // last share was stopped by user (clean)
  | 'blocked';             // browser denied permission

export interface ManagerSnapshot {
  state: ShareState;
  isSharing: boolean;
  hasStream: boolean;
  trackSettings: MediaTrackSettings | null;
  intent: boolean;
  lastEndReason: EndReason | null;
  recoveryAttempts: number;
  lastError: string | null;
  startedAt: number | null;
  blockReason: 'permission-denied' | 'unsupported' | 'cross-tab' | null;
  trackMuted: boolean;       // track is muted (source backgrounded, etc.)
}

type Listener = () => void;

// ── Module-level state (the singleton) ─────────────────────────────────────
const PERSIST_KEY = 'robin.screenShare.intent';
const BC_NAME = 'robin.screen-share.coordination';

let currentStream: MediaStream | null = null;
let currentTrack: MediaStreamTrack | null = null;
let snapshot: ManagerSnapshot = {
  state: 'idle',
  isSharing: false,
  hasStream: false,
  trackSettings: null,
  intent: readPersistedIntent(),
  lastEndReason: null,
  recoveryAttempts: 0,
  lastError: null,
  startedAt: null,
  blockReason: null,
  trackMuted: false,
};
const listeners = new Set<Listener>();

// Flags / scratch state
let stopping = false;
let manualStop = false;            // set true inside stop() so onended can classify
let wakeLock: any = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityWired = false;
let deviceWired = false;
let userActivationWired = false;
let bc: BroadcastChannel | null = null;
let lastActivationAt = 0;          // last time we saw a user gesture

// Public hooks consumed by useWebRTC's sender path — we don't import that
// hook here (cycle-free) but we expose callbacks the hook subscribes to.
const trackListeners = new Set<(track: MediaStreamTrack | null) => void>();

// ── Helpers ────────────────────────────────────────────────────────────────
function readPersistedIntent(): boolean {
  try { return sessionStorage.getItem(PERSIST_KEY) === '1'; } catch { return false; }
}
function writePersistedIntent(on: boolean) {
  try {
    if (on) sessionStorage.setItem(PERSIST_KEY, '1');
    else    sessionStorage.removeItem(PERSIST_KEY);
  } catch { /* private mode */ }
}

function emit() { listeners.forEach(l => { try { l(); } catch { /* ignore */ } }); }
function emitTrack(track: MediaStreamTrack | null) {
  trackListeners.forEach(l => { try { l(track); } catch { /* ignore */ } });
}

function updateSnapshot(patch: Partial<ManagerSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function setState(next: ShareState, extra?: Partial<ManagerSnapshot>) {
  if (snapshot.state === next && !extra) return;
  logShareEvent('state-change', `${snapshot.state} → ${next}`, extra as Record<string, unknown>);
  updateSnapshot({ state: next, ...(extra || {}) });
}

function safeGetSettings(t: MediaStreamTrack | null): MediaTrackSettings | null {
  if (!t) return null;
  try { return t.getSettings(); } catch { return null; }
}

// ── BroadcastChannel — coordinate between tabs ─────────────────────────────
function ensureBroadcast() {
  if (bc || typeof BroadcastChannel === 'undefined') return;
  try {
    bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (msg) => {
      const m = msg.data as { type: string; from?: string };
      if (!m || typeof m.type !== 'string') return;
      // Another tab started sharing → we yield. This tab kills its own
      // share so the OS doesn't end up with two captures fighting.
      if (m.type === 'started' && currentTrack) {
        logShareEvent('broadcast-channel-rejected', 'another tab started — yielding');
        manualStop = true;
        teardown('device-change');
      }
      if (m.type === 'ping' && currentTrack) {
        bc?.postMessage({ type: 'active' });
      }
    };
  } catch (e: any) {
    logShareEvent('error', 'BroadcastChannel init failed', { message: e?.message });
  }
}

function broadcastStarted() { try { bc?.postMessage({ type: 'started' }); } catch { /* ignore */ } }

async function probeOtherTab(): Promise<boolean> {
  if (!bc) return false;
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const onReply = (msg: MessageEvent) => {
      if (resolved) return;
      const m = msg.data as { type: string };
      if (m?.type === 'active') {
        resolved = true;
        bc?.removeEventListener('message', onReply);
        resolve(true);
      }
    };
    bc?.addEventListener('message', onReply);
    try { bc?.postMessage({ type: 'ping' }); } catch { /* ignore */ }
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      bc?.removeEventListener('message', onReply);
      resolve(false);
    }, 250);
  });
}

// ── Activation tracking — power for the recovery path ──────────────────────
function ensureUserActivationListener() {
  if (userActivationWired) return;
  userActivationWired = true;
  const mark = () => { lastActivationAt = Date.now(); };
  // Capture-phase so we don't lose the gesture if a child stopPropagation()s.
  document.addEventListener('pointerdown', mark, { capture: true });
  document.addEventListener('keydown',     mark, { capture: true });
}

function hasFreshActivation(): boolean {
  // 4s — matches what the Chromium HTML spec gives `getDisplayMedia`. We
  // pad slightly less than the 5s allowed to leave room for our own delay.
  return Date.now() - lastActivationAt < 4_000;
}

// ── Visibility — wake-lock re-acquire ──────────────────────────────────────
function ensureVisibilityListener() {
  if (visibilityWired) return;
  visibilityWired = true;
  const onVis = async () => {
    logShareEvent('visibility-change', document.visibilityState);
    if (document.visibilityState === 'visible' && currentTrack && !wakeLock) {
      await acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVis);
}

// ── Device change — monitor unplug etc. ────────────────────────────────────
function ensureDeviceListener() {
  if (deviceWired) return;
  deviceWired = true;
  if (!navigator.mediaDevices?.addEventListener) return;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    logShareEvent('device-change', 'mediaDevices.devicechange');
    // If our track has gone bad (ended/muted for >5s post-event) the
    // watchdog will pick it up shortly. We just log here.
  });
}

async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    wakeLock = await (navigator as any).wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      logShareEvent('wake-lock-released', 'wakeLock release event');
      wakeLock = null;
    });
    logShareEvent('wake-lock-acquired', 'screen wake-lock held');
  } catch (e: any) {
    logShareEvent('wake-lock-failed', 'request failed', { message: e?.message });
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch { /* ignore */ }
  wakeLock = null;
}

// ── Watchdog — catch dead tracks the browser didn't notify us about ────────
function startWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = setInterval(() => {
    const t = currentTrack;
    if (!t) return;
    if (t.readyState === 'ended') {
      logShareEvent('watchdog-ended-detected', 'track.readyState=ended w/o onended');
      // Synthesise an onended path — same handler classifies + recovers.
      handleTrackEnded('unknown');
    }
    // Note: muted is not necessarily fatal (source backgrounded). We let
    // it ride. Only when readyState flips to ended do we tear down.
  }, 2000);
}

function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

// ── Classification — figure out WHY the track ended ────────────────────────
function classify(): EndReason {
  if (manualStop) return 'user';
  // Heuristic: if document.hidden when the end fired AND wake-lock was
  // not released by us, it's most often display-sleep.
  if (typeof document !== 'undefined' && document.hidden) return 'system-sleep';
  // We can't perfectly distinguish pill vs source-closed in-browser. Default
  // to 'browser-stop-pill' because it's the most common cause we've seen in
  // production — clicking Chrome's "Stop sharing" toolbar.
  return 'browser-stop-pill';
}

// ── Teardown — common shutdown without duplicating intent logic ───────────
function teardown(reason: EndReason) {
  stopWatchdog();
  releaseWakeLock();
  // Detach handlers before stop() so we don't re-enter via onended.
  if (currentTrack) {
    try { currentTrack.onended = null; currentTrack.onmute = null; currentTrack.onunmute = null; } catch { /* ignore */ }
    try { currentTrack.stop(); } catch { /* ignore */ }
  }
  if (currentStream) {
    try { currentStream.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } }); } catch { /* ignore */ }
  }
  currentStream = null;
  currentTrack = null;
  emitTrack(null);

  updateSnapshot({
    isSharing: false,
    hasStream: false,
    trackSettings: null,
    lastEndReason: reason,
    trackMuted: false,
    startedAt: null,
  });
}

// ── onended path — single entry-point regardless of detection source ──────
function handleTrackEnded(forceReason?: EndReason) {
  if (stopping) {
    // teardown is already running — let it finish.
    return;
  }
  const reason: EndReason = forceReason || classify();
  logShareEvent('track-onended', `reason=${reason}`, {
    readyState: currentTrack?.readyState,
    muted: currentTrack?.muted,
    manualStop,
  });

  const wasManual = manualStop;
  teardown(reason);

  if (wasManual) {
    setState('stopped');
    writePersistedIntent(false);
    return;
  }

  // Unexpected end. Keep intent on, transition to 'recovering', and
  // schedule a backoff-driven retry. Real getDisplayMedia call has to
  // wait for fresh user activation — `attemptRecovery()` checks that.
  if (!snapshot.intent) {
    // No intent — user never enabled persistent retry. Stop here.
    setState('stopped');
    return;
  }
  setState('recovering');
  scheduleRecovery();
}

// ── Recovery — backoff + activation gate ───────────────────────────────────
const BACKOFF_MS = [500, 2_000, 6_000, 15_000, 45_000];

function scheduleRecovery() {
  if (recoveryTimer) return;
  const attempt = snapshot.recoveryAttempts;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  logShareEvent('recovery-scheduled', `attempt #${attempt + 1} in ${delay}ms`);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    attemptRecovery();
  }, delay);
}

async function attemptRecovery() {
  if (!snapshot.intent || currentTrack) return;
  updateSnapshot({ recoveryAttempts: snapshot.recoveryAttempts + 1 });

  if (!hasFreshActivation()) {
    logShareEvent('recovery-blocked-no-activation', 'waiting for user click — re-arming on next gesture');
    // Wait for the next user activation, then retry once. The activation
    // listener calls onActivationRecovery() below.
    return;
  }

  logShareEvent('recovery-attempt', `#${snapshot.recoveryAttempts}`);
  try {
    await internalStart({ silent: true });
  } catch (e: any) {
    logShareEvent('error', 'recovery start failed', { message: e?.message });
    // Reschedule.
    scheduleRecovery();
  }
}

// Called from ensureUserActivationListener — every gesture is a recovery
// opportunity if we want to be sharing.
function onActivationForRecovery() {
  if (snapshot.state !== 'recovering') return;
  if (!snapshot.intent) return;
  if (recoveryTimer) return; // a scheduled retry is already pending
  // Fire on the next microtask so the click handler that triggered us
  // can finish first (some click handlers stop propagation / replace DOM
  // before we'd request the picker, which can confuse Chrome).
  setTimeout(() => attemptRecovery(), 0);
}

// ── start — public API ────────────────────────────────────────────────────
interface StartOptions {
  silent?: boolean;   // suppress UI toasts (used during recovery)
}

async function internalStart(opts: StartOptions = {}): Promise<void> {
  if (currentTrack) {
    logShareEvent('note', 'start ignored — already sharing');
    return;
  }
  if (snapshot.state === 'starting') {
    logShareEvent('note', 'start ignored — already starting');
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setState('blocked', { blockReason: 'unsupported', lastError: 'getDisplayMedia not supported' });
    logShareEvent('error', 'getDisplayMedia unsupported on this browser');
    return;
  }

  // Cross-tab guard: if another Robin tab is already sharing, refuse.
  ensureBroadcast();
  const otherActive = await probeOtherTab();
  if (otherActive) {
    setState('blocked', { blockReason: 'cross-tab', lastError: 'Another tab is already sharing.' });
    logShareEvent('broadcast-channel-rejected', 'another tab claims active share — refusing to start');
    return;
  }

  setState('starting', { lastError: null, blockReason: null });
  logShareEvent('start-requested', 'getDisplayMedia call', { silent: !!opts.silent });

  let stream: MediaStream;
  try {
    stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 24 } },
      audio: false,
    });
  } catch (err: any) {
    const name = err?.name as string;
    logShareEvent('getDisplayMedia-fail', `name=${name}`, { message: err?.message });
    if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError') {
      // User cancelled / denied. Don't trigger another recovery loop.
      setState('idle', { lastError: name === 'NotAllowedError' ? 'Permission denied' : null });
      // If denied by the system (Mac System Settings), set blockReason.
      if (name === 'NotAllowedError') {
        updateSnapshot({ blockReason: 'permission-denied' });
      }
      return;
    }
    // Other errors (NotReadable, etc.) — back off and retry if intent is on.
    setState('recovering', { lastError: name || 'getDisplayMedia failed' });
    if (snapshot.intent) scheduleRecovery();
    return;
  }

  currentStream = stream;
  currentTrack = stream.getVideoTracks()[0] || null;
  if (!currentTrack) {
    setState('idle', { lastError: 'No video track on stream' });
    return;
  }

  logShareEvent('getDisplayMedia-ok', 'track acquired', {
    label: currentTrack.label,
    settings: safeGetSettings(currentTrack),
  });

  // Reset classification for the new share. manualStop becomes true only
  // when our own stop() runs; any other end is unexpected.
  manualStop = false;

  // Lifecycle wiring on the track.
  currentTrack.onended = () => handleTrackEnded();
  currentTrack.onmute = () => {
    logShareEvent('track-mute', 'source likely backgrounded');
    updateSnapshot({ trackMuted: true });
  };
  currentTrack.onunmute = async () => {
    logShareEvent('track-unmute', 'source returned');
    updateSnapshot({ trackMuted: false });
    if (!wakeLock) await acquireWakeLock();
  };

  // Cross-cutting concerns — wake-lock, watchdog, listeners.
  await acquireWakeLock();
  startWatchdog();
  ensureVisibilityListener();
  ensureDeviceListener();
  ensureUserActivationListener();

  setState('sharing', {
    isSharing: true,
    hasStream: true,
    trackSettings: safeGetSettings(currentTrack),
    startedAt: Date.now(),
    recoveryAttempts: 0,
    lastError: null,
    blockReason: null,
  });
  writePersistedIntent(true);
  broadcastStarted();
  emitTrack(currentTrack);
}

async function start(): Promise<void> {
  // Public start treats the user click as fresh activation explicitly so
  // tests / programmatic calls behave correctly.
  lastActivationAt = Date.now();
  await internalStart();
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  manualStop = true;
  logShareEvent('stop-requested', 'user-initiated stop');
  // Cancel any pending recovery.
  if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; logShareEvent('recovery-cancelled', 'stop pre-empted scheduled recovery'); }
  try {
    teardown('user');
    setState('stopped', { recoveryAttempts: 0, lastEndReason: 'user' });
    writePersistedIntent(false);
    logShareEvent('stopped', 'teardown complete');
  } finally {
    stopping = false;
    // Defer flip so any racing onended (from t.stop()) still sees manualStop=true.
    setTimeout(() => { manualStop = false; }, 0);
  }
}

function setIntent(on: boolean) {
  updateSnapshot({ intent: on });
  writePersistedIntent(on);
  if (!on && recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    logShareEvent('recovery-cancelled', 'intent cleared');
  }
}

function getSnapshot(): ManagerSnapshot { return snapshot; }
function getStream(): MediaStream | null { return currentStream; }
function getTrack(): MediaStreamTrack | null { return currentTrack; }
function isSharing(): boolean { return !!currentTrack && currentTrack.readyState === 'live'; }

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function subscribeTrack(fn: (track: MediaStreamTrack | null) => void): () => void {
  trackListeners.add(fn);
  // Replay current track immediately so late subscribers get state.
  try { fn(currentTrack); } catch { /* ignore */ }
  return () => { trackListeners.delete(fn); };
}

// One-shot module init — wire activation listener so recovery can fire.
(function init() {
  if (typeof document === 'undefined') return;
  ensureUserActivationListener();
  // Each activation while in recovering state triggers an attempt.
  document.addEventListener('pointerdown', onActivationForRecovery, { capture: true });
  document.addEventListener('keydown',     onActivationForRecovery, { capture: true });
})();

export const screenShareManager = {
  start,
  stop,
  setIntent,
  getSnapshot,
  getStream,
  getTrack,
  isSharing,
  subscribe,
  subscribeTrack,
};

// Expose for debugging from DevTools.
if (typeof window !== 'undefined') {
  (window as any).__robinScreenShareManager = screenShareManager;
}
