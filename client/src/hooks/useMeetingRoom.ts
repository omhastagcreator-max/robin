import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  RemoteTrackPublication,
  LocalParticipant,
  ConnectionState,
} from 'livekit-client';
import * as api from '@/api';

const LIVEKIT_URL = (import.meta as any).env?.VITE_LIVEKIT_URL || '';

const log = (...args: any[]) => console.log('[huddle]', ...args);

// Make the env state observable from the browser console at load time —
// users can also just type `import.meta.env.VITE_LIVEKIT_URL` to inspect.
// eslint-disable-next-line no-console
console.log('[huddle] env at load:', {
  VITE_LIVEKIT_URL: LIVEKIT_URL || '(empty — set it on Vercel + redeploy without cache)',
});

export interface MeetingParticipant {
  userId: string;
  name?: string;
  role?: string;
}

export interface PeerView {
  userId: string;
  name?: string;
  role?: string;
  /** A MediaStream we synthesise from this peer's audio + screen tracks. */
  stream: MediaStream;
  audioOn: boolean;
  screenOn: boolean;
}

interface UseMeetingRoomOptions {
  userId: string;
  userName?: string;
  userRole?: string;
  /** Ignored — LiveKit room is derived server-side from the user's org. */
  roomId?: string;
}

/**
 * Audio + screen-share huddle, powered by LiveKit Cloud.
 *
 * Why LiveKit and not the mesh we had before:
 *   - Their SFU + global TURN handle every NAT we encountered.
 *   - Audio echo cancellation, reconnection, codec selection — done for us.
 *   - Free tier (50 GB / mo, 100 concurrent) covers an agency forever.
 *
 * The hook keeps the SAME external interface we had with the mesh
 * implementation, so HuddleStage, HuddleDock and HuddleQuickPill don't
 * need to change. Internally we manage a single livekit-client `Room`
 * and translate its events into the same `peers / audioOn / screenOn`
 * shape we used before.
 */
