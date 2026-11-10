import { useEffect, useState } from 'react';
import { getTheme, setTheme, onThemeChange, type Theme } from '@/lib/theme';

/** Nov 2026 — sun/moon button in the top bar. Choice is remembered per browser. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setT] = useState<Theme>(getTheme);
  useEffect(() => onThemeChange(setT), []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => { setTheme(next); setT(next); }}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className={`h-9 w-9 shrink-0 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition ${className}`}
    >
      <i className={`fa-solid ${theme === 'dark' ? 'fa-sun text-amber-300' : 'fa-moon text-indigo-400'} text-sm`}></i>
    </button>
  );
}
