import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Room, RoomEvent, Track, RemoteParticipant,
} from 'livekit-client';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * ClientMeetingContext
 *
 * Holds the live LiveKit room for the host's client-meeting page. Mounted
 * at App level (above the router) so the room — and the hidden audio
 * elements rendered via portal — survive route changes. Previously the
 * room lived inside MeetHost.tsx, so navigating to /tasks (or any sidebar
 * link) unmounted the page, called disconnect(), and the host was kicked
 * out mid-call with the guest still talking.
 *
 * Three things this context provides:
 *
 *   1. Persistent connection — joining is sticky. The room stays connected
 *      as the user navigates around Robin; only an explicit leave() /
 *      endMeeting() drops it.
 *   2. Persistent audio playback — remote-audio <audio> elements are
 *      rendered via portal into document.body, never inside the route
 *      subtree. They play continuously regardless of which page is open.
 *   3. Clean handoff — MeetHost reads from this context (peers, audioOn,
 *      etc.) instead of managing its own room.
 *
 * Pair with <ClientMeetingDock /> in AppLayout to give the user a visible
 * "still in a meeting" pill they can click to return to MeetHost.
 */

interface Peer {
  identity: string;
  name: string;
  role: 'host' | 'guest';
  audioOn: boolean;
  screenOn: boolean;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
}

interface ClientMeetingApi {
  // State
  active:   boolean;             // true while a room exists, regardless of joined state
  meeting:  any | null;          // metadata from /api/client-meetings/mine
  joined:   boolean;
  joining:  boolean;
  peers:    Record<string, Peer>;
  audioOn:  boolean;
  screenOn: boolean;
  error:    string | null;
  // Was audio playback blocked by the browser's autoplay policy?
  // Surface this so the UI can show a "Click to enable audio" prompt.
  audioBlocked: boolean;

  // Actions
  joinAs:        (slug: string) => Promise<void>;
  leave:         () => Promise<void>;
  toggleMic:     () => Promise<void>;
  toggleScreen:  () => Promise<void>;
  endMeeting:    () => Promise<void>;
  extendMeeting: () => Promise<void>;
  unblockAudio:  () => void;
}

const Ctx = createContext<ClientMeetingApi | null>(null);

