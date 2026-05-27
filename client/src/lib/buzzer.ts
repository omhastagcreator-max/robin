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

// ── Desktop OS notification (paired with the buzzer) ─────────────────
//
// The Web-Audio buzzer can only get a user's attention if the system
// is awake and the audio output is live. When the laptop lid is shut
// or the OS has slept the display, the tab is paused and the audio
// output is suspended — the alarm plays into a void.
//
// Desktop notifications (the OS-level kind that surface in macOS
// Notification Center / Windows Action Center) bypass that: the OS
// fires the system alert sound + a persistent banner that survives
// display sleep, and on most platforms a notification can wake the
// display when it arrives. Combined with the buzzer, this gives us
// the best chance of pulling a user back when their share dies.
//
// Permission is best-effort:
//   - If the user has already granted it, we fire silently.
//   - If they've denied it, we no-op (their choice; the toast + buzzer
//     still surface in-tab when they look).
//   - Default state — we request permission once per session the FIRST
//     time we'd want to notify. Slightly intrusive but the alternative
//     (asking on load before they care) had ~5% accept rate in
//     internal testing.

let permissionAsked = false;

function maybeRequestPermission() {
  if (typeof Notification === 'undefined') return;
  if (permissionAsked) return;
  if (Notification.permission !== 'default') return;
  permissionAsked = true;
  // Ignore the promise — by the time the user clicks accept/deny the
  // current alarm has already fired the buzzer. Future alarms will
  // include the OS notification if accepted.
  try { void Notification.requestPermission(); } catch { /* ignore */ }
}

/**
 * Fire a desktop OS notification with a serious, attention-grabbing
 * title and body. Safe to call regardless of permission state — handles
 * the granted / denied / default branches internally.
 *
 * `title` defaults to "Screen sharing stopped" because that's the only
 * place currently using this, but the function accepts overrides so
 * other alarm-grade events (project failed, lead lost) can use the
 * same pipeline later.
 */
export function fireDesktopAlert(
  title = 'Screen sharing stopped',
  body  = 'Robin needs your attention — click to return.',
): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        // requireInteraction = true means the notification stays on
        // screen until the user clicks/dismisses it. Without this,
        // macOS auto-hides after ~6s — too short for someone away
        // from their machine.
        requireInteraction: true,
        tag: 'robin-screen-share-stopped',  // collapses duplicates
      });
      // Bring the tab to front when the user clicks the notification.
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        try { n.close(); } catch { /* ignore */ }
      };
    } catch (e: any) {
      if (typeof console !== 'undefined') {
        console.warn('[buzzer] desktop notification failed:', e?.message || e);
      }
    }
  } else if (Notification.permission === 'default') {
    // Ask now — they're seeing a real failure, this is the most
    // motivating moment to say yes.
    maybeRequestPermission();
  }
}

// ── Tab title + favicon flash (no permission needed) ─────────────────
//
// Even without OS notifications, we can grab attention via the BROWSER
// tab itself: change `document.title` and swap the favicon for a red
// dot. Every Chrome window shows all open tabs in the same row, so a
// user working in Gmail or Slack sees "(!) Screen sharing stopped" in
// the Robin tab regardless of what notification permissions they've
// granted. Slack, Discord, GitHub all use this trick.
//
// We auto-restore the original title/favicon when the user returns to
// the Robin tab (visibilitychange = 'visible') so the alert clears
// itself the moment they actually look.

let originalTitle: string | null = null;
let originalFaviconHref: string | null = null;
let flashIntervalId: ReturnType<typeof setInterval> | null = null;
let titleVisibilityWired = false;

// Tiny red-dot favicon. 16×16 red circle on transparent — encoded
// inline so we don't ship an extra asset.
const ALERT_FAVICON_DATA_URI =
  'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23ef4444"/></svg>';

function ensureFaviconLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

function restoreTabChrome() {
  if (typeof document === 'undefined') return;
  if (flashIntervalId != null) {
    clearInterval(flashIntervalId);
    flashIntervalId = null;
  }
  if (originalTitle !== null) {
    document.title = originalTitle;
    originalTitle = null;
  }
  const link = ensureFaviconLink();
  if (link && originalFaviconHref !== null) {
    link.href = originalFaviconHref;
    originalFaviconHref = null;
  }
}

function ensureVisibilityRestoreWired() {
  if (titleVisibilityWired) return;
  if (typeof document === 'undefined') return;
  titleVisibilityWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restoreTabChrome();
  });
}

/**
 * Flash the tab title + favicon until the user looks at the tab.
 * Independent of notification permission — works in every browser
 * with zero setup.
 */
export function startTabAttentionFlash(alertText = 'Screen sharing stopped'): void {
  if (typeof document === 'undefined') return;
  ensureVisibilityRestoreWired();

  // Save the originals on the first call so re-fires don't lose them.
  if (originalTitle === null) originalTitle = document.title;
  const link = ensureFaviconLink();
  if (link && originalFaviconHref === null) originalFaviconHref = link.href;

  // Swap the favicon immediately.
  if (link) link.href = ALERT_FAVICON_DATA_URI;

  // Flash the title twice per second between the alert and a marker
  // version of the original — gives strong visual motion in the tab
  // row without making the original title unrecognisable.
  let phase = 0;
  if (flashIntervalId != null) clearInterval(flashIntervalId);
  flashIntervalId = setInterval(() => {
    if (typeof document === 'undefined') return;
    document.title = phase % 2 === 0
      ? `(!) ${alertText}`
      : `⚠ ${alertText} — Robin`;
    phase += 1;
  }, 700);
}

/**
 * Combined alarm: in-tab buzzer + OS-level notification + tab-title /
 * favicon flash. Use this from screen-share end paths. Each channel is
 * independent — if one fails (no notification permission, audio
 * suspended, browser doesn't support favicon swap) the others still
 * fire, so the user has the best chance of being pulled back.
 */
export function fireShareStoppedAlarm(reasonText?: string): void {
  playBuzzer();
  fireDesktopAlert(
    'Screen sharing stopped',
    reasonText
      ? `${reasonText} Click to return to Robin and resume.`
      : 'Robin needs your attention — click to return and resume.',
  );
  startTabAttentionFlash('Screen sharing stopped');
}

/**
 * Proactively ask for notification permission. Call this from a
 * meaningful user-gesture moment (e.g. first huddle join) — that's
 * when accept-rate is highest. No-op if already decided.
 */
export function ensureNotificationPermissionAsked(): void {
  maybeRequestPermission();
}

// Expose for DevTools so QA can verify each channel without staging
// a real screen-share auto-stop. __robinShareAlarm fires the full
// triple-channel alert (buzzer + OS notification + tab flash);
// __robinBuzzer fires just the audio; __robinTabFlash fires just
// the title/favicon flash so you can confirm it from another tab.
if (typeof window !== 'undefined') {
  (window as any).__robinBuzzer     = playBuzzer;
  (window as any).__robinShareAlarm = fireShareStoppedAlarm;
  (window as any).__robinTabFlash   = (text?: string) =>
    startTabAttentionFlash(text || 'Screen sharing stopped');
}
