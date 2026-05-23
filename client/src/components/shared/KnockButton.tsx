import { Hand } from 'lucide-react';
import { useKnock } from '@/hooks/useKnock';

/**
 * <KnockButton /> — a single icon button that pings a teammate with a
 * chime + toast wherever they are inside Robin. Pierces deafen.
 *
 * Mount this inline anywhere a teammate's name appears — huddle tiles,
 * people grid, sidebar online list, etc. Keeps a consistent look so
 * users learn one icon (raised hand) and recognize it everywhere.
 *
 * Props:
 *   - userId   recipient userId
 *   - name     for the tooltip ("Knock Sakshi")
 *   - hasMutedYou  optional — when true the button gets an amber tint
 *                  to suggest "use this; they can't hear you right now"
 *   - size     'sm' (5×5) | 'md' (6×6) — defaults to 'sm'
 */
interface Props {
  userId: string;
  name?: string;
  hasMutedYou?: boolean;
  size?: 'sm' | 'md';
}

export function KnockButton({ userId, name, hasMutedYou, size = 'sm' }: Props) {
  const { knock, hasPendingTo } = useKnock();
  const disabled = hasPendingTo(userId);

  const dim = size === 'md' ? 'h-6 w-6' : 'h-5 w-5';
  const ico = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5';

  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!disabled) knock(userId); }}
      disabled={disabled}
      title={
        disabled
          ? 'You knocked them recently — wait 10s'
          : hasMutedYou
            ? `${name || 'They'} muted team audio — knock them so they hear a chime`
            : `Knock ${name || 'them'} (chime + toast)`
      }
      className={`${dim} rounded-full flex items-center justify-center transition-colors ${
        disabled
          ? 'bg-muted text-muted-foreground opacity-50 cursor-not-allowed'
          : hasMutedYou
            ? 'bg-amber-500/25 text-amber-700 hover:bg-amber-500/40'
            : 'bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary'
      }`}
    >
      <Hand className={ico} />
    </button>
  );
}

export default KnockButton;
