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
import { logShareEvent } from '@/lib/screenShareDebug';

// Dev-only debug logger. In production these are no-ops — the ~10 calls
// per huddle session were filling clients' DevTools consoles with chatter
// that wasn't actionable for them. Vite inlines `import.meta.env.DEV` to
// a literal at build time, so this also gets dead-code-eliminated.
const log = import.meta.env.DEV
  ? (...args: any[]) => console.log('[huddle]', ...args)
  : (..._args: any[]) => { /* no-op in prod */ };

// LiveKit URL is provided by the server alongside the JWT (see
// /api/huddle/token). We deliberately don't read it from Vite env vars
// because they're fragile across Vercel cache / build configs. The
// server (Render) injects LIVEKIT_URL at runtime and returns it on
// every token request.

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
  // Remote-audio output volume (0..1). Driven by the deafen toggle.
  // We keep it in a ref because TrackSubscribed handlers need the latest
  // value without re-creating themselves on every render.
  const remoteVolumeRef = useRef<number>(1);

  const [joined, setJoined]       = useState(false);
  const [joining, setJoining]     = useState(false);
  const [audioOn, setAudioOn]     = useState(false);
  const [screenOn, setScreenOn]   = useState(false);
  // Mirror `screenOn` in a ref so the LiveKit ConnectionStateChanged
  // listener (declared once at join time, never re-created) can read
  // the LATEST value when it fires on reconnect. Without this we'd
  // capture the value-at-join, which is always false.
  const screenOnRef = useRef(false);
  useEffect(() => { screenOnRef.current = screenOn; }, [screenOn]);
  const [peers, setPeers]         = useState<Record<string, PeerView>>({});
  const [error, setError]         = useState<string | null>(null);
  const [networkBlocked, setNetworkBlocked] = useState(false);

  /**
   * Apply a volume level (0..1) to every currently subscribed remote audio
   * track in the room. Call this when toggling deafen, or pass a value to
   * apply right now without changing the ref.
   *
   * LiveKit's RemoteAudioTrack.setVolume() controls the volume of the
   * <audio> element it auto-attaches to the document. setting 0 silences
   * the participant on this client without unsubscribing — they still see
   * us connected, we still receive the data, we just don't play it.
   */
  const setRemoteAudioVolume = useCallback((volume: number) => {
    remoteVolumeRef.current = volume;
    const room = roomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        const track: any = pub.track;
        if (track && typeof track.setVolume === 'function') {
          try { track.setVolume(volume); } catch { /* ignore */ }
        }
      });
    });
  }, []);
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
      // ── Safari mic-permission warm-up ────────────────────────────────
      // Safari ties getUserMedia() to the user-activation token of the
      // originating click. Once the LiveKit SDK eventually asks for the
      // mic (after JWT fetch + room.connect + first audio publish), the
      // activation is long gone and Safari silently drops the prompt.
      //
      // Doing this INSIDE joinMeeting (not the click handler) means we
      // hit the API before LiveKit does, so they don't race over the
      // audio device. The earlier "click handler prime" version raced
      // with LiveKit and hung every browser at "Connecting…".
      //
      // Gated to Safari only — Chrome/Firefox handle the delayed prompt
      // just fine and adding this for them was the source of the hang.
      try {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        const isSafari =
          /^((?!chrome|crios|fxios|edg|android).)*safari/i.test(ua) &&
          /apple/i.test(navigator.vendor || '');
        if (isSafari && navigator.mediaDevices?.getUserMedia) {
          const warmUp = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Release the warm-up tracks immediately — LiveKit will request
          // its own mic stream when it publishes audio, and now Safari
          // already has the permission grant in its store.
          warmUp.getTracks().forEach(t => t.stop());
        }
      } catch (warmupErr) {
        // User denied OR no mic — not fatal. Let LiveKit try; if it
        // fails it'll surface a clearer error in `setError` below.
        log('safari mic warm-up declined/failed', (warmupErr as Error).message);
      }

      log('requesting JWT…');
      const { token, url } = await api.getHuddleToken();
      if (!url || !token) {
        throw new Error('Server did not return a LiveKit URL or token. Set LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET on Render and redeploy the API.');
      }
      log('connecting to', url);

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
        .on(RoomEvent.TrackSubscribed, (track: any, _pub, p) => {
          // Apply the current deafen volume to newly subscribed audio.
          if (track && typeof track.setVolume === 'function' && (track.kind === 'audio' || track.source === Track.Source.Microphone)) {
            try { track.setVolume(remoteVolumeRef.current); } catch { /* ignore */ }
          }
          refreshPeer(p);
        })
        .on(RoomEvent.TrackUnsubscribed,       (_t, _pub, p) => refreshPeer(p))
        .on(RoomEvent.TrackMuted,              (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.TrackUnmuted,            (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.LocalTrackPublished,     () => syncLocal(room.localParticipant))
        .on(RoomEvent.LocalTrackUnpublished,   () => syncLocal(room.localParticipant))
        .on(RoomEvent.ConnectionStateChanged,  (state) => {
          log('connection', state);
          logShareEvent('note', `livekit connection=${state}`);
          if (state === ConnectionState.Disconnected) {
            setNetworkBlocked(false);
          }
          // ── Re-publish screen share after LiveKit reconnects ─────────
          // When the room comes back online (TCP/UDP fluctuation, server
          // restart on Render, etc.), check whether we WERE sharing before
          // the drop. LiveKit's SDK auto-resubscribes remote tracks, but
          // LOCAL screen-share publications are sometimes lost when the
          // SFU session is re-established. We re-publish iff our React
          // state says we were sharing and no current ScreenShare pub
          // exists post-reconnect.
          if (state === ConnectionState.Connected) {
            try {
              const lp = room.localParticipant;
              const hasScreenPub = Array.from(lp.videoTrackPublications.values())
                .some(p => p.source === Track.Source.ScreenShare);
              if (screenOnRef.current && !hasScreenPub) {
                logShareEvent('livekit-reconnect-republish', 'screen pub missing after reconnect — re-publishing');
                lp.setScreenShareEnabled(true).catch((e) => {
                  logShareEvent('error', 'livekit re-publish failed', { message: e?.message });
                });
              }
            } catch { /* ignore */ }
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

      // ── Defensive connect timeout ────────────────────────────────────
      // LiveKit's room.connect() has no built-in timeout. If the WebSocket
      // upgrade succeeds but ICE / DTLS hangs (NAT, picky corporate
      // firewall, half-broken proxy), the promise never resolves or
      // rejects — so the UI sits forever at "Connecting…". Race it
      // against a 15-second timer so the user gets a real error instead.
      const connectWithTimeout = (timeoutMs: number) => new Promise<void>((resolve, reject) => {
        let settled = false;
        const t = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { room.disconnect(true); } catch { /* ignore */ }
          reject(new Error(`Huddle connect timed out after ${Math.round(timeoutMs / 1000)}s. Your network may be blocking WebRTC — try a different connection (mobile hotspot) and retry.`));
        }, timeoutMs);
        room.connect(url, token).then(
          () => { if (settled) return; settled = true; clearTimeout(t); resolve(); },
          (err) => { if (settled) return; settled = true; clearTimeout(t); reject(err); },
        );
      });
      await connectWithTimeout(15_000);
      log('connected as', room.localParticipant.identity);

      // Hydrate existing remote participants (those who joined before us).
      room.remoteParticipants.forEach(refreshPeer);
      syncLocal(room.localParticipant);

      // Apply current deafen state to existing tracks.
      setRemoteAudioVolume(remoteVolumeRef.current);

      setJoined(true);
    } catch (e: any) {
      // Translate the common failure modes into copy that points at a real
      // remedy. Generic "Error" pills used to send people to support when
      // the answer was "wait 1 min" or "wake the server".
      const raw = e?.message || '';
      let msg = e?.message || 'Could not join the huddle';
      const status = e?.response?.status;
      if (status === 429 || /Too Many Requests|429/i.test(raw)) {
        msg = 'LiveKit Cloud rate limited too many connect attempts. Wait ~1 minute and try again.';
      } else if (status === 401 || status === 403) {
        msg = 'Your session may have expired — sign out and back in, then try the huddle again.';
      } else if (e?.code === 'ECONNABORTED' || /timeout/i.test(raw)) {
        msg = 'The Robin API didn\'t respond — server may be redeploying. Wait ~30 seconds and retry.';
      } else if (/Failed to fetch|Network Error|ERR_NETWORK/i.test(raw)) {
        msg = 'No connection to the Robin API. Check your internet, then retry.';
      }
      log('joinMeeting failed:', msg, { rawMessage: raw, status });
      setError(msg);
      // Drop any partially-initialised room so the next attempt starts fresh.
      try { roomRef.current?.disconnect(true); } catch { /* ignore */ }
      roomRef.current = null;
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
    logShareEvent('note', `livekit toggleScreen → ${next}`);
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
      logShareEvent('note', `livekit screen share=${next}`);
    } catch (e: any) {
      // User cancelled the screen picker — silent in console, recorded in
      // the share-event ring so support can see why.
      log('toggleScreen failed/cancelled', e);
      logShareEvent('error', `livekit toggleScreen failed`, { message: e?.message });
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
    setRemoteAudioVolume,
  };
}

function safeJsonRole(metadata?: string): string | undefined {
  if (!metadata) return undefined;
  try { return JSON.parse(metadata).role; } catch { return undefined; }
}
