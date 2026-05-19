import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * <Button /> — the one button component in Robin v2.
 *
 * Sizes:   xs (24px) · sm (28px) · md (32px — default) · lg (36px)
 * Intent:  primary (Rani Pink filled) · secondary (border) · ghost (transparent) · danger
 * Loading: shows a spinner + disables interaction
 *
 * Every other place that draws a button should die. Search for `<button class`
 * to find candidates for migration.
 */

type Size   = 'xs' | 'sm' | 'md' | 'lg';
type Intent = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?:    Size;
  intent?:  Intent;
  loading?: boolean;
  iconLeft?:  ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  /** Pill-shaped button (round full radius). Used for floating actions. */
  pill?: boolean;
  /** Stretch to full container width. */
  full?: boolean;
}

const sizeMap: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1',
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-1.5',
  lg: 'h-9 px-4 text-[14px] gap-2',
};

const intentMap: Record<Intent, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)]',
  secondary:
    'bg-card text-foreground border border-border hover:border-primary/30 hover:bg-primary/[0.03]',
  ghost:
    'bg-transparent text-foreground hover:bg-muted',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-700',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-700',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { size = 'md', intent = 'primary', loading, iconLeft, iconRight, children, pill, full, className = '', disabled, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-semibold whitespace-nowrap
        transition-[background-color,box-shadow,border-color,transform]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40
        disabled:opacity-50 disabled:cursor-not-allowed
        active:scale-[0.98]
        ${sizeMap[size]}
        ${intentMap[intent]}
        ${pill ? 'rounded-full' : 'rounded-md'}
        ${full ? 'w-full' : ''}
        ${className}
      `}
      style={{ transitionDuration: 'var(--t-fast)', transitionTimingFunction: 'var(--e-out)' }}
      {...rest}
    >
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});
