/**
 * tabKeepAlive — prevents Chrome / Edge / Safari from background-throttling
 * the Robin tab while the user is actively sharing their screen or in a
 * huddle.
 *
 * Why this exists:
 *   Chrome heavily throttles inactive tabs — setInterval clamps to 1Hz,
 *   network keep-alives stretch, AudioContext suspends, and worst of all
 *   the OS can decide to put the display to sleep. The downstream effect
 *   the team has been reporting is "I switched tabs for two minutes and
 *   my screen share just died." The screen-share manager + LiveKit hook
 *   both already acquire wake-locks, but wake-locks don't keep the JS
 *   event loop running — they only keep the display awake.
 *
 *   The standard fix (used by Discord, Slack, Google Meet, etc.) is to
 *   keep a silent audio stream playing. Browsers exempt tabs with active
 *   audio output from background throttling because they're treated as
 *   media-active. A muted oscillator at gain=0 costs effectively zero
 *   CPU but flips the "audible" bit the throttler watches.
 *
 * Lifecycle — refcounted:
 *   Multiple subsystems can hold a keep-alive simultaneously (the
 *   screen-share manager AND LiveKit's huddle screen-share both call
 *   `acquire()`). The module starts the audio loop on the first
 *   acquire and stops it on the last release. Counters never go
 *   negative — a defensive max(0) prevents a runaway release from
 *   permanently disabling future acquires.
 *
 * Activation gotcha:
 *   AudioContext construction can throw on Safari and some Firefox
 *   versions if there's no fresh user gesture. We invariably call
 *   acquire() inside a click-driven path (getDisplayMedia for the
 *   manager, room.localParticipant.setScreenShareEnabled for LiveKit)
 *   so activation IS present. We still try/catch defensively — if the
 *   context can't be created, we log to console and otherwise no-op;
 *   the rest of the share still works.
 *
 * Visibility note:
 *   We do NOT pause the loop when the tab is hidden — that would defeat
 *   the entire purpose. The loop runs continuously between acquire and
 *   release. The cost is well under 1% CPU even on low-end laptops.
 */

let ctx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gain: GainNode | null = null;
let refcount = 0;

/** True when the loop is currently running. Useful for debug / health checks. */
export function isTabKeepAliveActive(): boolean {
  return refcount > 0 && !!oscillator;
}

/** Current refcount — exposed for diagnostics, never mutated externally. */
export function tabKeepAliveRefcount(): number {
  return refcount;
}

function actuallyStart() {
  if (oscillator) return;
  try {
    const ACtor: typeof AudioContext =
      (window.AudioContext || (window as any).webkitAudioContext);
    if (!ACtor) return;
    ctx = new ACtor();
    // Chrome can hand back a suspended context if the user hasn't
    // interacted yet. We try resume() anyway — if it succeeds great, if
    // not the share itself will fail upstream and we'll be retried.
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { /* swallow; downstream will retry */ });
    }
    oscillator = ctx.createOscillator();
    gain = ctx.createGain();
    gain.gain.value = 0;                // SILENT — gain=0 means inaudible
    oscillator.frequency.value = 440;   // arbitrary; doesn't matter at gain=0
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    if (typeof console !== 'undefined') {
      console.debug('[tabKeepAlive] started silent audio loop');
    }
  } catch (e: any) {
    if (typeof console !== 'undefined') {
      console.warn('[tabKeepAlive] failed to start:', e?.message || e);
    }
    // Clean up any half-initialised state so the next acquire can retry.
    oscillator = null;
    gain = null;
    if (ctx) { try { void ctx.close(); } catch { /* ignore */ } ctx = null; }
  }
}

function actuallyStop() {
  try { oscillator?.stop(); } catch { /* already stopped */ }
  try { oscillator?.disconnect(); } catch { /* not connected */ }
  try { gain?.disconnect(); } catch { /* not connected */ }
  try { void ctx?.close(); } catch { /* already closed */ }
  oscillator = null;
  gain = null;
  ctx = null;
  if (typeof console !== 'undefined') {
    console.debug('[tabKeepAlive] stopped silent audio loop');
  }
}

/**
 * Add one reference to the keep-alive. The audio loop starts on the
 * first acquire and stays running until the matching release.
 *
 * Safe to call from any code path — multiple subsystems may acquire
 * concurrently and the refcount will hold the loop open for as long
 * as ANY of them still need it.
 */
export function acquireTabKeepAlive(): void {
  refcount += 1;
  if (refcount === 1) actuallyStart();
}

/**
 * Drop one reference. The audio loop stops once the refcount returns
 * to zero. Calling release more times than acquire is harmless — the
 * counter is clamped to zero.
 */
export function releaseTabKeepAlive(): void {
  refcount = Math.max(0, refcount - 1);
  if (refcount === 0) actuallyStop();
}

// Expose for DevTools poking — same pattern as the screen-share
// manager's __robinScreenShareManager handle.
if (typeof window !== 'undefined') {
  (window as any).__robinTabKeepAlive = {
    isActive: isTabKeepAliveActive,
    refcount: tabKeepAliveRefcount,
    acquire: acquireTabKeepAlive,
    release: releaseTabKeepAlive,
  };
}
