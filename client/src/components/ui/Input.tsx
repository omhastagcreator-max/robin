import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';

/**
 * Robin v2 input primitives. All text inputs in the app should use these
 * — no more bespoke `<input class="px-3 py-2 ...">` calls. Replacing them
 * is the single biggest visual-consistency win across the form pages.
 *
 * Sizes:  sm (28px) · md (32px — default) · lg (36px)
 * Intent: default · error (red border + ring) · success (emerald)
 */

type Size = 'sm' | 'md' | 'lg';

interface BaseProps {
  size?: Size;
  intent?: 'default' | 'error' | 'success';
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
}

const sizeMap: Record<Size, string> = {
  sm: 'h-7 text-[12px] px-2 gap-1.5',
  md: 'h-8 text-[13px] px-2.5 gap-2',
  lg: 'h-9 text-[14px] px-3 gap-2',
};

const intentMap = {
  default: 'border-input focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25',
  error:   'border-rose-500/60 focus-within:ring-2 focus-within:ring-rose-500/25',
  success: 'border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/25',
};

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, BaseProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', intent = 'default', iconLeft, iconRight, full = true, className = '', ...rest },
  ref,
) {
  return (
    <div className={`
      inline-flex items-center bg-background border rounded-md transition-shadow
      ${sizeMap[size]}
      ${intentMap[intent]}
      ${full ? 'w-full' : ''}
      ${className}
    `}>
      {iconLeft && <span className="text-muted-foreground shrink-0">{iconLeft}</span>}
      <input
        ref={ref}
        className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60"
        {...rest}
      />
      {iconRight && <span className="text-muted-foreground shrink-0">{iconRight}</span>}
    </div>
  );
});

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>, BaseProps {
  rows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { intent = 'default', full = true, className = '', rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`
        block bg-background border rounded-md px-2.5 py-2 text-[13px]
        outline-none resize-y
        ${intentMap[intent]}
        ${full ? 'w-full' : ''}
        ${className}
      `}
      {...rest}
    />
  );
});
