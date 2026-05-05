import { PictureInPicture2, X } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * HuddleMicPiP — the IN-PAGE button + auto-pop toggle.
 *
 * The actual portal that renders into the PiP window now lives in
 * HuddleProvider so the floating window always has content the moment it
 * opens. This component is just the small control surface inside the
 * HuddleDashboardCard that shows "Pop out" / "auto" / "Close mini panel".
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
    </>
  );
}

export default HuddleMicPiP;
