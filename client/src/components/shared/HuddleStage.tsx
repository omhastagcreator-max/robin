import { useEffect, useRef } from 'react';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneCall, PhoneOff, Coffee, CalendarOff, Headphones, Loader2, AlertTriangle,
} from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { RemoteAudio, useAudioLevel } from '@/components/shared/RemoteAudio';
import { TurnSetupBanner } from '@/components/shared/TurnSetupBanner';

/**
 * Full-page Google-Meet-like huddle stage. Used INSIDE the WorkRoom page
 * as the primary interaction. Shares state with the persistent HuddleDock
 * via HuddleContext + the singleton useMeetingRoom — so joining here joins
 * the dock, leaving here leaves the dock, and screen shares are visible
 * everywhere consistently.
 *
 * Layout:
 *   • If anyone is sharing: large screen view at the top + tile strip below.
 *   • Otherwise: a tile grid filling the stage, Meet-style.
 *   • Bottom controls: Mic / Screen-share / Leave.
 */
export function HuddleStage() {
  const { user } = useAuth();
  // ALL huddle state from the single context-owned useMeetingRoom instance.
  const meeting = useHuddle();
  const { mode, join, leave } = meeting;
  const presence = useTeamPresence();

  const handleLeave = () => leave();

  // Whoever is sharing screen — only one main view at a time.
  const sharingPeer = meeting.peers.find(p => p.screenOn);
  const selfSharing = meeting.screenOn;

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Headphones className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Live Huddle</h2>
        {meeting.joined && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            {meeting.peers.length + 1} {meeting.peers.length === 0 ? 'person' : 'people'}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          mic + screen share · no camera · free forever
        </span>
      </div>

      {/* ICE diagnostic strip — instantly visible without console scrollback */}
      {meeting.joined && (
        <div className="px-4 py-1.5 border-b border-border bg-muted/30 text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>ICE:</span>
          {meeting.iceMeta.source === 'metered' && (
            <span className="text-green-600 font-semibold">✓ Metered API · {meeting.iceMeta.count} servers</span>
          )}
          {meeting.iceMeta.source === 'static' && (
            <span className="text-green-600 font-semibold">✓ Static TURN · {meeting.iceMeta.count} servers</span>
          )}
          {meeting.iceMeta.source === 'stun-only' && (
            <span className="text-amber-600 font-semibold">⚠ STUN-only — TURN env vars not detected. Set VITE_METERED_API_KEY + VITE_METERED_DOMAIN in Vercel and Redeploy.</span>
          )}
        </div>
      )}

      {/* JOIN screen */}
      {!meeting.joined && !meeting.joining && (
        <div className="flex flex-col items-center justify-center gap-4 py-14 px-6 text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center">
            <PhoneCall className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-base">Join the agency huddle</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              All shared screens appear here automatically. Mute by default, click your mic to talk.
            </p>
          </div>
          {meeting.meetingError && (
            <p className="text-xs text-red-500 max-w-sm flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {meeting.meetingError}
            </p>
          )}
          <button
            onClick={join}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
          >
            <PhoneCall className="h-4 w-4" /> Join huddle
          </button>
        </div>
      )}

      {/* CONNECTING screen */}
      {meeting.joining && !meeting.joined && (
        <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm font-semibold">Connecting…</p>
          <p className="text-xs text-muted-foreground">Allow microphone access if your browser asks.</p>
        </div>
      )}

      {/* JOINED — Meet-style stage */}
      {meeting.joined && (
        <>
          {/* Network blocked — show TURN setup */}
          {meeting.networkBlocked && (
            <div className="px-4 py-3 border-b border-border">
              <TurnSetupBanner />
            </div>
          )}
          {/* Screen share area — ALWAYS shown when anyone is sharing */}
          {(sharingPeer || selfSharing) && (
            <div className="relative bg-black border-b border-border">
              {sharingPeer
                ? <PeerScreenView peer={sharingPeer} />
                : selfSharing && meeting.localStream
                  ? <SelfScreenView stream={meeting.localStream} />
                  : null}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] text-white bg-black/60 backdrop-blur flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                {sharingPeer ? `${sharingPeer.name || 'Teammate'} is sharing` : 'You are sharing'}
              </div>
            </div>
          )}

          {/* Participant tile grid */}
          <div className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <SelfTile
                name={user?.name || user?.email || 'You'}
                audioOn={meeting.audioOn}
                screenOn={meeting.screenOn}
                stream={meeting.localStream}
                presenceStatus={presence.statusOf(user?.id || '')}
              />
              {meeting.peers.map(p => (
                <PeerTile key={p.userId} peer={p} presenceStatus={presence.statusOf(p.userId)} />
              ))}
              {meeting.peers.length === 0 && (
                <div className="col-span-full flex items-center justify-center py-6 text-xs text-muted-foreground italic">
                  Waiting for teammates to join…
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2 px-3 py-3 border-t border-border bg-card/50">
            <ControlButton
              on={meeting.audioOn}
              onIcon={Mic}
              offIcon={MicOff}
              onClick={meeting.toggleAudio}
              tone={meeting.audioOn ? 'good' : 'danger'}
              label={meeting.audioOn ? 'Mute' : 'Unmute'}
            />
            <ControlButton
              on={meeting.screenOn}
              onIcon={MonitorOff}
              offIcon={Monitor}
              onClick={meeting.toggleScreen}
              tone={meeting.screenOn ? 'primary' : 'neutral'}
              label={meeting.screenOn ? 'Stop sharing' : 'Share screen'}
            />
            <button
              onClick={handleLeave}
              className="ml-3 flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500 text-white text-sm font-medium hover:bg-red-600 shadow"
            >
              <PhoneOff className="h-3.5 w-3.5" /> Leave
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Tiles ─────────────────────────────────────────────────────────────────

function PresenceChip({ status }: { status: PresenceStatus }) {
  if (status === 'on_break') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
      <Coffee className="h-2.5 w-2.5" /> Break
    </span>
  );
  if (status === 'on_leave') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold bg-purple-500/15 text-purple-500 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
      <CalendarOff className="h-2.5 w-2.5" /> Leave
    </span>
  );
  return null;
}

function SelfTile({
  name, audioOn, screenOn, stream, presenceStatus,
}: {
  name: string;
  audioOn: boolean;
  screenOn: boolean;
  stream: MediaStream | null;
  presenceStatus: PresenceStatus;
}) {
  // Audio level: read off our own outbound stream so the user can see when
  // they're "transmitting" (helps confirm the mic is working).
  const level = useAudioLevel(audioOn ? stream : null);
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div className="relative bg-muted/30 border border-primary/20 rounded-2xl p-3 flex flex-col items-center gap-2 aspect-square">
      <PresenceTopRight status={presenceStatus} />
      <AvatarWithRing initial={initial} active={audioOn && level > 0.05} />
      <p className="text-xs font-medium text-center truncate w-full">{name} (you)</p>
      <div className="flex items-center gap-1 absolute bottom-2 left-2">
        <span className={`h-6 w-6 rounded-full flex items-center justify-center ${audioOn ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {audioOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
        </span>
        {screenOn && (
          <span className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Monitor className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

function PeerTile({ peer, presenceStatus }: { peer: PeerView; presenceStatus: PresenceStatus }) {
  const level = useAudioLevel(peer.audioOn ? peer.stream : null);
  const initial = (peer.name || '?')[0].toUpperCase();
  return (
    <div className="relative bg-muted/30 border border-border rounded-2xl p-3 flex flex-col items-center gap-2 aspect-square">
      <PresenceTopRight status={presenceStatus} />
      <RemoteAudio stream={peer.stream} />
      <AvatarWithRing initial={initial} active={peer.audioOn && level > 0.05} />
      <p className="text-xs font-medium text-center truncate w-full">{peer.name || 'Teammate'}</p>
      <div className="flex items-center gap-1 absolute bottom-2 left-2">
        <span className={`h-6 w-6 rounded-full flex items-center justify-center ${peer.audioOn ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {peer.audioOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
        </span>
        {peer.screenOn && (
          <span className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Monitor className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

function PresenceTopRight({ status }: { status: PresenceStatus }) {
  if (status !== 'on_break' && status !== 'on_leave') return null;
  return (
    <div className="absolute top-2 right-2">
      <PresenceChip status={status} />
    </div>
  );
}

function AvatarWithRing({ initial, active }: { initial: string; active: boolean }) {
  return (
    <div className={`h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold transition-all ${
      active ? 'ring-4 ring-green-500/60 bg-primary/20 text-primary' : 'bg-primary/15 text-primary'
    }`}>
      {initial}
    </div>
  );
}

function PeerScreenView({ peer }: { peer: PeerView }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return <video ref={ref} autoPlay playsInline className="w-full max-h-[60vh] object-contain bg-black" />;
}

function SelfScreenView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="w-full max-h-[60vh] object-contain bg-black" />;
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
      className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors ${palette}`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

export default HuddleStage;
