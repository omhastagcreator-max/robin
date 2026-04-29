import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  Coffee, Users, Loader2, Headphones, CalendarOff,
  Monitor, MonitorOff, Eye, PhoneCall,
} from 'lucide-react';
import { useTeamPresence, type TeamMember, type PresenceStatus } from '@/hooks/useTeamPresence';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { useWebRTCReceiver } from '@/hooks/useWebRTC';
import { useHuddle } from '@/contexts/HuddleContext';
import * as api from '@/api';

/**
 * WorkRoom — the agency's universal Work Room.
 *
 *   1. Live Huddle  → embedded Jitsi room (mic + screen + chat + raise hand,
 *                     NO camera). One room for the whole agency.
 *   2. Live Screens → legacy 1-to-many broadcast/watch grid (so admins can
 *                     keep an eye on a teammate's screen without joining
 *                     the huddle).
 *   3. Team status  → who's working / on break / on leave / off the clock,
 *                     with banners so people don't ping teammates on break.
 */
export default function WorkRoom() {
  const { user, role } = useAuth();
  const isInternal = role === 'admin' || role === 'employee' || role === 'sales';

  // Huddle is now global — drive it via the persistent dock context.
  const huddle = useHuddle();

  const presence = useTeamPresence();

  // ── Legacy 1-to-many broadcast flow (separate from huddle) ──────────────
  const { isSharing, startSharing, stopSharing } = useScreenShare();
  const { remoteStreams, connectingTo, viewScreen, stopViewing } = useWebRTCReceiver(user?.id || '');

  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [viewingUser, setViewingUser] = useState<string | null>(null);

  const monitorVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && viewingUser && remoteStreams[viewingUser]) el.srcObject = remoteStreams[viewingUser];
  }, [remoteStreams, viewingUser]);

  const loadSessions = async () => {
    try {
      const data = await api.listScreenSessions();
      setScreenSessions(Array.isArray(data) ? data : []);
    } finally { setLoadingSessions(false); }
  };

  useEffect(() => {
    if (!isInternal) { setLoadingSessions(false); return; }
    loadSessions();
    const i = setInterval(loadSessions, 10000);
    return () => clearInterval(i);
  }, [isInternal]);

  const handlePeek = (targetId: string) => {
    if (viewingUser === targetId) { stopViewing(targetId); setViewingUser(null); return; }
    setViewingUser(targetId);
    viewScreen(targetId);
  };

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
              The agency's universal huddle — mic + screen share, all in one tab.
            </p>
          </div>
          {(huddle.mode === 'expanded' || huddle.mode === 'collapsed') && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-xs text-green-600 font-medium">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              In the huddle{huddle.participantCount > 0 ? ` · ${huddle.participantCount}` : ''}
            </div>
          )}
        </div>

        {/* Break banner */}
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

        {/* On-leave banner */}
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

        {/* ── HUDDLE — driven by the global dock; just a one-click CTA here ─── */}
        <section className="bg-card border border-primary/30 rounded-2xl p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Headphones className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Live huddle</p>
            <p className="text-xs text-muted-foreground">
              The agency-wide audio room — mic, screen share, chat. The huddle dock at the bottom of
              your screen stays connected even when you switch pages.
            </p>
          </div>
          {huddle.mode === 'idle' ? (
            <button
              onClick={huddle.join}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-md"
            >
              <PhoneCall className="h-4 w-4" /> Join huddle
            </button>
          ) : huddle.mode === 'collapsed' ? (
            <button
              onClick={huddle.expand}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/30 rounded-xl text-sm font-medium hover:bg-primary/20"
            >
              <PhoneCall className="h-4 w-4" /> Show huddle
            </button>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-xs text-green-600 font-medium">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live below
            </span>
          )}
        </section>

        {/* ── LIVE SCREENS — broadcast / monitor ──────────────────── */}
        {isInternal && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Live screens</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {screenSessions.filter(s => s.status === 'active').length} broadcasting
              </span>
            </div>

            <div className={`bg-card border rounded-2xl p-4 flex items-center gap-3 flex-wrap transition-colors ${isSharing ? 'border-green-500/40' : 'border-border'}`}>
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${isSharing ? 'bg-green-500/20' : 'bg-muted'}`}>
                {isSharing
                  ? <Monitor className="h-5 w-5 text-green-500" />
                  : <MonitorOff className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">
                  {isSharing ? 'Your screen is broadcasting' : 'Broadcast your screen'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isSharing
                    ? 'Admins and teammates can watch live without joining the huddle'
                    : 'Make your screen visible to admin/teammates without joining the huddle'}
                </p>
              </div>
              {isSharing ? (
                <button onClick={stopSharing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium hover:bg-red-500/25 transition-all">
                  <MonitorOff className="h-4 w-4" /> Stop broadcasting
                </button>
              ) : (
                <button onClick={startSharing}
                  className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/30 rounded-xl text-sm font-medium hover:bg-primary/20 transition-all">
                  <Monitor className="h-4 w-4" /> Start broadcast
                </button>
              )}
            </div>

            {loadingSessions ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : screenSessions.filter(s => s.status === 'active').length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 bg-card border border-dashed border-border rounded-2xl">
                Nobody is broadcasting their screen right now.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {screenSessions.filter(s => s.status === 'active').map(session => (
                  <motion.div
                    key={session._id || session.userId}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-green-500/30 rounded-2xl p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {(session.profile?.name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{session.profile?.name || session.userId}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {session.profile?.role && <span className="capitalize">{session.profile.role}</span>}
                          {session.profile?.email && <> · {session.profile.email}</>}
                        </p>
                      </div>
                      <span className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                    </div>
                    <button onClick={() => handlePeek(session.userId)}
                      className={`w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                        viewingUser === session.userId
                          ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                          : 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
                      }`}>
                      {connectingTo[session.userId] && viewingUser === session.userId ? (
                        <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
                      ) : viewingUser === session.userId ? (
                        <><MonitorOff className="h-3 w-3" /> Stop watching</>
                      ) : (
                        <><Eye className="h-3 w-3" /> Watch live</>
                      )}
                    </button>
                  </motion.div>
                ))}
              </div>
            )}

            <AnimatePresence>
              {viewingUser && remoteStreams[viewingUser] && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="bg-black rounded-2xl overflow-hidden border border-primary/30 shadow-2xl shadow-primary/10"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-primary/20">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                      <p className="text-xs font-medium">
                        Watching {screenSessions.find(s => s.userId === viewingUser)?.profile?.name || 'teammate'}
                      </p>
                    </div>
                    <button
                      onClick={() => { stopViewing(viewingUser); setViewingUser(null); }}
                      className="text-xs text-muted-foreground hover:text-red-400"
                    >
                      Stop
                    </button>
                  </div>
                  <video ref={monitorVideoRef} autoPlay playsInline className="w-full max-h-[60vh] object-contain bg-black" />
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* ── TEAM ROSTER ─────────────────────────────────────────── */}
        {isInternal && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Team status</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {presence.active.length} working · {presence.onBreak.length} on break · {presence.onLeave?.length || 0} on leave · {presence.off.length} off
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
                  .map(m => <RosterRow key={m.userId} member={m} />)}
              </div>
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

function RosterRow({ member }: { member: TeamMember }) {
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
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{member.email}</p>
      </div>
      <StatusBadge status={member.status} />
    </div>
  );
}
