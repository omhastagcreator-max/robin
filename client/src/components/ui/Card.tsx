import type { HTMLAttributes, ReactNode } from 'react';

/**
 * <Card /> — the one card container in Robin v2.
 *
 * Reserved for: hero summary blocks, AI briefs, modals, and grouped
 * sections that need visual separation from the page background. Anything
 * list-like (clients, leads, tasks) should be a <Row /> instead — see
 * Row.tsx's docstring. Using Card for list items is what caused Robin's
 * pages to feel like "everything is a giant bordered box."
 *
 * Padding presets keep spacing consistent instead of every page picking
 * its own p-3/p-4/p-5/p-6.
 */

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** none — for cards that manage their own internal padding (e.g. a
   *  card with a header strip + divided sections). */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Adds hover elevation — use for clickable/navigable cards only. */
  interactive?: boolean;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export function Card({ children, padding = 'md', interactive, className = '', ...rest }: Props) {
  return (
    <div
      className={`
        rounded-xl border border-border bg-card
        ${paddingMap[padding]}
        ${interactive ? 'transition-colors hover:border-primary/30 cursor-pointer' : ''}
        ${className}
      `}
      {...rest}
    >
      {children}
    </div>
  );
}

Card.Header = function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 border-b border-border flex items-center justify-between gap-3 ${className}`}>
      {children}
    </div>
  );
};

Card.Title = function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-[13px] font-bold text-foreground ${className}`}>{children}</h3>;
};

Card.Subtitle = function CardSubtitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11.5px] text-muted-foreground mt-0.5 ${className}`}>{children}</p>;
};

/** Divided section inside a `padding="none"` card — e.g. the 5-section
 *  Info/Sales/Services/Financials/Operations panels used on client pages. */
Card.Section = function CardSection({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 border-b border-border last:border-b-0 ${className}`}>{children}</div>;
};