export function ClientMeetingProvider({ children }: { children: ReactNode }) {
  const roomRef       = useRef<Room | null>(null);
  const currentSlugRef = useRef<string | null>(null);
  const [meeting, setMeeting]   = useState<any>(null);
  const [peers, setPeers]       = useState<Record<string, Peer>>({});
  const [audioOn, setAudioOn]   = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [joined, setJoined]     = useState(false);
  const [joining, setJoining]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // ── Build a serialisable Peer from a LiveKit RemoteParticipant ──────
  const buildPeer = (p: RemoteParticipant): Peer => {
    const audio  = new MediaStream();
    const screen = new MediaStream();
    let aOn = false; let sOn = false;
    p.audioTrackPublications.forEach(pub => {
      if (pub.track && pub.isSubscribed) {
        if (pub.track.mediaStreamTrack) audio.addTrack(pub.track.mediaStreamTrack);
        if (!pub.isMuted) aOn = true;
      }
    });
    p.videoTrackPublications.forEach(pub => {
      if (pub.source === Track.Source.ScreenShare && pub.track && pub.isSubscribed) {
        if (pub.track.mediaStreamTrack) screen.addTrack(pub.track.mediaStreamTrack);
        sOn = true;
      }
    });
    let role: 'host' | 'guest' = 'guest';
    try { if (p.metadata) role = JSON.parse(p.metadata).role || 'guest'; } catch { /* ignore */ }
    return {
      identity: p.identity,
      name: p.name || 'Guest',
      role,
      audioOn: aOn,
      screenOn: sOn,
      audioStream: audio.getAudioTracks().length ? audio : undefined,
      screenStream: screen.getVideoTracks().length ? screen : undefined,
    };
  };

  // ── Join a meeting by slug ──────────────────────────────────────────
  const joinAs = useCallback(async (slug: string) => {
    // Already in THIS meeting? No-op (idempotent for re-mount of MeetHost).
    if (currentSlugRef.current === slug && roomRef.current) return;
    // Joining a DIFFERENT meeting while in one? Disconnect the old room first.
    if (roomRef.current && currentSlugRef.current !== slug) {
      try { roomRef.current.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
      setPeers({}); setJoined(false); setAudioOn(false); setScreenOn(false);
    }

    setJoining(true);
    setError(null);
    try {
      const t = await api.clientMeetingsHostToken(slug);
      const list = await api.clientMeetingsMine();
      const m = list.find((x: any) => x.slug === slug);
      setMeeting(m);
      currentSlugRef.current = slug;

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const refresh = (p: RemoteParticipant) => setPeers(prev => ({ ...prev, [p.identity]: buildPeer(p) }));
      const drop    = (id: string)            => setPeers(prev => { const n = { ...prev }; delete n[id]; return n; });

      room
        .on(RoomEvent.ParticipantConnected,    refresh)
        .on(RoomEvent.ParticipantDisconnected, p => drop(p.identity))
        .on(RoomEvent.TrackSubscribed,         (_t, _pub, p) => refresh(p))
        .on(RoomEvent.TrackUnsubscribed,       (_t, _pub, p) => refresh(p))
        .on(RoomEvent.TrackMuted,              (_pub, p) => p.isLocal ? null : refresh(p as RemoteParticipant))
        .on(RoomEvent.TrackUnmuted,            (_pub, p) => p.isLocal ? null : refresh(p as RemoteParticipant))
        .on(RoomEvent.Disconnected,            () => {
          setJoined(false); setPeers({}); setAudioOn(false); setScreenOn(false);
          currentSlugRef.current = null;
          roomRef.current = null;
        })
        .on(RoomEvent.MediaDevicesError, (err) => {
          // Captured permission failures bubble up here. Surface to user.
          toast.error('Microphone error', { description: String((err as any)?.message || err) });
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          // Chrome's autoplay block. canPlaybackAudio is false until the
          // user provides a gesture. Surface a banner so the UI can prompt.
          setAudioBlocked(!room.canPlaybackAudio);
        });

      await room.connect(t.url, t.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setAudioOn(true);
      room.remoteParticipants.forEach(refresh);
      setJoined(true);
      // Immediately try to start audio — surfaces autoplay block on first
      // join too, not just on later track-subscribe.
      try { await room.startAudio(); setAudioBlocked(false); }
      catch { setAudioBlocked(!room.canPlaybackAudio); }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not join the meeting');
      roomRef.current = null;
      currentSlugRef.current = null;
    } finally {
      setJoining(false);
    }
  }, []);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    currentSlugRef.current = null;
    if (room) { try { room.disconnect(); } catch { /* ignore */ } }
    setPeers({}); setAudioOn(false); setScreenOn(false);
    setJoined(false); setMeeting(null); setAudioBlocked(false);
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current; if (!room) return;
    const next = !audioOn;
    try { await room.localParticipant.setMicrophoneEnabled(next); setAudioOn(next); }
    catch (e: any) { toast.error('Could not toggle mic', { description: e?.message }); }
  }, [audioOn]);

  const toggleScreen = useCallback(async () => {
    const room = roomRef.current; if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!screenOn);
      setScreenOn(!screenOn);
    } catch { /* user cancelled the picker */ }
  }, [screenOn]);

  const endMeeting = useCallback(async () => {
    const slug = currentSlugRef.current;
    if (!slug) return;
    if (!confirm('End this meeting now? Anyone still on the link will be disconnected.')) return;
    try {
      await api.clientMeetingsEnd(slug);
      await leave();
      toast.success('Meeting ended');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not end meeting');
    }
  }, [leave]);

  const extendMeeting = useCallback(async () => {
    const slug = currentSlugRef.current;
    if (!slug) return;
    try {
      const r = await api.clientMeetingsExtend(slug);
      toast.success(`Extended — duration cap is now ${r.maxDurationMinutes} min`);
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not extend'); }
  }, []);

  // ── Unblock audio (run inside a user click) ─────────────────────────
  const unblockAudio = useCallback(() => {
    const room = roomRef.current; if (!room) return;
    room.startAudio()
      .then(() => setAudioBlocked(false))
      .catch(() => { /* will retry on next user gesture */ });
  }, []);

  // ── Render hidden audio elements via PORTAL into document.body ──────
  // Anchoring outside the React route subtree means they never unmount
  // on navigation. Without this, switching tabs killed the audio elements
  // and the user heard silence even though the room was technically alive.
  //
  // data-meeting-audio="client" tags every element so the huddle's
  // "Mute team audio" (deafen) sweep can SKIP these — deafening the
  // workroom huddle must NOT silence the live client call. See
  // HuddleContext's muteAll effect for the matching exclusion.
  const audioPortal = typeof document !== 'undefined' ? createPortal(
    <div
      aria-hidden
      data-meeting-audio="client"
      style={{ position: 'fixed', width: 1, height: 1, left: -9999, top: -9999, pointerEvents: 'none' }}
    >
      {Object.values(peers).map(p => p.audioStream ? (
        <PersistentAudio key={`a-${p.identity}`} stream={p.audioStream} />
      ) : null)}
    </div>,
    document.body,
  ) : null;

  return (
    <Ctx.Provider value={{
      active: !!roomRef.current,
      meeting, joined, joining, peers, audioOn, screenOn, error, audioBlocked,
      joinAs, leave, toggleMic, toggleScreen, endMeeting, extendMeeting, unblockAudio,
    }}>
      {children}
      {audioPortal}
    </Ctx.Provider>
  );
}

export function useClientMeeting() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useClientMeeting must be used inside ClientMeetingProvider');
  return ctx;
}

// Hidden audio element that re-attaches stream on change. Lives in the
// portal so navigation doesn't unmount it.
function PersistentAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => { /* autoplay may be blocked — handled by AudioPlaybackStatusChanged */ });
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}
