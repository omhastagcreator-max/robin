/**
 * Light / dark theme — Nov 2026 (owner: "enable a button to switch to dark
 * theme and light theme").
 *
 * Robin's screens were built dark-first with hard-coded Tailwind slate
 * classes (bg-slate-950, text-slate-400, border-slate-800 …) across ~150
 * files. Instead of touching every file, tailwind.config.js now reads the
 * whole slate scale from CSS variables, and `html.theme-light` (index.css)
 * swaps those variables for a light scale. One class on <html> re-themes
 * the entire app. index.html applies the saved choice before React loads,
 * so there's no dark flash on refresh.
 */
export type Theme = 'dark' | 'light';
const KEY = 'robin:theme';
const EVENT = 'robin:theme-changed';

export function getTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.classList.toggle('theme-light', t === 'light');
  el.style.colorScheme = t;
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked — still apply for this tab */ }
  applyTheme(t);
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: t })); } catch { /* old browser */ }
}

/** Keep other open tabs in step when the theme is switched in one of them. */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  const local = (e: Event) => cb((e as CustomEvent).detail as Theme);
  const storage = (e: StorageEvent) => { if (e.key === KEY) { const t = getTheme(); applyTheme(t); cb(t); } };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', storage); };
}
