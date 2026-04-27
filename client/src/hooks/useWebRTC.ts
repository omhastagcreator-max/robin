import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

let socketSingleton: Socket | null = null;

function getSocket(userId: string): Socket {
  if (!socketSingleton || !socketSingleton.connected) {
    socketSingleton = io(SOCKET_URL, { query: { userId }, transports: ['websocket', 'polling'] });
  }
  return socketSingleton;
}

// ── Sender (Employee) ─────────────────────────────────────────────────────────
export function useWebRTCSender(userId: string) {
  const [isSharing, setIsSharing] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    socketRef.current = socket;

    socket.on('view:request', async ({ adminId }: { adminId: string }) => {
      if (!streamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current!));
      pc.onicecandidate = e => { if (e.candidate) socket.emit('webrtc:ice', { target: adminId, candidate: e.candidate, senderId: userId }); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { target: adminId, offer, senderId: userId });
    });

    socket.on('webrtc:answer', async ({ answer }: any) => {
      if (pcRef.current && answer) await pcRef.current.setRemoteDescription(answer);
    });

    socket.on('webrtc:ice', async ({ candidate }: any) => {
      if (pcRef.current && candidate) await pcRef.current.addIceCandidate(candidate);
    });

    return () => { socket.off('view:request'); socket.off('webrtc:answer'); socket.off('webrtc:ice'); };
  }, [userId]);

  const startSharing = useCallback(async () => {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      stream.getVideoTracks()[0].onended = stopSharing;
      setIsSharing(true);
      await api.updateScreenStatus({ status: 'active', startedAt: new Date().toISOString() });
      socketRef.current?.emit('screen:start', { userId });
    } catch { /* user cancelled */ }
  }, [userId]);

  const stopSharing = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setIsSharing(false);
    await api.updateScreenStatus({ status: 'inactive' });
    socketRef.current?.emit('screen:stop', { userId });
  }, [userId]);

  return { isSharing, startSharing, stopSharing };
}

// ── Receiver (Admin) ──────────────────────────────────────────────────────────
export function useWebRTCReceiver(userId: string) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectingTo, setConnectingTo] = useState<Record<string, boolean>>({});
  const pcMap = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    socketRef.current = socket;

    socket.on('webrtc:offer', async ({ offer, senderId }: any) => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcMap.current.set(senderId, pc);

      pc.onicecandidate = e => { if (e.candidate) socket.emit('webrtc:ice', { target: senderId, candidate: e.candidate, senderId: userId }); };
      pc.ontrack = e => { 
        setRemoteStreams(prev => ({ ...prev, [senderId]: e.streams[0] })); 
        setConnectingTo(prev => ({ ...prev, [senderId]: false })); 
      };

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { target: senderId, answer, adminId: userId });
    });

    socket.on('webrtc:ice', async ({ candidate, senderId }: any) => {
      const pc = pcMap.current.get(senderId);
      if (pc && candidate) await pc.addIceCandidate(candidate);
    });

    return () => { socket.off('webrtc:offer'); socket.off('webrtc:ice'); };
  }, [userId]);

  const viewScreen = useCallback((targetId: string) => {
    setConnectingTo(prev => ({ ...prev, [targetId]: true }));
    socketRef.current?.emit('view:request', { targetId, adminId: userId });
  }, [userId]);

  const stopViewing = useCallback((targetId: string) => {
    const pc = pcMap.current.get(targetId);
    pc?.close();
    pcMap.current.delete(targetId);
    setRemoteStreams(prev => { const nw = {...prev}; delete nw[targetId]; return nw; });
    setConnectingTo(prev => { const nw = {...prev}; delete nw[targetId]; return nw; });
  }, []);

  const stopAll = useCallback(() => {
    pcMap.current.forEach(pc => pc.close());
    pcMap.current.clear();
    setRemoteStreams({});
    setConnectingTo({});
  }, []);

  return { remoteStreams, connectingTo, viewScreen, stopViewing, stopAll };
}
