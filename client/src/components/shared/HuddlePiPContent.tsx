import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, MicOff, Monitor, MonitorOff, PhoneOff, ExternalLink, Phone, PhoneCall, Volume2, VolumeX } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useOnCall } from '@/hooks/useOnCall';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { HuddlePingChat } from '@/components/shared/HuddlePingChat';

/**
 * HuddlePiPContent — what gets rendered INSIDE the floating Document
 * Picture-in-Picture window. Acts as a self-sufficient mini control room
 * so the user never has to switch back to the main Robin tab while
 * working in another app.
 *
 * Layout (top → bottom, ~340x520):
 *   1. Top control bar: mic toggle, screen toggle, Open Workroom, Leave.
 *   2. Live screen strip: a compact tile per peer who's screen-sharing.
 *   3. Chat: the same HuddlePingChat used in the page (last messages + input).
 *
 * "Open Workroom" calls window.focus() to surface the original Robin tab,
 * then navigates it to /workroom. Useful if the user wants to see the full
 * Meet-style stage with bigger screens. PiP stays open meanwhile.
 *
 * Important: this component is rendered via React PORTAL into the PiP
 * window's DOM. Even though the DOM lives in a separate document, React
 * state and contexts (useHuddle, useAuth, useNavigate, useSocket) flow
 * through normally — that's how flipping the mic in PiP mutes you in the
 * real app.
 */
export function HuddlePiPContent() {
  const huddle = useHuddle();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isOnCall, toggle: toggleOnCall } = useOnCall();

  const screenSharers = huddle.peers.filter(p => p.screenOn);

  const handleOpenWorkroom = () => {
    try { window.focus(); } catch {}
    navigate('/workroom');
  };

  // Hide the splash on first paint — guarantees we never get stuck.
  // useEffect runs after the DOM is committed, so by the time this runs
  // our React content is already visible inside the PiP root container.
  useEffect(() => {
    try {
      const splash = (window as any).documentPictureInPicture?.window?.document?.getElementById('robin-pip-splash');
      if (splash) splash.style.display = 'none';
    } catch { /* ignore */ }
  }, []);

  // Pre-join state — the user clicked Join, PiP opened immediately, but
  // the LiveKit handshake isn't done yet. Show a friendly waiting screen
  // instead of an empty panel.
  if (!huddle.joined) {
    return (
      <div className="flex flex-col h-screen w-screen bg-background text-foreground items-center justify-center gap-3 p-6 text-center">
        {huddle.joining ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-semibold">Connecting to the huddle…</p>
            <p className="text-[11px] text-muted-foreground max-w-xs">
              Allow microphone access if your browser asks. This panel will fill with screens, mic and chat once you're in.
            </p>
          </>
        ) : huddle.meetingError ? (
          <>
            <p className="text-sm font-semibold text-red-500">Couldn't connect</p>
            <p className="text-[11px] text-muted-foreground max-w-xs">{huddle.meetingError}</p>
            <button
              onClick={huddle.join}
              className="mt-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">Not in the huddle</p>
            <p className="text-[11px] text-muted-foreground max-w-xs">
              Click below to join, or close this floating panel.
            </p>
            <button
              onClick={huddle.join}
              className="mt-1 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
            >
              Join huddle
            </button>
          </>
        )}
        <button
          onClick={huddle.pip.close}
          className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Close mini panel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground">
      {/* Top control bar */}
      <header className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-card">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Huddle · {huddle.participantCount}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={huddle.toggleAudio}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              huddle.audioOn
                ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
                : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
            }`}
            title={huddle.audioOn ? 'Mute' : 'Unmute'}
          >
            {huddle.audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={huddle.toggleDeafen}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              huddle.deafened
                ? 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
            title={huddle.deafened ? 'Hear team again' : 'Mute team audio (deafen)'}
          >
            {huddle.deafened ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={huddle.toggleScreen}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              huddle.screenOn
                ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/25'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
            title={huddle.screenOn ? 'Stop sharing' : 'Share screen'}
          >
            {huddle.screenOn ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          </button>
          {/* On Call toggle — works for any role (User-level flag) */}
          <button
            onClick={() => toggleOnCall()}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              isOnCall
                ? 'bg-violet-500/20 text-violet-700 border-violet-500/40 hover:bg-violet-500/30'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
            title={isOnCall ? 'On a call (click to clear)' : 'Mark on a call (DND)'}
          >
            {isOnCall ? <PhoneCall className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleOpenWorkroom}
            className="h-8 px-2 rounded-md flex items-center gap-1 bg-card text-foreground border border-border hover:bg-muted text-[10px] font-semibold transition-colors"
            title="Open the workroom (full Meet-style view)"
          >
            <ExternalLink className="h-3 w-3" /> Workroom
          </button>
          <button
            onClick={huddle.leave}
            className="h-8 w-8 rounded-md flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors"
            title="Leave the huddle"
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Live screen strip — shows what each broadcasting peer is sharing */}
      <section className="border-b border-border">
        <div className="px-3 py-1.5 flex items-center gap-2 bg-muted/30">
          <Monitor className="h-3 w-3 text-primary" />
          <p className="text-[10px] font-semibold uppercase tracking-wide">
            Live screens · {screenSharers.length}
          </p>
        </div>
        {screenSharers.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted-foreground text-center">
            Nobody is sharing yet. Click the screen icon above to share.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 p-2 max-h-44 overflow-y-auto">
            {screenSharers.map(p => (
              <PiPScreenTile key={p.userId} peer={p} />
            ))}
          </div>
        )}
      </section>

      {/* Chat — same component, same backend */}
      <section className="flex-1 overflow-hidden p-2">
        <HuddlePingChat />
      </section>

      <footer className="px-3 py-1.5 border-t border-border text-[9px] text-muted-foreground text-center">
        Robin · floating mini-panel
      </footer>
    </div>
  );
}

/** Small live-screen tile inside the PiP window. */
function PiPScreenTile({ peer }: { peer: PeerView }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) {
      ref.current.srcObject = peer.stream;
      ref.current.muted = true;          // voice flows through LiveKit audio tracks, not this video
    }
  }, [peer.stream]);
  return (
    <div className="relative bg-black rounded-md overflow-hidden aspect-video">
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain" />
      <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm">
        <span className="h-1 w-1 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-semibold text-white truncate">{peer.name || 'Teammate'}</span>
      </div>
    </div>
  );
}

export default HuddlePiPContent;
