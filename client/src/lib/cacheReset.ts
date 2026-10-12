/**
 * One-time, org-wide browser reset — Oct 2026 owner ask: "clear cache and
 * cookies for all the users".
 *
 * On page load, if this browser hasn't applied RESET_ID yet, wipe
 * everything Robin keeps on the device — Cache Storage, service workers,
 * sessionStorage, localStorage (including the login token, so everyone
 * signs in fresh) and every cookie readable on this domain — then reload
 * once. The marker is written AFTER the wipe, so it runs exactly once per
 * browser.
 *
 * To force another reset for everyone later, just change RESET_ID and
 * deploy. (Open tabs pick up the new build via useAppUpdater's auto-reload.)
 */
export const RESET_ID = '2026-10-12-a';
const MARKER = 'robin.cacheResetId';

function clearCookies() {
  try {
    const host = window.location.hostname;
    const parts = host.split('.');
    // Expire each cookie on this host and every parent domain + root path.
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (!name) continue;
      for (const d of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    }
  } catch { /* */ }
}

/** Returns true when a reset ran and the page is reloading (skip rendering). */
export async function applyCacheResetIfNeeded(): Promise<boolean> {
  let current: string | null = null;
  try { current = localStorage.getItem(MARKER); } catch { return false; }  // storage blocked — nothing to clear
  if (current === RESET_ID) return false;

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
  try { localStorage.clear(); } catch { /* */ }
  clearCookies();
  try { localStorage.setItem(MARKER, RESET_ID); } catch { /* */ }

  // Fresh, cache-busted load. Login is cleared, so protected pages will
  // bounce to /login on their own.
  const url = new URL(window.location.href);
  url.searchParams.set('_reset', RESET_ID);
  window.location.replace(url.toString());
  return true;
}
