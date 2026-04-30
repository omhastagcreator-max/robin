import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as api from '@/api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// ICE servers for NAT traversal.
//   - Google STUN works on simple home networks.
//   - TURN is required when STUN can't punch through (most corporate /
//     hotel / mobile networks, symmetric NATs, etc.). Without TURN the
//     signalling completes but no media bytes flow → black video.
//
// Open Relay Project provides free public TURN with usable bandwidth and
// is the standard "it just works for testing" choice. For production it's
// worth swapping to Twilio NTS / Cloudflare TURN with paid credentials.
//
// You can override with VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
// if you wire up your own TURN later.
const TURN_URL  = (import.meta as any).env?.VITE_TURN_URL  || 'turn:openrelay.metered.ca:443';
const TURN_USER = (import.meta as any).env?.VITE_TURN_USERNAME   || 'openrelayproject';
const TURN_PASS = (import.meta as any).env?.VITE_TURN_CREDENTIAL || 'openrelayproject';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // UDP TURN
  { urls: TURN_URL,                                  username: TURN_USER, credential: TURN_PASS },
  // TCP fallback for restrictive firewalls
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: TURN_USER, credential: TURN_PASS },
];

function attachConnLogging(pc: RTCPeerConnection, label: string) {
  pc.onconnectionstatechange    = () => console.log(`[webrtc:${label}] conn=${pc.connectionState}`);
  pc.oniceconnectionstatechange = () => console.log(`[webrtc:${label}] ice=${pc.iceConnectionState}`);
}

let socketSingleton: Socket | null = null;

function getSocket(userId: string, userName?: string, userRole?: string): Socket {
  if (!socketSingleton || !socketSingleton.connected) {
    socketSingleton = io(SOCKET_URL, {
      query: { userId, userName, userRole },
      transports: ['websocket', 'polling'],
    });
  }
  return socketSingleton;
}

// ── Sender (Employee broadcasting their screen) ──────────────────────────────
export function useWebRTCSender(userId: string) {
  const [isSharing, setIsSharing] = useState(false);
  // Sender keeps one PC per admin watching, so multiple admins can view at once.
  const pcMap = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Buffer ICE candidates that arrive before remoteDescription is set on a PC.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Forward declarations so closures can call each other
  const stopAllPCs = useCallback(() => {
    pcMap.current.forEach(pc => pc.close());
    pcMap.current.clear();
    pendingIce.current.clear();
  }, []);

  const stopSharing = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    stopAllPCs();
    setIsSharing(false);
    try { await api.updateScreenStatus({ status: 'inactive' }); } catch { /* ignore */ }
    socketRef.current?.emit('screen:stop', { userId });
  }, [userId, stopAllPCs]);

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    socketRef.current = socket;

    // Admin asks to view our screen — create a PC just for them.
    const onViewRequest = async ({ adminId }: { adminId: string }) => {
      if (!streamRef.current) return; // not broadcasting yet
      // Tear down any prior PC for this admin (they may be reconnecting).
      pcMap.current.get(adminId)?.close();

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      attachConnLogging(pc, `sender→${adminId.slice(0, 6)}`);
      pcMap.current.set(adminId, pc);

      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current!));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('webrtc:ice', { target: adminId, candidate: e.candidate, senderId: userId });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { target: adminId, offer, senderId: userId });
    };

    // Admin's answer to our offer
    const onAnswer = async ({ answer, adminId }: any) => {
      const pc = pcMap.current.get(adminId);
      if (!pc || !answer) return;
      await pc.setRemoteDescription(answer);
      // Drain any ICE that arrived before remoteDescription was set.
      const pending = pendingIce.current.get(adminId);
      if (pending) {
        for (const c of pending) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.current.delete(adminId);
      }
    };

    // ICE from admin — note: server forwards with field `senderId` set to
    // whoever emitted (here, the admin).
    const onIce = async ({ candidate, senderId }: any) => {
      if (!candidate) return;
      const pc = pcMap.current.get(senderId);
      if (!pc) return; // not a PC we manage (could be receiver-side ICE)
      if (!pc.remoteDescription) {
        const list = pendingIce.current.get(senderId) || [];
        list.push(candidate);
        pendingIce.current.set(senderId, list);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    };

    socket.on('view:request',  onViewRequest);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice',    onIce);

    // Use named callbacks in cleanup so we don't trample sibling listeners.
    return () => {
      socket.off('view:request',  onViewRequest);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice',    onIce);
    };
  }, [userId]);

  const startSharing = useCallback(async () => {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      stream.getVideoTracks()[0].onended = () => stopSharing();
      setIsSharing(true);
      try { await api.updateScreenStatus({ status: 'active', startedAt: new Date().toISOString() }); } catch { /* ignore */ }
      socketRef.current?.emit('screen:start', { userId });
    } catch { /* user cancelled the picker */ }
  }, [userId, stopSharing]);

  return { isSharing, startSharing, stopSharing };
}

