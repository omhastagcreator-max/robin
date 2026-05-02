import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import { useAuth } from '@/contexts/AuthContext';
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

  // ── Wire mode <-> meeting lifecycle ─────────────────────────────────────
  // join() flips mode to 'joining' which triggers meeting.joinMeeting() below.
  const join = useCallback(() => setMode(m => (m === 'idle' ? 'joining' : m)), []);
  const leave = useCallback(() => {
    meeting.leaveMeeting();
    setMode('idle');
  }, [meeting]);
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

  // Auto-share screen the first time someone joins the huddle in a session.
  // Browser shows the screen-picker; user can pick or cancel — either is fine.
  // We track whether we've already auto-prompted to avoid re-firing on every
  // remount (e.g. page navigation while the call is alive).
  const autoSharedThisJoinRef = useRef(false);
  useEffect(() => {
    if (!meeting.joined) {
      autoSharedThisJoinRef.current = false;
      return;
    }
    if (autoSharedThisJoinRef.current) return;
    if (meeting.screenOn) { autoSharedThisJoinRef.current = true; return; }
    autoSharedThisJoinRef.current = true;
    // Small delay so the user sees the join confirmation before the picker
    // opens — feels less abrupt.
    const t = setTimeout(() => {
      try { meeting.toggleScreen(); } catch { /* user can still trigger manually */ }
    }, 600);
    return () => clearTimeout(t);
  }, [meeting.joined, meeting.screenOn, meeting.toggleScreen]);

  const participantCount = meeting.peers.length + (meeting.joined ? 1 : 0);

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
  }), [
    mode, join, leave, collapse, expand,
    meeting.joined, meeting.joining, meeting.peers, meeting.localStream,
    meeting.audioOn, meeting.screenOn, meeting.error, meeting.networkBlocked,
    meeting.iceMeta, meeting.toggleAudio, meeting.toggleScreen,
    participantCount,
  ]);

  return <HuddleContext.Provider value={value}>{children}</HuddleContext.Provider>;
}

export function useHuddle(): HuddleApi {
  const ctx = useContext(HuddleContext);
  if (!ctx) throw new Error('useHuddle must be used inside HuddleProvider');
  return ctx;
}
