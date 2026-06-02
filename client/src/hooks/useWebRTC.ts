import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import * as api from '@/api';
import { getIceServers } from '@/lib/iceServers';
import { getSharedSocket } from '@/hooks/useSocket';
import { screenShareManager } from '@/lib/screenShareManager';
import { logShareEvent } from '@/lib/screenShareDebug';
import { fireShareStoppedAlarm } from '@/lib/buzzer';

// Resolved at first use via getIceServers() — see lib/iceServers.ts. Order:
// (1) Metered.live REST API   (2) static VITE_TURN_*   (3) public STUN.
let resolvedIceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
let icePromise: Promise<RTCIceServer[]> | null = null;
async function ensureIce() {
  if (!icePromise) icePromise = getIceServers().then(s => { resolvedIceServers = s; return s; });
  await icePromise;
  return resolvedIceServers;
}

function attachConnLogging(pc: RTCPeerConnection, label: string) {
  pc.onconnectionstatechange    = () => console.log(`[webrtc:${label}] conn=${pc.connectionState}`);
  pc.oniceconnectionstatechange = () => console.log(`[webrtc:${label}] ice=${pc.iceConnectionState}`);
}

// Use the shared socket from useSocket() so we don't open a SECOND TCP
// connection per user (every authenticated tab was opening two sockets,
// doubling presence updates and disconnect events).
function getSocket(userId: string): Socket | null {
  return getSharedSocket({ id: userId });
}

// ── Sender (Employee broadcasting their screen) ──────────────────────────────
//
// As of Phase 7, the MediaStream lifecycle lives in screenShareManager. This
// hook is a thin React adapter that:
//   1. Subscribes to the manager's snapshot for UI (isSharing, recovering…).
//   2. Owns the RTCPeerConnection mesh + signaling: when an admin asks to view,
//      we build a PC and attach the manager's track. When the manager hands us
//      a new track (after recovery), we replaceTrack on every existing PC so
//      the watcher's view doesn't break.
//   3. Re-emits screen:start on socket reconnect so the server's presence
//      table doesn't drift after a transient drop.
//   4. Surfaces a sticky toast when the share dies unexpectedly. Recovery
//      itself is handled by the manager — the toast is purely informative.
//
// Why this split: the manager state machine is plain TypeScript, free of
// React's render lifecycle, so a remount of AppLayout (or React 18 StrictMode
// double-mount in dev) doesn't kill an in-flight share.

