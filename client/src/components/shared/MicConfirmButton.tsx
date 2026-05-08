import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, AlertTriangle } from 'lucide-react';

/**
 * MicConfirmButton — asymmetric mic toggle.
 *
 * Pattern:
 *   • Mic currently OFF + click → opens a confirmation popup. The user must
 *     explicitly click "Yes, turn on" to broadcast their voice.
 *   • Mic currently ON + click → mutes immediately, no confirmation. Muting
 *     is the safe direction — a stray click that mutes you can be undone with
 *     another click; a stray click that UNMUTES you might broadcast a private
 *     conversation before you notice.
 *
 * The popup is a true modal (rendered via React Portal at document.body), so
 * it sits above the huddle UI and the PiP window cleanly.
 */

interface Props {
  audioOn: boolean;
  onToggle: () => void;
  /** "label" = pill with text · "icon" = 40×40 · "pip" = compact 32×32 for PiP. */
  variant?: 'label' | 'icon' | 'pip';
}

export function MicConfirmButton({ audioOn, onToggle, variant = 'label' }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  // Esc closes the popup
  useEffect(() => {
    if (!showConfirm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowConfirm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConfirm]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioOn) {
      // Going from on → off (mute) is one-click — the safe direction
      onToggle();
    } else {
      // Going from off → on (unmute) needs confirmation
      setShowConfirm(true);
    }
  };

  const confirmTurnOn = () => {
    setShowConfirm(false);
    onToggle();
  };

  // ── Button rendering ─────────────────────────────────────────────────
  const button = (() => {
    const tone = audioOn
      ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
      : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25';
    const title = audioOn ? 'Mute' : 'Turn on mic (will ask to confirm)';

    if (variant === 'pip') {
      return (
        <button
          onClick={handleClick}
          title={title}
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
          title={title}
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
  })();

  return (
    <>
      {button}
      {showConfirm && createPortal(
        <div
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base leading-tight">Turn on your mic?</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Once on, anyone in the huddle can hear you. Make sure you're ready to speak.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-muted"
                autoFocus
              >
                Cancel
              </button>
              <button
                onClick={confirmTurnOn}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 flex items-center gap-1.5"
              >
                <Mic className="h-4 w-4" /> Yes, turn on
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default MicConfirmButton;
