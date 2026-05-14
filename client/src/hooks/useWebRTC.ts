import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import * as api from '@/api';
import { getIceServers } from '@/lib/iceServers';
import { getSharedSocket } from '@/hooks/useSocket';

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
export function useWebRTCSender(userId: string) {
  const [isSharing, setIsSharing] = useState(false);
  // Sender keeps one PC per admin watching, so multiple admins can view at once.
  const pcMap = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Buffer ICE candidates that arrive before remoteDescription is set on a PC.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // True while a teardown is already in flight — prevents the onended →
  // stopSharing → t.stop() → onended recursion that was double-emitting
  // screen:stop and double-firing updateScreenStatus on every manual stop.
  const stoppingRef = useRef(false);
  // True ONLY when the user clicked Stop in our UI. If onended fires while
  // this is false, the browser ended the track unexpectedly (user clicked
  // Chrome's native Stop pill, the source window closed, OS sleep, etc.).
  // Lets us surface a "Sharing ended — resume?" toast instead of silently
  // killing the share.
  const manualStopRef = useRef(false);
  // Wake-lock keeps the Mac display from sleeping while we're sharing —
  // macOS aggressively cuts screen-capture when the display sleeps. Held
  // for the lifetime of the share, released in stopSharing.
  const wakeLockRef = useRef<any>(null);
  // Keep-alive interval that polls track.readyState. When the OS, browser
  // tab discard, or memory-saver kills the track WITHOUT firing onended
  // (which happens on Mac under tab freezing), this catches it within 2s
  // instead of leaving the UI stuck on "Sharing".
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Forward declarations so closures can call each other
  const stopAllPCs = useCallback(() => {
    pcMap.current.forEach(pc => pc.close());
    pcMap.current.clear();
    pendingIce.current.clear();
  }, []);

  const stopSharing = useCallback(async () => {
    // Guard against re-entry: t.stop() below fires onended → onended calls
    // stopSharing → infinite recursion + double network emits. The ref-flag
    // is the only way to break the cycle since onended runs async.
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    manualStopRef.current = true;
    console.log('[screen-share] stopSharing called');
    try {
      // Clear watchdog before tearing down tracks so it doesn't fire
      // mid-teardown and trigger spurious "share ended" diagnostics.
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
      // Release the screen wake-lock so the Mac can sleep normally.
      if (wakeLockRef.current) {
        try { await wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      streamRef.current?.getTracks().forEach(t => {
        // Clear onended FIRST so t.stop() can't re-enter via the handler.
        t.onended = null;
        try { t.stop(); } catch { /* track already ended */ }
      });
      streamRef.current = null;
      stopAllPCs();
      setIsSharing(false);
      try { await api.updateScreenStatus({ status: 'inactive' }); } catch { /* ignore */ }
      socketRef.current?.emit('screen:stop', { userId });
    } finally {
      stoppingRef.current = false;
      // Reset manualStop so the NEXT share's onended fires correctly.
      // Defer to next tick so any racing onended sees true (no auto-toast).
      setTimeout(() => { manualStopRef.current = false; }, 0);
    }
  }, [userId, stopAllPCs]);

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket(userId);
    if (!socket) return;            // shared socket not ready yet
    socketRef.current = socket;

    // Admin asks to view our screen — create a PC just for them.
    const onViewRequest = async ({ adminId }: { adminId: string }) => {
      if (!streamRef.current) return; // not broadcasting yet
      // Tear down any prior PC for this admin (they may be reconnecting).
      pcMap.current.get(adminId)?.close();

      const pc = new RTCPeerConnection({ iceServers: resolvedIceServers });
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
      // Resolve ICE servers up front — guarantees TURN is fetched before
      // an admin asks to view this stream.
      await ensureIce();
      // Higher framerate + content hint keep the share crisp without taxing
      // the network. Audio off because Chrome will prompt for tab audio.
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 24 } },
        audio: false,
      });
      streamRef.current = stream;
      manualStopRef.current = false;
      const track = stream.getVideoTracks()[0];
      console.log('[screen-share] started', {
        label: track.label, settings: track.getSettings?.(),
        platform: navigator.userAgent,
      });

      // ── 1. Screen wake-lock so the Mac display doesn't sleep ─────────
      // macOS aggressively ends screen-capture when the display sleeps
      // (lock screen, hot corners, energy saver). Hold a wake-lock while
      // sharing to prevent that. Best-effort — older browsers don't have
      // the API; that's fine.
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('[screen-share] wake-lock acquired');
        }
      } catch (e) {
        console.log('[screen-share] wake-lock unavailable', e);
      }

      // Re-acquire wake-lock if the browser drops it on tab focus change
      // (it auto-releases when document.hidden becomes true).
      const onVis = async () => {
        if (document.visibilityState === 'visible' && streamRef.current && !wakeLockRef.current) {
          try {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            console.log('[screen-share] wake-lock re-acquired on visibility change');
          } catch { /* ignore */ }
        }
      };
      document.addEventListener('visibilitychange', onVis);

      // ── 2. Listen to track ending ───────────────────────────────────
      // Could be from:
      //   1. Our stopSharing() calling t.stop() (manualStopRef = true)
      //   2. User clicked Chrome's native "Stop sharing" pill
      //   3. The captured window/tab closed
      //   4. macOS display sleep / lock screen / energy saver
      //   5. Chrome Memory Saver discarding a backgrounded tab
      track.onended = () => {
        const wasManual = manualStopRef.current;
        console.warn('[screen-share] track.onended fired', {
          wasManual, readyState: track.readyState, muted: track.muted,
        });
        document.removeEventListener('visibilitychange', onVis);
        stopSharing();
        if (!wasManual) {
          toast('Screen sharing stopped', {
            description: 'Most common Mac cause: display went to sleep, the captured window was closed, or Chrome\'s Stop pill was clicked.',
            action: {
              label: 'Share again',
              onClick: () => { startSharingRef.current?.(); },
            },
            duration: 10000,
          });
        }
      };
      // Mute = source backgrounded (don't tear down). Unmute = back.
      track.onmute   = () => console.log('[screen-share] track muted (source backgrounded?)');
      track.onunmute = () => console.log('[screen-share] track unmuted (source foregrounded)');

      // ── 3. Watchdog — readyState polling ────────────────────────────
      // Sometimes (especially on Mac with Chrome Memory Saver / tab freeze)
      // the track gets killed without firing onended. Poll readyState
      // every 2s and force-cleanup if it ever flips to 'ended'.
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = setInterval(() => {
        const t = streamRef.current?.getVideoTracks()[0];
        if (!t) return;
        if (t.readyState === 'ended') {
          console.warn('[screen-share] watchdog detected ended track without onended firing');
          // Trigger the onended path manually
          if (t.onended) (t.onended as any)(new Event('ended'));
          else stopSharing();
        }
      }, 2000);

      setIsSharing(true);
      try { await api.updateScreenStatus({ status: 'active', startedAt: new Date().toISOString() }); } catch { /* ignore */ }
      socketRef.current?.emit('screen:start', { userId });
    } catch (err: any) {
      const name = err?.name;
      console.warn('[screen-share] startSharing failed', { name, message: err?.message });
      if (name && name !== 'NotAllowedError' && name !== 'AbortError') {
        toast.error('Could not start screen sharing', {
          description: name === 'NotReadableError'
            ? 'The source might be in use by another app. Close it and try again.'
            : name === 'NotFoundError'
            ? 'No screen / window / tab was selected.'
            : 'Browser declined the request. Try a different source.',
        });
      }
    }
  }, [userId, stopSharing]);

  // Stable ref so the onended toast's "Share again" button can call the
  // current startSharing even after it's been regenerated by a userId change.
  const startSharingRef = useRef(startSharing);
  useEffect(() => { startSharingRef.current = startSharing; }, [startSharing]);

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
