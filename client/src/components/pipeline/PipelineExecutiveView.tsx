import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle, Clock, Inbox, UserCheck, Rocket, CheckCircle2,
  Activity, ArrowUpRight,
} from 'lucide-react';

/**
 * PipelineExecutiveView — agency owner's command-center view.
 *
 * One scrollable page. Four bands top-to-bottom on the left rail, a
 * persistent right rail of operational widgets:
 *
 *   1. KPI strip — Total / On track / At risk / Awaiting client /
 *      Delayed / Launching this week. Compact, no charts.
 *   2. Project table — one row per workflow, six columns:
 *        - Client + manager
 *        - Development progress (Shopify / website / landing)
 *        - Video progress (creatives / influencer)
 *        - Meta Ads progress
 *        - Status pill (On track / At risk / Delayed / Awaiting / Done)
 *        - Last update (one line, who + how long ago)
 *      The CURRENT ACTIVE stage column is subtly highlighted with a
 *      coloured outline + tinted background so an owner glances down
 *      the table and immediately sees "which department owns this
 *      project right now".
 *   3. Right rail — Upcoming launches, Needs attention, Team
 *      workload, Recent activity. Each a tight white card.
 *
 * Design rules pulled straight from the brief: white surfaces on a
 * soft-neutral page background, thin borders, muted accents only,
 * generous whitespace, no shadows, no graphs. Linear / Stripe /
 * Notion vocabulary.
 *
 * Data shape: we DON'T require new backend fields. Everything is
 * derived from the existing ClientWorkflow document — services[],
 * lastUpdate, health, eta, priority. If a field is missing we degrade
 * gracefully (empty bar / "not started").
 */

// Local Workflow shape — declared loose on purpose so the page's
// stricter Workflow interface is structurally assignable to it
// without a cast. Required fields here mirror "everything the
// rendering logic below actually reads"; everything else is optional.
interface ChecklistItem { done?: boolean }
interface ServiceSummary {
  _id?: string;
  label?: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist?: ChecklistItem[];
  assignedTo?: string;
}
export interface ExecutiveWorkflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  services: ServiceSummary[];
  // `health` is typed loose — the page imports a stricter Status union
  // that we don't want to re-pull here. The pill helper below narrows
  // by string-equality, so a wider type is fine.
  health?: string;
  // `| null` matches the page's `lastUpdate?: ... | null` shape so
  // Workflow[] is directly assignable to ExecutiveWorkflow[].
  lastUpdate?: { detail?: string; at?: string; actorId?: string; serviceType?: string } | null;
  updatedAt?: string;
  priority?: string;
  blockerType?: string;
  eta?: string | null;
}

export interface ExecutiveUser { _id: string; name?: string; avatarUrl?: string }

// ── Column → service-type mapping ───────────────────────────────────
// Three departments the table surfaces. Each one matches one or more
// of the existing service types stored on the workflow.
const COLUMNS = [
  { key: 'dev',   label: 'Development', tone: 'emerald', matches: (s: ServiceSummary) => s.serviceType === 'shopify' },
  { key: 'video', label: 'Video',       tone: 'amber',   matches: (s: ServiceSummary) => s.serviceType === 'influencer' },
  { key: 'meta',  label: 'Meta ads',    tone: 'blue',    matches: (s: ServiceSummary) => s.serviceType === 'meta_ads' },
] as const;
type ColumnKey = typeof COLUMNS[number]['key'];

// Per-tone classes. Mirrors the existing Kanban Column convention so
// the dashboard sits in the same visual family as the rest of Robin.
function tone(t: 'emerald' | 'amber' | 'blue') {
  switch (t) {
    case 'emerald': return { soft: 'bg-emerald-50',  ring: 'ring-emerald-500/40',  bar: 'bg-emerald-500', text: 'text-emerald-700' };
    case 'amber':   return { soft: 'bg-amber-50',    ring: 'ring-amber-500/40',    bar: 'bg-amber-500',   text: 'text-amber-700'   };
    case 'blue':    return { soft: 'bg-blue-50',     ring: 'ring-blue-500/40',     bar: 'bg-blue-500',    text: 'text-blue-700'    };
  }
}

