import { useEffect, useState } from 'react';
import {
  Loader2, Mail, Calendar, Briefcase, CheckCircle2,
  Activity, Headphones, Monitor, Phone,
} from 'lucide-react';

import { Stat }       from '@/components/ui/Stat';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar }     from '@/components/shared/Avatar';
import { useUnifiedPresence, type UnifiedPresence } from '@/hooks/useUnifiedPresence';
import * as api from '@/api';

/**
 * <TeammateDetailPanel /> — drawer content for a single teammate.
 *
 * Shows live presence (drawn from useUnifiedPresence) PLUS the admin-only
 * productivity report (api.getEmployeeReport) — tasks completed, sessions
 * worked, performance metrics. Reuses existing endpoint; no new backend.
 *
 * If the calling user isn't an admin (employee viewing their teammate),
 * we still render presence — the report block just won't render.
 */

export function TeammateDetailPanel({ userId }: { userId: string }) {
  const presence = useUnifiedPresence();
  const liveRow: UnifiedPresence | null = presence.get(userId);

  // Productivity report — admin-only endpoint, may 403 for non-admin.
  const [report, setReport]   = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.adminEmployeeReport(userId)
      .then(r => { if (!cancelled) setReport(r); })
      .catch(() => { /* not admin or no data — show presence only */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [userId]);

  if (!liveRow) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <section className="p-4 flex items-center gap-3">
        <Avatar name={liveRow.name} email={liveRow.email} size="md" tone="primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-bold truncate">{liveRow.name || 'Unknown'}</h2>
          <p className="text-[11px] text-muted-foreground truncate">
            {liveRow.role || 'employee'}{liveRow.team ? ` · ${liveRow.team}` : ''}
          </p>
        </div>
        <StatusPill state={liveRow.displayState as any} size="sm" />
      </section>

      {/* Live signal block */}
      <section className="p-4 space-y-2">
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Live signal</span>
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <Stat icon={<Activity className="h-3 w-3" />}   value={liveRow.displayLabel} label="" />
          {liveRow.sharingScreen && <Stat icon={<Monitor className="h-3 w-3" />} value="Sharing" label="screen" tone="success" />}
          {liveRow.onCall &&         <Stat icon={<Phone   className="h-3 w-3" />} value="On call" label="" tone="warning" />}
          {liveRow.inHuddle &&       <Stat icon={<Headphones className="h-3 w-3" />} value="In huddle" label="" tone="primary" />}
        </div>
      </section>

      {/* Contact */}
      {liveRow.email && (
        <section className="p-4 text-[12px] space-y-1">
          <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Contact</span>
          <a href={`mailto:${liveRow.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <Mail className="h-3 w-3" /> {liveRow.email}
          </a>
        </section>
      )}

      {/* Productivity report (admin-only) */}
      {loading ? (
        <section className="p-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></section>
      ) : report ? (
        <section className="p-4 space-y-3">
          <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Last 30 days</span>
          <div className="grid grid-cols-3 gap-3">
            <Stat block icon={<CheckCircle2 className="h-3 w-3" />} value={report.tasksCompleted ?? 0}  label="Tasks done"  tone="success" />
            <Stat block icon={<Briefcase className="h-3 w-3" />}    value={report.activeTasks ?? 0}     label="In progress" />
            <Stat block icon={<Calendar className="h-3 w-3" />}     value={report.sessionsCount ?? 0}   label="Sessions"    tone="primary" />
          </div>
        </section>
      ) : (
        <section className="p-4">
          <EmptyState size="sm" title="No detailed report available" hint="Only admins can see productivity reports." />
        </section>
      )}
    </div>
  );
}
