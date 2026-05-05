import { createPortal } from 'react-dom';
import { PictureInPicture2, X } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { HuddlePiPContent } from '@/components/shared/HuddlePiPContent';

/**
 * HuddleMicPiP
 *
 * Two roles in one component:
 *  1. Render a "Pop out" button (when PiP is closed) and an "Auto" toggle
 *     so the user can disable the always-on-pop behaviour.
 *  2. When the PiP window IS open, render <HuddlePiPContent /> into it via
 *     a React portal. This is what makes the mini panel "magically" mirror
 *     the same Robin state — same audio toggle state, same chat, same
 *     screen list — without us managing two state trees.
 *
 * The actual `documentPictureInPicture.requestWindow` call happens inside
 * `huddle.join()` in HuddleContext, so the auto-pop fires within the user's
 * click activation window. This component just renders into whatever
 * window already exists.
 */
export function HuddleMicPiP() {
  const huddle = useHuddle();

  // Show nothing until the user is in the huddle.
  if (!huddle.joined) return null;

  return (
    <>
      {/* In-page button when PiP is NOT open */}
      {!huddle.pip.isOpen && (
        <div className="flex items-center gap-1.5">
          {huddle.pip.supported ? (
            <button
              onClick={() => huddle.pip.open()}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-card border border-border text-xs font-semibold hover:bg-muted transition-colors"
              title="Pop out the mini panel"
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
              Pop out
            </button>
          ) : (
            <span className="text-[10px] text-muted-foreground italic" title="Document Picture-in-Picture is Chrome/Edge 116+ only">
              pop-out unavailable
            </span>
          )}
          {huddle.pip.supported && (
            <label className="text-[10px] text-muted-foreground flex items-center gap-1 cursor-pointer select-none" title="Open the floating mini panel automatically when you join the huddle">
              <input
                type="checkbox"
                checked={huddle.pip.autoEnabled}
                onChange={e => huddle.pip.setAutoEnabled(e.target.checked)}
                className="h-3 w-3"
              />
              auto
            </label>
          )}
        </div>
      )}

      {/* In-page indicator + close button when PiP IS open */}
      {huddle.pip.isOpen && (
        <button
          onClick={huddle.pip.close}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-semibold hover:bg-primary/25 transition-colors"
          title="Close the floating mini panel"
        >
          <X className="h-3.5 w-3.5" />
          Mini panel open
        </button>
      )}

      {/* The portal that renders the entire mini control panel into the PiP DOM */}
      {huddle.pip.container && createPortal(<HuddlePiPContent />, huddle.pip.container)}
    </>
  );
}

export default HuddleMicPiP;
