import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Headphones, ChevronDown, ChevronUp, PhoneCall, PhoneOff,
  Mic, MicOff, Monitor, MonitorOff, AlertTriangle, Users, PictureInPicture2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { RemoteAudio } from '@/components/shared/RemoteAudio';

/**
 * Persistent huddle dock — self-hosted mesh WebRTC (no Jitsi, no third-party
 * limits). Lives at the top of the React tree so the connection survives
 * navigation. Audio + screen share, no camera.
 *
 *   • Idle      → floating "Join huddle" pill (1 click).
 *   • Joined    → small 380×540 card bottom-right with participant tiles,
 *                 mic / screen-share / leave controls.
 *   • Collapsed → tiny status pill, call still alive (audio keeps flowing
 *                 because hidden audio elements don't pause).
 *
 * Mesh ceiling is ~6 simultaneous participants for audio — fine for an
 * agency huddle, free forever.
 */
export function HuddleDock() {
  const { user, role } = useAuth();
  // 'workroom' role is huddle-only — they MUST see the floating dock once
  // they've joined, otherwise they can't mute/leave without going back to
  // the WorkRoom page.
  const internal = role === 'admin' || role === 'employee' || role === 'sales' || role === 'workroom';
  const location = useLocation();
  const onWorkRoom = location.pathname.startsWith('/workroom');

  // PUBLIC ROUTES — guests viewing a shared Meta report or a client meeting
  // link must NEVER see the huddle dock, even if they happen to have a Robin
  // token in localStorage (e.g., the agency owner testing their own share
  // link while logged in). The dock would expose internal call infrastructure
  // and break the white-label illusion.
  const isPublicRoute =
    location.pathname.startsWith('/share/') ||
    location.pathname.startsWith('/meet/');  // /meet/:slug guest page

  // ALL huddle state comes from the single context-owned useMeetingRoom.
  const huddle = useHuddle();
  const { mode, join, leave, collapse, expand, participantCount } = huddle;

  // Remote-mute relay (June 2026). Anyone in the huddle can request
  // that anyone else be muted. We send through Socket.IO (server-side
  // relay in /server/src/index.ts) so we don't have to bolt anything
  // onto the LiveKit room. The receive-side handler fires when WE get
  // muted by someone — we kill our local mic and toast who did it.
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    const onMuted = (data: { actorId?: string; actorName?: string }) => {
      // Already muted? No-op — still surface the toast so the user
      // knows a teammate flagged them.
      if (huddle.audioOn) {
        try { huddle.toggleAudio(); } catch { /* */ }
      }
      const who = data?.actorName || 'A teammate';
      toast(`${who} muted you`, {
        description: 'Tap the mic button to talk again.',
        icon: '🤫',
        duration: 6000,
      });
    };
    socket.on('huddle:muted-by', onMuted);
    return () => { socket.off('huddle:muted-by', onMuted); };
  }, [socket, huddle]);

  const requestMute = (targetUserId: string) => {
    if (!socket || !targetUserId) return;
    socket.emit('huddle:mute-request', { targetUserId });
    toast.success('Mute request sent.');
  };

  if (isPublicRoute) return null;
  if (!internal) return null;
  // On the WorkRoom page, the full HuddleStage is the primary UI — hide
  // the dock so we don't show two huddle interfaces side-by-side.
  if (onWorkRoom) return null;

  const sharingPeer = huddle.peers.find(p => p.screenOn);
  const selfSharing = huddle.screenOn;
  const handleLeave = () => leave();

  // The card stays mounted with real dimensions whenever a call is in
  // progress — translateY moves it off-screen for collapsed state without
  // pausing the audio elements (which need to keep playing).
  const panelVisible = mode === 'expanded' || mode === 'joining';

  return (
    <>
      {/* Idle — single floating Join pill */}
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

      {/* Collapsed — small status pill with quick mic + screen + expand + leave.
          Tints aligned to StatusPill: emerald = audio live (working), rose =
          muted (danger). Previously generic green-500/red-500 which drifted
          from every other badge in the app. */}
      {mode === 'collapsed' && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 bg-card border border-primary/40 rounded-full pl-4 pr-1.5 py-1.5 shadow-xl">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium">
            Huddle{participantCount > 0 ? ` · ${participantCount}` : ''}
          </span>
          <button
            onClick={huddle.toggleAudio}
            title={huddle.audioOn ? 'Mute' : 'Unmute'}
            className={`ml-2 h-7 w-7 rounded-full flex items-center justify-center text-white transition-colors ${
              huddle.audioOn ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'
            }`}
          >
            {huddle.audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={huddle.toggleScreen}
            title={huddle.screenOn ? 'Stop sharing' : 'Share screen'}
            className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
              huddle.screenOn
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted hover:bg-muted/80 text-foreground border border-border'
            }`}
          >
            {huddle.screenOn ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          </button>
          {/* Pop out — like Google Meet's PiP button. Click → opens the
              floating PiP window that stays visible across tabs / apps /
              monitors. Manual trigger as a fallback to the auto-open
              that fires on huddle.joined. */}
          {huddle.pip.supported && !huddle.pip.isOpen && (
            <button
              onClick={() => { void huddle.pip.open(); }}
              title="Pop out huddle (floating window, visible across tabs)"
              className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={expand}
            title="Show huddle"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          {/* Leave-huddle button removed (May 2026). See SessionTopBar
              Log Out for the only authorised exit path. */}
        </div>
      )}

      {/* Persistent card — small floating bottom-right.
          Always rendered with real dimensions so audio keeps playing across
          collapse/expand and across page navigation. */}
      <div
        className="fixed z-40 transition-transform duration-200"
        style={{
          right:  '1rem',
          bottom: '1rem',
          width:  'min(92vw, 380px)',
          height: 'min(70vh, 540px)',
          transform: panelVisible ? 'translateY(0)' : 'translateY(calc(100% + 2rem))',
          pointerEvents: panelVisible ? 'auto' : 'none',
        }}
      >
        <div className="bg-card border border-primary/30 rounded-2xl overflow-hidden h-full flex flex-col shadow-2xl shadow-primary/20">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
            <Headphones className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-semibold">Huddle</p>
            {participantCount > 0 && (
              <span className="text-[10px] bg-primary/15 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Users className="h-2.5 w-2.5" /> {participantCount}
              </span>
            )}
            <button
              onClick={collapse}
              className="ml-auto h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0"
              title="Minimise (call keeps running)"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            {/* Leave-huddle removed (May 2026). Exit only via Log Out. */}
          </div>

          {/* Body */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {huddle.meetingError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
                <AlertTriangle className="h-8 w-8 text-rose-600" />
                <p className="text-sm font-semibold">Couldn't access microphone</p>
                <p className="text-xs text-muted-foreground">{huddle.meetingError}</p>
              </div>
            ) : !huddle.joined ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="h-12 w-12 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <PhoneCall className="h-5 w-5 text-primary animate-pulse" />
                </div>
                <p className="text-sm font-semibold">Connecting…</p>
                <p className="text-xs text-muted-foreground">Allow microphone access if your browser asks.</p>
              </div>
            ) : (
              <>
                {/* Screen share area — primary view if anyone is sharing */}
                {(sharingPeer || selfSharing) && (
                  <div className="bg-black border-b border-border" style={{ height: 200 }}>
                    {sharingPeer
                      ? <PeerScreenView peer={sharingPeer} />
                      : selfSharing && huddle.localStream
                        ? <SelfScreenView stream={huddle.localStream} />
                        : null}
                    <p className="absolute mt-[-26px] ml-2 text-[10px] text-white bg-black/60 px-2 py-0.5 rounded-md">
                      {sharingPeer ? `${sharingPeer.name || 'Teammate'} is sharing` : 'You are sharing'}
                    </p>
                  </div>
                )}

                {/* Participant strip */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  <ParticipantTile
                    name={user?.name || user?.email || 'You'}
                    avatarUrl={user?.avatarUrl}
                    isSelf
                    audioOn={huddle.audioOn}
                    screenOn={huddle.screenOn}
                  />
                  {huddle.peers.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic text-center pt-4">
                      Waiting for teammates to join…
                    </p>
                  )}
                  {huddle.peers.map(p => (
                    <ParticipantTile
                      key={p.userId}
                      peer={p}
                      name={p.name || 'Teammate'}
                      onRequestMute={() => requestMute(p.userId)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Controls */}
          {huddle.joined && (
            <div className="flex items-center justify-center gap-2 px-3 py-3 border-t border-border bg-card shrink-0">
              <ControlButton
                on={huddle.audioOn}
                onIcon={Mic}
                offIcon={MicOff}
                onClick={huddle.toggleAudio}
                tone={huddle.audioOn ? 'good' : 'danger'}
                label={huddle.audioOn ? 'Mute' : 'Unmute'}
              />
              <ControlButton
                on={huddle.screenOn}
                onIcon={MonitorOff}
                offIcon={Monitor}
                onClick={huddle.toggleScreen}
                tone={huddle.screenOn ? 'primary' : 'neutral'}
                label={huddle.screenOn ? 'Stop sharing' : 'Share screen'}
              />
              {/* Leave-huddle removed (May 2026). Exit only via Log Out. */}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function ParticipantTile({
  name, audioOn, screenOn, isSelf, peer, avatarUrl, onRequestMute,
}: {
  name: string;
  audioOn?: boolean;
  screenOn?: boolean;
  isSelf?: boolean;
  /** Real peer — used to render their hidden audio element so we hear them. */
  peer?: PeerView;
  /** Self-tile avatar URL (peers pick it up from peer.avatarUrl below).
   *  Owner ask (May 2026): show the profile pic everywhere a name shows. */
  avatarUrl?: string;
  /** Click handler for the remote-mute button. Shown only on peer
   *  tiles AND only when their mic is currently live (no point muting
   *  someone who's already muted). */
  onRequestMute?: () => void;
}) {
  const initial = (name || '?')[0].toUpperCase();
  const showAudioOn = isSelf ? audioOn : peer?.audioOn;
  const showScreenOn = isSelf ? screenOn : peer?.screenOn;
  // Effective avatar — self uses the prop, peers use the LiveKit metadata.
  const effectiveAvatar = isSelf ? avatarUrl : peer?.avatarUrl;

  return (
    <div className="group relative flex items-center gap-2 px-2 py-1.5 rounded-xl bg-muted/30 border border-border/40">
      {peer && <RemoteAudio stream={peer.stream} />}
      <div className="h-8 w-8 rounded-lg overflow-hidden bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
        {effectiveAvatar ? (
          <img
            src={effectiveAvatar}
            alt={initial}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{name}{isSelf ? ' (you)' : ''}</p>
        <p className="text-[10px] text-muted-foreground">
          {showAudioOn ? 'Talking-ready' : 'Muted'}
          {showScreenOn ? ' · sharing screen' : ''}
        </p>
      </div>

      {/* Remote-mute button — always visible on every peer tile so the
          control is discoverable without hovering. Disabled (visibly
          dim) when the peer is already muted instead of vanishing, so
          users know the affordance exists. Click fires a socket event
          that mutes the peer's mic and toasts them with our name. */}
      {!isSelf && onRequestMute && (
        <button
          type="button"
          onClick={onRequestMute}
          disabled={!showAudioOn}
          title={showAudioOn ? `Mute ${name}` : `${name} is already muted`}
          aria-label={`Mute ${name}`}
          className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            showAudioOn
              ? 'bg-rose-500/15 text-rose-600 hover:bg-rose-500/30'
              : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
          }`}
        >
          <VolumeX className="h-3 w-3" />
        </button>
      )}

      <span className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
        showAudioOn ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
      }`}>
        {showAudioOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
      </span>
      {showScreenOn && (
        <span className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <Monitor className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

function PeerScreenView({ peer }: { peer: PeerView }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return <video ref={ref} autoPlay playsInline className="w-full h-full object-contain bg-black" />;
}

function SelfScreenView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />;
}

function ControlButton({
  on, onIcon: OnIcon, offIcon: OffIcon, onClick, tone, label,
}: {
  on: boolean;
  onIcon: any;
  offIcon: any;
  onClick: () => void;
  tone: 'good' | 'danger' | 'primary' | 'neutral';
  label: string;
}) {
  const Icon = on ? OnIcon : OffIcon;
  // Aligned to StatusPill: emerald = good (audio live), rose = danger (muted).
  const palette = {
    good:    'bg-emerald-500 text-white hover:bg-emerald-600',
    danger:  'bg-rose-500    text-white hover:bg-rose-600',
    primary: 'bg-primary     text-primary-foreground hover:bg-primary/90',
    neutral: 'bg-muted       text-foreground hover:bg-muted/80 border border-border',
  }[tone];
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-colors ${palette}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default HuddleDock;
