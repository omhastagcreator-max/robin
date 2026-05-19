import type { ReactNode } from 'react';

/**
 * Robin v2 inline stat primitive. Used for the dense stat strips that
 * replace KPI-card grids on every dashboard.
 *
 * Compact (one-line) by default. Pass `block` for a stacked vertical
 * variant used in section headers.
 *
 * Tones map to status colors so a "blocked count: 3" can render in red,
 * "completed: 12" in emerald, etc.
 */

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted';

interface Props {
  icon?: ReactNode;
  value: ReactNode;
  label: string;
  tone?: Tone;
  /** Stacked rather than inline. */
  block?: boolean;
  className?: string;
}

const toneMap: Record<Tone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger:  'text-rose-700',
  muted:   'text-muted-foreground',
};

export function Stat({ icon, value, label, tone = 'default', block, className = '' }: Props) {
  if (block) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        {(icon || label) && (
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {icon}<span>{label}</span>
          </div>
        )}
        <p className={`text-[20px] font-bold tabular-nums leading-none ${toneMap[tone]}`}>{value}</p>
      </div>
    );
  }
  return (
    <div className={`inline-flex items-center gap-1.5 leading-none text-[12px] ${className}`}>
      {icon && <span className={toneMap[tone]}>{icon}</span>}
      <span className={`font-bold tabular-nums ${toneMap[tone]}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
