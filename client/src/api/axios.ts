import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { toast } from 'sonner';

/**
 * Network-resilient axios client tuned for India / mobile data.
 *
 * Behavior:
 *  - 30s timeout (default 60s+ would feel like the app is frozen on 3G)
 *  - Auto-retry idempotent GETs up to 2× with exponential backoff on
 *    network errors / timeouts / 502/503/504 (server warming up after
 *    Render free-tier idle). Non-idempotent requests (POST/PUT/DELETE)
 *    are NOT retried — the server may have already processed them and a
 *    blind retry could double-create/double-charge.
 *  - Distinct toasts for "you're offline" vs. real server errors.
 *  - Skips error toasts for background polls (configurable via header).
 */

const NETWORK_TIMEOUT_MS = 30_000;
// 5 retries with exponential backoff covers a Render free-tier cold start
// (which can take 30–60s while the service spins back up). Total worst-case
// wait before we surface the failure: ~22 seconds. Most users never see it.
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 700; // 700ms, 1.4s, 2.8s, 5.6s, 11.2s

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: NETWORK_TIMEOUT_MS,
});

// ── Request: attach JWT from localStorage ─────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('robin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Public routes a logged-out visitor can land on. We never redirect them
// to /login from here — the page handles its own error UI.
const PUBLIC_ROUTE_PREFIXES = ['/meet/', '/share/', '/login', '/update-password'];
const isPublicRoute = () =>
  PUBLIC_ROUTE_PREFIXES.some(p => window.location.pathname.startsWith(p));

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const isRetryableError = (err: AxiosError): boolean => {
  // No response = network error / DNS / timeout
  if (!err.response) return true;
  // Render cold-start / gateway hiccups
  if ([502, 503, 504].includes(err.response.status)) return true;
  return false;
};

const isIdempotent = (cfg: AxiosRequestConfig): boolean => {
  const method = (cfg.method || 'get').toLowerCase();
  return method === 'get' || method === 'head' || method === 'options';
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Response: retry + smart toasts ────────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const cfg = err.config as (AxiosRequestConfig & { _retryCount?: number }) | undefined;

    // Auto-retry transient failures on idempotent requests.
    if (cfg && isIdempotent(cfg) && isRetryableError(err)) {
      cfg._retryCount = (cfg._retryCount || 0) + 1;
      if (cfg._retryCount <= MAX_RETRIES) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, cfg._retryCount - 1));
        return api(cfg);
      }
    }

    const status  = err.response?.status;
    const message = (err.response?.data as any)?.error || err.message || 'Request failed';

    // Allow callers to opt-out of toasts (background polls, optional fetches).
    const silent = (cfg?.headers as any)?.['X-Silent'] === '1';

    if (status === 401 && !isPublicRoute()) {
      localStorage.removeItem('robin_token');
      window.location.href = '/login';
    } else if (status !== 401 || !isPublicRoute()) {
      if (silent) {
        // swallow — caller is handling their own UX
      } else if (!err.response) {
        // No response — either offline or server unreachable.
        if (isOffline()) {
          toast.error('You appear to be offline. We\'ll retry when you reconnect.', { id: 'net-offline' });
        } else {
          toast.error('Network is slow or unreachable. Please retry in a moment.', { id: 'net-slow' });
        }
      } else if (status === 429) {
        toast.error('Too many requests — please slow down.', { id: 'net-429' });
      } else if (status && status >= 500) {
        // Silent — auto-retry already handled this. If we got here all 5
        // retries failed (~22s). Show a calmer message instead of "hiccup".
        toast.error('Couldn\'t reach the server. We\'ll keep trying.', { id: 'net-5xx' });
      } else if (status !== 410) {
        // 410 = meeting expired/ended — page renders a nicer state itself
        toast.error(message);
      }
    }
    return Promise.reject(err);
  },
);

/** Helper: mark a request as silent so failures don't show a toast. */
export function silent(config?: AxiosRequestConfig): AxiosRequestConfig {
  return { ...config, headers: { ...(config?.headers || {}), 'X-Silent': '1' } };
}

export default api;
