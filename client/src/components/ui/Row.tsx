import type { ReactNode } from 'react';

/**
 * <Row /> — the row primitive that replaces 90% of Robin's cards.
 *
 * A row is denser than a card: ~36px tall, hairline divider above each
 * one, hover affordance, optional left accent strip for status. Designed
 * for the Linear / Notion / ClickUp style list views.
 *
 * Slot anatomy:
 *   <Row accent="primary">
 *     <Row.Leading>{avatar / icon}</Row.Leading>
 *     <Row.Main>
 *       <Row.Title>{name}</Row.Title>
 *       <Row.Meta>{phone · last update}</Row.Meta>
 *     </Row.Main>
 *     <Row.Trail>{status pill / actions}</Row.Trail>
 *   </Row>
 *
 * Cards are reserved for: hero summary cards, AI briefs, modals. Everything
 * else becomes Rows.
 */

interface Props {
  children: ReactNode;
  onClick?: () => void;
  /** Coloured accent strip on the left edge for status signaling. */
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'none';
  /** Style: dense (36px tall, default) | comfy (44px) */
  density?: 'dense' | 'comfy';
  active?: boolean;
  className?: string;
}

const accentMap = {
  primary: 'before:bg-primary',
  success: 'before:bg-emerald-500',
  warning: 'before:bg-amber-500',
  danger:  'before:bg-rose-500',
  info:    'before:bg-blue-500',
  none:    'before:hidden',
};

export function Row({ children, onClick, accent = 'none', density = 'dense', active, className = '' }: Props) {
  return (
    <div
      onClick={onClick}
      className={`
        relative flex items-center gap-2.5 px-3 group
        ${density === 'dense' ? 'h-9' : 'h-11'}
        ${onClick ? 'cursor-pointer hover:bg-primary/[0.03]' : ''}
        ${active ? 'bg-primary/[0.05]' : ''}
        before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full ${accentMap[accent]}
        border-b border-border last:border-b-0
        transition-colors duration-100
        ${className}
      `}
    >
      {children}
    </div>
  );
}

Row.Leading = function RowLeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`shrink-0 flex items-center ${className}`}>{children}</div>;
};

Row.Main = function RowMain({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex-1 min-w-0 flex flex-col leading-tight ${className}`}>{children}</div>;
};

Row.Title = function RowTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-[13px] font-semibold text-foreground truncate ${className}`}>{children}</span>;
};

Row.Meta = function RowMeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-[11px] text-muted-foreground truncate ${className}`}>{children}</span>;
};

Row.Trail = function RowTrail({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`shrink-0 flex items-center gap-2 ${className}`}>{children}</div>;
};
