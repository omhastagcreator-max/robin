import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// STUN + free TURN for NAT traversal. Override via VITE_TURN_*.
const TURN_URL  = (import.meta as any).env?.VITE_TURN_URL  || 'turn:openrelay.metered.ca:443';
const TURN_USER = (import.meta as any).env?.VITE_TURN_USERNAME   || 'openrelayproject';
const TURN_PASS = (import.meta as any).env?.VITE_TURN_CREDENTIAL || 'openrelayproject';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: TURN_URL,                                     username: TURN_USER, credential: TURN_PASS },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: TURN_USER, credential: TURN_PASS },
];

const log = (...args: any[]) => console.log('[huddle]', ...args);

export interface MeetingParticipant {
  userId: string;
  name?: string;
  role?: string;
}

export interface PeerView {
  userId: string;
  name?: string;
  role?: string;
  stream: MediaStream;
  audioOn: boolean;
  screenOn: boolean;
}

interface UseMeetingRoomOptions {
  userId: string;
  userName?: string;
  userRole?: string;
  roomId?: string;
}

/**
 * Audio + screen-share mesh meeting room (no camera).
 *
 * Design choices that matter for reliability:
 *
 *   1. ONE MediaStream per peer — both audio and the screen-share video
 *      track live in the SAME outbound stream. If we used separate streams,
 *      receivers' `ontrack` on the second track would surface a different
 *      `e.streams[0]` and our state would drop the audio.
 *
 *   2. Mute via `RTCRtpSender.replaceTrack(null | track)` rather than
 *      flipping `track.enabled`. Some browsers don't resume RTP encoding
 *      when re-enabling a previously-disabled track; replaceTrack always
 *      does the right thing.
 *
 *   3. Audio sender is created up-front (track null until first unmute) so
 *      the SDP m-line for audio exists from the first negotiation.
 *      Screen-share tracks are added/removed live with renegotiation.
 *
 *   4. Console logging at every step (`[huddle] …`) so when something
 *      misbehaves, the browser console shows exactly where.
 */
