import { useMemo } from 'react';

/**
 * Avatar — initial-only avatar bubble. Crash-safe replacement for the
 * `(name || email)[0].toUpperCase()` pattern that blew up on rows where
 * both fields were empty/null (TypeError: Cannot read properties of
 * undefined). The audit found this in 4+ admin pages.
 *
 * Usage:
 *   <Avatar name={user.name} email={user.email} />
 *   <Avatar name="Rahul" size="lg" tone="primary" />
 */

const SIZE_CLASS: Record<string, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

// Pick a deterministic color from the name so each user has a consistent
// hue across the app. Hash → palette index. Cheap and good enough.
const PALETTE = [
  'bg-blue-500/15 text-blue-700',
  'bg-emerald-500/15 text-emerald-700',
  'bg-violet-500/15 text-violet-700',
  'bg-amber-500/15 text-amber-700',
  'bg-rose-500/15 text-rose-700',
  'bg-sky-500/15 text-sky-700',
  'bg-orange-500/15 text-orange-700',
];

function hashIndex(str: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

export interface AvatarProps {
  name?: string | null;
  email?: string | null;
  url?: string | null;            // optional photo URL
  size?: 'xs' | 'sm' | 'md' | 'lg';
  tone?: 'auto' | 'primary' | 'muted';
  className?: string;
}

export function Avatar({ name, email, url, size = 'sm', tone = 'auto', className = '' }: AvatarProps) {
  const display = (name || email || '').trim();

  // ALWAYS produce a 1-char initial — never crash on empty/null.
  const initial = display ? display.charAt(0).toUpperCase() : '?';

  const tonalClass = useMemo(() => {
    if (tone === 'primary') return 'bg-primary/15 text-primary';
    if (tone === 'muted')   return 'bg-muted text-muted-foreground';
    return PALETTE[hashIndex(display || 'x', PALETTE.length)];
  }, [display, tone]);

  if (url) {
    return (
      <img
        src={url}
        alt={display || 'avatar'}
        className={`${SIZE_CLASS[size]} rounded-full object-cover shrink-0 ${className}`}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div
      className={`${SIZE_CLASS[size]} rounded-full font-bold flex items-center justify-center shrink-0 ${tonalClass} ${className}`}
      title={display || undefined}
      aria-label={display || 'avatar'}
    >
      {initial}
    </div>
  );
}

export default Avatar;