export function useMeetingRoom(_opts: UseMeetingRoomOptions) {
  const roomRef = useRef<Room | null>(null);

  const [joined, setJoined]       = useState(false);
  const [joining, setJoining]     = useState(false);
  const [audioOn, setAudioOn]     = useState(false);
  const [screenOn, setScreenOn]   = useState(false);
  const [peers, setPeers]         = useState<Record<string, PeerView>>({});
  const [error, setError]         = useState<string | null>(null);
  const [networkBlocked, setNetworkBlocked] = useState(false);
  // The user's OWN screen-share stream while they're presenting (so the
  // self-screen-preview tile in HuddleStage has something to render).
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Diagnostic compatibility — LiveKit handles ICE itself; we just record
  // that we're using it so the UI strip can confirm config is loaded.
  const iceMeta = { source: 'livekit' as any, count: 1 };

  // ── Build a PeerView from a LiveKit RemoteParticipant ───────────────────
  const buildPeerView = useCallback((p: RemoteParticipant): PeerView => {
    const stream = new MediaStream();
    let audioOn = false;
    let screenOn = false;

    p.audioTrackPublications.forEach(pub => {
      if (pub.track && pub.isSubscribed) {
        const ms = pub.track.mediaStreamTrack;
        if (ms) stream.addTrack(ms);
        if (!pub.isMuted) audioOn = true;
      }
    });

    p.videoTrackPublications.forEach(pub => {
      if (pub.source === Track.Source.ScreenShare && pub.track && pub.isSubscribed) {
        const ms = pub.track.mediaStreamTrack;
        if (ms) stream.addTrack(ms);
        screenOn = true;
      }
    });

    return {
      userId: p.identity,
      name:   p.name || p.identity,
      role:   safeJsonRole(p.metadata),
      stream,
      audioOn,
      screenOn,
    };
  }, []);

  const refreshPeer = useCallback((p: RemoteParticipant) => {
    setPeers(prev => ({ ...prev, [p.identity]: buildPeerView(p) }));
  }, [buildPeerView]);

  const dropPeer = useCallback((identity: string) => {
    setPeers(prev => {
      const n = { ...prev };
      delete n[identity];
      return n;
    });
  }, []);

  // ── Public: join ────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    if (joined || joining) return;
    setError(null);
    setJoining(true);
    try {
      if (!LIVEKIT_URL) {
        throw new Error(
          'Huddle not configured: VITE_LIVEKIT_URL is empty in the bundle. ' +
          'On Vercel → Settings → Environment Variables, confirm the variable is named exactly VITE_LIVEKIT_URL ' +
          '(VITE_ prefix is mandatory) and is enabled for Production. Then Deployments → Redeploy WITHOUT "Use existing Build Cache".'
        );
      }
      log('requesting JWT…');
      const { token } = await api.getHuddleToken();
      log('connecting to', LIVEKIT_URL);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // ── Wire up events ────────────────────────────────────────────────
      const onParticipantChange = (p: RemoteParticipant) => refreshPeer(p);

      room
        .on(RoomEvent.ParticipantConnected,    onParticipantChange)
        .on(RoomEvent.ParticipantDisconnected, p => dropPeer(p.identity))
        .on(RoomEvent.TrackSubscribed,         (_t, _pub, p) => refreshPeer(p))
        .on(RoomEvent.TrackUnsubscribed,       (_t, _pub, p) => refreshPeer(p))
        .on(RoomEvent.TrackMuted,              (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.TrackUnmuted,            (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.LocalTrackPublished,     () => syncLocal(room.localParticipant))
        .on(RoomEvent.LocalTrackUnpublished,   () => syncLocal(room.localParticipant))
        .on(RoomEvent.ConnectionStateChanged,  (state) => {
          log('connection', state);
          if (state === ConnectionState.Disconnected) {
            setNetworkBlocked(false);
          }
        })
        .on(RoomEvent.Disconnected,            () => {
          log('disconnected');
          setJoined(false);
          setPeers({});
        });

      const syncLocal = (lp: LocalParticipant) => {
        const audioPub  = Array.from(lp.audioTrackPublications.values()).find(p => p.source === Track.Source.Microphone);
        const screenPub = Array.from(lp.videoTrackPublications.values()).find(p => p.source === Track.Source.ScreenShare);
        setAudioOn(!!(audioPub && !audioPub.isMuted));
        setScreenOn(!!screenPub);
        // Build a self-stream containing the screen track (when sharing) so
        // HuddleStage's self-preview tile has something to render.
        if (screenPub?.track) {
          const ms = new MediaStream([screenPub.track.mediaStreamTrack]);
          setLocalStream(ms);
        } else {
          setLocalStream(null);
        }
      };

      await room.connect(LIVEKIT_URL, token);
      log('connected as', room.localParticipant.identity);

      // Hydrate existing remote participants (those who joined before us).
      room.remoteParticipants.forEach(refreshPeer);
      syncLocal(room.localParticipant);

      setJoined(true);
    } catch (e: any) {
      const msg = e?.message || 'Could not join the huddle';
      log('joinMeeting failed:', msg);
      setError(msg);
    } finally {
      setJoining(false);
    }
  }, [joined, joining, refreshPeer, dropPeer]);

  const leaveMeeting = useCallback(() => {
    log('leaveMeeting');
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try { room.disconnect(true); } catch { /* ignore */ }
    }
    setPeers({});
    setAudioOn(false);
    setScreenOn(false);
    setJoined(false);
    setNetworkBlocked(false);
  }, []);

  const toggleAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !audioOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setAudioOn(next);
    } catch (e) { log('toggleAudio failed', e); }
  }, [audioOn]);

  const toggleScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !screenOn;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
    } catch (e) {
      // User cancelled the screen picker — silent.
      log('toggleScreen failed/cancelled', e);
    }
  }, [screenOn]);

  // Cleanup on unmount.
  useEffect(() => () => { leaveMeeting(); }, []); // eslint-disable-line

  return {
    joined,
    joining,
    peers: Object.values(peers),
    localStream,
    audioOn,
    screenOn,
    error,
    networkBlocked,
    iceMeta,
    joinMeeting,
    leaveMeeting,
    toggleAudio,
    toggleScreen,
  };
}

function safeJsonRole(metadata?: string): string | undefined {
  if (!metadata) return undefined;
  try { return JSON.parse(metadata).role; } catch { return undefined; }
}
