import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Robin v2 icon-only button. Used for inline row actions, toolbar buttons,
 * close buttons, etc. — anywhere you want a square button containing only
 * an icon.
 *
 * Sizes:  xs (20px) · sm (24px) · md (28px) · lg (32px)
 * Intent: primary (Rani Pink) · ghost (default) · danger
 */

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Intent = 'primary' | 'ghost' | 'danger' | 'success';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: Size;
  intent?: Intent;
  children: ReactNode;       // expected to be a lucide icon
  /** Round corners → pill. */
  pill?: boolean;
}

const sizeMap: Record<Size, string> = {
  xs: 'h-5 w-5 [&_svg]:h-3 [&_svg]:w-3',
  sm: 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-7 w-7 [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
};

const intentMap: Record<Intent, string> = {
  primary: 'text-primary bg-primary/[0.04] hover:bg-primary/10',
  ghost:   'text-muted-foreground hover:text-foreground hover:bg-muted',
  danger:  'text-rose-600 hover:text-rose-700 hover:bg-rose-500/10',
  success: 'text-emerald-700 hover:bg-emerald-500/10',
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { size = 'sm', intent = 'ghost', pill, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`
        inline-flex items-center justify-center
        transition-colors
        ${sizeMap[size]}
        ${intentMap[intent]}
        ${pill ? 'rounded-full' : 'rounded'}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      {...rest}
    >
      {children}
    </button>
  );
});
