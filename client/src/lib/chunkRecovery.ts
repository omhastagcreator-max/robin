/**
 * chunkRecovery.ts — shared "stale deploy" detection + auto-reload.
 *
 * When we ship a new build, Vite's asset filenames change (content
 * hashes). Any tab that already had the app open is still holding an
 * OLD index.html that references the OLD hashed chunk filenames — those
 * files no longer exist once the new deploy finishes, so any further
 * lazy-loaded route (React.lazy(() => import(...))) 404s with one of:
 *   "Failed to fetch dynamically imported module: <url>"
 *   "Importing a module script failed"
 *   "Loading chunk N failed"
 *   ChunkLoadError
 *
 * The fix is always the same: force a fresh page load so the browser
 * pulls the new index.html (which references the new, correct hashes).
 *
 * Aug 2026 — owner report: "when I tried to open anything it just went
 * blank." Root cause: `PageErrorBoundary` already had this exact
 * recovery, but ONLY catches errors that surface through React's render
 * cycle. This specific failure mode is a native `<script type="module">`
 * / modulepreload load failure — those fire as a genuinely UNCAUGHT
 * window-level error or unhandledrejection, which never reaches a React
 * error boundary at all (confirmed via the browser console: "Uncaught
 * TypeError: Failed to fetch dynamically imported module"). The global
 * handlers in errorReporter.ts were only logging it, not recovering.
 * Both call sites now share this one recovery function so a stale-chunk
 * crash self-heals no matter which layer catches it.
 */

const RELOAD_COOLDOWN_MS = 60_000;
const FLAG = 'robin.chunkReloadAt';

export function isChunkLoadFailure(err: unknown): boolean {
  const message = typeof err === 'string' ? err : (err as any)?.message || '';
  const name = (err as any)?.name || '';
  const msg = String(message);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \S+ failed/.test(msg) ||
    /ChunkLoadError/i.test(name)
  );
}

/**
 * Forces exactly one fresh page load within any 60s window (so a
 * genuinely broken deploy — not just a stale tab — doesn't trap the
 * user in a reload loop). Returns true if it triggered a reload (caller
 * should stop any further error handling / rendering), false if the
 * cooldown was still active (caller should fall through to its normal
 * "something went wrong" UI).
 */
export function recoverFromChunkFailure(): boolean {
  try {
    const last = Number(sessionStorage.getItem(FLAG) || 0);
    if (Date.now() - last <= RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(FLAG, String(Date.now()));
    const u = new URL(window.location.href);
    u.searchParams.set('_rcb', String(Date.now())); // robin chunk bust
    window.location.replace(u.toString());
    return true;
  } catch {
    // sessionStorage disabled (private mode etc.) — best effort, still
    // try a plain reload once; can't guard against a loop here, but a
    // hard-broken deploy is rare enough this is an acceptable fallback.
    window.location.reload();
    return true;
  }
}
