import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import { useAuth } from '@/contexts/AuthContext';
import { useHuddleTranscription } from '@/hooks/useHuddleTranscription';
import { HuddlePiPContent } from '@/components/shared/HuddlePiPContent';
import type { IceSource } from '@/lib/iceServers';

type HuddleMode = 'idle' | 'joining' | 'expanded' | 'collapsed';

interface HuddleApi {
  // UI mode state
  mode: HuddleMode;
  join: () => void;
  leave: () => void;
  collapse: () => void;
  expand: () => void;

  // Meeting state (read from the single useMeetingRoom instance below)
  joined: boolean;
  joining: boolean;
  peers: PeerView[];
  localStream: MediaStream | null;
  audioOn: boolean;
  screenOn: boolean;
  meetingError: string | null;
  networkBlocked: boolean;
  iceMeta: { source: IceSource; count: number };
  participantCount: number;

  // Meeting actions
  toggleAudio: () => void;
  toggleScreen: () => void;

  // AI scribe state
  scribe: {
    supported: boolean;
    listening: boolean;
    lastError: string | null;
    linesPosted: number;
  };

  // Document Picture-in-Picture (always-on-top floating mini panel)
  pip: {
    supported: boolean;
    isOpen: boolean;
    container: HTMLElement | null;
    open: () => Promise<void>;
    close: () => void;
    autoEnabled: boolean;
    setAutoEnabled: (on: boolean) => void;
  };
}

const HuddleContext = createContext<HuddleApi | null>(null);

/**
 * SINGLE source of truth for the huddle. Calls useMeetingRoom ONCE here
 * (not in HuddleDock + HuddleStage separately) so we only ever have one
 * mesh peer connection per teammate. Two instances would build duplicate
 * RTCPeerConnections and exhaust the browser's media resources, which
 * was causing tab hangs (Aw, Snap! / RESULT_CODE_HUNG).
 *
 * Lives at the BrowserRouter level (above AppRoutes) so the call survives
 * page navigation.
 */
