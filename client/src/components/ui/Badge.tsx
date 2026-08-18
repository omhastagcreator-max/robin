import type { ReactNode } from 'react';

/**
 * <Badge /> — small labelled chip for arbitrary text (tags, counts, free-
 * form labels). NOT for status — use <StatusPill /> for any of the fixed
 * presence/health states, since that component owns the canonical
 * color+icon+label mapping for those. Badge is for everything else: a
 * client tag, a "3 new" count, a priority word, a service name chip.
 */

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface Props {
  children: ReactNode;
  tone?: Tone;
  size?: 'xs' | 'sm';
  /** Small dot instead of full background — for subtler inline use. */
  dot?: boolean;
  onRemove?: () => void;
  className?: string;
}

const toneMap: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-emerald-500/12 text-emerald-700',
  warning: 'bg-amber-500/12 text-amber-700',
  danger:  'bg-rose-500/12 text-rose-700',
  info:    'bg-blue-500/12 text-blue-700',
};

const dotToneMap: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/50',
  primary: 'bg-primary',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-rose-500',
  info:    'bg-blue-500',
};

const sizeMap = {
  xs: 'h-[18px] px-1.5 text-[10px] gap-1 rounded',
  sm: 'h-[22px] px-2 text-[11px] gap-1 rounded-md',
};

export function Badge({ children, tone = 'neutral', size = 'sm', dot, onRemove, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center font-medium ${toneMap[tone]} ${sizeMap[size]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotToneMap[tone]}`} />}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 -mr-0.5 opacity-60 hover:opacity-100"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