export function useWebRTCSender(userId: string) {
  // Subscribe to the manager's snapshot. The manager IS the source of truth.
  const [snap, setSnap] = useState(() => screenShareManager.getSnapshot());
  useEffect(() => {
    return screenShareManager.subscribe(() => {
      setSnap(screenShareManager.getSnapshot());
    });
  }, []);

  const isSharing       = snap.isSharing;
  const persistentIntent = snap.intent;

  const setPersistentIntent = useCallback((on: boolean) => {
    screenShareManager.setIntent(on);
  }, []);

  // Sender keeps one PC per admin watching, so multiple admins can view at once.
  const pcMap = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  // Buffer ICE candidates that arrive before remoteDescription is set on a PC.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // True while we're currently mid-stop, so onended events from t.stop()
  // don't trigger a spurious resume toast.
  const stoppingRef = useRef(false);

  const stopAllPCs = useCallback(() => {
    pcMap.current.forEach(pc => { try { pc.close(); } catch { /* ignore */ } });
    pcMap.current.clear();
    pendingIce.current.clear();
  }, []);

  // ── Track lifecycle from the manager ────────────────────────────────────
  // The manager notifies us when a new track is acquired (initial start
  // OR recovery). On every track change we hot-swap it onto all existing
  // RTCRtpSenders so admins watching us don't have to re-request a view.
  useEffect(() => {
    const onTrack = (newTrack: MediaStreamTrack | null) => {
      if (!newTrack) return;
      logShareEvent('note', `useWebRTCSender — hot-swap track onto ${pcMap.current.size} PCs`);
      pcMap.current.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(newTrack).catch((e) => {
            logShareEvent('error', 'replaceTrack failed', { message: (e as Error).message });
          });
        } else {
          // No existing video sender — add a fresh one.
          try { pc.addTrack(newTrack); } catch { /* ignore */ }
        }
      });
    };
    return screenShareManager.subscribeTrack(onTrack);
  }, []);

  // ── React to state transitions: side-effects (server status, toasts) ────
  const prevSharingRef = useRef<boolean>(false);
  const prevStateRef = useRef(snap.state);
  useEffect(() => {
    const prev = prevSharingRef.current;
    const prevState = prevStateRef.current;
    prevSharingRef.current = isSharing;
    prevStateRef.current = snap.state;

    const socket = socketRef.current;

    // Share started (true edge)
    if (!prev && isSharing) {
      api.updateScreenStatus({ status: 'active', startedAt: new Date().toISOString() }).catch(() => {});
      socket?.emit('screen:start', { userId });
      // Dismiss any lingering resume toast.
      toast.dismiss('screen-share-resume');
    }

    // Share stopped (true edge)
    if (prev && !isSharing) {
      stopAllPCs();
      api.updateScreenStatus({ status: 'inactive' }).catch(() => {});
      socket?.emit('screen:stop', { userId });

      // Distinguish user-stop (clean) from anything else (toast).
      const reason = snap.lastEndReason;
      const userIntended = reason === 'user';
      if (!userIntended && !stoppingRef.current) {
        const reasonCopy: Record<string, string> = {
          'browser-stop-pill': 'You clicked Chrome\'s "Stop sharing" toolbar.',
          'source-closed':     'The window or tab you were sharing was closed.',
          'system-sleep':      'Your Mac display went to sleep — capture stopped.',
          'tab-discard':       'Chrome\'s Memory Saver paused this tab.',
          'device-change':     'A display change was detected.',
          'network':           'A network blip ended the share.',
          'unknown':           'The browser ended the share without telling us why.',
        };
        const description = reasonCopy[reason || 'unknown'] || reasonCopy.unknown;
        // Triple-channel alert so we reach the user wherever they are:
        //   1. In-tab toast (covers users actively on a Robin page)
        //   2. Loud Web-Audio buzzer (covers users on another tab on the
        //      same awake machine)
        //   3. OS desktop notification (covers users with a sleeping
        //      display / closed-lid laptop — the notification can wake
        //      the screen and survives audio suspension)
        try { fireShareStoppedAlarm(description); } catch { /* swallow — toast still surfaces */ }
        toast.error('Screen sharing stopped — click anywhere to resume', {
          id:       'screen-share-resume',
          description,
          duration: 1_000 * 60 * 10,  // 10 min — long but not Infinity (Sonner leaks elements at Infinity)
          action:   { label: 'Resume now', onClick: () => { void screenShareManager.start(); } },
        });
      }
    }

    // State transitions worth surfacing — blocked / recovering
    if (snap.state === 'blocked' && prevState !== 'blocked') {
      const desc = snap.blockReason === 'cross-tab'
        ? 'Another Robin tab is already sharing. Close it and try again.'
        : snap.blockReason === 'unsupported'
        ? 'Your browser doesn\'t support screen capture.'
        : 'Browser denied permission. Check System Settings → Screen Recording.';
      toast.error('Screen sharing blocked', { id: 'screen-share-blocked', description: desc, duration: 8_000 });
    }
  }, [isSharing, snap.state, snap.lastEndReason, snap.blockReason, stopAllPCs, userId]);

  // ── Socket signaling (offer / answer / ICE) + reconnect re-announce ────
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    if (!socket) return;
    socketRef.current = socket;

    const announce = () => {
      if (screenShareManager.isSharing()) {
        logShareEvent('socket-reconnect-republish', 're-announcing screen:start to server');
        socket.emit('screen:start', { userId });
        api.updateScreenStatus({ status: 'active', startedAt: new Date().toISOString() }).catch(() => {});
      }
    };

    // Admin asks to view our screen — create a PC just for them.
    const onViewRequest = async ({ adminId }: { adminId: string }) => {
      const track = screenShareManager.getTrack();
      if (!track) return; // not broadcasting yet
      // Tear down any prior PC for this admin (they may be reconnecting).
      pcMap.current.get(adminId)?.close();

      const pc = new RTCPeerConnection({ iceServers: resolvedIceServers });
      attachConnLogging(pc, `sender→${adminId.slice(0, 6)}`);
      pcMap.current.set(adminId, pc);

      try { pc.addTrack(track); } catch (e: any) {
        logShareEvent('error', 'addTrack failed', { message: e?.message });
      }

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
      if (!pc) return;
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
    // Re-announce on reconnect so the server's screen-sessions row
    // reflects ground truth instead of the snapshot before the drop.
    socket.on('connect',       announce);

    return () => {
      socket.off('view:request',  onViewRequest);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice',    onIce);
      socket.off('connect',       announce);
    };
  }, [userId]);

  const startSharing = useCallback(async () => {
    // ICE resolution is async; kick it off so TURN creds are warm by the
    // time the first admin sends view:request. We don't await it because
    // the user already clicked — we MUST issue getDisplayMedia inside the
    // activation window.
    void ensureIce();
    await screenShareManager.start();
  }, []);

  const stopSharing = useCallback(async () => {
    stoppingRef.current = true;
    try {
      await screenShareManager.stop();
    } finally {
      // Defer so the snapshot transition fires before we drop the flag.
      setTimeout(() => { stoppingRef.current = false; }, 50);
    }
  }, []);

  return { isSharing, startSharing, stopSharing, persistentIntent, setPersistentIntent };
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
    if (!socket) return;            // shared socket not ready yet
    socketRef.current = socket;

    const onOffer = async ({ offer, senderId }: any) => {
      // Only accept offers we explicitly requested via view:request.
      if (!expected.current.has(senderId) && !pcMap.current.has(senderId)) {
        return;
      }
      pcMap.current.get(senderId)?.close();

      const pc = new RTCPeerConnection({ iceServers: resolvedIceServers });
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

  const viewScreen = useCallback(async (targetId: string) => {
    // Make sure TURN credentials are loaded before the broadcaster's offer
    // arrives — otherwise we'd build the PC with a stale STUN-only config.
    await ensureIce();
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
