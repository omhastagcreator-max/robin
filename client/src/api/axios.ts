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

// ── Response: show toast on errors ───────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status  = err.response?.status;
    const message = err.response?.data?.error || err.message || 'Request failed';
    if (status === 401) {
      localStorage.removeItem('robin_token');
      window.location.href = '/login';
    } else {
      toast.error(message);
    }
    return Promise.reject(err);
  }
);

export default api;
