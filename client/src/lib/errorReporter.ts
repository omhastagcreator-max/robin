import api from '@/api/axios';
import { silent } from '@/api/axios';
import { toast } from 'sonner';

/**
 * Global client-side error reporter.
 *
 * Catches:
 *  - uncaught exceptions (window.onerror)
 *  - unhandled promise rejections
 *  - React render errors via the existing PageErrorBoundary (manual call below)
 *
 * Each error is POSTed to /api/logs/error so it persists in the ErrorLog
 * collection and appears in the same place as server crashes. Throttled to
 * one report per (message, url) per minute so a render loop doesn't spam.
 */

const REPORT_COOLDOWN_MS = 60_000;
const recent = new Map<string, number>();

function report(message: string, stack?: string, extra: Record<string, any> = {}) {
  if (!message) return;
  // Don't report network errors — the server already logs them.
  // Don't report errors that fired during page unload (they often spam).
  if (/network error|fetch failed|load failed/i.test(message)) return;

  const key = `${message}|${window.location.pathname}`;
  const last = recent.get(key) || 0;
  if (Date.now() - last < REPORT_COOLDOWN_MS) return;
  recent.set(key, Date.now());

  // Only report if the user is logged in (otherwise the route 401s).
  if (!localStorage.getItem('robin_token')) return;

  const payload = {
    message: String(message).slice(0, 2000),
    stack: stack ? String(stack).slice(0, 8000) : undefined,
    url: window.location.href,
    userAgent: navigator.userAgent,
    meta: extra,
  };

  // silent() so a failure to post the error doesn't pop a toast.
  api.post('/logs/error', payload, silent()).catch(() => {/* swallow */});
}

export function installGlobalErrorReporters() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    report(event.message, event.error?.stack, { kind: 'window.error', filename: event.filename, lineno: event.lineno });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: any = event.reason;
    const message = typeof reason === 'string' ? reason : (reason?.message || 'Unhandled rejection');

    // If this looks like an axios error, the response interceptor in
    // axios.ts already toasted (or chose to stay silent). Don't double-toast.
    // Otherwise the rejection is a real bug — let the user know something
    // went wrong instead of leaving them staring at a frozen UI.
    const isAxios = !!reason?.isAxiosError || !!reason?.response;
    if (!isAxios) {
      toast.error('Something went wrong — the team has been notified.', {
        id: 'unhandled-rejection',
        description: String(message).slice(0, 120),
      });
    }
    report(message, reason?.stack, { kind: 'unhandledrejection' });
  });
}

/** Manually report from a React error boundary or controlled catch site. */
export function reportError(err: Error, extra: Record<string, any> = {}) {
  report(err.message, err.stack, { kind: 'manual', ...extra });
}
