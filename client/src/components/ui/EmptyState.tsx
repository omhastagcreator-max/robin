import type { ReactNode } from 'react';

/**
 * Robin v2 empty-state primitive. Every "nothing here yet" surface in the
 * app should use this. Replaces the bespoke "py-12 text-center text-muted"
 * blocks scattered across pages.
 *
 * Designed to feel useful, not empty — every empty state has a primary
 * action ("Onboard a client", "Create your first task") instead of just
 * grey text.
 *
 * Sizes:  sm (in-card placeholder) · md (in-section, default) · lg (full-page)
 */

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;          // typically a <Button>
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'py-6 px-4 text-center gap-1.5',
  md: 'py-10 px-6 text-center gap-2',
  lg: 'py-16 px-8 text-center gap-3',
};

export function EmptyState({ icon, title, hint, action, size = 'md', className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center ${sizeMap[size]} ${className}`}>
      {icon && <div className="text-muted-foreground/40 mb-1">{icon}</div>}
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      {hint && <p className="text-[11.5px] text-muted-foreground max-w-sm">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