export function useMeetingRoom({ userId, userName, userRole, roomId = 'agency-global' }: UseMeetingRoomOptions) {
  const socketRef = useRef<Socket | null>(null);

  const audioTrackRef  = useRef<MediaStreamTrack | null>(null);     // The mic track (always alive while joined)
  const screenStreamRef= useRef<MediaStream | null>(null);          // The screen-share MediaStream (or null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);     // The active screen video track (or null)
  const localOutboundRef = useRef<MediaStream | null>(null);        // The "outbound" stream we associate every track with

  // Per-peer state
  const peersRef     = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioSenderByPeer  = useRef<Map<string, RTCRtpSender>>(new Map());
  const screenSenderByPeer = useRef<Map<string, RTCRtpSender>>(new Map());
  const peerInfoRef  = useRef<Map<string, MeetingParticipant>>(new Map());
  const pendingIceRef= useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const [joined, setJoined]   = useState(false);
  const [joining, setJoining] = useState(false);
  const [peers, setPeers]     = useState<Record<string, PeerView>>({});
  const [audioOn, setAudioOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // True when one or more peer connections enter the `failed` state — almost
  // always means TURN is unreachable from the user's network. Surfaces in UI.
  const [networkBlocked, setNetworkBlocked] = useState(false);

  const updatePeer = useCallback((peerId: string, patch: Partial<PeerView>) => {
    setPeers(prev => {
      const existing = prev[peerId];
      const info = peerInfoRef.current.get(peerId);
      const next: PeerView = {
        userId: peerId,
        name:    info?.name ?? existing?.name,
        role:    info?.role ?? existing?.role,
        stream:  patch.stream  || existing?.stream || new MediaStream(),
        audioOn: patch.audioOn  ?? existing?.audioOn  ?? false,
        screenOn:patch.screenOn ?? existing?.screenOn ?? false,
      };
      return { ...prev, [peerId]: next };
    });
  }, []);

  const removePeer = useCallback((peerId: string) => {
    log('removePeer', peerId);
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    audioSenderByPeer.current.delete(peerId);
    screenSenderByPeer.current.delete(peerId);
    peerInfoRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setPeers(prev => { const n = { ...prev }; delete n[peerId]; return n; });
  }, []);

  // Acquire mic up-front. We KEEP the track always — mute is done via
  // sender.replaceTrack(null), not by killing the track.
  const ensureLocalStream = useCallback(async () => {
    if (audioTrackRef.current) return;
    log('requesting mic permission…');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('No microphone available');
    audioTrackRef.current = audioTrack;
    // The "outbound" stream is what we attach every track to. Keeping the
    // same stream across audio + screen makes the receiver see ONE stream.
    localOutboundRef.current = new MediaStream();
    localOutboundRef.current.addTrack(audioTrack);
    log('mic acquired:', audioTrack.label || '(unnamed device)');
  }, []);

  const buildPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    log('buildPeerConnection', peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    // Audio: attach the real mic track so the SDP gets an audio m-line and
    // a usable RTCRtpSender. To honour the current mute state, immediately
    // replaceTrack(null) if the user is muted. We never *kill* the track —
    // mute = transient sender swap, unmute = swap the track back in.
    if (audioTrackRef.current && localOutboundRef.current) {
      const audioSender = pc.addTrack(audioTrackRef.current, localOutboundRef.current);
      audioSenderByPeer.current.set(peerId, audioSender);
      if (!audioOn) {
        audioSender.replaceTrack(null).catch(() => {});
      }
    }

    // If we are already screen-sharing when this peer joins, attach the
    // screen track too — always associated with the same outbound stream.
    if (screenTrackRef.current && localOutboundRef.current) {
      const ss = pc.addTrack(screenTrackRef.current, localOutboundRef.current);
      screenSenderByPeer.current.set(peerId, ss);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('webrtc:ice', { target: peerId, candidate: e.candidate, senderId: userId });
    };

    pc.ontrack = (e) => {
      log('ontrack from', peerId, '— kind', e.track.kind, 'streams', e.streams.length);
      const stream = e.streams[0] || new MediaStream([e.track]);
      updatePeer(peerId, { stream });
    };

    pc.oniceconnectionstatechange = () => {
      log('ice', peerId, '→', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') setNetworkBlocked(true);
    };
    pc.onconnectionstatechange = () => {
      log('conn', peerId, '→', pc.connectionState);
      if (pc.connectionState === 'failed') setNetworkBlocked(true);
    };

    return pc;
  }, [audioOn, updatePeer, userId]);

  // Some TS lib types insist on a real track for addTrack. Workaround:
  // when we don't yet have a real track to attach (user muted), use
  // addTransceiver so an audio m-line still appears in the SDP and we
  // get a sender we can replaceTrack() on later.
  // — Implemented above by passing a placeholder; fall back here if the
  // browser rejects null. Practical browsers (Chromium / Safari / Firefox)
  // accept null so the simpler path works.

  const negotiate = useCallback(async (peerId: string) => {
    const pc = buildPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log('sending offer to', peerId);
    socketRef.current?.emit('webrtc:offer', { target: peerId, offer, senderId: userId });
  }, [buildPeerConnection, userId]);

  const renegotiateAll = useCallback(async () => {
    log('renegotiateAll', peersRef.current.size, 'peers');
    for (const peerId of Array.from(peersRef.current.keys())) {
      const pc = peersRef.current.get(peerId);
      if (!pc) continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc:offer', { target: peerId, offer, senderId: userId });
      } catch (e) { log('renegotiate failed for', peerId, e); }
    }
  }, [userId]);

  // ── Socket setup once joined ─────────────────────────────────────────────
  useEffect(() => {
    if (!joined || !userId) return;

    const socket = io(SOCKET_URL, {
      query: { userId, userName, userRole },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    log('socket connecting…', SOCKET_URL);

    socket.on('connect',    () => log('socket connected:', socket.id));
    socket.on('disconnect', () => log('socket disconnected'));
    socket.emit('meeting:join', { roomId });
    log('emit meeting:join', roomId);

    socket.on('meeting:participants', ({ participants }: { participants: MeetingParticipant[] }) => {
      log('meeting:participants', participants.length);
      participants.forEach(p => {
        if (p.userId === userId) return;
        peerInfoRef.current.set(p.userId, p);
        if (userId < p.userId) negotiate(p.userId);
        else                    buildPeerConnection(p.userId);
      });
    });

    socket.on('meeting:user-joined', (p: MeetingParticipant) => {
      if (p.userId === userId) return;
      log('meeting:user-joined', p.userId);
      peerInfoRef.current.set(p.userId, p);
      if (userId < p.userId) negotiate(p.userId);
    });

    socket.on('meeting:user-left', ({ userId: peerId }: { userId: string }) => {
      removePeer(peerId);
    });

    socket.on('meeting:track-state', ({ userId: peerId, state }: { userId: string; state: any }) => {
      updatePeer(peerId, { audioOn: !!state.audioOn, screenOn: !!state.screenOn });
    });

    socket.on('webrtc:offer', async ({ offer, senderId }: any) => {
      if (!peerInfoRef.current.has(senderId)) { log('offer from unknown peer', senderId, '— ignoring'); return; }
      const pc = buildPeerConnection(senderId);
      try {
        await pc.setRemoteDescription(offer);
        const pending = pendingIceRef.current.get(senderId);
        if (pending) {
          for (const c of pending) await pc.addIceCandidate(c).catch(() => {});
          pendingIceRef.current.delete(senderId);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { target: senderId, answer, adminId: userId });
        log('answered', senderId);
      } catch (e) { log('offer handling failed', senderId, e); }
    });

    socket.on('webrtc:answer', async ({ answer, adminId }: any) => {
      const peerId = adminId;
      const pc = peersRef.current.get(peerId);
      if (pc && answer) {
        try { await pc.setRemoteDescription(answer); log('answer applied for', peerId); }
        catch (e) { log('answer apply failed', peerId, e); }
      }
    });

    socket.on('webrtc:ice', async ({ candidate, senderId }: any) => {
      const pc = peersRef.current.get(senderId);
      if (!pc) return;
      if (!pc.remoteDescription) {
        const list = pendingIceRef.current.get(senderId) || [];
        list.push(candidate); pendingIceRef.current.set(senderId, list);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    });

    return () => {
      socket.emit('meeting:leave', { roomId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joined, userId, userName, userRole, roomId, buildPeerConnection, negotiate, removePeer, updatePeer]);

  // ── Public API ───────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    if (joined || joining) return;
    setError(null);
    setJoining(true);
    try {
      await ensureLocalStream();
      setJoined(true);
    } catch (e: any) {
      const msg = e?.message || 'Could not access microphone';
      log('joinMeeting failed:', msg);
      setError(msg);
    } finally {
      setJoining(false);
    }
  }, [joined, joining, ensureLocalStream]);

  const leaveMeeting = useCallback(() => {
    log('leaveMeeting');
    audioTrackRef.current?.stop();
    audioTrackRef.current = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    localOutboundRef.current = null;
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    audioSenderByPeer.current.clear();
    screenSenderByPeer.current.clear();
    peerInfoRef.current.clear();
    pendingIceRef.current.clear();
    setPeers({});
    setAudioOn(false);
    setScreenOn(false);
    setJoined(false);
  }, []);

  const broadcastTrackState = useCallback((next: { audioOn: boolean; screenOn: boolean }) => {
    socketRef.current?.emit('meeting:track-state', { roomId, state: next });
  }, [roomId]);

  // Mute / unmute via replaceTrack — guarantees RTP encoding restarts.
  const toggleAudio = useCallback(async () => {
    const next = !audioOn;
    const t = audioTrackRef.current;
    if (!t) { log('toggleAudio: no audio track'); return; }
    log('toggleAudio →', next);
    for (const [peerId, sender] of audioSenderByPeer.current) {
      try {
        await sender.replaceTrack(next ? t : null);
      } catch (e) { log('replaceTrack failed for', peerId, e); }
    }
    setAudioOn(next);
    broadcastTrackState({ audioOn: next, screenOn });
  }, [audioOn, screenOn, broadcastTrackState]);

  const startScreenShare = useCallback(async () => {
    if (screenOn) return;
    try {
      log('requesting display media…');
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      const track: MediaStreamTrack = stream.getVideoTracks()[0];
      screenStreamRef.current = stream;
      screenTrackRef.current  = track;

      // Add to outbound stream so receivers see the same stream object.
      if (localOutboundRef.current) localOutboundRef.current.addTrack(track);

      // Add to every peer's PC associated with the outbound stream.
      for (const [peerId, pc] of peersRef.current) {
        const sender = pc.addTrack(track, localOutboundRef.current!);
        screenSenderByPeer.current.set(peerId, sender);
      }

      track.onended = () => stopScreenShare();
      setScreenOn(true);
      broadcastTrackState({ audioOn, screenOn: true });
      await renegotiateAll();
      log('screen share started');
    } catch (e) {
      log('screen share cancelled / failed', e);
    }
  }, [screenOn, audioOn, broadcastTrackState, renegotiateAll]);

  const stopScreenShare = useCallback(async () => {
    if (!screenOn) return;
    log('screen share stopping');
    const track = screenTrackRef.current;
    track?.stop();
    if (track && localOutboundRef.current) {
      try { localOutboundRef.current.removeTrack(track); } catch {}
    }
    screenStreamRef.current = null;
    screenTrackRef.current = null;

    for (const [peerId, sender] of screenSenderByPeer.current) {
      const pc = peersRef.current.get(peerId);
      if (pc && sender) {
        try { pc.removeTrack(sender); } catch (e) { log('removeTrack failed', peerId, e); }
      }
    }
    screenSenderByPeer.current.clear();

    setScreenOn(false);
    broadcastTrackState({ audioOn, screenOn: false });
    await renegotiateAll();
  }, [screenOn, audioOn, broadcastTrackState, renegotiateAll]);

  const toggleScreen = useCallback(() => {
    if (screenOn) stopScreenShare();
    else          startScreenShare();
  }, [screenOn, startScreenShare, stopScreenShare]);

  // Cleanup on unmount
  useEffect(() => () => { leaveMeeting(); }, []); // eslint-disable-line

  return {
    joined,
    joining,
    peers: Object.values(peers),
    localStream: localOutboundRef.current,
    audioOn,
    screenOn,
    error,
    networkBlocked,
    joinMeeting,
    leaveMeeting,
    toggleAudio,
    toggleScreen,
  };
}
