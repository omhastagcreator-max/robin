import { useEffect, useRef, useState } from 'react';
import { Headphones, ChevronDown, ChevronUp, PhoneOff, Mic, MicOff, AlertTriangle } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';

declare global { interface Window { JitsiMeetExternalAPI?: any } }

const JITSI_DOMAIN = 'meet.jit.si';
const SCRIPT_SRC   = `https://${JITSI_DOMAIN}/external_api.js`;

/**
 * Persistent huddle dock — Jitsi-based audio + screen-share huddle that
 * lives at the top of the React tree (above AppRoutes), so the iframe
 * survives every page navigation.
 *
 * Two important UI tricks for reliability:
 *   1. The Jitsi container ALWAYS has real CSS dimensions while a call is
 *      live. We slide the whole panel off-screen with `translateY(100%)`
 *      to "minimise" instead of shrinking to 0×0, because Chrome will
 *      pause / break media in zero-sized iframes.
 *   2. We ALWAYS render the container <div> in the DOM (even when idle)
 *      so the ref is stable. The Jitsi API mounts into it on Join.
 */
export function HuddleDock() {
  const { user, role } = useAuth();
  const internal = role === 'admin' || role === 'employee' || role === 'sales';
  const { mode, join, leave, collapse, expand, setParticipantCount, markJoined, participantCount } = useHuddle();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef       = useRef<any>(null);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable per-org room.
  const orgId = (user as any)?.organizationId || 'global';
  const roomName = `RobinAgency_${orgId}_huddle`;

  // ── Boot Jitsi when the user clicks Join ─────────────────────────────────
  useEffect(() => {
    if (!internal) return;
    if (mode !== 'joining' || apiRef.current || !containerRef.current) return;

    let disposed = false;

    const ensureScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.JitsiMeetExternalAPI) { resolve(); return; }
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
        if (existing) {
          existing.addEventListener('load',  () => resolve());
          existing.addEventListener('error', () => reject(new Error('Jitsi script failed to load')));
          return;
        }
        const s = document.createElement('script');
        s.src = SCRIPT_SRC; s.async = true;
        s.onload  = () => resolve();
        s.onerror = () => reject(new Error('Jitsi script failed to load'));
        document.body.appendChild(s);
      });

    setError(null);

    ensureScript().then(() => {
      if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) return;

      // Clear any prior iframe (HMR etc).
      containerRef.current.innerHTML = '';

      const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName,
        parentNode: containerRef.current,
        width:  '100%',
        height: '100%',
        userInfo: {
          displayName: user?.name || user?.email || 'Team member',
          email: user?.email,
        },
        configOverwrite: {
          // Keep the prejoin page so users see the explicit mic permission
          // dialog and can choose their audio device. Without it, some users
          // were ending up muted with no clear path to grant permission.
          prejoinPageEnabled:  true,
          // Always start with video muted — we never want camera.
          startWithVideoMuted: true,
          // Still let Jitsi acquire the mic device up front.
          disableInitialGUM:   false,
          startWithAudioMuted: false,
          disableProfile:      true,
          // No camera button anywhere.
          toolbarButtons: [
            'microphone', 'desktop', 'chat', 'raisehand',
            'tileview', 'fullscreen', 'settings', 'participants-pane', 'hangup',
          ],
        },
        interfaceConfigOverwrite: {
          DEFAULT_BACKGROUND:        '#000',
          DISABLE_VIDEO_BACKGROUND:  true,
          HIDE_INVITE_MORE_HEADER:   true,
          MOBILE_APP_PROMO:          false,
          SHOW_JITSI_WATERMARK:      false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          TOOLBAR_BUTTONS: [
            'microphone', 'desktop', 'chat', 'raisehand',
            'tileview', 'fullscreen', 'settings', 'hangup',
          ],
        },
      });

      apiRef.current = api;

      api.addEventListener('videoConferenceJoined', () => {
        markJoined();
        // Read initial mute state — Jitsi may auto-mute new participants
        try { api.isAudioMuted?.().then((m: boolean) => setMuted(!!m)); } catch { /* ignore */ }
      });
      api.addEventListener('readyToClose', () => {
        try { api.dispose(); } catch { /* ignore */ }
        apiRef.current = null;
        leave();
      });
      api.addEventListener('audioMuteStatusChanged', (e: any) => setMuted(!!e.muted));

      const updateCount = () => {
        try {
          const list = api.getParticipantsInfo?.() || [];
          setParticipantCount(list.length + 1); // +1 for self
        } catch { /* ignore */ }
      };
      api.addEventListener('participantJoined', updateCount);
      api.addEventListener('participantLeft',   updateCount);
    }).catch((err: Error) => {
      setError(err.message || 'Could not load the huddle. Check your internet.');
      leave();
    });

    return () => { disposed = true; };
  }, [mode, internal, roomName, user?.name, user?.email, markJoined, setParticipantCount, leave]);

  // Tear down iframe on actual leave
  useEffect(() => {
    if (mode === 'idle' && apiRef.current) {
      try { apiRef.current.dispose(); } catch { /* ignore */ }
      apiRef.current = null;
      setMuted(true);
    }
  }, [mode]);

  if (!internal) return null;

  const toggleMic = () => { try { apiRef.current?.executeCommand('toggleAudio'); } catch {} };
  const handleLeave = () => {
    try { apiRef.current?.executeCommand('hangup'); } catch {}
    try { apiRef.current?.dispose(); } catch {}
    apiRef.current = null;
    leave();
  };

  // The panel is ALWAYS rendered with real dimensions. We slide it
  // off-screen with translateY when it shouldn't be visible — that way
  // the Jitsi iframe never sees a 0×0 container (which Chrome treats as
  // hidden and pauses media in).
  // Joining + expanded both show the panel: while joining, the user needs
  // to see the Jitsi prejoin page to grant mic permission.
  const panelVisible = mode === 'expanded' || mode === 'joining';

  return (
    <>
      {/* Idle — single floating "Join huddle" pill */}
      {mode === 'idle' && (
        <button
          onClick={join}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
          title="Join the agency huddle"
        >
          <Headphones className="h-4 w-4" />
          <span className="text-sm font-semibold">Join huddle</span>
        </button>
      )}

      {/* Collapsed — small status pill with quick mic + leave + expand. */}
      {mode === 'collapsed' && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 bg-card border border-primary/40 rounded-full pl-4 pr-1.5 py-1.5 shadow-xl">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium">
            In huddle{participantCount > 0 ? ` · ${participantCount}` : ''}
          </span>
          <button
            onClick={toggleMic}
            title={muted ? 'Unmute' : 'Mute'}
            className={`ml-2 h-7 w-7 rounded-full flex items-center justify-center text-white transition-colors ${
              muted ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={expand}
            title="Show huddle"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={handleLeave}
            title="Leave huddle"
            className="h-7 w-7 rounded-full flex items-center justify-center bg-red-500/15 hover:bg-red-500/30 text-red-500"
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Persistent Jitsi panel — always rendered with real dimensions.
          Slides off-screen via translateY when not visible. The container
          <div> below is the single source of truth for the ref so Jitsi
          mounts into the same DOM node across all mode transitions. */}
      <div
        className="fixed left-1/2 z-40 transition-transform duration-200"
        style={{
          bottom: 0,
          width:   'min(960px, calc(100% - 1rem))',
          height:  'min(60vh, 560px)',
          transform: panelVisible ? 'translateX(-50%)' : 'translate(-50%, 110%)',
          pointerEvents: panelVisible ? 'auto' : 'none',
        }}
      >
        <div className="bg-card border border-border rounded-t-2xl overflow-hidden h-full flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
            <Headphones className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Live huddle</p>
            {participantCount > 0 && (
              <span className="text-[10px] bg-primary/15 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full">
                {participantCount} {participantCount === 1 ? 'person' : 'people'}
              </span>
            )}
            {muted && (
              <span className="text-[10px] flex items-center gap-1 text-red-500 font-medium">
                <MicOff className="h-3 w-3" /> Mic off — click the toolbar mic to unmute
              </span>
            )}
            <button
              onClick={collapse}
              className="ml-auto h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
              title="Minimise (call keeps running)"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={handleLeave}
              className="h-7 px-2 rounded-full flex items-center gap-1 bg-red-500 text-white text-xs font-medium hover:bg-red-600"
              title="Leave huddle"
            >
              <PhoneOff className="h-3 w-3" /> Leave
            </button>
          </div>

          {/* Jitsi iframe lives here — single, stable ref */}
          <div ref={containerRef} className="w-full flex-1 bg-black" />
        </div>
      </div>

      {/* Inline error banner */}
      {error && (
        <div className="fixed bottom-20 right-4 z-50 max-w-sm bg-red-500/10 border border-red-500/30 text-red-600 text-xs px-3 py-2 rounded-xl shadow-lg flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Couldn't start the huddle</p>
            <p className="opacity-80">{error}</p>
          </div>
        </div>
      )}
    </>
  );
}

export default HuddleDock;
