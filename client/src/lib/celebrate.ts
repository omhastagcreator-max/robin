/**
 * celebrate() — fire a confetti burst from the bottom corners.
 *
 * Self-contained canvas confetti. No external dependency. The whole
 * thing weighs about 4KB minified and uses an overlay <canvas> that is
 * mounted on demand, animated for ~2.5s, then removed. Safe to call
 * concurrently — multiple celebrate()s stack their particles in the
 * same canvas instead of fighting over it.
 *
 * Usage:
 *   import { celebrate } from '@/lib/celebrate';
 *
 *   // After a meaningful success — close a deal, finish a project, etc.
 *   celebrate();
 *
 *   // Custom colors / intensity:
 *   celebrate({ colors: ['#10b981', '#3b82f6'], particleCount: 200 });
 *
 *   // Or quickly from DevTools to demo:
 *   __robinCelebrate();
 *
 * Design notes:
 *   - Two-side bottom-corner burst (matches the user-selected style).
 *     Particles launch from x ≈ 0 / x ≈ width with angles aimed up and
 *     toward the centre — feels celebratory without occluding mid-screen UI.
 *   - Physics are intentionally simple: each particle has position,
 *     velocity, angular velocity, gravity, drag. No spring constraints,
 *     no collision detection — at 60fps with ~150 particles the cost is
 *     negligible (<2ms / frame on a mid-spec laptop).
 *   - The canvas sits at z-index 9999 with pointer-events: none, so it
 *     never blocks clicks on the UI underneath.
 *   - Respects prefers-reduced-motion. Users who've opted out of
 *     animations get a no-op — the underlying success toast still fires.
 */

export interface CelebrateOptions {
  /** Total particles per burst. Default 160 (80 per corner). */
  particleCount?: number;
  /** Hex colors to sample from. Defaults to Robin's accent ramps. */
  colors?: string[];
  /** Duration in ms the canvas stays mounted. Default 2500. */
  duration?: number;
  /** Spread half-angle in degrees. Larger = wider cone. Default 55. */
  spread?: number;
  /** Initial velocity magnitude. Larger = particles travel further. Default 35. */
  velocity?: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  rot: number; vrot: number;
  color: string;
  size: number;
  shape: 'rect' | 'circle';
  life: number;       // ms remaining
  maxLife: number;
}

// Default palette — Robin's emerald / blue / amber / violet / rose accents
// at vivid mid-stops. Looks celebratory without clashing with the brand.
const DEFAULT_COLORS = [
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
];

const GRAVITY = 0.18;     // px / frame²
const DRAG    = 0.992;    // velocity multiplier per frame
const FPS     = 60;
const FRAME_MS = 1000 / FPS;

// Single shared canvas + particle pool. We mount the canvas on first
// call and reuse it across subsequent celebrate()s so back-to-back
// successes (e.g. closing two deals in a row) feel continuous rather
// than competing.
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let rafHandle: number | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch { return false; }
}

function ensureCanvas() {
  if (canvas && ctx) return;
  if (typeof document === 'undefined') return;
  canvas = document.createElement('canvas');
  canvas.style.position      = 'fixed';
  canvas.style.inset         = '0';
  canvas.style.width         = '100%';
  canvas.style.height        = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex        = '9999';
  // Respect device pixel ratio so the confetti is crisp on retina.
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth  * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);

  // Keep canvas in sync with window resizes that happen mid-celebration.
  const onResize = () => {
    if (!canvas || !ctx) return;
    const r = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * r;
    canvas.height = window.innerHeight * r;
    ctx.scale(r, r);
  };
  window.addEventListener('resize', onResize);
}

function teardown() {
  if (rafHandle != null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  if (teardownTimer != null) { clearTimeout(teardownTimer); teardownTimer = null; }
  if (canvas?.parentNode) { try { canvas.parentNode.removeChild(canvas); } catch { /* ignore */ } }
  canvas = null;
  ctx = null;
  particles = [];
}

function tick() {
  if (!ctx || !canvas) { rafHandle = null; return; }
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  // Update + draw each particle. We use a forward loop with a separate
  // alive[] accumulator instead of splice-during-iterate, which would
  // be O(n²) for the worst case of "everything dies at once".
  const alive: Particle[] = [];
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.vy += GRAVITY;
    p.vx *= DRAG;
    p.vy *= DRAG;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vrot;
    p.life -= FRAME_MS;

    // Off-screen below or expired — drop.
    if (p.y > h + 40 || p.life <= 0) continue;
    alive.push(p);

    // Fade out in the last 600ms of life so they don't pop out.
    const fade = p.life < 600 ? Math.max(0, p.life / 600) : 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  particles = alive;

  if (particles.length > 0) {
    rafHandle = requestAnimationFrame(tick);
  } else {
    rafHandle = null;
    // Tear down a beat after the last particle exits so a follow-up
    // celebrate() within the next 200ms can reuse the canvas.
    if (!teardownTimer) {
      teardownTimer = setTimeout(teardown, 200);
    }
  }
}

/**
 * Fire a confetti celebration. See module-level doc for usage examples.
 */
export function celebrate(opts: CelebrateOptions = {}): void {
  if (typeof window === 'undefined') return;
  if (reducedMotion()) return;

  const {
    particleCount = 160,
    colors        = DEFAULT_COLORS,
    duration      = 2500,
    spread        = 55,
    velocity      = 35,
  } = opts;

  ensureCanvas();
  if (!canvas || !ctx) return;

  // Cancel any pending teardown so a back-to-back call reuses the
  // active canvas rather than restarting it.
  if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const perCorner = Math.ceil(particleCount / 2);
  // Left-bottom corner aims up + right; right-bottom corner aims up + left.
  // Angle measured CCW from +x axis: 90° is straight up; we tilt 30° in
  // toward the centre, then spread by ±spread.
  const launchAngles = [60, 120]; // left, right
  const launchOrigins = [
    { x: 0,   y: h },
    { x: w,   y: h },
  ];

  for (let corner = 0; corner < 2; corner++) {
    const origin = launchOrigins[corner];
    const baseAngleDeg = launchAngles[corner];
    for (let i = 0; i < perCorner; i++) {
      // Random angle within the spread cone.
      const angle = ((baseAngleDeg + (Math.random() * 2 - 1) * spread) * Math.PI) / 180;
      const v = velocity * (0.7 + Math.random() * 0.5);  // 0.7×–1.2× variance
      const p: Particle = {
        x: origin.x + (Math.random() - 0.5) * 20,
        y: origin.y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * v,
        // SVG/canvas y is downward, so we negate to launch upward.
        vy: -Math.sin(angle) * v,
        rot: Math.random() * 360,
        vrot: (Math.random() - 0.5) * 14,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 6 + Math.random() * 6,
        shape: Math.random() < 0.7 ? 'rect' : 'circle',
        life: duration,
        maxLife: duration,
      };
      particles.push(p);
    }
  }

  if (rafHandle == null) {
    rafHandle = requestAnimationFrame(tick);
  }
}

// Expose for DevTools / one-off demos. Type with `any` so consumers
// don't have to import the function just to fire a celebration during
// QA / customer demos.
if (typeof window !== 'undefined') {
  (window as any).__robinCelebrate = celebrate;
}
