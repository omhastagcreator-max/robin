import { motion } from 'framer-motion';
import {
  Coffee, Users, Loader2, Headphones, CalendarOff,
} from 'lucide-react';

import { AppLayout }   from '@/components/AppLayout';
import { Row }         from '@/components/ui/Row';
import { StatusPill }  from '@/components/ui/StatusPill';
import { Stat }        from '@/components/ui/Stat';
import { EmptyState }  from '@/components/ui/EmptyState';
import { Avatar }      from '@/components/shared/Avatar';
import { HuddleStage } from '@/components/shared/HuddleStage';
import { useAuth }     from '@/contexts/AuthContext';
import { useUnifiedPresence, type UnifiedPresence } from '@/hooks/useUnifiedPresence';

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
  const { role } = useAuth();
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
            ) : presence.list.length === 0 ? (
              <EmptyState
                size="md"
                icon={<Users className="h-7 w-7" />}
                title="No teammates found"
                hint="As people sign in their presence will appear here."
              />
            ) : (
              <div className="border border-border rounded-xl bg-card overflow-hidden">
                {presence.list.map((m: UnifiedPresence) => (
                  <Row
                    key={m.userId}
                    density="comfy"
                    accent={
                      m.displayState === 'in_huddle' ? 'primary' :
                      m.displayState === 'working'   ? 'success' :
                      m.displayState === 'on_break'  ? 'warning' :
                      m.displayState === 'on_leave'  ? 'info'    :
                                                        'none'
                    }
                  >
                    <Row.Leading>
                      <Avatar name={m.name} email={m.email} size="sm" tone="primary" />
                    </Row.Leading>
                    <Row.Main>
                      <Row.Title>{m.name || 'Unnamed'}</Row.Title>
                      <Row.Meta>
                        {m.role || 'employee'}{m.team ? ` · ${m.team}` : ''}
                      </Row.Meta>
                    </Row.Main>
                    <Row.Trail>
                      <StatusPill state={m.displayState as any} size="xs" />
                    </Row.Trail>
                  </Row>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
