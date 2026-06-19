import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneCall, PhoneOff, Coffee, CalendarOff, Headphones, Loader2, AlertTriangle,
  Maximize2, X, Pin, Volume2, VolumeX, Calendar,
} from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { toast } from 'sonner';
import type { PeerView } from '@/hooks/useMeetingRoom';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { RemoteAudio, useAudioLevel } from '@/components/shared/RemoteAudio';
import { HuddlePingChat } from '@/components/shared/HuddlePingChat';
import { MicConfirmButton } from '@/components/shared/MicConfirmButton';
import { KnockButton } from '@/components/shared/KnockButton';

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
  const socket = useSocket();

  // Remote-mute receive-side handler. Server relays mute-requests
  // to our user room; we kill our local mic and toast the actor's
  // name so the muted person always knows who did it.
  useEffect(() => {
    if (!socket) return;
    const onMuted = (data: { actorId?: string; actorName?: string }) => {
      if (meeting.audioOn) { try { meeting.toggleAudio(); } catch { /* */ } }
      const who = data?.actorName || 'A teammate';
      toast(`${who} muted you`, {
        description: 'Tap the mic button to talk again.',
        icon: '🤫',
        duration: 6000,
      });
    };
    socket.on('huddle:muted-by', onMuted);
    return () => { socket.off('huddle:muted-by', onMuted); };
  }, [socket, meeting]);

  const requestMute = (targetUserId: string) => {
    if (!socket || !targetUserId) return;
    socket.emit('huddle:mute-request', { targetUserId });
    toast.success('Mute request sent.');
  };

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
          // Emerald = "live & working" (matches StatusPill `working` tone).
          <span className="flex items-center gap-1 text-xs text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
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
          <span className="text-emerald-700 font-semibold">● LiveKit Cloud — connected</span>
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
            <p className="text-xs text-rose-600 max-w-sm flex items-center gap-1">
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
          {/* SHARED SCREENS — inline; expands in place when one is pinned */}
          {sharers.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 py-2 flex items-center gap-2 bg-muted/20">
                <Monitor className="h-3.5 w-3.5 text-primary" />
                {pinnedSharer ? (
                  <>
                    <Pin className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-semibold truncate flex-1">
                      {pinnedSharer.name}'s screen
                      {pinnedSharer.isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                    </p>
                    <button
                      onClick={() => setPinned(null)}
                      className="h-6 px-2 flex items-center gap-1 rounded-md bg-card hover:bg-muted text-xs"
                      title="Back to grid"
                    >
                      <X className="h-3 w-3" /> Close
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold">
                      {sharers.length} screen{sharers.length === 1 ? '' : 's'} shared
                    </p>
                    <span className="text-[10px] text-muted-foreground">click any to pin</span>
                  </>
                )}
              </div>

              {pinnedSharer ? (
                /* Inline 16:9 expanded view — replaces the grid in place */
                <div className="p-3">
                  <div className="relative bg-black rounded-xl overflow-hidden border border-primary/30 aspect-video w-full">
                    {pinnedSharer.peer
                      ? <PeerScreenView peer={pinnedSharer.peer} fullscreen />
                      : pinnedSharer.stream
                        ? <SelfScreenView stream={pinnedSharer.stream} fullscreen />
                        : null}
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] text-white bg-black/60 backdrop-blur flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {pinnedSharer.name}{pinnedSharer.isSelf ? ' (you)' : ''}
                    </div>
                  </div>
                </div>
              ) : (
                /* Card grid */
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sharers.map(s => (
                    <ScreenCard key={s.id} sharer={s} onPin={() => setPinned(s.id)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Participant tile grid — compact */}
          <div className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              <SelfTile
                name={user?.name || user?.email || 'You'}
                avatarUrl={user?.avatarUrl}
                audioOn={meeting.audioOn}
                screenOn={meeting.screenOn}
                stream={meeting.localStream}
                presenceStatus={presence.statusOf(user?.id || '')}
              />
              {meeting.peers.map(p => (
                <PeerTile
                  key={p.userId}
                  peer={p}
                  presenceStatus={presence.statusOf(p.userId)}
                  onCall={presence.isOnCall(p.userId)}
                  deafened={meeting.deafened}
                  hasMutedYou={presence.isDeafened(p.userId)}
                  inMeetingUntil={presence.meetingEndsAt(p.userId)}
                  onRequestMute={() => requestMute(p.userId)}
                />
              ))}
              {meeting.peers.length === 0 && (
                <div className="col-span-full flex items-center justify-center py-3 text-xs text-muted-foreground italic">
                  Waiting for teammates to join…
                </div>
              )}
            </div>
          </div>

          {/* Chat + controls — two-column on md+. Was stacked (chat full
              row, controls full row below) which wasted screen height
              and forced people to scroll past their own controls to
              read chat. Now chat occupies ~2/3 width, controls sit in
              a right-side rail at ~1/3 with mic / deafen / screen
              stacked vertically. Below md (mobile) it stacks like
              before so the controls don't crunch. */}
          <div className="grid grid-cols-1 md:grid-cols-3 border-t border-border">
            {/* Chat column */}
            <div className="md:col-span-2 px-3 py-3 bg-muted/10 md:border-r md:border-border min-w-0">
              <HuddlePingChat />
            </div>

            {/* Controls column — vertical rail on md+, horizontal on mobile */}
            <div className="md:col-span-1 px-3 py-3 bg-card/50 flex flex-row md:flex-col items-stretch justify-center gap-2">
              {/* Mic — two-click confirm to prevent accidental flips during a call */}
              <MicConfirmButton audioOn={meeting.audioOn} onToggle={meeting.toggleAudio} variant="label" />
              {/* Deafen — mute everyone else's audio without leaving the room */}
              <ControlButton
                on={!meeting.deafened}
                onIcon={Volume2}
                offIcon={VolumeX}
                onClick={meeting.toggleDeafen}
                tone={meeting.deafened ? 'danger' : 'neutral'}
                label={meeting.deafened ? 'Hear team' : 'Mute team audio'}
              />
              <ControlButton
                on={meeting.screenOn}
                onIcon={MonitorOff}
                offIcon={Monitor}
                onClick={meeting.toggleScreen}
                tone={meeting.screenOn ? 'primary' : 'neutral'}
                label={meeting.screenOn ? 'Stop sharing' : 'Share screen'}
              />
              {/* Leave-huddle removed (May 2026). Exit only via Log Out
                  on the topbar. That click calls huddle.leave() before
                  ending the session — same lifecycle, single doorway. */}
            </div>
          </div>
        </>
      )}

    </section>
  );
}

// ─── Tiles ─────────────────────────────────────────────────────────────────

function PresenceChip({ status }: { status: PresenceStatus }) {
  if (status === 'on_break') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/15 text-amber-700 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
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
  name, audioOn, screenOn, stream, presenceStatus, avatarUrl,
}: {
  name: string;
  avatarUrl?: string;
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
      <AvatarWithRing initial={initial} active={audioOn && level > 0.05} avatarUrl={avatarUrl} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{name}</p>
        <p className="text-[10px] text-muted-foreground">you</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`h-5 w-5 rounded-full flex items-center justify-center ${audioOn ? 'bg-emerald-500/20 text-emerald-600' : 'bg-rose-500/20 text-rose-600'}`}>
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

function PeerTile({ peer, presenceStatus, onCall, deafened, hasMutedYou, inMeetingUntil, onRequestMute }: { peer: PeerView; presenceStatus: PresenceStatus; onCall?: boolean; deafened?: boolean; hasMutedYou?: boolean; inMeetingUntil?: Date | null; onRequestMute?: () => void }) {
  const level = useAudioLevel(peer.audioOn ? peer.stream : null);
  const initial = (peer.name || '?')[0].toUpperCase();
  const meetingTimeStr = inMeetingUntil
    ? new Date(inMeetingUntil).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : null;
  return (
    <div className={`relative bg-muted/30 border rounded-xl p-2 flex items-center gap-2.5 ${
      inMeetingUntil ? 'border-blue-500/40' :
      onCall         ? 'border-primary/40' :
      hasMutedYou    ? 'border-amber-500/40' :
                       'border-border'
    }`}>
      <PresenceTopRight status={presenceStatus} />
      {/* RemoteAudio was here — removed (audio audit, May 2026). The
          provider-level mount in HuddleContext.tsx is now the single
          source of audio playback for every peer. Mounting one here
          ALSO gave us two <audio> elements per peer playing the same
          track; deafen only ever muted one of them, so some users
          reported "I can still hear them after I muted." */}
      <AvatarWithRing initial={initial} active={peer.audioOn && level > 0.05} avatarUrl={peer.avatarUrl} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate flex items-center gap-1.5 flex-wrap">
          {peer.name || 'Teammate'}
          {inMeetingUntil && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[8px] font-bold bg-blue-500/20 text-blue-700 border border-blue-500/30"
              title={`In a scheduled meeting until ${meetingTimeStr}`}
            >
              <Calendar className="h-2.5 w-2.5" /> In meeting · until {meetingTimeStr}
            </span>
          )}
          {onCall && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded-full text-[8px] font-bold bg-primary/15 text-primary border border-primary/30">
              On call
            </span>
          )}
          {hasMutedYou && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[8px] font-bold bg-amber-500/20 text-amber-700 border border-amber-500/30"
              title="They've muted the team audio — they can't hear anyone right now"
            >
              <VolumeX className="h-2.5 w-2.5" /> Muted you
            </span>
          )}
        </p>
        {peer.role && <p className="text-[10px] text-muted-foreground capitalize">{peer.role}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`h-5 w-5 rounded-full flex items-center justify-center ${peer.audioOn ? 'bg-emerald-500/20 text-emerald-600' : 'bg-rose-500/20 text-rose-600'}`}>
          {peer.audioOn ? <Mic className="h-2.5 w-2.5" /> : <MicOff className="h-2.5 w-2.5" />}
        </span>
        {peer.screenOn && (
          <span className="h-5 w-5 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Monitor className="h-2.5 w-2.5" />
          </span>
        )}
        {/* Remote-mute button — always visible so the control is
            discoverable. Disabled (dim) when the peer is already
            muted instead of vanishing, so the affordance never
            mysteriously disappears between actions. Click sends a
            'huddle:mute-request' through the server which pings the
            target with our name. */}
        {onRequestMute && (
          <button
            type="button"
            onClick={onRequestMute}
            disabled={!peer.audioOn}
            title={peer.audioOn ? `Mute ${peer.name || 'this teammate'}` : `${peer.name || 'They'} are already muted`}
            aria-label="Remote mute"
            className={`h-5 w-5 rounded-full flex items-center justify-center transition-colors ${
              peer.audioOn
                ? 'bg-rose-500/15 text-rose-600 hover:bg-rose-500/30'
                : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
            }`}
          >
            <VolumeX className="h-2.5 w-2.5" />
          </button>
        )}
        {/* Knock — single shared button. Bypasses deafen, fires chime
            + toast on the recipient wherever they are in Robin. */}
        <KnockButton userId={peer.userId} name={peer.name} hasMutedYou={hasMutedYou} />

      </div>
    </div>
  );
}

