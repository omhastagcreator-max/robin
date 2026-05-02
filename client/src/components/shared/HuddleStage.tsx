import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneCall, PhoneOff, Coffee, CalendarOff, Headphones, Loader2, AlertTriangle,
  Maximize2, X, Pin,
} from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { RemoteAudio, useAudioLevel } from '@/components/shared/RemoteAudio';

/**
 * Full-page Google-Meet-like huddle stage. Used INSIDE the WorkRoom page
 * as the primary interaction. Shares state with the persistent HuddleDock
 * via HuddleContext.
 *
 * Layout:
 *   • Shared screens grid — one card per peer (or self) currently sharing.
 *     Click a card to pin it to fullscreen; click again or press Esc to
 *     return to the grid.
 *   • Participants tile grid — Meet-style avatars + speaking indicators.
 *   • Bottom controls: Mic / Screen-share / Leave.
 */
export function HuddleStage() {
  const { user } = useAuth();
  const meeting = useHuddle();
  const { mode, join, leave } = meeting;
  const presence = useTeamPresence();

  // Pin state — which screen-share is currently maximised. `'self'` for the
  // user's own share; otherwise a peer userId. null = grid view.
  const [pinned, setPinned] = useState<string | null>(null);

  // ── Build the list of "who's sharing right now" ────────────────────────
  const sharers: { id: string; name: string; isSelf: boolean; stream: MediaStream | null; peer?: PeerView }[] = [];
  if (meeting.screenOn && meeting.localStream) {
    sharers.push({
      id: 'self',
      name: user?.name || user?.email || 'You',
      isSelf: true,
      stream: meeting.localStream,
    });
  }
  for (const p of meeting.peers) {
    if (p.screenOn) {
      sharers.push({ id: p.userId, name: p.name || 'Teammate', isSelf: false, stream: p.stream, peer: p });
    }
  }

  // Auto-unpin if the pinned sharer stopped.
  useEffect(() => {
    if (pinned && !sharers.find(s => s.id === pinned)) setPinned(null);
  }, [pinned, sharers.length]);

  // Esc closes the pinned view.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  const handleLeave = () => leave();
  const pinnedSharer = pinned ? sharers.find(s => s.id === pinned) : null;

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
          mic + screen share · no camera · click any screen to pin
        </span>
      </div>

      {/* Connection status strip */}
      {meeting.joined && (
        <div className="px-4 py-1.5 border-b border-border bg-muted/30 text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <span className="text-green-600 font-semibold">● LiveKit Cloud — connected</span>
          <span className="text-muted-foreground/70">free forever for an agency</span>
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
          {/* SHARED SCREENS GRID */}
          {sharers.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 py-2 flex items-center gap-2 bg-muted/20">
                <Monitor className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-semibold">
                  {sharers.length} screen{sharers.length === 1 ? '' : 's'} shared
                </p>
                <span className="text-[10px] text-muted-foreground">click any card to pin to fullscreen</span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sharers.map(s => (
                  <ScreenCard key={s.id} sharer={s} onPin={() => setPinned(s.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Participant tile grid — compact */}
          <div className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
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
                <div className="col-span-full flex items-center justify-center py-3 text-xs text-muted-foreground italic">
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

      {/* ── Pinned screen modal — smaller, easy to close ──────────────── */}
      <AnimatePresence>
        {pinnedSharer && (
          <>
            {/* Backdrop — click to close */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPinned(null)}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            />
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-card border border-border rounded-2xl overflow-hidden shadow-2xl flex flex-col"
              style={{ width: 'min(960px, calc(100vw - 2rem))', height: 'min(640px, calc(100vh - 4rem))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
                <Pin className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-sm font-semibold truncate flex-1">
                  {pinnedSharer.name}'s screen
                  {pinnedSharer.isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                </p>
                <span className="hidden sm:inline text-[10px] text-muted-foreground">Esc to close</span>
                <button
                  onClick={() => setPinned(null)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 bg-black flex items-center justify-center min-h-0">
                {pinnedSharer.peer
                  ? <PeerScreenView peer={pinnedSharer.peer} fullscreen />
                  : pinnedSharer.stream
                    ? <SelfScreenView stream={pinnedSharer.stream} fullscreen />
                    : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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

function PresenceTopRight({ status }: { status: PresenceStatus }) {
  if (status !== 'on_break' && status !== 'on_leave') return null;
  return (
    <div className="absolute top-2 right-2">
      <PresenceChip status={status} />
    </div>
  );
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
  const level = useAudioLevel(audioOn ? stream : null);
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div className="relative bg-muted/30 border border-primary/30 rounded-xl p-2 flex items-center gap-2.5">
      <PresenceTopRight status={presenceStatus} />
      <AvatarWithRing initial={initial} active={audioOn && level > 0.05} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{name}</p>
        <p className="text-[10px] text-muted-foreground">you</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`h-5 w-5 rounded-full flex items-center justify-center ${audioOn ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {audioOn ? <Mic className="h-2.5 w-2.5" /> : <MicOff className="h-2.5 w-2.5" />}
        </span>
        {screenOn && (
          <span className="h-5 w-5 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Monitor className="h-2.5 w-2.5" />
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
    <div className="relative bg-muted/30 border border-border rounded-xl p-2 flex items-center gap-2.5">
      <PresenceTopRight status={presenceStatus} />
      <RemoteAudio stream={peer.stream} />
      <AvatarWithRing initial={initial} active={peer.audioOn && level > 0.05} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{peer.name || 'Teammate'}</p>
        {peer.role && <p className="text-[10px] text-muted-foreground capitalize">{peer.role}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`h-5 w-5 rounded-full flex items-center justify-center ${peer.audioOn ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {peer.audioOn ? <Mic className="h-2.5 w-2.5" /> : <MicOff className="h-2.5 w-2.5" />}
        </span>
        {peer.screenOn && (
          <span className="h-5 w-5 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Monitor className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
    </div>
  );
}

function AvatarWithRing({ initial, active }: { initial: string; active: boolean }) {
  return (
    <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
      active ? 'ring-2 ring-green-500/70 bg-primary/20 text-primary' : 'bg-primary/15 text-primary'
    }`}>
      {initial}
    </div>
  );
}

// ─── Screen-share card + fullscreen views ─────────────────────────────────

function ScreenCard({
  sharer, onPin,
}: {
  sharer: { id: string; name: string; isSelf: boolean; stream: MediaStream | null; peer?: PeerView };
  onPin: () => void;
}) {
  return (
    <button
      onClick={onPin}
      className="group relative bg-black rounded-xl overflow-hidden aspect-video border border-primary/30 hover:border-primary/60 transition-all shadow-md"
      title="Click to pin to fullscreen"
    >
      {sharer.peer
        ? <PeerScreenView peer={sharer.peer} />
        : sharer.stream
          ? <SelfScreenView stream={sharer.stream} />
          : null}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] text-white bg-black/60 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
        {sharer.name}{sharer.isSelf ? ' (you)' : ''}
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-primary text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity">
        <Maximize2 className="h-3 w-3" /> Pin
      </div>
    </button>
  );
}

function PeerScreenView({ peer, fullscreen = false }: { peer: PeerView; fullscreen?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className={fullscreen
        ? 'w-full h-full max-w-full max-h-full object-contain bg-black'
        : 'w-full h-full object-cover bg-black'}
    />
  );
}

function SelfScreenView({ stream, fullscreen = false }: { stream: MediaStream; fullscreen?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={fullscreen
        ? 'w-full h-full max-w-full max-h-full object-contain bg-black'
        : 'w-full h-full object-cover bg-black'}
    />
  );
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
