import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import { useAuth } from '@/contexts/AuthContext';
import { useHuddleTranscription } from '@/hooks/useHuddleTranscription';
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
    try {
      const w = await (window as any).documentPictureInPicture.requestWindow({
        width: 360,
        height: 540,
      });

      // Copy parent stylesheets so Tailwind classes render inside the PiP DOM.
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const css = Array.from(sheet.cssRules || []).map((r: any) => r.cssText).join('\n');
          if (css) {
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

      const root = w.document.createElement('div');
      root.id = 'robin-pip-root';
      w.document.body.appendChild(root);

      const cs = getComputedStyle(document.body);
      w.document.body.style.background = cs.background || '#0a0a0a';
      w.document.body.style.color = cs.color || '#fff';
      w.document.body.style.margin = '0';
      w.document.body.style.fontFamily = cs.fontFamily;
      w.document.title = 'Robin Huddle';

      // The user closing the PiP window should reset state.
      w.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipContainer(null);
      });

      pipWindowRef.current = w;
      setPipContainer(root);
    } catch (e) {
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

  return <HuddleContext.Provider value={value}>{children}</HuddleContext.Provider>;
}

export function useHuddle(): HuddleApi {
  const ctx = useContext(HuddleContext);
  if (!ctx) throw new Error('useHuddle must be used inside HuddleProvider');
  return ctx;
}
