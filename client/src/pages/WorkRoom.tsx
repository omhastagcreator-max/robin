import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  Coffee, Users, Loader2, Headphones, CalendarOff,
} from 'lucide-react';
import { useTeamPresence, type TeamMember, type PresenceStatus } from '@/hooks/useTeamPresence';
import { HuddleStage } from '@/components/shared/HuddleStage';

/**
 * WorkRoom — the agency's universal workroom.
 *
 *   1. HuddleStage — the live Meet-style huddle (audio + screen share,
 *      no camera). All screen sharing happens here; anyone joining the
 *      huddle can share and anyone can pin a teammate's screen to fullscreen.
 *   2. Team roster — who's working, on break, on leave, off the clock.
 */
export default function WorkRoom() {
  const { role } = useAuth();
  const isInternal = role === 'admin' || role === 'employee' || role === 'sales';

  const presence = useTeamPresence();

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

        {/* ── FULL HUDDLE STAGE — Meet-style, in-page ───────────────────────── */}
        <HuddleStage />

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
