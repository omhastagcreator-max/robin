import { motion } from 'framer-motion';
import {
  Coffee, Users, Loader2, Headphones, CalendarOff,
} from 'lucide-react';

import { AppLayout }   from '@/components/AppLayout';
import { Stat }        from '@/components/ui/Stat';
import { EmptyState }  from '@/components/ui/EmptyState';
import { PeopleGrid, type PeopleGridItem } from '@/components/ui/PeopleGrid';
import { HuddleStage } from '@/components/shared/HuddleStage';
import { KnockButton } from '@/components/shared/KnockButton';
import { useAuth }     from '@/contexts/AuthContext';
import { useUnifiedPresence } from '@/hooks/useUnifiedPresence';

/**
 * WorkRoom v2 — rebuilt on design-system primitives.
 *
 * Same anatomy: HuddleStage on top, team roster below. v2 changes:
 *   • Bespoke amber/purple banners → tighter inline strips, aligned tones.
 *   • Roster card grid replaced with Row list (denser, scannable).
 *   • Presence badges read from useUnifiedPresence — no more separate
 *     useTeamPresence cross-referenced manually.
 */
export default function WorkRoom() {
  const { user, role } = useAuth();
  const isInternal = role === 'admin' || role === 'employee' || role === 'sales' || role === 'workroom';
  const presence = useUnifiedPresence();

  const onBreak = presence.list.filter(r => r.displayState === 'on_break');
  const onLeave = presence.list.filter(r => r.displayState === 'on_leave');

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight flex items-center gap-2">
              <Headphones className="h-5 w-5 text-primary" /> Work Room
            </h1>
            <p className="text-[12px] text-muted-foreground">
              The agency's universal huddle — mic + screen share, all in one tab.
            </p>
          </div>
        </div>

        {/* Banners */}
        {onBreak.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 flex items-start gap-2 text-[12px] text-amber-700"
          >
            <Coffee className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">
                {onBreak.length} teammate{onBreak.length === 1 ? '' : 's'} on break — please don't ping them
              </p>
              <p className="text-[11px] text-amber-700/80 mt-0.5">
                {onBreak.map(m => m.name).filter(Boolean).join(', ')}
              </p>
            </div>
          </motion.div>
        )}

        {onLeave.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2 flex items-start gap-2 text-[12px] text-blue-700"
          >
            <CalendarOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">
                {onLeave.length} teammate{onLeave.length === 1 ? '' : 's'} on leave today
              </p>
              <p className="text-[11px] text-blue-700/80 mt-0.5">
                {onLeave.map(m => m.name).filter(Boolean).join(', ')}
              </p>
            </div>
          </motion.div>
        )}

        {/* Huddle stage */}
        <HuddleStage />

        {/* Team roster */}
        {isInternal && (
          <section className="space-y-3">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h2 className="text-[14px] font-bold">Team status</h2>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Stat value={presence.working.length}  label="working"  tone="success" />
                <Stat value={presence.inHuddle.length} label="in huddle" tone="primary" />
                <Stat value={onBreak.length}            label="on break" tone="warning" />
                <Stat value={onLeave.length}            label="on leave" tone="muted" />
                <Stat value={presence.offClock.length}  label="off"      tone="muted" />
              </div>
            </div>

            {presence.loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <PeopleGrid
                storageKey="people.workroom.layout"
                items={presence.list.map((m) => {
                  // Knock is offered for any teammate who is at least
                  // signed in to Robin. We skip:
                  //   - self (no self-knocks)
                  //   - off_clock (server rejects with 'offline' anyway, but
                  //     showing it would be confusing)
                  //   - on_break / on_leave (sanctioned downtime; bug them
                  //     via Slack if it's truly urgent — Robin courtesy).
                  const canKnock =
                    m.userId !== user?.id &&
                    m.displayState !== 'off_clock' &&
                    m.displayState !== 'on_break' &&
                    m.displayState !== 'on_leave';
                  return {
                    id:    m.userId,
                    name:  m.name,
                    email: m.email,
                    role:  m.role || 'employee',
                    team:  m.team,
                    state: m.displayState as PeopleGridItem['state'],
                    trailing: canKnock
                      ? <KnockButton userId={m.userId} name={m.name} />
                      : undefined,
                  };
                })}
                empty={
                  <EmptyState
                    size="md"
                    icon={<Users className="h-7 w-7" />}
                    title="No teammates found"
                    hint="As people sign in their presence will appear here."
                  />
                }
              />
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
