import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, PictureInPicture2, X } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * HuddleMicPiP — pop-out mic toggle that floats outside the browser window.
 *
 * Uses the new Document Picture-in-Picture API (Chrome 116+, Edge 116+).
 * When the user clicks "Pop out", we open a small always-on-top window
 * containing a tiny DOM tree, then render a React portal into that window.
 * That portal contains a mic toggle that controls the same useHuddle()
 * state — so flipping the mic in the PiP window mutes you in the real app.
 *
 * Why this is useful: agency employees alt-tab to other apps (Figma, ads
 * manager, code editor). Reaching back to the Robin tab to mute is friction.
 * A floating mic button stays on top no matter which app they're using.
 *
 * Browsers without support fall back to a regular in-page button so it
 * still works on Firefox / Safari (just not floating).
 */

interface DocumentPiPWindow extends Window {
  document: Document;
}

interface DocumentPictureInPicture {
  requestWindow: (opts: { width?: number; height?: number }) => Promise<DocumentPiPWindow>;
  window?: DocumentPiPWindow | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function HuddleMicPiP() {
  const huddle = useHuddle();
  const [pipWindow, setPipWindow] = useState<DocumentPiPWindow | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const supported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

  // Only meaningful while the user is actually in a huddle.
  if (!huddle.joined) return null;

  const openPiP = async () => {
    if (!supported || !window.documentPictureInPicture) {
      alert('Pop-out is only supported in Chrome / Edge 116+. The in-app mic button still works.');
      return;
    }
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 220, height: 110 });

      // Copy the parent's stylesheets into the PiP window so Tailwind
      // classes render correctly. (Each <style>/<link> needs to be cloned;
      // the new window is a separate Document.)
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const css = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
          const styleEl = w.document.createElement('style');
          styleEl.textContent = css;
          w.document.head.appendChild(styleEl);
        } catch {
          // Cross-origin stylesheets throw on .cssRules access — copy as <link>.
          if (sheet.href) {
            const link = w.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            w.document.head.appendChild(link);
          }
        }
      });

      const root = w.document.createElement('div');
      root.id = 'pip-root';
      w.document.body.appendChild(root);

      // Make the PiP body inherit our app's theme tokens.
      w.document.body.style.background = getComputedStyle(document.body).background || '#0a0a0a';
      w.document.body.style.color = getComputedStyle(document.body).color || '#fff';
      w.document.body.style.margin = '0';
      w.document.body.style.fontFamily = getComputedStyle(document.body).fontFamily;

      // When the PiP window closes (user clicks X), reset state.
      w.addEventListener('pagehide', () => {
        setPipWindow(null);
        setContainer(null);
      });

      setPipWindow(w);
      setContainer(root);
    } catch (e) {
      console.error('PiP open failed', e);
    }
  };

  const closePiP = () => {
    pipWindow?.close();
    setPipWindow(null);
    setContainer(null);
  };

  // The control UI we render BOTH in the page AND (when popped) in the PiP.
  const controls = (
    <div className="p-3 flex items-center gap-2">
      <button
        onClick={huddle.toggleAudio}
        className={`flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold transition-colors ${
          huddle.audioOn
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-red-500 text-white hover:bg-red-600'
        }`}
      >
        {huddle.audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        {huddle.audioOn ? 'Mic on' : 'Muted'}
      </button>
      {pipWindow && (
        <button
          onClick={closePiP}
          className="h-10 w-10 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-muted"
          title="Close pop-out"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* In-page button — shown when PiP is closed */}
      {!pipWindow && (
        <button
          onClick={openPiP}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-card border border-border text-xs font-semibold hover:bg-muted transition-colors"
          title={supported ? 'Pop out the mic' : 'Pop-out unavailable in this browser'}
          disabled={!supported}
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
          Pop-out mic
        </button>
      )}

      {/* When PiP is open, render the controls into it via a portal */}
      {pipWindow && container && createPortal(controls, container)}
    </>
  );
}

export default HuddleMicPiP;
