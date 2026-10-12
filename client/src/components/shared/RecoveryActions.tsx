import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Eraser, Power, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * RecoveryActions — Oct 2026 owner ask: "give me a log out button, clear
 * cache button, refresh button, restart button in case of failure to
 * login". Self-service fixes for the usual stuck states:
 *
 *   Refresh      — plain reload.
 *   Clear cache  — wipes browser caches, service workers, sessionStorage
 *                  and Robin's cached drafts/settings in localStorage, but
 *                  KEEPS the login token, then hard-reloads. Fixes "old
 *                  version stuck" / corrupted local state.
 *   Restart      — wakes the Render backend (free tier sleeps ~50s), then
 *                  does a full reset: everything above PLUS the login is
 *                  cleared, and you land on /login fresh.
 *   Log out      — signs out of the account (not just "end my work day").
 */

const AUTH_KEYS = ['robin_token', 'robin_user'];

async function wipeBrowserCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* */ }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch { /* */ }
  try { sessionStorage.clear(); } catch { /* */ }
}

function clearLocalStorage(keepAuth: boolean) {
  try {
    const keep: Record<string, string> = {};
    if (keepAuth) for (const k of AUTH_KEYS) { const v = localStorage.getItem(k); if (v !== null) keep[k] = v; }
    localStorage.clear();
    for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  } catch { /* */ }
}

function hardReload(path?: string) {
  const url = new URL(path || window.location.pathname, window.location.origin);
  url.searchParams.set('_r', String(Date.now()));   // bust any HTML cache
  window.location.replace(url.toString());
}

async function wakeServer(): Promise<boolean> {
  const api = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '').replace(/\/api$/, '');
  if (!api) return false;
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${api}/health`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (r.ok) return true;
    } catch { /* still waking */ }
    await new Promise(res => setTimeout(res, 3000));
  }
  return false;
}

export function RecoveryActions({ variant = 'light', showLogout = true }: { variant?: 'light' | 'dark'; showLogout?: boolean }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const onRefresh = () => { setBusy('refresh'); window.location.reload(); };

  const onClearCache = async () => {
    setBusy('cache');
    await wipeBrowserCaches();
    clearLocalStorage(true);
    toast.success('Cache cleared — reloading…');
    setTimeout(() => hardReload(), 400);
  };

  const onRestart = async () => {
    setBusy('restart');
    const t = toast.loading('Waking the Robin server… (can take up to a minute)');
    const ok = await wakeServer();
    toast.dismiss(t);
    if (ok) toast.success('Server is up — restarting Robin…');
    else toast.error('Server still not answering — restarting anyway. Try again in a minute if login fails.');
    try { logout(); } catch { /* */ }
    await wipeBrowserCaches();
    clearLocalStorage(false);
    setTimeout(() => hardReload('/login'), 600);
  };

  const onLogout = () => {
    setBusy('logout');
    try { logout(); } catch { /* */ }
    clearLocalStorage(false);
    hardReload('/login');
  };

  const btn = variant === 'dark'
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition'
    : 'inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-[11.5px] font-semibold border border-border bg-background text-foreground/80 hover:bg-muted disabled:opacity-50 transition';
  const spin = (k: string, Icon: any) => busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />;

  return (
    <div className={variant === 'dark' ? 'flex items-center gap-1.5' : 'grid grid-cols-2 sm:grid-cols-4 gap-2'}>
      <button type="button" disabled={!!busy} onClick={onRefresh} className={btn} title="Reload this page">
        {spin('refresh', RefreshCw)}<span className={variant === 'dark' ? 'hidden lg:inline' : ''}>Refresh</span>
      </button>
      <button type="button" disabled={!!busy} onClick={onClearCache} className={btn} title="Clear cached files and saved app data (keeps you signed in), then reload">
        {spin('cache', Eraser)}<span className={variant === 'dark' ? 'hidden lg:inline' : ''}>Clear cache</span>
      </button>
      <button type="button" disabled={!!busy} onClick={onRestart} className={btn} title="Wake the server, wipe everything (including login) and start fresh">
        {spin('restart', Power)}<span className={variant === 'dark' ? 'hidden lg:inline' : ''}>Restart</span>
      </button>
      {showLogout && (
        <button type="button" disabled={!!busy} onClick={onLogout} className={`${btn} ${variant === 'dark' ? 'hover:!bg-rose-600 hover:!border-rose-500' : 'hover:!bg-rose-50 hover:!text-rose-700'}`} title="Sign out of your Robin account">
          {spin('logout', LogOut)}<span className={variant === 'dark' ? 'hidden lg:inline' : ''}>Sign out</span>
        </button>
      )}
    </div>
  );
}

export default RecoveryActions;
