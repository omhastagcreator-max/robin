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
  videoOn: boolean;
  screenOn: boolean;
}

interface UseMeetingRoomOptions {
  userId: string;
  userName?: string;
  userRole?: string;
  roomId?: string;
}

/**
 * Mesh WebRTC meeting room.
 *
 * Each participant maintains one RTCPeerConnection per other participant.
 * The local stream carries audio + camera video; screen-sharing replaces the
 * outgoing video track on every PC (so peers see your screen instead of cam).
 *
 * Practical limit ~4–6 simultaneous participants (mesh). Fine for an agency.
 */
export function useMeetingRoom({ userId, userName, userRole, roomId = 'agency-global' }: UseMeetingRoomOptions) {
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);   // last camera video track (for restore after screen share)
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerInfoRef = useRef<Map<string, MeetingParticipant>>(new Map());
  // Pending ICE candidates received before remoteDescription was set
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerView>>({});
  const [audioOn, setAudioOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
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
        audioOn: patch.audioOn ?? existing?.audioOn ?? false,
        videoOn: patch.videoOn ?? existing?.videoOn ?? false,
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

  // ── Set up local media (camera + mic) lazily on first toggle ────────────
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    // Start with both tracks DISABLED; user opts in via toggles.
    stream.getAudioTracks().forEach(t => (t.enabled = false));
    stream.getVideoTracks().forEach(t => (t.enabled = false));
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] || null;
    return stream;
  }, []);

  // ── Build a PC for a specific peer ───────────────────────────────────────
  const buildPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    // Attach local tracks if we have any
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('webrtc:ice', { target: peerId, candidate: e.candidate, senderId: userId });
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      updatePeer(peerId, { stream });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // peer dropped — keep entry for now, server will signal user-left
      }
    };

    return pc;
  }, [updatePeer, userId]);

  const negotiate = useCallback(async (peerId: string) => {
    const pc = buildPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('webrtc:offer', { target: peerId, offer, senderId: userId });
  }, [buildPeerConnection, userId]);

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
      // Build PCs for everyone except self. Initiator rule: smaller userId calls.
      participants.forEach(p => {
        if (p.userId === userId) return;
        peerInfoRef.current.set(p.userId, p);
        if (userId < p.userId) {
          // I initiate
          negotiate(p.userId);
        } else {
          // Just prepare a PC so we can answer when their offer arrives
          buildPeerConnection(p.userId);
        }
      });
    });

    socket.on('meeting:user-joined', (p: MeetingParticipant) => {
      if (p.userId === userId) return;
      peerInfoRef.current.set(p.userId, p);
      // I initiate to the newcomer if my id is "smaller"
      if (userId < p.userId) negotiate(p.userId);
    });

    socket.on('meeting:user-left', ({ userId: peerId }: { userId: string }) => {
      removePeer(peerId);
    });

    socket.on('meeting:track-state', ({ userId: peerId, state }: { userId: string; state: any }) => {
      updatePeer(peerId, {
        audioOn: !!state.audioOn,
        videoOn: !!state.videoOn,
        screenOn: !!state.screenOn,
      });
    });

    socket.on('webrtc:offer', async ({ offer, senderId }: any) => {
      const pc = buildPeerConnection(senderId);
      await pc.setRemoteDescription(offer);
      // Drain any ICE that arrived before remoteDescription
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
      const peerId = adminId; // server passes the answerer's id back as adminId (legacy field name)
      const pc = peersRef.current.get(peerId);
      if (pc && answer) await pc.setRemoteDescription(answer);
    });

    socket.on('webrtc:ice', async ({ candidate, senderId }: any) => {
      const pc = peersRef.current.get(senderId);
      if (!pc) return;
      if (!pc.remoteDescription) {
        // Buffer until remoteDescription is set
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
      setError(e?.message || 'Could not access camera/microphone');
    } finally {
      setJoining(false);
    }
  }, [joined, joining, ensureLocalStream]);

  // ── Public: leave ────────────────────────────────────────────────────────
  const leaveMeeting = useCallback(() => {
    // Stop all local tracks
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    // Tear down peers
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    peerInfoRef.current.clear();
    pendingIceRef.current.clear();
    setPeers({});
    setAudioOn(false);
    setVideoOn(false);
    setScreenOn(false);
    setJoined(false);
  }, []);

  // ── Toggle helpers ───────────────────────────────────────────────────────
  const broadcastTrackState = useCallback((next: { audioOn: boolean; videoOn: boolean; screenOn: boolean }) => {
    socketRef.current?.emit('meeting:track-state', { roomId, state: next });
  }, [roomId]);

  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !audioOn;
    stream.getAudioTracks().forEach(t => (t.enabled = next));
    setAudioOn(next);
    broadcastTrackState({ audioOn: next, videoOn, screenOn });
  }, [audioOn, videoOn, screenOn, broadcastTrackState]);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !videoOn;
    stream.getVideoTracks().forEach(t => (t.enabled = next));
    setVideoOn(next);
    broadcastTrackState({ audioOn, videoOn: next, screenOn });
  }, [audioOn, videoOn, screenOn, broadcastTrackState]);

  const startScreenShare = useCallback(async () => {
    if (screenOn) return;
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      const screenTrack: MediaStreamTrack = screen.getVideoTracks()[0];

      // Replace the outgoing video track on every peer connection
      peersRef.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Also update our local stream so a self-preview shows the screen
      const localVideo = localStreamRef.current?.getVideoTracks()[0];
      if (localVideo && localStreamRef.current) {
        // Remove the camera video from the local stream (keep camera track ref so we can restore)
        cameraTrackRef.current = localVideo;
        localStreamRef.current.removeTrack(localVideo);
        localStreamRef.current.addTrack(screenTrack);
      }

      // Auto-stop on user clicking "Stop sharing" in browser UI
      screenTrack.onended = () => stopScreenShare();

      setScreenOn(true);
      broadcastTrackState({ audioOn, videoOn, screenOn: true });
    } catch (e: any) {
      // user cancelled — silent
    }
  }, [screenOn, audioOn, videoOn, broadcastTrackState]);

  const stopScreenShare = useCallback(() => {
    if (!screenOn) return;
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    screenTrack?.stop();
    screenStreamRef.current = null;

    // Restore camera track to peers + local stream (camera will be muted unless videoOn)
    const cameraTrack = cameraTrackRef.current;
    peersRef.current.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
    });
    if (localStreamRef.current && cameraTrack) {
      // Replace whatever video is on the local stream with the camera track
      localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current!.removeTrack(t));
      localStreamRef.current.addTrack(cameraTrack);
      cameraTrack.enabled = videoOn;
    }
    setScreenOn(false);
    broadcastTrackState({ audioOn, videoOn, screenOn: false });
  }, [screenOn, audioOn, videoOn, broadcastTrackState]);

  const toggleScreen = useCallback(() => {
    if (screenOn) stopScreenShare();
    else startScreenShare();
  }, [screenOn, startScreenShare, stopScreenShare]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      leaveMeeting();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    joined,
    joining,
    peers: Object.values(peers),
    localStream: localStreamRef.current,
    audioOn,
    videoOn,
    screenOn,
    error,
    joinMeeting,
    leaveMeeting,
    toggleAudio,
    toggleVideo,
    toggleScreen,
  };
}
