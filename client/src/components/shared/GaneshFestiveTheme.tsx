import { useMemo } from 'react';

/**
 * GaneshFestiveTheme — Ganesh Chaturthi 2026 decor 🏵️
 *
 * A pure-CSS festive overlay for the whole app shell: a marigold garland
 * (toran) across the top with hanging flower strands, gently falling
 * petals, and a small greeting chip. No images, no network, no state —
 * just emoji + CSS animations, all pointer-events-none so nothing is
 * ever blocked or made unclickable.
 *
 * SELF-REMOVING: renders nothing after 15 Sep 2026 23:59 IST (Anant
 * Chaturdashi window over), so it disappears on its own — no redeploy
 * needed to take it down. Safe to leave mounted year-round.
 *
 * Respects prefers-reduced-motion (animations stop, petals hidden).
 */

const FESTIVE_END_MS = new Date('2026-09-15T23:59:59+05:30').getTime();
const PETALS = ['🌼', '🏵️', '🌺', '🌼'];

export function GaneshFestiveTheme() {
  // Stable random petal layout — computed once per mount so petals don't
  // jump on re-render.
  const petals = useMemo(() => Array.from({ length: 10 }, (_, i) => ({
    id: i,
    emoji: PETALS[i % PETALS.length],
    left: Math.round(2 + Math.random() * 94),          // vw
    delay: +(Math.random() * 12).toFixed(1),           // s
    duration: +(14 + Math.random() * 10).toFixed(1),   // s
    size: +(0.65 + Math.random() * 0.45).toFixed(2),   // rem
  })), []);

  if (Date.now() > FESTIVE_END_MS) return null;

  return (
    <div aria-hidden="true" className="gf-root">
      <style>{`
        .gf-root { position: fixed; inset: 0; z-index: 50; pointer-events: none; overflow: hidden; }
        .gf-row {
          position: absolute; top: -7px; left: 0; right: 0;
          display: flex; justify-content: space-between;
          font-size: 15px; line-height: 1;
          filter: drop-shadow(0 1px 1px rgba(120, 60, 0, .25));
        }
        .gf-flower { display: inline-block; animation: gf-sway 4.5s ease-in-out infinite; transform-origin: 50% 0; }
        .gf-strands {
          position: absolute; top: 6px; left: 0; right: 0;
          display: flex; justify-content: space-around;
          font-size: 11px; line-height: 1.15; text-align: center;
        }
        .gf-strand { display: inline-block; animation: gf-swing 5.5s ease-in-out infinite; transform-origin: 50% 0; opacity: .95; }
        .gf-greet {
          position: absolute; top: 84px; right: 14px;
          padding: 4px 10px; border-radius: 9999px;
          background: rgba(255, 247, 230, .92);
          border: 1px solid rgba(245, 158, 11, .45);
          color: #b45309; font-size: 11px; font-weight: 600;
          box-shadow: 0 2px 8px rgba(180, 83, 9, .12);
        }
        .gf-petal {
          position: absolute; top: -5vh;
          animation-name: gf-fall; animation-timing-function: linear; animation-iteration-count: infinite;
          opacity: .8;
        }
        @keyframes gf-sway  { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
        @keyframes gf-swing { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
        @keyframes gf-fall {
          0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: .85; }
          80%  { opacity: .75; }
          100% { transform: translateY(112vh) translateX(4vw) rotate(300deg); opacity: 0; }
        }
        @media (max-width: 639px) {
          .gf-strands, .gf-greet { display: none; }
          .gf-row { font-size: 13px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gf-flower, .gf-strand { animation: none !important; }
          .gf-petal { display: none; }
        }
      `}</style>

      {/* Top marigold garland (toran) */}
      <div className="gf-row">
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} className="gf-flower" style={{ animationDelay: `${(i % 5) * 0.4}s` }}>
            {i % 2 === 0 ? '🏵️' : '🌼'}
          </span>
        ))}
      </div>

      {/* Hanging flower strands */}
      <div className="gf-strands">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className="gf-strand" style={{ animationDelay: `${i * 0.6}s` }}>
            🌼<br />{i % 2 === 0 ? '🌺' : '🏵️'}<br />🌼
          </span>
        ))}
      </div>

      {/* Greeting chip */}
      <div className="gf-greet">🙏 शुभ गणेश चतुर्थी</div>

      {/* Falling petals */}
      {petals.map(p => (
        <span
          key={p.id}
          className="gf-petal"
          style={{
            left: `${p.left}vw`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            fontSize: `${p.size}rem`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
