import { useState, type ReactNode } from 'react';

/**
 * <Tooltip /> — lightweight hover/focus tooltip. Wraps a single child and
 * shows a small dark label above it on hover or keyboard focus. No portal
 * (fine for Robin's density — nothing sits close enough to a scroll
 * boundary to need one); if that ever becomes a problem, upgrade this one
 * file rather than each ad-hoc `title="..."` attribute scattered around.
 *
 * Prefer this over the native `title` attribute for anything that needs
 * to explain WHY something is disabled or what an icon-only button does —
 * native title tooltips are slow to appear and invisible on touch.
 */

interface Props {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

export function Tooltip({ label, children, side = 'top', className = '' }: Props) {
  const [show, setShow] = useState(false);
  if (!label) return <>{children}</>;
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={`
            absolute left-1/2 -translate-x-1/2 z-50 px-2 py-1 rounded-md
            bg-foreground text-background text-[10.5px] font-medium whitespace-nowrap
            pointer-events-none shadow-[var(--shadow-2)]
            ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
          `}
        >
          {label}
        </span>
      )}
    </span>
  );
}
