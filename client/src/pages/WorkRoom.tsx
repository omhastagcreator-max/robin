import { useEffect, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  Mic, MicOff, ScreenShare, ScreenShareOff,
  PhoneCall, PhoneOff, Coffee, Users, Loader2, Headphones, CalendarOff,
} from 'lucide-react';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import { useTeamPresence, type TeamMember, type PresenceStatus } from '@/hooks/useTeamPresence';

/**
 * WorkRoom — the agency's universal always-on huddle.
 *
 * Purpose: keep a remote agency in sync during the working day. Everyone
 * shares one room; you join when you start work, mute by default, unmute
 * when you need to talk, share your screen when you need to collaborate.
 * No video cameras — bandwidth-friendly and ambient.
 *
 * Break tags: anyone on break shows up with an "On break" badge so the team
 * knows not to ping them again and again until they're back.
 */
export default function WorkRoom() {
  const { user, role } = useAuth();
  const isInternal = role === 'admin' || role === 'employee' || role === 'sales';

  const meeting = useMeetingRoom({
    userId:   user?.id || '',
    userName: user?.name,
    userRole: role,
    roomId:   'agency-global',
  });

  const presence = useTeamPresence();

  // The set of participant userIds currently inside the meeting (peers + self)
  const inMeetingIds = new Set<string>([
    user?.id || '',
    ...meeting.peers.map(p => p.userId),
  ]);

  // Teammates on break who are NOT in the meeting — banner audience
  const breakNotInMeeting = presence.onBreak.filter(m => !inMeetingIds.has(m.userId));

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        {/* Page header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Headphones className="h-6 w-6 text-primary" /> Work Room
            </h1>
            <p className="text-sm text-muted-foreground">
              The agency's universal huddle — one room for everyone, mic + screen only.
            </p>
          </div>
          {meeting.joined && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-xs text-green-600 font-medium">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              You're in the huddle · {meeting.peers.length + 1} {meeting.peers.length === 0 ? 'person' : 'people'}
            </div>
          )}
        </div>

        {/* Break banner — visible always so people don't ping teammates on break */}
        {presence.onBreak.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3"
          >
            <div className="h-9 w-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <Coffee className="h-4 w-4 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {presence.onBreak.length} teammate{presence.onBreak.length === 1 ? ' is' : 's are'} on break — please don't ping them
              </p>
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-1">
                {presence.onBreak.map(m => m.name).filter(Boolean).join(', ')}
              </p>
            </div>
          </motion.div>
        )}

        {/* On-leave banner — visible to whole team so people know who's out */}
        {presence.onLeave && presence.onLeave.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4 flex items-start gap-3"
          >
            <div className="h-9 w-9 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
              <CalendarOff className="h-4 w-4 text-purple-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                {presence.onLeave.length} teammate{presence.onLeave.length === 1 ? ' is' : 's are'} on leave today
              </p>
              <p className="text-xs text-purple-700/70 dark:text-purple-400/70 mt-1">
                {presence.onLeave.map(m => m.name).filter(Boolean).join(', ')}
              </p>
            </div>
          </motion.div>
        )}

        {/* ── HUDDLE ────────────────────────────────────────────────── */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Headphones className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Live Huddle</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {meeting.joined ? 'You are connected' : 'Click to join the huddle'}
            </span>
          </div>

          {!meeting.joined ? (
            <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
              <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center">
                <PhoneCall className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-base">Join the agency huddle</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  One mic, optional screen share, no camera. Stay connected while you work
                  and chime in only when you need to.
                </p>
              </div>
              {meeting.error && <p className="text-xs text-red-400 max-w-sm">{meeting.error}</p>}
              <button
                onClick={meeting.joinMeeting}
                disabled={meeting.joining}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
              >
                {meeting.joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                {meeting.joining ? 'Joining…' : 'Join huddle'}
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Tile grid — self + peers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <SelfTile
                  name={user?.name || user?.email || 'You'}
                  status={presence.statusOf(user?.id || '')}
                  audioOn={meeting.audioOn}
                  screenOn={meeting.screenOn}
                  stream={meeting.localStream}
                />
                {meeting.peers.map(p => (
                  <PeerTile
                    key={p.userId}
                    peer={p}
                    status={presence.statusOf(p.userId)}
                  />
                ))}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                <ControlButton
                  on={meeting.audioOn}
                  onLabel="Mute"
                  offLabel="Unmute"
                  IconOn={Mic}
                  IconOff={MicOff}
                  onClick={meeting.toggleAudio}
                />
                <ControlButton
                  on={meeting.screenOn}
                  onLabel="Stop sharing"
                  offLabel="Share screen"
                  IconOn={ScreenShareOff}
                  IconOff={ScreenShare}
                  onClick={meeting.toggleScreen}
                  highlight
                />
                <button
                  onClick={meeting.leaveMeeting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 ml-2"
                >
                  <PhoneOff className="h-4 w-4" /> Leave
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── TEAM ROSTER ─────────────────────────────────────────── */}
        {isInternal && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Team status</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {presence.active.length} working · {presence.onBreak.length} on break · {presence.off.length} off the clock
              </span>
            </div>

            {presence.loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : (
              <div className="bg-card border border-border rounded-2xl divide-y divide-border/40 overflow-hidden">
                {presence.list.length === 0 && (
                  <p className="px-5 py-4 text-sm text-muted-foreground">No teammates found.</p>
                )}
                {presence.list
                  .slice()
                  .sort((a, b) => statusRank(a.status) - statusRank(b.status))
                  .map(m => <RosterRow key={m.userId} member={m} inHuddle={inMeetingIds.has(m.userId)} />)}
              </div>
            )}

            {breakNotInMeeting.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Tip: people on break appear with an amber tag — give them space until they're back.
              </p>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function statusRank(s: PresenceStatus) {
  switch (s) {
    case 'active':    return 0;
    case 'on_break':  return 1;
    case 'on_leave':  return 2;
    case 'off_clock': return 3;
    default:          return 4;
  }
}

function StatusBadge({ status }: { status: PresenceStatus }) {
  if (status === 'on_leave') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-500 border border-purple-500/30">
        <CalendarOff className="h-3 w-3" /> On leave
      </span>
    );
  }
  if (status === 'on_break') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30">
        <Coffee className="h-3 w-3" /> On break
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/15 text-green-600 border border-green-500/30">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Working
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
      Off the clock
    </span>
  );
}

function SelfTile({
  name, status, audioOn, screenOn, stream,
}: {
  name: string;
  status: PresenceStatus;
  audioOn: boolean;
  screenOn: boolean;
  stream: MediaStream | null;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && stream && screenOn) ref.current.srcObject = stream;
  }, [stream, screenOn]);

  return (
    <div className="relative bg-black/95 rounded-xl overflow-hidden aspect-video border border-primary/30">
      {screenOn ? (
        <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center text-3xl font-bold text-primary">
            {(name || '?')[0].toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute top-2 left-2">
        <StatusBadge status={status} />
      </div>
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <span className="text-xs px-2 py-0.5 bg-black/60 backdrop-blur rounded-md text-white font-medium truncate">
          You {screenOn && '· sharing screen'}
        </span>
        {!audioOn && (
          <span className="h-5 w-5 rounded-full bg-red-500/80 flex items-center justify-center shrink-0">
            <MicOff className="h-3 w-3 text-white" />
          </span>
        )}
      </div>
    </div>
  );
}

function PeerTile({ peer, status }: { peer: PeerView; status: PresenceStatus }) {
  // Always mount the <video> — it plays both the screen track (when shared)
  // AND the peer's mic audio. We just overlay the avatar visually when there
  // is no screen track. This avoids any "where did the audio go?" bug.
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);

  const initial = (peer.name || peer.userId || '?')[0].toUpperCase();

  return (
    <div className="relative bg-black/95 rounded-xl overflow-hidden aspect-video border border-border">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`w-full h-full object-contain bg-black ${peer.screenOn ? '' : 'opacity-0 pointer-events-none'}`}
      />
      {!peer.screenOn && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center text-3xl font-bold text-primary">
            {initial}
          </div>
        </div>
      )}
      <div className="absolute top-2 left-2">
        <StatusBadge status={status} />
      </div>
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <span className="text-xs px-2 py-0.5 bg-black/60 backdrop-blur rounded-md text-white font-medium truncate">
          {peer.name || peer.userId} {peer.screenOn && '· sharing'}
        </span>
        {!peer.audioOn && (
          <span className="h-5 w-5 rounded-full bg-red-500/80 flex items-center justify-center shrink-0">
            <MicOff className="h-3 w-3 text-white" />
          </span>
        )}
      </div>
    </div>
  );
}

function RosterRow({ member, inHuddle }: { member: TeamMember; inHuddle: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20">
      <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center text-sm font-bold text-primary shrink-0">
        {(member.name || member.email || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{member.name || 'Unnamed'}</p>
          {member.role && (
            <span className="text-[10px] uppercase font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
              {member.role}
            </span>
          )}
          {inHuddle && (
            <span className="text-[10px] font-semibold text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <Headphones className="h-2.5 w-2.5" /> in huddle
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{member.email}</p>
      </div>
      <StatusBadge status={member.status} />
    </div>
  );
}

function ControlButton({
  on, onLabel, offLabel, IconOn, IconOff, onClick, highlight = false,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  IconOn: any;
  IconOff: any;
  onClick: () => void;
  highlight?: boolean;
}) {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      onClick={onClick}
      title={on ? onLabel : offLabel}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
        on
          ? (highlight ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-muted')
          : 'bg-muted/40 border border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{on ? onLabel : offLabel}</span>
    </button>
  );
}
