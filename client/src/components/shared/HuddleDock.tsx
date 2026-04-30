import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Headphones, ChevronDown, ChevronUp, PhoneCall, PhoneOff,
  Mic, MicOff, Monitor, MonitorOff, AlertTriangle, Users,
} from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { RemoteAudio } from '@/components/shared/RemoteAudio';
import { TurnSetupBanner } from '@/components/shared/TurnSetupBanner';

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
  const internal = role === 'admin' || role === 'employee' || role === 'sales';
  const location = useLocation();
  const onWorkRoom = location.pathname.startsWith('/workroom');

  // ALL huddle state comes from the single context-owned useMeetingRoom.
  const huddle = useHuddle();
  const { mode, join, leave, collapse, expand, participantCount } = huddle;

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

      {/* Collapsed — small status pill with quick mic + leave + expand */}
      {mode === 'collapsed' && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 bg-card border border-primary/40 rounded-full pl-4 pr-1.5 py-1.5 shadow-xl">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium">
            In huddle{participantCount > 0 ? ` · ${participantCount}` : ''}
          </span>
          <button
            onClick={huddle.toggleAudio}
            title={huddle.audioOn ? 'Mute' : 'Unmute'}
            className={`ml-2 h-7 w-7 rounded-full flex items-center justify-center text-white transition-colors ${
              huddle.audioOn ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {huddle.audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
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
            <button
              onClick={handleLeave}
              className="h-7 px-2 rounded-full flex items-center gap-1 bg-red-500 text-white text-xs font-medium hover:bg-red-600 shrink-0"
              title="Leave huddle"
            >
              <PhoneOff className="h-3 w-3" /> Leave
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {huddle.meetingError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
                <AlertTriangle className="h-8 w-8 text-red-500" />
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
                {/* Network blocked — actionable TURN setup banner */}
                {huddle.networkBlocked && (
                  <div className="px-3 py-2 border-b border-border">
                    <TurnSetupBanner compact />
                  </div>
                )}

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
              <button
                onClick={handleLeave}
                className="ml-2 flex items-center gap-1.5 px-3 py-2 rounded-full bg-red-500 text-white text-xs font-medium hover:bg-red-600 shadow"
                title="Leave huddle"
              >
                <PhoneOff className="h-3.5 w-3.5" /> Leave
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function ParticipantTile({
  name, audioOn, screenOn, isSelf, peer,
}: {
  name: string;
  audioOn?: boolean;
  screenOn?: boolean;
  isSelf?: boolean;
  /** Real peer — used to render their hidden audio element so we hear them. */
  peer?: PeerView;
}) {
  const initial = (name || '?')[0].toUpperCase();
  const showAudioOn = isSelf ? audioOn : peer?.audioOn;
  const showScreenOn = isSelf ? screenOn : peer?.screenOn;

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-xl bg-muted/30 border border-border/40">
      {peer && <RemoteAudio stream={peer.stream} />}
      <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{name}{isSelf ? ' (you)' : ''}</p>
        <p className="text-[10px] text-muted-foreground">
          {showAudioOn ? 'Talking-ready' : 'Muted'}
          {showScreenOn ? ' · sharing screen' : ''}
        </p>
      </div>
      <span className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
        showAudioOn ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'
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
  const palette = {
    good:    'bg-green-500 text-white hover:bg-green-600',
    danger:  'bg-red-500   text-white hover:bg-red-600',
    primary: 'bg-primary   text-primary-foreground hover:bg-primary/90',
    neutral: 'bg-muted     text-foreground hover:bg-muted/80 border border-border',
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
