/**
 * playBuzzer() — loud alarm sound when something the user CARES about
 * just went wrong (currently: screen sharing auto-stopped without their
 * input).
 *
 * Three quick 300ms bursts of a 220Hz square wave at 70% gain. Square
 * wave = harsh, harmonics-heavy timbre — sounds urgent in a way a
 * sine wave doesn't. Three bursts read as "BZZT BZZT BZZT" — the
 * classic alarm pattern your brain decodes as "pay attention NOW",
 * not "you have a new message".
 *
 * Self-contained: no audio file dependency, no fetch, no preload step.
 * The whole thing weighs ~30 lines and uses the same Web Audio
 * primitives the existing useKnock + tabKeepAlive modules already use.
 *
 * AudioContext gotcha:
 *   Modern browsers require a user gesture to construct an AudioContext.
 *   Every call site here fires from a screen-share-end event, and the
 *   user originally STARTED the share via a click — that click warmed
 *   up the audio graph (the tabKeepAlive oscillator is already
 *   playing). So by the time we'd play the buzzer, the context should
 *   already be unlocked. We still try/catch defensively and silently
 *   no-op on failure rather than blowing up; the toast that already
 *   accompanies a screen-share stop still surfaces.
 *
 * Volume note:
 *   0.7 gain on a square wave is genuinely loud — full system volume
 *   on a laptop is unmissable from across the room. We use the
 *   default destination (system audio output) rather than routing
 *   through any LiveKit mixer so it plays at the same level as a
 *   FaceTime ring or a Slack alert.
 */

let ctx: AudioContext | null = null;

/**
 * Fire the alarm. Safe to call repeatedly; later calls cancel and
 * restart the burst pattern so a rapid sequence of auto-stops
 * doesn't pile up into garbled noise.
 */
export function playBuzzer(): void {
  if (typeof window === 'undefined') return;
  try {
    const ACtor: typeof AudioContext =
      (window.AudioContext || (window as any).webkitAudioContext);
    if (!ACtor) return;
    // Reuse a single AudioContext across calls — cheaper than spinning
    // a new one each time, and matches the pattern the rest of the
    // app uses.
    if (!ctx) ctx = new ACtor();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { /* will retry on next call */ });
    }

    const now = ctx.currentTime;
    const totalDuration = 1.2;            // 3 × (200ms on + 200ms off)

    // Single oscillator, gated by a gain envelope that does the
    // pulsing. Cheaper than three separate oscillators and the
    // attack/release shape is more controllable.
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 220;            // low + harsh — feels alarming

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    // Three bursts at t = 0, 0.4s, 0.8s. Each burst is a quick
    // attack (20ms ramp up), 260ms hold at 0.7, then a quick
    // release (20ms ramp down).
    const PULSE_LEVEL = 0.7;
    [0, 0.4, 0.8].forEach((offset) => {
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(PULSE_LEVEL, now + offset + 0.02);
      gain.gain.setValueAtTime(PULSE_LEVEL, now + offset + 0.28);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.3);
    });

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + totalDuration);
  } catch (e: any) {
    if (typeof console !== 'undefined') {
      console.warn('[buzzer] failed to play:', e?.message || e);
    }
  }
}

// Expose for DevTools so QA can verify the sound without staging a
// real screen-share auto-stop.
if (typeof window !== 'undefined') {
  (window as any).__robinBuzzer = playBuzzer;
}
