import { useEffect, useRef, useState } from 'react';
import { Loader2, Headphones } from 'lucide-react';

declare global {
  interface Window {
    JitsiMeetExternalAPI?: any;
  }
}

interface Props {
  /** Stable room name. Same value across teammates ⇒ same room. */
  roomName: string;
  /** Display name shown to other participants. */
  displayName?: string;
  /** Optional email used by Jitsi for the avatar (gravatar). */
  email?: string;
  /** Called when the user clicks Hangup / closes the meeting from inside Jitsi. */
  onLeave?: () => void;
}

const JITSI_DOMAIN = 'meet.jit.si';
const SCRIPT_SRC   = `https://${JITSI_DOMAIN}/external_api.js`;

/**
 * Embedded Jitsi Meet huddle — mic + screen-share + chat + raise hand,
 * no camera. Replaces the home-grown mesh WebRTC room which couldn't reach
 * Google-Meet level reliability without TURN infrastructure.
 *
 * Loads the Jitsi External API script lazily on first mount, mounts the
 * iframe into our container, and tears it down cleanly on unmount.
 */
export function JitsiHuddle({ roomName, displayName, email, onLeave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef       = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let disposed = false;

    const ensureScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.JitsiMeetExternalAPI) { resolve(); return; }
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
        if (existing) {
          existing.addEventListener('load',  () => resolve());
          existing.addEventListener('error', () => reject(new Error('Failed to load Jitsi script')));
          return;
        }
        const s = document.createElement('script');
        s.src = SCRIPT_SRC;
        s.async = true;
        s.onload  = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Jitsi script'));
        document.body.appendChild(s);
      });

    ensureScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) return;

        // Strip out any prior iframe (HMR or fast remount).
        containerRef.current.innerHTML = '';

        const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName,
          parentNode: containerRef.current,
          width: '100%',
          height: 580,
          userInfo: {
            displayName: displayName || 'Team member',
            email: email || undefined,
          },
          configOverwrite: {
            // Audio / video defaults — start muted, never auto-engage camera.
            startWithAudioMuted:    true,
            startWithVideoMuted:    true,
            disableInitialGUM:      false,
            prejoinPageEnabled:     false,
            disableProfile:         true,
            // Hide camera-related side rails, since we don't use video.
            disableSelfView:        true,
            disableTileEnlargement: false,
            // Toolbar — just the buttons we care about. Notably: no `camera`.
            toolbarButtons: [
              'microphone',
              'desktop',
              'chat',
              'raisehand',
              'tileview',
              'fullscreen',
              'settings',
              'participants-pane',
              'hangup',
            ],
          },
          interfaceConfigOverwrite: {
            DEFAULT_BACKGROUND:        '#000000',
            DISABLE_VIDEO_BACKGROUND:  true,
            HIDE_INVITE_MORE_HEADER:   true,
            MOBILE_APP_PROMO:          false,
            SHOW_JITSI_WATERMARK:      false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            TOOLBAR_BUTTONS: [
              'microphone',
              'desktop',
              'chat',
              'raisehand',
              'tileview',
              'fullscreen',
              'settings',
              'hangup',
            ],
          },
        });

        apiRef.current = api;
        setStatus('ready');

        api.addEventListener('readyToClose', () => {
          try { api.dispose(); } catch { /* ignore */ }
          apiRef.current = null;
          onLeave?.();
        });
      })
      .catch(() => { if (!disposed) setStatus('error'); });

    return () => {
      disposed = true;
      try { apiRef.current?.dispose(); } catch { /* ignore */ }
      apiRef.current = null;
    };
  }, [roomName, displayName, email, onLeave]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Headphones className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Live Huddle</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Audio · screen share · chat — no camera
        </span>
      </div>
      <div className="relative">
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card z-10 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Connecting to the huddle…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 px-6 text-center">
            <p className="text-sm font-semibold">Couldn't load the huddle</p>
            <p className="text-xs text-muted-foreground max-w-md">
              We rely on Jitsi (meet.jit.si) for the live audio + screen-share huddle. Check your internet
              connection or refresh the page to retry.
            </p>
          </div>
        )}
        <div ref={containerRef} className="w-full" style={{ minHeight: status === 'loading' ? 580 : 0 }} />
      </div>
    </div>
  );
}

export default JitsiHuddle;