export function HuddleProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [mode, setMode] = useState<HuddleMode>('idle');

  // The ONE useMeetingRoom instance for the whole app.
  const meeting = useMeetingRoom({
    userId:   user?.id || '',
    userName: user?.name,
    userRole: role,
    roomId:   'agency-global',
  });

  // ── Document Picture-in-Picture (PiP mini-panel) ────────────────────────
  // We hold the PiP state HERE (not in HuddleMicPiP) because the open call
  // needs "transient activation" — the click that triggers `join()` is the
  // only moment we have permission to spawn the PiP window. So join() itself
  // calls openPiP() synchronously when auto-pop is enabled.
  const pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const pipWindowRef = useRef<any>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipAutoEnabled, setPipAutoEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('robin.huddle.autoPiP') !== 'false'; // default on
  });
  const setPipAutoEnabled = useCallback((on: boolean) => {
    setPipAutoEnabledState(on);
    localStorage.setItem('robin.huddle.autoPiP', on ? 'true' : 'false');
  }, []);

  const openPiP = useCallback(async () => {
    if (!pipSupported || pipWindowRef.current) return;
    // Synchronous lock — claim the slot BEFORE the async request returns so
    // a second rapid call (e.g. double click on Join, or visibilitychange
    // racing the join click) can't spawn a duplicate PiP window. We replace
    // the placeholder with the real window on success, or null on failure.
    pipWindowRef.current = 'pending' as any;
    try {
      const w = await (window as any).documentPictureInPicture.requestWindow({
        width: 360,
        height: 560,
      });

      // ── Loading splash so the window is never visually empty ──────────
      // We paint this immediately, before React or styles arrive. Once
      // React mounts and Tailwind kicks in, our content covers it.
      w.document.title = 'Robin Huddle';
      w.document.body.style.margin = '0';
      w.document.body.innerHTML = `
        <div id="robin-pip-splash" style="
          position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
          gap:8px;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;
          font-size:13px;letter-spacing:.02em;z-index:1;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2px solid rgba(255,255,255,.2);border-top-color:#fff;
            animation:robin-pip-spin .8s linear infinite;"></span>
          Loading Robin huddle…
          <style>@keyframes robin-pip-spin { to { transform: rotate(360deg) } }</style>
        </div>
      `;

      // ── Stylesheet copy strategy (belt + suspenders) ──────────────────
      // 1) Modern path: adoptedStyleSheets — single shared sheet object,
      //    much faster + survives DOM mutations. Chrome 99+, Edge 99+.
      // 2) Fallback: clone every <style> tag's text content.
      // 3) Cross-origin sheets we can't read get re-linked via <link>.
      // 4) Copy <link rel="stylesheet"> tags directly (CDN fonts etc).
      const adoptable: any[] = [];
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const css = Array.from(sheet.cssRules || []).map((r: any) => r.cssText).join('\n');
          if (!css) return;
          // Try adoptedStyleSheets first
          try {
            // @ts-ignore — CSSStyleSheet constructor + replaceSync
            const cs = new w.CSSStyleSheet();
            cs.replaceSync(css);
            adoptable.push(cs);
          } catch {
            const styleEl = w.document.createElement('style');
            styleEl.textContent = css;
            w.document.head.appendChild(styleEl);
          }
        } catch {
          if (sheet.href) {
            const link = w.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            w.document.head.appendChild(link);
          }
        }
      });
      try {
        if (adoptable.length) (w.document as any).adoptedStyleSheets = adoptable;
      } catch { /* ignore */ }

      // Also clone any <link rel="stylesheet"> from the parent head (CDN fonts)
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach((node) => {
        const link = w.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = (node as HTMLLinkElement).href;
        w.document.head.appendChild(link);
      });

      // Copy CSS variables from :root so dark/light theme tokens still resolve
      const rootStyle = getComputedStyle(document.documentElement);
      const rootDecls: string[] = [];
      for (let i = 0; i < rootStyle.length; i += 1) {
        const prop = rootStyle.item(i);
        if (prop.startsWith('--')) {
          rootDecls.push(`${prop}: ${rootStyle.getPropertyValue(prop)};`);
        }
      }
      if (rootDecls.length) {
        const varStyle = w.document.createElement('style');
        varStyle.textContent = `:root, html, body { ${rootDecls.join(' ')} }`;
        w.document.head.appendChild(varStyle);
      }

      // Inherit body theme from parent
      const cs = getComputedStyle(document.body);
      w.document.body.style.background = cs.background || '#0a0a0a';
      w.document.body.style.color = cs.color || '#fff';
      w.document.body.style.fontFamily = cs.fontFamily;

      // Mount the React root container ABOVE the splash so when React paints,
      // its content visually covers the splash. (We don't remove the splash —
      // simpler, and the splash is never seen again once content paints.)
      const root = w.document.createElement('div');
      root.id = 'robin-pip-root';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.zIndex = '10';
      w.document.body.appendChild(root);

      // Closing the PiP resets state.
      w.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipContainer(null);
      });

      pipWindowRef.current = w;
      setPipContainer(root);

      // Splash auto-hide. The portal SHOULD paint over the splash via its
      // higher z-index, but if anything goes wrong (LiveKit stall, render
      // error, etc.) we don't want the user staring at "Loading…" forever.
      // After 5s we hide the splash unconditionally — at worst they see
      // their dark theme body until things recover.
      setTimeout(() => {
        try {
          const splash = w.document.getElementById('robin-pip-splash');
          if (splash) splash.style.display = 'none';
        } catch { /* PiP may have been closed already */ }
      }, 5000);
    } catch (e) {
      // Release the lock on failure so a future click can try again.
      pipWindowRef.current = null;
      console.warn('[huddle] PiP open failed', e);
    }
  }, [pipSupported]);

  const closePiP = useCallback(() => {
    try { pipWindowRef.current?.close(); } catch { /* ignore */ }
    pipWindowRef.current = null;
    setPipContainer(null);
  }, []);

  // ── Wire mode <-> meeting lifecycle ─────────────────────────────────────
  // join() flips mode to 'joining' which triggers meeting.joinMeeting() below.
  // It ALSO opens the PiP window if auto-pop is enabled — this MUST happen
  // synchronously inside the click handler so the browser sees a valid user
  // activation. (Open later in a useEffect → "Transient activation required".)
  const join = useCallback(() => {
    setMode(m => (m === 'idle' ? 'joining' : m));
    if (pipAutoEnabled && pipSupported && !pipWindowRef.current) {
      // Fire-and-forget; the click activation flows into requestWindow.
      void openPiP();
    }
  }, [pipAutoEnabled, pipSupported, openPiP]);

  const leave = useCallback(() => {
    meeting.leaveMeeting();
    setMode('idle');
    closePiP();
  }, [meeting, closePiP]);
  const collapse = useCallback(() => setMode(m => (m === 'expanded' ? 'collapsed' : m)), []);
  const expand   = useCallback(() => setMode(m => (m === 'collapsed' || m === 'joining' ? 'expanded' : m)), []);

  useEffect(() => {
    if (mode === 'joining' && !meeting.joined && !meeting.joining) {
      meeting.joinMeeting();
    }
  }, [mode, meeting.joined, meeting.joining, meeting]);

  // Once useMeetingRoom is fully joined, flip to expanded so the panel shows.
  useEffect(() => {
    if (meeting.joined && (mode === 'idle' || mode === 'joining')) {
      setMode('expanded');
    }
  }, [meeting.joined, mode]);

  // ── Auto-pop PiP when user leaves the Robin tab ────────────────────────
  // The user is in a huddle and switches to another app/tab — we want
  // the floating mini panel to be there. The Document PiP API requires
  // user activation, but Chrome relaxes this for pages the user has
  // recently interacted with, so we just *try* and silently swallow
  // any rejection. Worst case: nothing happens, user can manually
  // re-pop it from the dashboard.
  useEffect(() => {
    if (!pipSupported || !pipAutoEnabled) return;
    if (!meeting.joined) return;

    const tryAutoPop = () => {
      // Only when document is hidden (user tabbed away or minimised).
      if (document.visibilityState !== 'hidden') return;
      // Already open? Nothing to do.
      if (pipWindowRef.current) return;
      void openPiP();
    };

    document.addEventListener('visibilitychange', tryAutoPop);
    window.addEventListener('blur', tryAutoPop);
    return () => {
      document.removeEventListener('visibilitychange', tryAutoPop);
      window.removeEventListener('blur', tryAutoPop);
    };
  }, [pipSupported, pipAutoEnabled, meeting.joined, openPiP]);

  // Auto-share screen on join — only for employees and sales (the people
  // expected to be "on the floor"). Admins/managers join to oversee, not
  // to share their own screen by default; they can still toggle manually.
  const autoSharedThisJoinRef = useRef(false);
  useEffect(() => {
    if (!meeting.joined) {
      autoSharedThisJoinRef.current = false;
      return;
    }
    if (autoSharedThisJoinRef.current) return;
    if (meeting.screenOn) { autoSharedThisJoinRef.current = true; return; }
    // Admins are NOT auto-prompted — they're observers by default.
    if (role === 'admin') { autoSharedThisJoinRef.current = true; return; }
    autoSharedThisJoinRef.current = true;
    const t = setTimeout(() => {
      try { meeting.toggleScreen(); } catch { /* user can still trigger manually */ }
    }, 600);
    return () => clearTimeout(t);
  }, [meeting.joined, meeting.screenOn, meeting.toggleScreen, role]);

  const participantCount = meeting.peers.length + (meeting.joined ? 1 : 0);

  // ── AI Scribe ──────────────────────────────────────────────────────────
  // Browser Web Speech API listens to the user's mic while they're in the
  // huddle, transcribes their speech for free, and posts batched lines to
  // the server. End-of-day cron uses these to extract action items.
  // Currently OFF — flip `enabled` to `meeting.joined` to turn the agent on.
  const transcript = useHuddleTranscription({
    enabled: false,
    roomId:  'agency-global',
    language: 'en-IN',
  });

  const value = useMemo<HuddleApi>(() => ({
    mode, join, leave, collapse, expand,
    joined:        meeting.joined,
    joining:       meeting.joining,
    peers:         meeting.peers,
    localStream:   meeting.localStream,
    audioOn:       meeting.audioOn,
    screenOn:      meeting.screenOn,
    meetingError:  meeting.error,
    networkBlocked:meeting.networkBlocked,
    iceMeta:       meeting.iceMeta,
    participantCount,
    toggleAudio:   meeting.toggleAudio,
    toggleScreen:  meeting.toggleScreen,
    scribe: {
      supported:    transcript.supported,
      listening:    transcript.listening,
      lastError:    transcript.lastError,
      linesPosted:  transcript.linesPosted,
    },
    pip: {
      supported:    pipSupported,
      isOpen:       !!pipContainer,
      container:    pipContainer,
      open:         openPiP,
      close:        closePiP,
      autoEnabled:  pipAutoEnabled,
      setAutoEnabled: setPipAutoEnabled,
    },
  }), [
    mode, join, leave, collapse, expand,
    meeting.joined, meeting.joining, meeting.peers, meeting.localStream,
    meeting.audioOn, meeting.screenOn, meeting.error, meeting.networkBlocked,
    meeting.iceMeta, meeting.toggleAudio, meeting.toggleScreen,
    participantCount,
    transcript.supported, transcript.listening, transcript.lastError, transcript.linesPosted,
    pipSupported, pipContainer, openPiP, closePiP, pipAutoEnabled, setPipAutoEnabled,
  ]);

  return (
    <HuddleContext.Provider value={value}>
      {children}
      {/* PiP portal lives at the provider level so the floating window has
          content the moment it opens — independent of where in the React
          tree the user happens to be. Was previously inside HuddleMicPiP
          which is gated on huddle.joined, so a slow LiveKit handshake left
          the PiP stuck on the loading splash. */}
      {pipContainer && createPortal(<HuddlePiPContent />, pipContainer)}
    </HuddleContext.Provider>
  );
}

export function useHuddle(): HuddleApi {
  const ctx = useContext(HuddleContext);
  if (!ctx) throw new Error('useHuddle must be used inside HuddleProvider');
  return ctx;
}