// Compute a 0-100 progress percentage for a single service from its
// checklist. Missing checklist → 0% if pending/in_progress, 100% if done.
function svcProgress(svc?: ServiceSummary): number {
  if (!svc) return 0;
  if (svc.status === 'done') return 100;
  const total = svc.checklist?.length || 0;
  if (total === 0) return svc.status === 'in_progress' ? 25 : 0;
  const done = svc.checklist!.filter(c => c.done).length;
  return Math.round((done / total) * 100);
}

// Human label for a stage cell. We try the service's own .label first
// (set by the template), then fall back to its status + service type.
function stageLabel(svc?: ServiceSummary): string {
  if (!svc) return 'Not started';
  if (svc.status === 'done')        return 'Done · 100%';
  if (svc.status === 'blocked')     return 'Blocked';
  const pct = svcProgress(svc);
  if (svc.status === 'in_progress') return `In progress · ${pct}%`;
  return 'Not started';
}

// Which column currently "owns" a workflow. Returns the column key
// matching the first in-progress service, or first blocked service,
// or first non-done service. Used for the row-level highlight.
function activeColumn(wf: ExecutiveWorkflow): ColumnKey | null {
  const inProgress = wf.services.find(s => s.status === 'in_progress');
  if (inProgress) {
    const c = COLUMNS.find(c => c.matches(inProgress));
    if (c) return c.key;
  }
  const blocked = wf.services.find(s => s.status === 'blocked');
  if (blocked) {
    const c = COLUMNS.find(c => c.matches(blocked));
    if (c) return c.key;
  }
  const pending = wf.services.find(s => s.status !== 'done');
  if (pending) {
    const c = COLUMNS.find(c => c.matches(pending));
    if (c) return c.key;
  }
  return null;
}

// Workflow-level status pill. Derived from health field, falling back
// to a heuristic if health hasn't been computed yet.
function statusPill(wf: ExecutiveWorkflow): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  const allDone = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
  if (allDone) return { label: 'Completed', tone: 'success' };
  if (wf.health === 'blocked' || wf.blockerType === 'waiting_client_input') return { label: 'Awaiting client', tone: 'info' };
  if (wf.health === 'blocked') return { label: 'Delayed', tone: 'danger' };
  if (wf.health === 'at_risk') return { label: 'At risk', tone: 'warning' };
  if (wf.health === 'on_track') return { label: 'On track', tone: 'success' };
  return { label: 'In progress', tone: 'neutral' };
}

function pillClasses(t: ReturnType<typeof statusPill>['tone']): string {
  switch (t) {
    case 'success': return 'bg-emerald-500/12 text-emerald-700';
    case 'warning': return 'bg-amber-500/15 text-amber-700';
    case 'danger':  return 'bg-rose-500/12 text-rose-700';
    case 'info':    return 'bg-blue-500/12 text-blue-700';
    case 'neutral':
    default:        return 'bg-muted text-muted-foreground';
  }
}

// Tiny attention indicator slot. Returns 0-1 lucide icons to show on
// the row — urgent, blocked, awaiting client, etc.
function attentionIcon(wf: ExecutiveWorkflow): { icon: typeof AlertTriangle; color: string; title: string } | null {
  if (wf.priority === 'urgent')         return { icon: AlertTriangle, color: 'text-rose-600',   title: 'Urgent priority'   };
  if (wf.blockerType)                   return { icon: AlertTriangle, color: 'text-amber-600',  title: 'Has a blocker'     };
  return null;
}

// Initials for the client avatar circle.
function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

