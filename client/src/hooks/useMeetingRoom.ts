import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

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
 * Audio + screen-share meeting room (no camera).
 *
 * For a remote agency: people join the universal huddle, talk over mic when
 * needed, and share their screen for collaboration. No video conferencing,
 * no face cameras — keeps bandwidth low and the room feeling "ambient".
 *
 * Mesh WebRTC: each participant maintains 1 RTCPeerConnection per peer.
 * Screen sharing add/removes a video track and manually renegotiates per peer.
 */
export function useMeetingRoom({ userId, userName, userRole, roomId = 'agency-global' }: UseMeetingRoomOptions) {
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerInfoRef = useRef<Map<string, MeetingParticipant>>(new Map());
  // Pending ICE candidates received before remoteDescription was set
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerView>>({});
  const [audioOn, setAudioOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const updatePeer = useCallback((peerId: string, patch: Partial<PeerView>) => {
    setPeers(prev => {
      const existing = prev[peerId];
      if (!existing && !patch.stream) return prev;
      const info = peerInfoRef.current.get(peerId);
      const next: PeerView = {
        userId: peerId,
        name: info?.name,
        role: info?.role,
        stream: patch.stream || existing?.stream || new MediaStream(),
        audioOn:  patch.audioOn  ?? existing?.audioOn  ?? false,
        screenOn: patch.screenOn ?? existing?.screenOn ?? false,
      };
      return { ...prev, [peerId]: next };
    });
  }, []);

  const removePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    pc?.close();
    peersRef.current.delete(peerId);
    peerInfoRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setPeers(prev => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // ── Set up local audio stream lazily on join ─────────────────────────────
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    // Audio only — no camera by design.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Start muted; user opts in via the Mic toggle.
    stream.getAudioTracks().forEach(t => (t.enabled = false));
    localStreamRef.current = stream;
    return stream;
  }, []);

  // ── Build a PC for a specific peer ───────────────────────────────────────
  const buildPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    // Always attach the local audio track on creation
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
    }
    // If we're already sharing screen when this peer is built, attach that too
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => pc.addTrack(t, screenStreamRef.current!));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('webrtc:ice', { target: peerId, candidate: e.candidate, senderId: userId });
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      updatePeer(peerId, { stream });
    };

    return pc;
  }, [updatePeer, userId]);

  const negotiate = useCallback(async (peerId: string) => {
    const pc = buildPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('webrtc:offer', { target: peerId, offer, senderId: userId });
  }, [buildPeerConnection, userId]);

  // Renegotiate every existing peer (called when screen share toggles)
  const renegotiateAll = useCallback(async () => {
    const ids = Array.from(peersRef.current.keys());
    for (const peerId of ids) {
      try {
        const pc = peersRef.current.get(peerId);
        if (!pc) continue;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc:offer', { target: peerId, offer, senderId: userId });
      } catch { /* best-effort */ }
    }
  }, [userId]);

  // ── Socket setup (only while joined) ─────────────────────────────────────
  useEffect(() => {
    if (!joined || !userId) return;

    const socket = io(SOCKET_URL, {
      query: { userId, userName, userRole },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.emit('meeting:join', { roomId });

    socket.on('meeting:participants', ({ participants }: { participants: MeetingParticipant[] }) => {
      participants.forEach(p => {
        if (p.userId === userId) return;
        peerInfoRef.current.set(p.userId, p);
        // Initiator rule: smaller userId calls. Stable & deterministic.
        if (userId < p.userId) {
          negotiate(p.userId);
        } else {
          buildPeerConnection(p.userId);
        }
      });
    });

    socket.on('meeting:user-joined', (p: MeetingParticipant) => {
      if (p.userId === userId) return;
      peerInfoRef.current.set(p.userId, p);
      if (userId < p.userId) negotiate(p.userId);
    });

    socket.on('meeting:user-left', ({ userId: peerId }: { userId: string }) => {
      removePeer(peerId);
    });

    socket.on('meeting:track-state', ({ userId: peerId, state }: { userId: string; state: any }) => {
      updatePeer(peerId, {
        audioOn:  !!state.audioOn,
        screenOn: !!state.screenOn,
      });
    });

    socket.on('webrtc:offer', async ({ offer, senderId }: any) => {
      const pc = buildPeerConnection(senderId);
      await pc.setRemoteDescription(offer);
      const pending = pendingIceRef.current.get(senderId);
      if (pending) {
        for (const c of pending) await pc.addIceCandidate(c).catch(() => {});
        pendingIceRef.current.delete(senderId);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { target: senderId, answer, adminId: userId });
    });

    socket.on('webrtc:answer', async ({ answer, adminId }: any) => {
      const peerId = adminId; // the answerer's id (legacy field name in signaling)
      const pc = peersRef.current.get(peerId);
      if (pc && answer) await pc.setRemoteDescription(answer);
    });

    socket.on('webrtc:ice', async ({ candidate, senderId }: any) => {
      const pc = peersRef.current.get(senderId);
      if (!pc) return;
      if (!pc.remoteDescription) {
        const list = pendingIceRef.current.get(senderId) || [];
        list.push(candidate);
        pendingIceRef.current.set(senderId, list);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    });

    return () => {
      socket.emit('meeting:leave', { roomId });
      socket.off('meeting:participants');
      socket.off('meeting:user-joined');
      socket.off('meeting:user-left');
      socket.off('meeting:track-state');
      socket.off('webrtc:offer');
      socket.off('webrtc:answer');
      socket.off('webrtc:ice');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joined, userId, userName, userRole, roomId, buildPeerConnection, negotiate, removePeer, updatePeer]);

  // ── Public: join the meeting ─────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    if (joined || joining) return;
    setError(null);
    setJoining(true);
    try {
      await ensureLocalStream();
      setJoined(true);
    } catch (e: any) {
      setError(e?.message || 'Could not access microphone');
    } finally {
      setJoining(false);
    }
  }, [joined, joining, ensureLocalStream]);

  // ── Public: leave ────────────────────────────────────────────────────────
  const leaveMeeting = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    peerInfoRef.current.clear();
    pendingIceRef.current.clear();
    setPeers({});
    setAudioOn(false);
    setScreenOn(false);
    setJoined(false);
  }, []);

  // ── Toggle helpers ───────────────────────────────────────────────────────
  const broadcastTrackState = useCallback((next: { audioOn: boolean; screenOn: boolean }) => {
    socketRef.current?.emit('meeting:track-state', { roomId, state: next });
  }, [roomId]);

  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !audioOn;
    stream.getAudioTracks().forEach(t => (t.enabled = next));
    setAudioOn(next);
    broadcastTrackState({ audioOn: next, screenOn });
  }, [audioOn, screenOn, broadcastTrackState]);

  const startScreenShare = useCallback(async () => {
    if (screenOn) return;
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      const screenTrack: MediaStreamTrack = screen.getVideoTracks()[0];

      // Add the screen track to every existing peer connection
      peersRef.current.forEach(pc => {
        pc.addTrack(screenTrack, screen);
      });

      // Auto-stop on the browser's "Stop sharing" prompt
      screenTrack.onended = () => stopScreenShare();

      setScreenOn(true);
      broadcastTrackState({ audioOn, screenOn: true });

      // Renegotiate every peer (track addition changes SDP)
      await renegotiateAll();
    } catch {
      /* user cancelled the picker — silent */
    }
  }, [screenOn, audioOn, broadcastTrackState, renegotiateAll]);

  const stopScreenShare = useCallback(async () => {
    if (!screenOn) return;
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    screenTrack?.stop();
    screenStreamRef.current = null;

    // Remove the video sender from each peer connection
    peersRef.current.forEach(pc => {
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => { try { pc.removeTrack(s); } catch { /* sender already gone */ } });
    });

    setScreenOn(false);
    broadcastTrackState({ audioOn, screenOn: false });

    // Renegotiate to reflect the removed track
    await renegotiateAll();
  }, [screenOn, audioOn, broadcastTrackState, renegotiateAll]);

  const toggleScreen = useCallback(() => {
    if (screenOn) stopScreenShare();
    else startScreenShare();
  }, [screenOn, startScreenShare, stopScreenShare]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { leaveMeeting(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    joined,
    joining,
    peers: Object.values(peers),
    localStream: localStreamRef.current,
    audioOn,
    screenOn,
    error,
    joinMeeting,
    leaveMeeting,
    toggleAudio,
    toggleScreen,
  };
}
