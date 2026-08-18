import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * <Dropdown /> — the one "click a trigger, get a small menu" primitive in
 * Robin v2. Built specifically to absorb the "7 equally prominent buttons"
 * problem (see the UI/UX overhaul spec, §15 "Reduce button chaos") — put
 * one primary action on screen, then `<Dropdown trigger={<MoreButton />}>`
 * for everything else.
 *
 * Not for navigation menus (that's the sidebar) or command palettes (that's
 * CommandPalette). Just: trigger → small list of actions → closes on
 * selection or outside click.
 */

interface Props {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({ trigger, children, align = 'right', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <div onClick={() => setOpen(v => !v)}>{trigger}</div>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className={`
            absolute z-50 mt-1 min-w-[160px] py-1
            rounded-lg border border-border bg-card shadow-[var(--shadow-3)]
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
        >
          {children}
        </div>
      )}
    </div>
  );
}

Dropdown.Item = function DropdownItem({
  children, onClick, danger, icon, disabled,
}: {
  children: ReactNode; onClick?: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-left
        disabled:opacity-40 disabled:cursor-not-allowed
        ${danger ? 'text-rose-600 hover:bg-rose-500/10' : 'text-foreground hover:bg-muted'}
      `}
    >
      {icon}
      {children}
    </button>
  );
};

Dropdown.Divider = function DropdownDivider() {
  return <div className="my-1 border-t border-border" />;
};
