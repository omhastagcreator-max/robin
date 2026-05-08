import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Check } from 'lucide-react';

/**
 * MicConfirmButton — two-click toggle to prevent accidental mic flips.
 *
 * Pattern:
 *   Click 1 → button enters "Confirm?" pending state for 3 seconds.
 *   Click 2 (within 3s) → calls `onToggle()`.
 *   No click in 3s → resets to normal state, no action taken.
 *
 * Why: in a long huddle the mic button is right next to your cursor, and
 * a stray click can accidentally unmute you mid-typing or mute you while
 * you're talking. A two-step confirm catches both directions without
 * adding friction (the second click is a tap on the same spot).
 *
 * The component renders into the same button shape regardless of the
 * variant — pass a `variant` prop to match the host context (rounded pill
 * with label, or compact 40×40 icon-only).
 */

interface Props {
  audioOn: boolean;
  onToggle: () => void;
  /** "label" = pill with text · "icon" = 40×40 · "pip" = compact 32×32 for PiP. */
  variant?: 'label' | 'icon' | 'pip';
  /** When true, ignores confirm step (used inside dialogs that already gate). */
  bypass?: boolean;
}

const CONFIRM_WINDOW_MS = 3000;

export function MicConfirmButton({ audioOn, onToggle, variant = 'label', bypass }: Props) {
  const [pending, setPending] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Cancel pending state if it sits for too long.
  useEffect(() => {
    if (!pending) return;
    timerRef.current = window.setTimeout(() => setPending(false), CONFIRM_WINDOW_MS);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [pending]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (bypass) { onToggle(); return; }
    if (!pending) {
      setPending(true);
      return;
    }
    // Second click within window → execute
    setPending(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    onToggle();
  };

  // Visual states
  const action = audioOn ? 'mute' : 'unmute';
  const label =
    pending ? `Click again to ${action}` :
    audioOn ? 'Mute' : 'Unmute';

  if (variant === 'icon' || variant === 'pip') {
    const dims = variant === 'pip' ? 'h-8 w-8 rounded-md' : 'h-10 w-10 rounded-xl';
    const iconSize = variant === 'pip' ? 'h-3.5 w-3.5' : 'h-4 w-4';
    return (
      <button
        onClick={handleClick}
        title={pending ? `Confirm ${action}` : label}
        className={`relative ${dims} flex items-center justify-center border transition-all ${
          pending
            ? 'bg-amber-500/20 text-amber-600 border-amber-500/50 ring-2 ring-amber-500/40 animate-pulse'
            : audioOn
              ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
              : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
        }`}
      >
        {pending ? <Check className={iconSize} /> : audioOn ? <Mic className={iconSize} /> : <MicOff className={iconSize} />}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`h-10 px-4 rounded-xl border flex items-center gap-1.5 text-sm font-semibold transition-all ${
        pending
          ? 'bg-amber-500/20 text-amber-700 border-amber-500/50 ring-2 ring-amber-500/40 animate-pulse'
          : audioOn
            ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
            : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
      }`}
    >
      {pending ? <Check className="h-4 w-4" /> : audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      {label}
    </button>
  );
}

export default MicConfirmButton;
