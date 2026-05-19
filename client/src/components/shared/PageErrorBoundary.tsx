import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { reportError } from '@/lib/errorReporter';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { error: Error | null; }

/**
 * Detect Vite's dynamic-import failure for a stale lazy chunk.
 *
 * When we ship a new build, asset hashes change. Any tab that still has
 * the OLD index.html cached will try to fetch the OLD chunk filename
 * (e.g. `ClientWorkflowDetailPage-Cr5c53O8.js`) — which no longer exists
 * on the CDN. Vite throws one of these:
 *   "Failed to fetch dynamically imported module: <url>"
 *   "Loading chunk N failed"
 *   "Importing a module script failed"
 *
 * The right cure is a fresh page load — that pulls the new index.html
 * which references the new asset hashes. We do that automatically.
 */
function isChunkLoadFailure(e: Error): boolean {
  const msg = String(e?.message || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \S+ failed/.test(msg) ||
    /ChunkLoadError/i.test(e?.name || '')
  );
}

/**
 * Catches React render errors anywhere in its subtree. Shows a friendly
 * fallback instead of a blank white screen, AND reports the error to the
 * /api/logs/error collection so admins can see what crashed.
 *
 * Each route in App.tsx is wrapped with one of these, so a crash on the
 * Tasks page doesn't take down the whole app — only that page's content
 * is replaced with the fallback. The sidebar and topbar keep working.
 *
 * Special-case: a stale-chunk import failure is recovered by forcing a
 * single hard reload — but never more than once per minute, so a
 * genuinely broken deploy doesn't put us in an infinite reload loop.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(e: Error): State { return { error: e }; }
  componentDidCatch(e: Error, info: unknown) {
    console.error('[ErrorBoundary]', e, info);

    // Stale-chunk auto-recovery — the user's tab has an old index.html
    // pointing at chunk hashes that don't exist on the new deploy. Force
    // a fresh load. Guarded by a 60s session flag so a TRULY broken
    // chunk doesn't trap the tab in a reload loop.
    if (isChunkLoadFailure(e)) {
      try {
        const FLAG = 'robin.chunkReloadAt';
        const last = Number(sessionStorage.getItem(FLAG) || 0);
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(FLAG, String(Date.now()));
          // location.reload(true) is deprecated; the modern equivalent is
          // a query-busted assignment. Using assign() instead so the back
          // button still works after the recovery.
          const u = new URL(window.location.href);
          u.searchParams.set('_rcb', String(Date.now())); // robin chunk bust
          window.location.replace(u.toString());
          return;
        }
        // Still failing after a recent recovery — fall through to the
        // snag UI so the user sees something actionable.
      } catch { /* sessionStorage disabled — fall through */ }
    }

    // Persist to the central error log so admins can investigate later.
    try {
      reportError(e, {
        kind: 'react.render',
        componentStack: (info as any)?.componentStack?.slice(0, 4000),
      });
    } catch { /* never let logging crash the app */ }
  }
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="mx-auto h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="text-xl font-bold mb-2">This page hit a snag</h2>
            <p className="text-sm text-muted-foreground mb-1">
              We've logged it for the admin. You can try reloading or go back home.
            </p>
            <p className="text-[10px] text-muted-foreground/60 font-mono mt-3 mb-5 break-all">
              {this.state.error.message}
            </p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5">
                <RefreshCcw className="h-3.5 w-3.5" /> Reload
              </button>
              <button onClick={() => { window.location.href = '/'; }}
                className="px-4 py-2 bg-card border border-border rounded-lg text-sm font-semibold hover:bg-muted flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" /> Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
