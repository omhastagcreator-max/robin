import axios from 'axios';
import { toast } from 'sonner';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api',
  headers: { 'Content-Type': 'application/json' },
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

// ── Response: show toast on errors ───────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status  = err.response?.status;
    const message = err.response?.data?.error || err.message || 'Request failed';
    if (status === 401 && !isPublicRoute()) {
      localStorage.removeItem('robin_token');
      window.location.href = '/login';
    } else if (status !== 401 || !isPublicRoute()) {
      // Skip toast on 410 (meeting expired/ended) — page renders a nicer state
      if (status !== 410) toast.error(message);
    }
    return Promise.reject(err);
  }
);

export default api;
