import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * useAppUpdater
 *
 * The annoying part of SPAs: when Vercel ships a new build, every tab
 * keeps running the old bundle in memory until the user hits refresh.
 * That's how people end up with two-week-old code while Slack-typing
 * "yeh feature mere paas dikha hi nahi".
 *
 * This hook polls /api/version every 60s (and on tab focus) and compares
 * the returned `version` against the SHA Vite stamped into THIS bundle
 * (`__APP_VERSION__`). When they differ:
 *   - If the user is actively typing / clicking, show a sticky toast
 *     with a Reload button. They reload when they're at a clean stop.
 *   - If the user has been idle for 5+ min, silently reload the tab
 *     so they're on the new version when they come back.
 *
 * Skipped entirely when the build version is 'dev' — local builds
 * don't have a real SHA and we don't want every Vite HMR session
 * triggering a fake "new version" toast.
 *
 * Mount ONCE at the AppLayout level.
 */

// Owner ask (June 2026): "refresh the login for today for all
// automatically so that the changes are live". Tightened the polling
// + auto-reload thresholds so deployments propagate within ~30s
// across the whole team without anyone having to manually refresh.
const POLL_INTERVAL_MS    = 30_000;          // every 30s (was 60s)
const IDLE_AUTO_RELOAD_MS = 30_000;          // 30s idle → auto reload (was 5 min)

export function useAppUpdater() {
  // Track when the user last did anything; we use this to decide whether
  // a detected new version should auto-reload or wait for their click.
  const lastActivityRef = useRef<number>(Date.now());
  // Once we've shown the toast we don't keep re-showing it on every poll
  // — sonner would just stack duplicates and annoy people.
  const toastShownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const ourVersion = (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');
    // No-op for local dev — there's no meaningful server version to
    // compare against when Vite serves un-hashed files.
    if (!ourVersion || ourVersion === 'dev') return;

    // ── Track activity so we know whether auto-reload is safe ──────
    const markActive = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('mousemove',  markActive, { passive: true });
    window.addEventListener('mousedown',  markActive, { passive: true });
    window.addEventListener('keydown',    markActive, { passive: true });
    window.addEventListener('touchstart', markActive, { passive: true });
    window.addEventListener('scroll',     markActive, { passive: true });

    let cancelled = false;

    const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
    const versionUrl = apiBase ? `${apiBase}/api/version` : '/api/version';

    const checkOnce = async () => {
      try {
        // Cache-busting query param so a CDN never traps us on a stale
        // version response. Server also sets Cache-Control: no-store
        // but belt + suspenders for free-tier proxies.
        const res = await fetch(`${versionUrl}?_t=${Date.now()}`, {
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json() as { version?: string };
        const serverVersion = data?.version;
        if (cancelled || !serverVersion) return;
        if (serverVersion === ourVersion) return;            // up to date
        if (toastShownForVersionRef.current === serverVersion) {
          // Same new version still pending acknowledgement — re-check
          // idle to maybe auto-reload now.
          maybeAutoReload();
          return;
        }
        toastShownForVersionRef.current = serverVersion;

        // ── User-visible nudge ───────────────────────────────────────
        toast(
          'Robin ka naya version aaya hai',
          {
            description: 'Reload karo taki latest features mil sakein.',
            icon: '✨',
            duration: Infinity,              // sticky until clicked / auto-reload fires
            action: {
              label: 'Reload now',
              onClick: () => { window.location.reload(); },
            },
          }
        );
        maybeAutoReload();
      } catch {
        // Network blip — try again next interval. Don't toast errors;
        // version mismatch isn't worth panicking users about.
      }
    };

    const maybeAutoReload = () => {
      // Aggressive policy (June 2026): if the tab is hidden, reload
      // immediately — the user isn't looking, so a silent swap is
      // strictly better than waiting them to come back to an old
      // bundle. If the tab IS visible, we still respect a 30-second
      // idle window so we don't yank a half-typed message out from
      // under someone.
      if (document.visibilityState === 'hidden') {
        window.location.reload();
        return;
      }
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor < IDLE_AUTO_RELOAD_MS) return;
      window.location.reload();
    };

    // First check on mount, then on a steady interval, plus on every
    // focus / visibility flip (catches "comes back to the tab after
    // lunch" without waiting up to a minute).
    checkOnce();
    const interval = window.setInterval(checkOnce, POLL_INTERVAL_MS);
    const onFocus = () => { checkOnce(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('mousemove',  markActive);
      window.removeEventListener('mousedown',  markActive);
      window.removeEventListener('keydown',    markActive);
      window.removeEventListener('touchstart', markActive);
      window.removeEventListener('scroll',     markActive);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
}
