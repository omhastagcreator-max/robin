import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import { useAuth } from '@/contexts/AuthContext';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { useSocket } from '@/hooks/useSocket';
import * as api from '@/api';
import { useHuddleTranscription } from '@/hooks/useHuddleTranscription';
import { HuddlePiPContent } from '@/components/shared/HuddlePiPContent';
import { RemoteAudio } from '@/components/shared/RemoteAudio';
import type { IceSource } from '@/lib/iceServers';
import { screenShareManager } from '@/lib/screenShareManager';
import { logShareEvent } from '@/lib/screenShareDebug';
import { acquireTabKeepAlive, releaseTabKeepAlive } from '@/lib/tabKeepAlive';

type HuddleMode = 'idle' | 'joining' | 'expanded' | 'collapsed';

interface HuddleApi {
  // UI mode state
  mode: HuddleMode;
  join: () => void;
  leave: () => void;
  collapse: () => void;
  expand: () => void;

  // Meeting state (read from the single useMeetingRoom instance below)
  joined: boolean;
  joining: boolean;
  peers: PeerView[];
  localStream: MediaStream | null;
  audioOn: boolean;
  screenOn: boolean;
  meetingError: string | null;
  networkBlocked: boolean;
  iceMeta: { source: IceSource; count: number };
  participantCount: number;

  // Meeting actions
  toggleAudio: () => void;
  toggleScreen: () => void;

  // "Deafen" — mute incoming huddle audio without leaving. Useful when
  // you're in a different meeting in another tab.
  deafened: boolean;
  toggleDeafen: () => void;

  // AI scribe state
  scribe: {
    supported: boolean;
    listening: boolean;
    lastError: string | null;
    linesPosted: number;
  };

  // Document Picture-in-Picture (always-on-top floating mini panel)
  pip: {
    supported: boolean;
    isOpen: boolean;
    container: HTMLElement | null;
    open: () => Promise<void>;
    close: () => void;
    autoEnabled: boolean;
    setAutoEnabled: (on: boolean) => void;
  };
}

const HuddleContext = createContext<HuddleApi | null>(null);

/**
 * SINGLE source of truth for the huddle. Calls useMeetingRoom ONCE here
 * (not in HuddleDock + HuddleStage separately) so we only ever have one
 * mesh peer connection per teammate. Two instances would build duplicate
 * RTCPeerConnections and exhaust the browser's media resources, which
 * was causing tab hangs (Aw, Snap! / RESULT_CODE_HUNG).
 *
 * Lives at the BrowserRouter level (above AppRoutes) so the call survives
 * page navigation.
 */