function AvatarWithRing({ initial, active, avatarUrl }: { initial: string; active: boolean; avatarUrl?: string }) {
  // Owner ask (May 2026, v2): "profile pic should appear in the
  // meetings in small size rounded square". When the peer has set a
  // profile picture URL on their Robin profile, the participant tile
  // shows that image instead of an initial. The shape stays the
  // rounded-square (rounded-lg) the spec asked for; the audio-active
  // ring still wraps it.
  const base = `h-9 w-9 rounded-lg overflow-hidden flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
    active ? 'ring-2 ring-green-500/70 bg-primary/20 text-primary' : 'bg-primary/15 text-primary'
  }`;
  if (avatarUrl) {
    return (
      <div className={base}>
        <img
          src={avatarUrl}
          alt={initial}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
    );
  }
  return <div className={base}>{initial}</div>;
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
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
  // "stalled" = no frames arriving for a few seconds (display sleep,
  // source window hidden, etc.). The video element still renders the
  // last frame (often black) and the user can't tell the share is
  // broken. We sample readyState + track.muted + videoWidth on a
  // 2s interval and surface a clear overlay when any of those say
  // the feed is dead.
  const [stalled, setStalled] = useState<{ reason: string } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (peer.stream) ref.current.srcObject = peer.stream;

    let lastTimeUpdate = Date.now();
    const onTimeUpdate = () => { lastTimeUpdate = Date.now(); };
    ref.current.addEventListener('timeupdate', onTimeUpdate);

    const videoTrack = peer.stream?.getVideoTracks?.()[0];
    const onMute   = () => setStalled({ reason: 'Source is paused (window hidden or display sleeping).' });
    const onUnmute = () => setStalled(null);
    videoTrack?.addEventListener('mute',   onMute);
    videoTrack?.addEventListener('unmute', onUnmute);
    // Initial state — track may already be muted by the time we attach.
    if (videoTrack?.muted) setStalled({ reason: 'Source is paused (window hidden or display sleeping).' });

    const probe = setInterval(() => {
      const v = ref.current;
      if (!v) return;
      const t = peer.stream?.getVideoTracks?.()[0];
      // No video frames being decoded for >4s → stalled. timeupdate
      // fires roughly every frame; if it hasn't fired in 4s while the
      // element is in the DOM, the stream is dead.
      const idleMs = Date.now() - lastTimeUpdate;
      const dimZero = (v.videoWidth === 0 || v.videoHeight === 0);
      if (t?.readyState === 'ended') {
        setStalled({ reason: 'Stopped sharing.' });
      } else if (t?.muted) {
        setStalled({ reason: 'Source is paused (window hidden or display sleeping).' });
      } else if (dimZero) {
        setStalled({ reason: 'Waiting for the first frame…' });
      } else if (idleMs > 4000) {
        setStalled({ reason: 'Frames stopped. Source may be sleeping or the network is choppy.' });
      } else {
        setStalled(null);
      }
    }, 2000);

    return () => {
      clearInterval(probe);
      ref.current?.removeEventListener('timeupdate', onTimeUpdate);
      videoTrack?.removeEventListener('mute',   onMute);
      videoTrack?.removeEventListener('unmute', onUnmute);
    };
  }, [peer.stream]);

  return (
    <div className={fullscreen ? 'w-full h-full max-w-full max-h-full relative bg-black' : 'w-full h-full relative bg-black'}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={fullscreen
          ? 'w-full h-full max-w-full max-h-full object-contain bg-black'
          : 'w-full h-full object-cover bg-black'}
      />
      {stalled && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 text-white px-4 text-center">
          <div className="h-8 w-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          </div>
          <p className="text-[12.5px] font-semibold">
            {peer.name || 'Teammate'}'s screen is paused
          </p>
          <p className="text-[11px] text-white/80 max-w-xs leading-snug">{stalled.reason}</p>
          <p className="text-[10.5px] text-white/50 italic">
            Not a Robin bug — frames will resume when their source wakes up.
          </p>
        </div>
      )}
    </div>
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
    // Tones aligned to StatusPill: emerald=working, rose=danger.
    good:    'bg-emerald-500 text-white hover:bg-emerald-600',
    danger:  'bg-rose-500    text-white hover:bg-rose-600',
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