// ── Receiver (Admin or teammate watching someone's screen) ───────────────────
export function useWebRTCReceiver(userId: string) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectingTo,  setConnectingTo]  = useState<Record<string, boolean>>({});
  const pcMap = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // Senders we expect offers from (set when we emit view:request). Used as a
  // guard so this hook doesn't pick up unrelated offers from the mesh-meeting
  // room hook running on a sibling socket.
  const expected = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    socketRef.current = socket;

    const onOffer = async ({ offer, senderId }: any) => {
      // Only accept offers we explicitly requested via view:request.
      if (!expected.current.has(senderId) && !pcMap.current.has(senderId)) {
        return;
      }
      pcMap.current.get(senderId)?.close();

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      attachConnLogging(pc, `receiver←${senderId.slice(0, 6)}`);
      pcMap.current.set(senderId, pc);

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('webrtc:ice', { target: senderId, candidate: e.candidate, senderId: userId });
      };
      pc.ontrack = (e) => {
        setRemoteStreams(prev => ({ ...prev, [senderId]: e.streams[0] }));
        setConnectingTo(prev => ({ ...prev, [senderId]: false }));
      };

      await pc.setRemoteDescription(offer);
      const pending = pendingIce.current.get(senderId);
      if (pending) {
        for (const c of pending) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.current.delete(senderId);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { target: senderId, answer, adminId: userId });
    };

    const onIce = async ({ candidate, senderId }: any) => {
      if (!candidate) return;
      const pc = pcMap.current.get(senderId);
      if (!pc) return;
      if (!pc.remoteDescription) {
        const list = pendingIce.current.get(senderId) || [];
        list.push(candidate);
        pendingIce.current.set(senderId, list);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    };

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:ice',   onIce);

    return () => {
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:ice',   onIce);
    };
  }, [userId]);

  const viewScreen = useCallback((targetId: string) => {
    expected.current.add(targetId);
    setConnectingTo(prev => ({ ...prev, [targetId]: true }));
    socketRef.current?.emit('view:request', { targetId, adminId: userId });
  }, [userId]);

  const stopViewing = useCallback((targetId: string) => {
    expected.current.delete(targetId);
    pcMap.current.get(targetId)?.close();
    pcMap.current.delete(targetId);
    pendingIce.current.delete(targetId);
    setRemoteStreams(prev => { const nw = { ...prev }; delete nw[targetId]; return nw; });
    setConnectingTo(prev => { const nw = { ...prev }; delete nw[targetId]; return nw; });
  }, []);

  const stopAll = useCallback(() => {
    expected.current.clear();
    pcMap.current.forEach(pc => pc.close());
    pcMap.current.clear();
    pendingIce.current.clear();
    setRemoteStreams({});
    setConnectingTo({});
  }, []);

  return { remoteStreams, connectingTo, viewScreen, stopViewing, stopAll };
}