// Hash → soft tinted background for the avatar circle. Stable per
// name, so the same client always gets the same colour. We rotate
// through six pastel pairs sampled from the existing Robin palette.
function avatarChip(name?: string): { bg: string; fg: string } {
  const palette = [
    { bg: 'bg-emerald-100', fg: 'text-emerald-800' },
    { bg: 'bg-blue-100',    fg: 'text-blue-800'    },
    { bg: 'bg-amber-100',   fg: 'text-amber-800'   },
    { bg: 'bg-violet-100',  fg: 'text-violet-800'  },
    { bg: 'bg-rose-100',    fg: 'text-rose-800'    },
    { bg: 'bg-slate-100',   fg: 'text-slate-700'   },
  ];
  if (!name) return palette[5];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// ── Main component ──────────────────────────────────────────────────
export function PipelineExecutiveView({
  list, users, onOpenDrawer,
}: {
  list:        ExecutiveWorkflow[];
  users:       Record<string, ExecutiveUser>;
  onOpenDrawer?: (wfId: string, clientName?: string) => void;
}) {
  // KPI counts. Computed in one pass instead of six filter() calls.
  const kpis = useMemo(() => {
    let onTrack = 0, atRisk = 0, awaitingClient = 0, delayed = 0, launching = 0, completed = 0;
    const nowMs = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (const wf of list) {
      const allDone = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
      if (allDone) { completed++; continue; }
      if (wf.blockerType === 'waiting_client_input') awaitingClient++;
      else if (wf.health === 'blocked')              delayed++;
      else if (wf.health === 'at_risk')              atRisk++;
      else                                            onTrack++;
      if (wf.eta) {
        const etaMs = Date.parse(wf.eta);
        if (!Number.isNaN(etaMs) && etaMs - nowMs > 0 && etaMs - nowMs <= weekMs) launching++;
      }
    }
    return { total: list.length - completed, onTrack, atRisk, awaitingClient, delayed, launching, completed };
  }, [list]);

  // Right-rail derived sets — same pass discipline.
  const launchingThisWeek = useMemo(() => {
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    return list
      .filter(wf => {
        if (!wf.eta) return false;
        const t = Date.parse(wf.eta);
        return !Number.isNaN(t) && t - now > 0 && t - now <= week;
      })
      .sort((a, b) => Date.parse(a.eta!) - Date.parse(b.eta!))
      .slice(0, 5);
  }, [list]);

  const needsAttention = useMemo(() => list.filter(wf => {
    if (wf.priority === 'urgent')   return true;
    if (wf.health === 'blocked')    return true;
    if (wf.blockerType)             return true;
    return false;
  }).slice(0, 6), [list]);

  const teamWorkload = useMemo(() => {
    const counts = new Map<string, number>();
    for (const wf of list) {
      const seen = new Set<string>();
      for (const s of wf.services) {
        if (s.assignedTo && !seen.has(s.assignedTo)) {
          counts.set(s.assignedTo, (counts.get(s.assignedTo) || 0) + 1);
          seen.add(s.assignedTo);
        }
      }
    }
    const max = Math.max(1, ...counts.values());
    return Array.from(counts.entries())
      .map(([userId, n]) => ({ userId, n, pct: Math.round((n / max) * 100) }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
  }, [list]);

  const recentActivity = useMemo(() => {
    return list
      .filter(wf => wf.lastUpdate?.at && wf.lastUpdate.detail)
      .sort((a, b) => Date.parse(b.lastUpdate!.at!) - Date.parse(a.lastUpdate!.at!))
      .slice(0, 5);
  }, [list]);

  // Helper — formats "Sakshi · 2h ago" tail under each comment.
  const formatActor = (wf: ExecutiveWorkflow): string => {
    const actor = wf.lastUpdate?.actorId ? users[wf.lastUpdate.actorId]?.name : undefined;
    const when = wf.lastUpdate?.at ? formatDistanceToNow(new Date(wf.lastUpdate.at), { addSuffix: true }) : '';
    if (actor && when) return `${actor} · ${when}`;
    return actor || when || '';
  };

  return (
    <div className="space-y-4">
      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard icon={Inbox}          label="Active projects"     value={kpis.total}          hint="all open work" />
        <KpiCard icon={CheckCircle2}   label="On track"            value={kpis.onTrack}        tone="emerald" />
        <KpiCard icon={AlertTriangle}  label="At risk"             value={kpis.atRisk}         tone="amber"   />
        <KpiCard icon={UserCheck}      label="Awaiting client"     value={kpis.awaitingClient} tone="blue"    />
        <KpiCard icon={Clock}          label="Delayed"             value={kpis.delayed}        tone="rose"    />
        <KpiCard icon={Rocket}         label="Launching this week" value={kpis.launching}      tone="violet"  />
      </div>

      {/* ── Main grid: table left, sidebar right ─────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">

        {/* ── Project table ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Column header */}
          <div className="hidden md:grid grid-cols-[1.6fr_1.1fr_1.1fr_1.1fr_0.9fr_1.6fr] gap-2 px-4 py-2.5 border-b border-border text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">
            <div>Client / project</div>
            <div>Development</div>
            <div>Video</div>
            <div>Meta ads</div>
            <div>Status</div>
            <div>Last update</div>
          </div>

          {list.length === 0 ? (
            <div className="py-16 text-center text-[12.5px] text-muted-foreground">
              No projects in view — adjust filters or add a new client.
            </div>
          ) : (
            list.map(wf => {
              const active = activeColumn(wf);
              const pill   = statusPill(wf);
              const att    = attentionIcon(wf);
              const ic     = avatarChip(wf.clientName);
              const manager = wf.services.find(s => s.assignedTo)?.assignedTo;
              const managerName = manager ? users[manager]?.name : undefined;

              return (
                <div
                  key={wf._id}
                  onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
                  className="grid grid-cols-1 md:grid-cols-[1.6fr_1.1fr_1.1fr_1.1fr_0.9fr_1.6fr] gap-2 px-4 py-3 border-b border-border last:border-b-0 items-center hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  {/* Client + manager */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-8 w-8 rounded-full ${ic.bg} ${ic.fg} flex items-center justify-center text-[11px] font-bold shrink-0`}>
                      {initials(wf.clientName)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-semibold truncate">{wf.clientName || 'Unnamed'}</p>
                        {att && <att.icon className={`h-3 w-3 ${att.color} shrink-0`} aria-label={att.title} />}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {managerName || 'Unassigned'}
                      </p>
                    </div>
                  </div>

                  {COLUMNS.map(col => {
                    const svc = wf.services.find(col.matches);
                    const pct = svcProgress(svc);
                    const t   = tone(col.tone);
                    const isActive = active === col.key;
                    return (
                      <div
                        key={col.key}
                        className={`px-2 py-1.5 rounded-md transition-all ${
                          isActive
                            ? `${t.soft} ring-1 ${t.ring}`
                            : ''
                        }`}
                      >
                        <p className={`text-[10.5px] mb-1 truncate ${
                          !svc                          ? 'text-muted-foreground' :
                          svc.status === 'done'         ? 'text-emerald-700' :
                          svc.status === 'blocked'      ? 'text-rose-700'    :
                          isActive                       ? t.text             :
                                                          'text-muted-foreground'
                        }`}>
                          {stageLabel(svc)}
                        </p>
                        <div className={`h-1 rounded-full overflow-hidden ${
                          svc?.status === 'done' ? 'bg-emerald-500/20' :
                          isActive               ? 'bg-white/60'        :
                                                  'bg-muted'
                        }`}>
                          <div
                            className={`h-full transition-all ${
                              svc?.status === 'done'    ? 'bg-emerald-500' :
                              svc?.status === 'blocked' ? 'bg-rose-500'    :
                              isActive                   ? t.bar            :
                                                          'bg-muted-foreground/40'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Status pill */}
                  <div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${pillClasses(pill.tone)}`}>
                      {pill.label}
                    </span>
                  </div>

                  {/* Last update — single line, who + when */}
                  <div className="min-w-0">
                    <p className="text-[12px] text-foreground/90 truncate">
                      {wf.lastUpdate?.detail || <span className="italic text-muted-foreground">No updates yet</span>}
                    </p>
                    <p className="text-[10.5px] text-muted-foreground truncate">
                      {formatActor(wf) || '—'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Right sidebar ───────────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col gap-3 sticky top-4">

          <SidebarCard title="Upcoming launches" icon={Rocket}>
            {launchingThisWeek.length === 0 ? (
              <SidebarEmpty>No launches scheduled this week.</SidebarEmpty>
            ) : launchingThisWeek.map(wf => (
              <SidebarRow
                key={wf._id}
                onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
                left={wf.clientName || 'Unnamed'}
                right={wf.eta ? formatDistanceToNow(new Date(wf.eta), { addSuffix: true }) : ''}
              />
            ))}
          </SidebarCard>

          <SidebarCard title="Needs attention" icon={AlertTriangle}>
            {needsAttention.length === 0 ? (
              <SidebarEmpty>Nothing flagged — all calm.</SidebarEmpty>
            ) : needsAttention.map(wf => {
              const reason =
                wf.priority === 'urgent' ? 'Urgent' :
                wf.blockerType            ? wf.blockerType.replace(/_/g, ' ') :
                                            'Off track';
              return (
                <SidebarRow
                  key={wf._id}
                  onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
                  left={wf.clientName || 'Unnamed'}
                  right={reason}
                  tone="warning"
                />
              );
            })}
          </SidebarCard>

          <SidebarCard title="Team workload" icon={Activity}>
            {teamWorkload.length === 0 ? (
              <SidebarEmpty>No assignments yet.</SidebarEmpty>
            ) : teamWorkload.map(({ userId, n, pct }) => (
              <div key={userId} className="py-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px]">{users[userId]?.name || 'Unknown'}</span>
                  <span className="text-[10.5px] text-muted-foreground tabular-nums">{n} projects</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </SidebarCard>

          <SidebarCard title="Recent activity" icon={ArrowUpRight}>
            {recentActivity.length === 0 ? (
              <SidebarEmpty>No recent updates.</SidebarEmpty>
            ) : recentActivity.map(wf => (
              <div
                key={wf._id}
                onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
                className="py-1.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md"
              >
                <p className="text-[12px] truncate">
                  <span className="font-semibold">{wf.clientName}</span>
                  <span className="text-muted-foreground"> — {wf.lastUpdate?.detail}</span>
                </p>
                <p className="text-[10.5px] text-muted-foreground">
                  {formatActor(wf)}
                </p>
              </div>
            ))}
          </SidebarCard>
        </aside>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, tone, hint,
}: {
  icon:  typeof Inbox;
  label: string;
  value: number;
  tone?: 'emerald' | 'amber' | 'blue' | 'rose' | 'violet';
  hint?: string;
}) {
  const accent =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700'   :
    tone === 'blue'    ? 'text-blue-700'    :
    tone === 'rose'    ? 'text-rose-700'    :
    tone === 'violet'  ? 'text-violet-700'  :
                         'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
      </div>
      <p className={`text-[22px] font-bold tabular-nums leading-tight ${accent}`}>{value}</p>
      {hint && <p className="text-[10.5px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function SidebarCard({
  title, icon: Icon, children,
}: {
  title:    string;
  icon:     typeof Rocket;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</p>
      </div>
      <div className="divide-y divide-border/60">
        {children}
      </div>
    </div>
  );
}

function SidebarRow({
  left, right, tone, onClick,
}: {
  left:    string;
  right:   string;
  tone?:   'warning';
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md"
    >
      <p className="text-[12px] truncate min-w-0">{left}</p>
      <span className={`text-[10.5px] shrink-0 ml-2 capitalize ${
        tone === 'warning' ? 'text-amber-700' : 'text-muted-foreground'
      }`}>{right}</span>
    </div>
  );
}

function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[11.5px] text-muted-foreground text-center italic">{children}</p>;
}

export default PipelineExecutiveView;
