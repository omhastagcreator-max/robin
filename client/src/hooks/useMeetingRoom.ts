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
import { acquireTabKeepAlive, releaseTabKeepAlive } from '@/lib/tabKeepAlive';
import { fireShareStoppedAlarm } from '@/lib/buzzer';
import { toast } from 'sonner';

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
  // Set TRUE when toggleScreen is invoked by the user (start OR stop).
  // syncLocal checks + resets it to distinguish a user-initiated change
  // from an UNEXPECTED screen-track unpublish (Chrome stop-pill, source
  // window closed, display sleep, etc) — only the unexpected case fires
  // the "Screen sharing stopped" toast.
  const userToggledScreenRef = useRef(false);
  // Forward ref to the latest toggleScreen function. syncLocal needs to
  // call it from the "Share again" toast action, but toggleScreen is
  // declared LATER in the file. The ref bridges the gap.
  const toggleScreenRef = useRef<(() => Promise<void>) | null>(null);
  // Auto-retry state was removed in the v3 auto-stop fix — see comment
  // inside syncLocal. We no longer programmatically re-fire toggleScreen
  // after an unexpected stop; the user gets a toast with an explicit
  // "Share again" button and decides themselves whether to retry.
  // True when this hook currently holds a tab-keep-alive reference.
  // Acquired when LiveKit's screen share toggles ON (which is the
  // strongest "user is actively working" signal we have inside the
  // huddle path); released on toggle OFF, leaveMeeting, or unmount.
  // Paired by hand so each acquire has exactly one matching release.
  const holdsKeepAliveRef = useRef(false);
  // Wake-lock handle while sharing — keeps macOS / Windows from sleeping
  // the display, which is the #1 cause of an unexpected track end.
  const wakeLockRef = useRef<any>(null);
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

        // ── Unexpected screen-share end detection (May 2026) ───────────
        // The owner reported "screen sharing auto turns off." Cause:
        // LiveKit's screen track can end without the user clicking Stop
        // — Chrome's screen-share pill, source window closing, OS
        // screen-recording permission revoked, macOS display sleep
        // killing the capture, or a network hiccup that unpublishes the
        // track. syncLocal flipped setScreenOn(false) silently with no
        // user-visible explanation.
        //
        // Now: if the screen pub disappears while we DIDN'T just call
        // toggleScreen ourselves, surface a toast with the most likely
        // cause and offer a one-click re-share.
        const previouslyOn = screenOnRef.current;
        const nowOn        = !!screenPub;
        // Update the ref SYNCHRONOUSLY so any second syncLocal that
        // fires before React's effect commit sees the correct
        // previouslyOn value. Without this, a fast back-to-back
        // syncLocal (e.g. LiveKit firing Unpublished + ConnectionState
        // events in the same tick) misclassified a legitimate stop as
        // an "unexpected" one and triggered a runaway auto-retry loop.
        screenOnRef.current = nowOn;
        if (previouslyOn && !nowOn && !userToggledScreenRef.current) {
          logShareEvent('error', 'livekit screen pub disappeared unexpectedly', {
            reason: 'no toggleScreen call; probably Chrome stop-pill / source closed / display sleep',
          });
          // Triple-channel alert: Web-Audio buzzer for users on another
          // tab + OS desktop notification for users with a sleeping
          // display + the existing in-tab toast for users on a Robin
          // page. See lib/buzzer.ts for the audio + Notification API
          // details. Wrapped in try/catch so a failure in any one
          // channel doesn't suppress the others.
          try {
            fireShareStoppedAlarm(
              'Most likely Chrome\'s "Stop sharing" pill, the source window closing, or display sleep.',
            );
          } catch { /* swallow — toast still surfaces */ }
          toast.error(
            'Screen sharing stopped. Most likely: you clicked Chrome\'s "Stop sharing" pill, the source window closed, or your Mac display slept. Click the screen icon to share again.',
            { duration: 9000, action: { label: 'Share again', onClick: () => { void toggleScreenRef.current?.(); } } },
          );

          // ── Auto-retry REMOVED (May 2026, v3) ───────────────────────
          // The 5s/20s/60s backoff sequence here was the second-biggest
          // cause of "screen sharing auto-stops for all roles." Each
          // retry programmatically called toggleScreen(), which
          // unconditionally pops Chrome's screen picker — even after a
          // legitimate stop. Worse, retries racing with the
          // screenShareManager's own getDisplayMedia caused Chrome to
          // alternately kill each capture, producing the user-visible
          // pattern of "share works for a few seconds, then dies, then
          // works again, then dies." Users now have a single explicit
          // "Share again" action in the toast above; no implicit retry.
        }
        userToggledScreenRef.current = false;  // arm for the next event

        setScreenOn(nowOn);
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

      // ── LiveKit 429 detection (May 2026 fix) ────────────────────────
      // LiveKit-client masks an HTTP 429 from LiveKit Cloud as a generic
      // "could not establish signal connection: websocket error during
      // connection establishment" message. The 429 itself appears in the
      // browser's Network panel + DevTools console but NEVER as the
      // thrown error. We scan our share-event ring buffer for the 429
      // marker so we can identify this case from the captured chain.
      let saw429 = false;
      try {
        // Look through console for recent 429s — LiveKit logs them as
        // failed-resource entries before bubbling the websocket error.
        // performance.getEntriesByType('resource') is the most reliable
        // hook we have without instrumenting fetch.
        const entries = (performance.getEntriesByType?.('resource') || []) as any[];
        const nowMs = performance.now();
        saw429 = entries.some(e => {
          if (!e?.name?.includes('livekit.cloud')) return false;
          if (nowMs - (e.startTime || 0) > 30_000) return false; // last 30s only
          // PerformanceResourceTiming doesn't expose status, but
          // responseEnd === 0 + transferSize === 0 + duration <100ms
          // is a strong proxy for an HTTP error like 429.
          return e.transferSize === 0 && e.responseEnd > 0 && e.duration < 200;
        });
      } catch { /* private mode / unsupported */ }

      if (status === 429 || /Too Many Requests|429/i.test(raw) || saw429) {
        // Project-level rate limit. Almost always one of:
        //   (a) LiveKit Cloud FREE TIER exhausted (50 concurrent users
        //       OR monthly minutes used up). Check the LiveKit Cloud
        //       dashboard → Usage tab.
        //   (b) Burst limit — too many connection attempts in a short
        //       window (e.g. everyone refreshing at once).
        //   (c) Project paused / suspended.
        msg = 'LiveKit rate-limited (429). Likely the LiveKit Cloud free-tier monthly cap is hit OR too many connect attempts in a burst. Admin: open https://cloud.livekit.io → your project → Usage, and check the monthly limits. Wait 5-10 min and try again, or upgrade the LiveKit plan.';
      } else if (status === 401 || status === 403) {
        msg = 'Your session may have expired — sign out and back in, then try the huddle again.';
      } else if (e?.code === 'ECONNABORTED' || /timeout/i.test(raw)) {
        msg = 'The Robin API didn\'t respond — server may be redeploying. Wait ~30 seconds and retry.';
      } else if (/Failed to fetch|Network Error|ERR_NETWORK/i.test(raw)) {
        msg = 'No connection to the Robin API. Check your internet, then retry.';
      } else if (/InvalidServerResponseError|server returned/i.test(raw)) {
        msg = 'LiveKit rejected the token — usually LIVEKIT_API_KEY / SECRET mismatch the URL\'s project. Admin: verify all three env vars in Render belong to the same LiveKit Cloud project.';
      } else if (/could not establish signal connection|websocket error during connection establishment/i.test(raw)) {
        // The token was minted but the WebSocket handshake to LiveKit
        // Cloud failed (and our 429-probe above didn't trip). Common
        // causes in priority order: LiveKit project paused, env mismatch,
        // firewall blocking outbound wss.
        msg = 'Couldn\'t reach LiveKit. Most likely the project is paused OR LIVEKIT_URL doesn\'t match the API key/secret. Admin: Render → robin-api → Environment, verify LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET all belong to the same active LiveKit Cloud project.';
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
    // (Auto-retry cleanup removed — see v3 auto-stop fix in syncLocal.)
    // Release any held wake-lock — we're no longer sharing anything.
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    }
    // Release tab keep-alive if we were holding it. Covers the case
    // where leaveMeeting fires while screenOn was still true (user hit
    // "Leave huddle" without first toggling screen off).
    if (holdsKeepAliveRef.current) {
      releaseTabKeepAlive();
      holdsKeepAliveRef.current = false;
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
    } catch (e: any) {
      // Surface mic failures to the user instead of swallowing them — the
      // previous catch only logged, so when permission was denied OR no
      // device was connected, the button stayed red and the user thought
      // Robin was broken (e.g. Bhawana, May 2026). Now each known browser
      // error gets a concrete next step the user can act on.
      log('toggleAudio failed', e);
      const name = e?.name || '';
      const msg  = e?.message || '';
      if (name === 'NotAllowedError' || /permission/i.test(msg)) {
        toast.error(
          'Mic permission blocked. Click the lock icon in the address bar → Site settings → Microphone → Allow, then reload.',
          { duration: 8000 }
        );
      } else if (name === 'NotFoundError' || /no devices? found|requested device not found/i.test(msg)) {
        toast.error(
          'No microphone detected. Plug in / select a mic in your OS sound settings, then click the mic button again.',
          { duration: 8000 }
        );
      } else if (name === 'NotReadableError' || /could not start|track start failed/i.test(msg)) {
        toast.error(
          'Your mic is busy in another app (Zoom / Meet / phone). Close it, then click the mic button again.',
          { duration: 8000 }
        );
      } else if (name === 'OverconstrainedError') {
        toast.error('Selected mic doesn\'t support our settings. Pick another mic in your OS sound settings and retry.', { duration: 8000 });
      } else if (name === 'AbortError') {
        // User dismissed the prompt — no toast, they cancelled deliberately.
      } else {
        toast.error(`Couldn't ${next ? 'unmute' : 'mute'} mic${msg ? `: ${msg}` : ''}`, { duration: 6000 });
      }
    }
  }, [audioOn]);

  const toggleScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !screenOn;
    logShareEvent('note', `livekit toggleScreen → ${next}`);
    // Mark this so syncLocal knows the upcoming Unpublished event was
    // user-initiated (no "screen sharing stopped" toast for clicks we
    // dispatched ourselves).
    userToggledScreenRef.current = true;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
      logShareEvent('note', `livekit screen share=${next}`);
      if (next) {
        // Acquire tab keep-alive so Chrome doesn't background-throttle
        // the LiveKit websocket / capture when the user switches tabs.
        // Refcounted globally — safe to call alongside the screen-share
        // manager's own acquire.
        if (!holdsKeepAliveRef.current) {
          acquireTabKeepAlive();
          holdsKeepAliveRef.current = true;
        }
        // Acquire a screen wake-lock. macOS / Windows aggressively put
        // the display to sleep on idle laptops; that kills the
        // getDisplayMedia track and is the #1 cause of "screen sharing
        // turned off without me clicking anything" tickets. Wake-lock
        // is gracefully unsupported on Safari < 16.4 and Firefox; the
        // try/catch + capability check below makes it a no-op there.
        try {
          const nav: any = navigator;
          if (nav?.wakeLock?.request) {
            // Release any previous lock first — defensive.
            if (wakeLockRef.current) { try { await wakeLockRef.current.release(); } catch { /* ignore */ } }
            wakeLockRef.current = await nav.wakeLock.request('screen');
            logShareEvent('note', 'wake-lock acquired while sharing');
            wakeLockRef.current.addEventListener?.('release', () => {
              // OS released it (e.g. tab backgrounded). We'll re-acquire
              // on visibility flip below.
              logShareEvent('note', 'wake-lock released by OS');
              wakeLockRef.current = null;
            });
          }
        } catch (e: any) {
          logShareEvent('error', 'wake-lock request failed', { message: e?.message });
        }
      } else {
        // Stopped sharing → release the wake-lock; nothing to keep awake.
        if (wakeLockRef.current) {
          try { await wakeLockRef.current.release(); } catch { /* ignore */ }
          wakeLockRef.current = null;
        }
        // Drop our tab keep-alive reference. If the screen-share
        // manager (or another caller) still holds a refcount the
        // silent audio loop keeps running.
        if (holdsKeepAliveRef.current) {
          releaseTabKeepAlive();
          holdsKeepAliveRef.current = false;
        }
      }
    } catch (e: any) {
      // User cancelled the screen picker — silent in console, recorded in
      // the share-event ring so support can see why.
      log('toggleScreen failed/cancelled', e);
      logShareEvent('error', `livekit toggleScreen failed`, { message: e?.message });
      // We armed userToggledScreenRef but the call failed; clear it so a
      // later unexpected unpublish still surfaces.
      userToggledScreenRef.current = false;
    }
  }, [screenOn]);
  // Keep the forward ref synced so syncLocal's "Share again" toast
  // action can invoke the latest toggleScreen.
  toggleScreenRef.current = toggleScreen;

  // Cleanup on unmount.
  useEffect(() => () => { leaveMeeting(); }, []); // eslint-disable-line

  // ── Re-acquire wake-lock on tab-visible (while sharing) ───────────────────
  // The OS auto-releases screen wake-locks when the tab goes to background.
  // When the user comes back, re-acquire so the next idle period doesn't
  // sleep the display and kill the share again.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!screenOnRef.current) return;
      if (wakeLockRef.current) return;
      try {
        const nav: any = navigator;
        if (!nav?.wakeLock?.request) return;
        wakeLockRef.current = await nav.wakeLock.request('screen');
        logShareEvent('note', 'wake-lock re-acquired on tab visible');
      } catch { /* ignore */ }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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
