import { Mic, MicOff } from 'lucide-react';

/**
 * MicConfirmButton — plain one-click mic toggle.
 *
 * Note: this used to show a confirmation popup before turning the mic on,
 * to prevent accidental unmute. The user found it slowed them down so we
 * reverted to a single click in both directions. The component name stays
 * the same so existing imports continue to work without a rename.
 */

interface Props {
  audioOn: boolean;
  onToggle: () => void;
  /** "label" = pill with text · "icon" = 40×40 · "pip" = compact 32×32 for PiP. */
  variant?: 'label' | 'icon' | 'pip';
}

export function MicConfirmButton({ audioOn, onToggle, variant = 'label' }: Props) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };

  const tone = audioOn
    ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
    : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25';

  if (variant === 'pip') {
    return (
      <button
        onClick={handleClick}
        title={audioOn ? 'Mute' : 'Unmute'}
        className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${tone}`}
      >
        {audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
      </button>
    );
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        title={audioOn ? 'Mute' : 'Unmute'}
        className={`h-10 w-10 rounded-xl flex items-center justify-center border transition-colors ${tone}`}
      >
        {audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`h-10 px-4 rounded-xl border flex items-center gap-1.5 text-sm font-semibold transition-colors ${tone}`}
    >
      {audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      {audioOn ? 'Mute' : 'Unmute'}
    </button>
  );
}

export default MicConfirmButton;