export function HuddleProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const socket = useSocket();
  // Read the OTHER screen-share system's state so the auto-share-on-join
  // effect can skip itself when the user is already broadcasting via
  // useWebRTCSender. Two getDisplayMedia captures racing each other was the
  // real cause of "screen sharing stops automatically" — Chrome ends the
  // first track when the second one is acquired.
  const { isSharing: alreadyBroadcasting } = useScreenShare();
  const [mode, setMode] = useState<HuddleMode>('idle');

  // The ONE useMeetingRoom instance for the whole app.
  const meeting = useMeetingRoom({
    userId:   user?.id || '',
    userName: user?.name,
    userRole: role,
    roomId:   'agency-global',
  });

  // ── Document Picture-in-Picture (PiP mini-panel) ────────────────────────
  // We hold the PiP state HERE (not in HuddleMicPiP) because the open call
  // needs "transient activation" — the click that triggers `join()` is the
  // only moment we have permission to spawn the PiP window. So join() itself
  // calls openPiP() synchronously when auto-pop is enabled.
  // Deafen — mute incoming huddle audio. Persisted so toggling carries
  // across page navigations (e.g., dashboard → workroom).
  const [deafened, setDeafened] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('robin.huddle.deafened') === 'true';
  });
  const toggleDeafen = useCallback(() => {
    setDeafened(prev => {
      const next = !prev;
      localStorage.setItem('robin.huddle.deafened', next ? 'true' : 'false');
      return next;
    });
  }, []);

  // Push the deafened flag through to LiveKit's auto-attached audio
  // elements via track.setVolume(0). Without this, only our own
  // RemoteAudio element was muted while LiveKit's internal one kept
  // playing — the user heard everyone anyway.
  useEffect(() => {
    if (!meeting.setRemoteAudioVolume) return;
    meeting.setRemoteAudioVolume(deafened ? 0 : 1);
  }, [deafened, meeting.setRemoteAudioVolume, meeting.joined]);

  // Broadcast deafen state so other teammates' UI shows a "muted you"
  // badge — they stop yelling someone's name when they're muted.
  // Server relays this to everyone but us via presence:deafened.
  useEffect(() => {
    if (!socket) return;
    socket.emit('presence:deafen', { on: deafened });
  }, [deafened, socket]);

  // ── Whole-tab mute (bulletproof) ───────────────────────────────────────
  // Earlier versions used a MutationObserver scoped to document.body. Two
  // sources of audio leaked past it: LiveKit's auto-attached elements
  // sometimes mount outside <body>, and React re-renders of components
  // like LiveTile/<video> can replace nodes faster than the observer
  // fires. The fix is three-pronged:
  //
  //   1. Walk the WHOLE document (documentElement, not just body).
  //   2. MutationObserver on documentElement covers new mounts.
  //   3. setInterval re-applies every 500ms to catch anything that gets
  //      un-muted by a re-render or by a library setting muted=false.
  //
  // We track elements WE muted via WeakSet so on undeafen we only
  // restore what we changed — won't unmute videos the user had muted
  // before (e.g., a chat embed they manually silenced).
  useEffect(() => {
    if (!deafened) return;

    const ours = new WeakSet<HTMLMediaElement>();

    // Skip any audio element that lives inside a region tagged as a
    // client-meeting audio sink. Critical fix: previously the team-mute
    // sweep walked the entire document and muted EVERY <audio> in it,
    // which silenced the live client call too. The client-meeting
    // portal now sets data-meeting-audio="client" on its wrapper; we
    // exclude descendants of any such wrapper, plus any element that
    // itself carries the same attribute (defensive in case the tag
    // moves directly onto the audio node later).
    const shouldSkip = (el: HTMLMediaElement) =>
      !!el.closest('[data-meeting-audio="client"]') ||
      el.dataset?.meetingAudio === 'client';

    const muteAll = () => {
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        if (shouldSkip(el)) return;
        if (!el.muted) {
          el.muted = true;
          ours.add(el);
        }
      });
    };
    muteAll();

    // Watch the entire document tree, not just <body>. Throttle the handler
    // — without throttling, a single chat scroll fires thousands of mutation
    // events, each triggering a full document.querySelectorAll('audio,video')
    // walk. Coalesce into one walk per animation frame instead.
    let scheduled = false;
    const scheduleMuteAll = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; muteAll(); });
    };
    const observer = new MutationObserver(scheduleMuteAll);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Periodic safety net for any element a re-render un-mutes — but only
    // while the tab is visible. Backgrounded tabs can't play sound that
    // matters anyway, and the 2Hz interval was burning battery.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      muteAll();
    }, 1000);

    return () => {
      observer.disconnect();
      clearInterval(interval);
      // Restore: only unmute elements we muted.
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        if (ours.has(el)) {
          try { el.muted = false; } catch { /* ignore */ }
        }
      });
    };
  }, [deafened]);

  const pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const pipWindowRef = useRef<any>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipAutoEnabled, setPipAutoEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('robin.huddle.autoPiP') !== 'false'; // default on
  });
  const setPipAutoEnabled = useCallback((on: boolean) => {
    setPipAutoEnabledState(on);
    localStorage.setItem('robin.huddle.autoPiP', on ? 'true' : 'false');
  }, []);

  const openPiP = useCallback(async () => {
    if (!pipSupported || pipWindowRef.current) return;
    // Synchronous lock — claim the slot BEFORE the async request returns so
    // a second rapid call (e.g. double click on Join, or visibilitychange
    // racing the join click) can't spawn a duplicate PiP window. We replace
    // the placeholder with the real window on success, or null on failure.
    pipWindowRef.current = 'pending' as any;
    try {
      // Default size restored to the original 360×560 (owner preferred
      // the prior look — the wider default felt heavy on small monitors).
      const w = await (window as any).documentPictureInPicture.requestWindow({
        width: 360,
        height: 560,
      });

      // ── Loading splash so the window is never visually empty ──────────
      // We paint this immediately, before React or styles arrive. Once
      // React mounts and Tailwind kicks in, our content covers it.
      w.document.title = 'Robin Huddle';
      w.document.body.style.margin = '0';
      w.document.body.innerHTML = `
        <div id="robin-pip-splash" style="
          position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
          gap:8px;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;
          font-size:13px;letter-spacing:.02em;z-index:1;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2px solid rgba(255,255,255,.2);border-top-color:#fff;
            animation:robin-pip-spin .8s linear infinite;"></span>
          Loading Robin huddle…
          <style>@keyframes robin-pip-spin { to { transform: rotate(360deg) } }</style>
        </div>
      `;

      // ── Stylesheet copy strategy (belt + suspenders) ──────────────────
      // 1) Modern path: adoptedStyleSheets — single shared sheet object,
      //    much faster + survives DOM mutations. Chrome 99+, Edge 99+.
      // 2) Fallback: clone every <style> tag's text content.
      // 3) Cross-origin sheets we can't read get re-linked via <link>.
      // 4) Copy <link rel="stylesheet"> tags directly (CDN fonts etc).
      const adoptable: any[] = [];
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const css = Array.from(sheet.cssRules || []).map((r: any) => r.cssText).join('\n');
          if (!css) return;
          // Try adoptedStyleSheets first
          try {
            // @ts-ignore — CSSStyleSheet constructor + replaceSync
            const cs = new w.CSSStyleSheet();
            cs.replaceSync(css);
            adoptable.push(cs);
          } catch {
            const styleEl = w.document.createElement('style');
            styleEl.textContent = css;
            w.document.head.appendChild(styleEl);
          }
        } catch {
          if (sheet.href) {
            const link = w.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            w.document.head.appendChild(link);
          }
        }
      });
      try {
        if (adoptable.length) (w.document as any).adoptedStyleSheets = adoptable;
      } catch { /* ignore */ }

      // Also clone any <link rel="stylesheet"> from the parent head (CDN fonts)
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach((node) => {
        const link = w.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = (node as HTMLLinkElement).href;
        w.document.head.appendChild(link);
      });

      // Copy CSS variables from :root so dark/light theme tokens still resolve
      const rootStyle = getComputedStyle(document.documentElement);
      const rootDecls: string[] = [];
      for (let i = 0; i < rootStyle.length; i += 1) {
        const prop = rootStyle.item(i);
        if (prop.startsWith('--')) {
          rootDecls.push(`${prop}: ${rootStyle.getPropertyValue(prop)};`);
        }
      }
      if (rootDecls.length) {
        const varStyle = w.document.createElement('style');
        varStyle.textContent = `:root, html, body { ${rootDecls.join(' ')} }`;
        w.document.head.appendChild(varStyle);
      }

      // Inherit body theme from parent
      const cs = getComputedStyle(document.body);
      w.document.body.style.background = cs.background || '#0a0a0a';
      w.document.body.style.color = cs.color || '#fff';
      w.document.body.style.fontFamily = cs.fontFamily;

      // Mount the React root container ABOVE the splash so when React paints,
      // its content visually covers the splash. (We don't remove the splash —
      // simpler, and the splash is never seen again once content paints.)
      const root = w.document.createElement('div');
      root.id = 'robin-pip-root';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.zIndex = '10';
      w.document.body.appendChild(root);

      // Closing the PiP resets state.
      w.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipContainer(null);
      });

      pipWindowRef.current = w;
      setPipContainer(root);

      // Splash auto-hide. The portal SHOULD paint over the splash via its
      // higher z-index, but if anything goes wrong (LiveKit stall, render
      // error, etc.) we don't want the user staring at "Loading…" forever.
      // After 5s we hide the splash unconditionally — at worst they see
      // their dark theme body until things recover.
      setTimeout(() => {
        try {
          const splash = w.document.getElementById('robin-pip-splash');
          if (splash) splash.style.display = 'none';
        } catch { /* PiP may have been closed already */ }
      }, 5000);
    } catch (e) {
      // Release the lock on failure so a future click can try again.
      pipWindowRef.current = null;
      console.warn('[huddle] PiP open failed', e);
    }
  }, [pipSupported]);

  const closePiP = useCallback(() => {
    try { pipWindowRef.current?.close(); } catch { /* ignore */ }
    pipWindowRef.current = null;
    setPipContainer(null);
  }, []);

  // ── Wire mode <-> meeting lifecycle ─────────────────────────────────────
  // join() flips mode to 'joining' which triggers meeting.joinMeeting() below.
  // It ALSO opens the PiP window if auto-pop is enabled — this MUST happen
  // synchronously inside the click handler so the browser sees a valid user
  // activation. (Open later in a useEffect → "Transient activation required".)
  const join = useCallback(() => {
    // NOTE: an earlier version of this function primed mic permission
    // synchronously via getUserMedia({ audio: true }) to work around a
    // Safari user-activation issue. That turned out to race with
    // LiveKit's own mic acquisition and stalled connections at
    // "connecting…" for everyone. Removed. Safari mic prompt is now
    // handled by joinMeeting() itself; see useMeetingRoom.ts.
    setMode(m => (m === 'idle' ? 'joining' : m));
    if (pipAutoEnabled && pipSupported && !pipWindowRef.current) {
      // Fire-and-forget; the click activation flows into requestWindow.
      void openPiP();
    }
  }, [pipAutoEnabled, pipSupported, openPiP]);

  // Refs that drive auto-join + auto-rejoin enforcement. Declared HERE
  // (above `leave`) so the leave handler can reset them in the same
  // closure — keeping the two pieces of state colocated with the
  // function that mutates them. See the auto-join useEffect below for
  // how they get consumed.
  const autoJoinedRef = useRef(false);
  const lastLeaveAtRef = useRef<number>(0);

  const leave = useCallback(() => {
    meeting.leaveMeeting();
    setMode('idle');
    closePiP();
    // Record the leave timestamp + arm a re-join so the user gets
    // pulled back in after the REJOIN_DELAY_MS cooldown (handled in
    // the auto-join effect). Without resetting autoJoinedRef the
    // effect's mount-once guard would block re-entry permanently.
    lastLeaveAtRef.current = Date.now();
    autoJoinedRef.current = false;
  }, [meeting, closePiP]);
  const collapse = useCallback(() => setMode(m => (m === 'expanded' ? 'collapsed' : m)), []);
  const expand   = useCallback(() => setMode(m => (m === 'collapsed' || m === 'joining' ? 'expanded' : m)), []);

  // Voice / text command bridge — robinActions.ts dispatches these
  // window events when the user says "join the huddle" / "leave the
  // huddle" / "log me in" / "log me out". The handlers run inside the
  // HuddleContext so the React state stays consistent.
  useEffect(() => {
    const onJoin  = () => { try { join();  } catch { /* swallow */ } };
    const onLeave = () => { try { leave(); } catch { /* swallow */ } };
    window.addEventListener('robin:huddle-join',  onJoin);
    window.addEventListener('robin:huddle-leave', onLeave);
    return () => {
      window.removeEventListener('robin:huddle-join',  onJoin);
      window.removeEventListener('robin:huddle-leave', onLeave);
    };
  }, [join, leave]);

  // ── Auto-join (and auto-REJOIN) on login ──────────────────────────────
  // The agency rule (May 2026, v2): EVERYONE in the org — admins included
  // — is expected to be in the huddle when they're clocked in. The
  // previous auto-join was single-shot per HuddleProvider mount, so a
  // user who clicked Leave would just stay out for the rest of the
  // session. Combined with HuddleRequiredBanner on the page, that turned
  // into "user dismisses banner mentally and works without joining."
  //
  // The new behaviour:
  //   - Initial auto-join still happens once per provider mount, ~400ms
  //     after the user is loaded.
  //   - When the user clicks Leave, `autoJoinedRef` is RESET so the
  //     effect below sees `mode === 'idle'`, no error, and re-fires.
  //     A small `lastLeaveAt` debounce prevents an immediate re-join
  //     loop (the user needs a few seconds to actually leave, e.g.
  //     during a hard reload), but otherwise the system keeps pulling
  //     them back in.
  //   - Admins are now INCLUDED. Owner ask: leadership shouldn't be
  //     visibly exempt from the same rule the team has.
  //   - Clients still excluded (external — not a huddle participant).
  //   - Escape hatch (`robin.huddle.autoJoinDisabled`) honoured — for
  //     anyone who needs to legitimately stay out (focus block,
  //     contractor mode, etc.).
  //   - Bail if `meetingError` is set — we already attempted and failed
  //     this session; user has to retry manually so we don't hammer
  //     LiveKit Cloud and get 429'd.
  //
  // PiP doesn't get auto-popped here — that requires a transient user
  // gesture which we don't have for an auto-fire. The existing PiP
  // auto-reopen effect catches the very next click and pops it then.
  // Re-attempt delay after a manual Leave click. ~10s gives the user
  // time to e.g. close the tab if they're actually trying to log off.
  const REJOIN_DELAY_MS = 10_000;
  useEffect(() => {
    if (!user) return;
    if (mode !== 'idle') return;
    if (meeting.joining || meeting.joined) return;
    if (meeting.error) return;

    // Clients are the only role we leave alone.
    if (role === 'client') return;

    // User-level escape hatch.
    try {
      if (localStorage.getItem('robin.huddle.autoJoinDisabled') === '1') return;
    } catch { /* private mode — proceed with auto-join */ }

    // Initial vs. re-join sizing — first time on this mount uses a
    // ~400ms warm-up. After a manual Leave we wait REJOIN_DELAY_MS
    // since `lastLeaveAtRef` was set.
    const sinceLeave = Date.now() - lastLeaveAtRef.current;
    const wait = autoJoinedRef.current
      ? Math.max(0, REJOIN_DELAY_MS - sinceLeave)
      : 400;

    autoJoinedRef.current = true;
    // Flip mode to 'joining' DIRECTLY — not via join() — because join()
    // chains into openPiP() which requires a transient user activation
    // we don't have here. The single-shot effect downstream fires the
    // real meeting.joinMeeting() either way, and the PiP auto-reopen
    // listener catches the user's very next click.
    const t = setTimeout(() => {
      setMode(m => (m === 'idle' ? 'joining' : m));
    }, wait);
    return () => clearTimeout(t);
  }, [user, role, mode, meeting.joining, meeting.joined, meeting.error]);

  // ── Single-shot join (no auto-retry loop) ──────────────────────────────
  //
  // Earlier this useEffect re-fired joinMeeting() every time `meeting.joining`
  // flipped false. Intended as a "retry on failure" but produced the worst
  // possible behaviour: after a single failure (e.g. server outage), the loop
  // would dial LiveKit Cloud every ~15s until they returned 429 Too Many
  // Requests, after which NO connection could ever establish and the UI sat
  // at "Connecting…" indefinitely. (See May-2026 incident — Om's machine.)
  //
  // Now: we attempt exactly ONCE per click. If it fails, mode flips back to
  // 'idle' and `meetingError` surfaces the cause so the user can decide
  // whether to retry. The user re-clicks Join to try again. Rate limits
  // clear in ~minutes; we don't poke the server during that window.
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (mode === 'joining' && !meeting.joined && !meeting.joining && !attemptedRef.current) {
      attemptedRef.current = true;
      meeting.joinMeeting();
    }
    // Reset the latch whenever we leave the 'joining' state so the next
    // user click is a fresh attempt.
    if (mode !== 'joining') attemptedRef.current = false;
  }, [mode, meeting.joined, meeting.joining, meeting]);

  // ── Auto-recover when joinMeeting() surfaces an error ──────────────────
  // joinMeeting catches its own errors and calls setError(msg) — but it
  // doesn't (and shouldn't) know about the higher-level `mode` state. Here
  // we flip mode back to 'idle' so the pill returns to "Join huddle"
  // instead of "Connecting…" indefinitely. The error message stays on
  // meeting.error so the UI can show it.
  useEffect(() => {
    if (mode === 'joining' && meeting.error && !meeting.joined && !meeting.joining) {
      setMode('idle');
    }
  }, [mode, meeting.error, meeting.joined, meeting.joining]);

  // Once useMeetingRoom is fully joined, flip to expanded so the panel shows.
  useEffect(() => {
    if (meeting.joined && (mode === 'idle' || mode === 'joining')) {
      setMode('expanded');
    }
  }, [meeting.joined, mode]);

  // ── Keep Robin's tab alive while the user is in the huddle ────────
  // Hooks the existing silent-audio keep-alive (lib/tabKeepAlive.ts)
  // into the huddle's joined state. Effect: any time the user is
  // joined, Chrome treats the tab as audio-active and refuses to
  // background-throttle it. Combined with the huddle enforcement
  // (auto-join, auto-rejoin, required banner), this means every
  // working employee's Robin tab stays fully responsive no matter
  // how many other tabs they switch to — websockets keep pinging,
  // timers keep firing, screen capture keeps running.
  //
  // Refcounted so we play nice with the screen-share manager and
  // useMeetingRoom (which both also acquire on their own paths).
  // The local ref prevents a double-acquire across StrictMode mounts.
  const huddleKeepAliveHeldRef = useRef(false);
  useEffect(() => {
    if (meeting.joined && !huddleKeepAliveHeldRef.current) {
      acquireTabKeepAlive();
      huddleKeepAliveHeldRef.current = true;
    }
    if (!meeting.joined && huddleKeepAliveHeldRef.current) {
      releaseTabKeepAlive();
      huddleKeepAliveHeldRef.current = false;
    }
    // Final release on provider unmount — covers tab-close / logout
    // paths where meeting.joined never flips to false before teardown.
    return () => {
      if (huddleKeepAliveHeldRef.current) {
        releaseTabKeepAlive();
        huddleKeepAliveHeldRef.current = false;
      }
    };
  }, [meeting.joined]);

  // ── Tie working time to huddle attendance ───────────────────────────
  // The agency rule is "you're at work when you're in the huddle." When
  // LiveKit reports joined/left, ping the server so it can start/pause
  // the work counter. Both endpoints are silent + idempotent so the
  // network stays clean during a flaky connection.
  //
  // Also fire huddleLeft on tab close (best-effort sendBeacon-style) so
  // the server doesn't keep counting after the browser is killed —
  // sessionEnd's finalisation also handles this case as a backstop.
  useEffect(() => {
    if (!user) return;
    if (meeting.joined) {
      api.huddleJoined().catch(() => {/* silent */});
    } else {
      api.huddleLeft().catch(() => {/* silent */});
    }
  }, [meeting.joined, user?.id]);

  // Best-effort huddle-left on hard tab close. Uses the standard fetch
  // with keepalive so the request survives the unload — sendBeacon would
  // need a different content-type. Server treats no-op gracefully.
  useEffect(() => {
    if (!meeting.joined) return;
    const onUnload = () => {
      try {
        const token = localStorage.getItem('robin_token');
        const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
        fetch(`${baseURL}/sessions/huddle-left`, {
          method: 'POST',
          keepalive: true,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch { /* unload, can't do much */ }
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [meeting.joined]);

  // ── Open PiP the moment meeting.joined transitions to true ────────
  // The join() function opens PiP inside the click handler (when the
  // user pressed "Log In" / "Join huddle"). But the actual LiveKit
  // connection completes a beat later — meeting.joined goes from false
  // → true. At that moment a fresh PiP attempt is more likely to
  // succeed because:
  //   (a) the user-activation token from the original click is still
  //       fresh (~5s window)
  //   (b) the huddle is now actually connected so the PiP shows real
  //       content instead of the "connecting…" splash
  // The activation listener below handles the case where the original
  // activation expired — but firing here too means most users see PiP
  // pop the instant they're in, like Google Meet's "Open PiP" UX.
  const lastJoinedRef = useRef(false);
  useEffect(() => {
    if (!pipSupported || !pipAutoEnabled) return;
    if (meeting.joined && !lastJoinedRef.current) {
      lastJoinedRef.current = true;
      // Tiny defer so the rest of the join effects settle first.
      const t = setTimeout(() => {
        if (!pipWindowRef.current) openPiP().catch(() => { /* needs another click */ });
      }, 200);
      return () => clearTimeout(t);
    }
    if (!meeting.joined) lastJoinedRef.current = false;
  }, [meeting.joined, pipSupported, pipAutoEnabled, openPiP]);

  // ── Aggressive PiP auto-reopen ────────────────────────────────────────
  // Browser security rule: documentPictureInPicture.requestWindow() only
  // works inside *transient user activation* — typically a click within the
  // last ~5 seconds. So the obvious approach (open PiP on visibilitychange)
  // fails the moment the user has been idle for more than 5s.
  //
  // The reliable workaround: treat ANY click/keydown inside Robin as fresh
  // activation, and re-open PiP if it isn't already open. Net effect: while
  // the user is using Robin, PiP gets re-opened on the very next interaction
  // after any accidental close — and PiP windows persist when the parent
  // tab loses focus, so once it's open it stays open while they work in
  // another app.
  //
  // We still try visibilitychange + blur as a best-effort secondary trigger
  // in case Chrome happens to allow it (sometimes it does, depending on
  // recent activity); failures are silently swallowed.
  useEffect(() => {
    if (!pipSupported || !pipAutoEnabled) return;
    if (!meeting.joined) return;

    let lastAttemptAt = 0;
    const COOLDOWN_MS = 1500;

    const tryAutoPop = () => {
      if (pipWindowRef.current) return;          // already open
      if (Date.now() - lastAttemptAt < COOLDOWN_MS) return; // throttle
      lastAttemptAt = Date.now();
      openPiP().catch(() => { /* browser declined — try again next click */ });
    };

    // Capture-phase so we beat any stopPropagation downstream.
    const onUserInteraction = () => tryAutoPop();
    const onVis = () => { if (document.visibilityState === 'hidden') tryAutoPop(); };

    document.addEventListener('click',   onUserInteraction, { capture: true });
    document.addEventListener('keydown', onUserInteraction, { capture: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur',      tryAutoPop);

    return () => {
      document.removeEventListener('click',   onUserInteraction, { capture: true } as any);
      document.removeEventListener('keydown', onUserInteraction, { capture: true } as any);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur',      tryAutoPop);
    };
  }, [pipSupported, pipAutoEnabled, meeting.joined, openPiP]);

  // ── Auto-stop fix (May 2026, v3) ─────────────────────────────────────
  // Both the auto-share-on-join and the cross-system "manager wins" kill
  // were removed in this pass. Diagnosis: they were the primary cause of
  // screen sharing "auto-stopping for all roles."
  //
  //   - auto-share-on-join fired `meeting.toggleScreen()` 1.5s after
  //     every join. If ANYTHING else was about to call getDisplayMedia
  //     in that window (manager recovery, another tab, the user
  //     clicking Share manually a beat late), Chrome silently killed
  //     the older capture — the user perceived this as the share they
  //     just started "auto-stopping."
  //
  //   - the "manager wins" coord effect explicitly called
  //     meeting.toggleScreen() (i.e. stopped LiveKit screen share)
  //     every time the manager's snapshot reported `isSharing && screenOn`.
  //     Because the manager's subscribe fires on EVERY state change
  //     (track-mute, settings update, etc.), this could re-fire even
  //     after meeting.screenOn went false, depending on closure timing,
  //     and effectively yanked screen sharing away from users who never
  //     touched the broadcast button.
  //
  // Screen sharing is now strictly user-driven. The Start sharing
  // button in the huddle UI, the broadcast button in WorkRoom, and the
  // ScreenShareResumeBanner's Resume action are the only paths that
  // start a capture. Nothing automated will stop it; only the user's
  // own Stop click, Chrome's own pill, or a real OS event will.
  // ─────────────────────────────────────────────────────────────────
  // Reference `alreadyBroadcasting` so the linter doesn't flag it as
  // dead. Useful for downstream UI badges in this provider.
  void alreadyBroadcasting;

  const participantCount = meeting.peers.length + (meeting.joined ? 1 : 0);

  // ── AI Scribe ──────────────────────────────────────────────────────────
  // Browser Web Speech API listens to the user's mic while they're in the
  // huddle, transcribes their speech for free, and posts batched lines to
  // the server. End-of-day cron uses these to extract action items.
  // Currently OFF — flip `enabled` to `meeting.joined` to turn the agent on.
  const transcript = useHuddleTranscription({
    enabled: false,
    roomId:  'agency-global',
    language: 'en-IN',
  });

  const value = useMemo<HuddleApi>(() => ({
    mode, join, leave, collapse, expand,
    joined:        meeting.joined,
    joining:       meeting.joining,
    peers:         meeting.peers,
    localStream:   meeting.localStream,
    audioOn:       meeting.audioOn,
    screenOn:      meeting.screenOn,
    meetingError:  meeting.error,
    networkBlocked:meeting.networkBlocked,
    iceMeta:       meeting.iceMeta,
    participantCount,
    toggleAudio:   meeting.toggleAudio,
    toggleScreen:  meeting.toggleScreen,
    deafened,
    toggleDeafen,
    scribe: {
      supported:    transcript.supported,
      listening:    transcript.listening,
      lastError:    transcript.lastError,
      linesPosted:  transcript.linesPosted,
    },
    pip: {
      supported:    pipSupported,
      isOpen:       !!pipContainer,
      container:    pipContainer,
      open:         openPiP,
      close:        closePiP,
      autoEnabled:  pipAutoEnabled,
      setAutoEnabled: setPipAutoEnabled,
    },
  }), [
    mode, join, leave, collapse, expand,
    meeting.joined, meeting.joining, meeting.peers, meeting.localStream,
    meeting.audioOn, meeting.screenOn, meeting.error, meeting.networkBlocked,
    meeting.iceMeta, meeting.toggleAudio, meeting.toggleScreen,
    participantCount,
    transcript.supported, transcript.listening, transcript.lastError, transcript.linesPosted,
    pipSupported, pipContainer, openPiP, closePiP, pipAutoEnabled, setPipAutoEnabled,
    deafened, toggleDeafen,
  ]);

  return (
    <HuddleContext.Provider value={value}>
      {children}
      {/* PERSISTENT REMOTE AUDIO — one hidden <audio> per peer, mounted at the
          provider level so it survives every route change. Without this, the
          audio elements lived inside HuddleStage / HuddleDock and unmounted
          the moment you navigated away from /workroom — you'd stay connected
          to the LiveKit room but couldn't hear anyone.
          ─────────────────────────────────────────────────────────────────
          FIX (audio audit, May 2026): mount for EVERY peer with a stream,
          not only when peer.audioOn is true. The previous gate meant that
          if peer.audioOn was stale-false at mount time and the peer later
          unmuted, no audio element ever attached → user heard nothing.
          We now toggle mute via the `muted` prop instead, which React
          updates without unmount/remount. */}
      {meeting.peers.map(peer =>
        peer.stream ? (
          <RemoteAudio
            key={`global-audio-${peer.userId}`}
            stream={peer.stream}
            muted={deafened || !peer.audioOn}
          />
        ) : null,
      )}
      {/* PiP portal lives at the provider level so the floating window has
          content the moment it opens — independent of where in the React
          tree the user happens to be. */}
      {pipContainer && createPortal(<HuddlePiPContent />, pipContainer)}
    </HuddleContext.Provider>
  );
}

export function useHuddle(): HuddleApi {
  const ctx = useContext(HuddleContext);
  if (!ctx) throw new Error('useHuddle must be used inside HuddleProvider');
  return ctx;
}
