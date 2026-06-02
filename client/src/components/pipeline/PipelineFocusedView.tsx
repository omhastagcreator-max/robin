import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow, format, parseISO, differenceInCalendarDays } from 'date-fns';
import {
  Search, X, Phone, Mail, Calendar, UserCheck, Plane, AlertTriangle,
  CheckCircle2, Clock, Inbox, Rocket, ArrowRight, ArrowLeft, MessageSquare,
  ChevronDown, Loader2, Filter,
} from 'lucide-react';
import * as api from '@/api';
import { ActivityTimeline } from '@/components/panels/ProjectDetailPanel';

/**
 * PipelineFocusedView — LeadSquared / Odoo–style search-first view.
 *
 * Philosophy (owner ask, May 2026):
 *   "Multiple options = multiple confusion." One brand at a time. The
 *   resting screen is just six KPIs + a centred search bar. The
 *   moment a query matches a single client, that client's full per-
 *   stage breakdown expands inline. No other brands compete for
 *   attention. When you stop interacting, the detail auto-collapses
 *   back to a one-line summary so the screen stays calm. Hovering
 *   the summary re-opens the full panel.
 *
 * Per-stage card surfaces:
 *   - Compound status pill: Active · on time / Active · delayed /
 *     Active · on holiday / Inactive (N days) / Completed / Blocked /
 *     Not started.
 *   - Assignee with a "Plane" icon if they're on approved leave today
 *     (driven by /api/leaves/on-leave-today).
 *   - End date (= service ETA) and next-meeting date if either is set.
 *   - Last comment + actor + time-ago.
 *
 * No charts, no extra columns, no toggle clutter. The other views
 * (Board / Flow / List / Dashboard) are still reachable from the
 * toolbar's "Advanced" toggle for the rare cases an admin actually
 * wants a multi-brand grid.
 */

// ── Shapes ───────────────────────────────────────────────────────────
// Loose intentionally — same approach as the executive view — so the
// page's stricter Workflow / User types are structurally assignable.
interface ChecklistItem { done?: boolean }
interface ServiceSummary {
  _id?: string;
  label?: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist?: ChecklistItem[];
  assignedTo?: string;
  eta?: string | null;
  nextMeetingAt?: string | null;
}
export interface FocusedWorkflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: ServiceSummary[];
  health?: string;
  lastUpdate?: { detail?: string; at?: string; actorId?: string; serviceType?: string } | null;
  updatedAt?: string;
  priority?: string;
  blockerType?: string;
  eta?: string | null;
  nextMeetingAt?: string | null;
}
export interface FocusedUser { _id: string; name?: string }

interface Props {
  list:    FocusedWorkflow[];
  users:   Record<string, FocusedUser>;
  query:   string;
  onQuery: (q: string) => void;
  onOpenDrawer?: (wfId: string, clientName?: string) => void;
}

// ── Stage taxonomy — same three columns the executive view uses ─────
const STAGES = [
  { key: 'dev',   label: 'Development', matches: (s: ServiceSummary) => s.serviceType === 'shopify'    },
  { key: 'video', label: 'Video',       matches: (s: ServiceSummary) => s.serviceType === 'influencer' },
  { key: 'meta',  label: 'Meta ads',    matches: (s: ServiceSummary) => s.serviceType === 'meta_ads'   },
];

// ── Compound status ─────────────────────────────────────────────────
type Status =
  | 'completed' | 'active_on_time' | 'active_delayed' | 'active_on_holiday'
  | 'blocked'   | 'inactive'        | 'not_started';

interface StatusInfo {
  key:    Status;
  label:  string;
  hint?:  string;
  tone:   'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'sky';
}

// Days of inactivity before we flag a stage as "Inactive".
const INACTIVE_DAYS = 3;

function computeStageStatus(
  svc: ServiceSummary | undefined,
  wf: FocusedWorkflow,
  onLeaveIds: Set<string>,
): StatusInfo {
  if (!svc) return { key: 'not_started', label: 'Not started', tone: 'neutral' };
  if (svc.status === 'done')    return { key: 'completed', label: 'Completed', tone: 'success' };
  if (svc.status === 'blocked') return { key: 'blocked',   label: 'Blocked',   tone: 'danger' };

  if (svc.status === 'in_progress') {
    // Holiday wins over delayed / on-time because the work CAN'T move
    // when the assignee isn't at their desk — owner ask: surface this
    // without the manager having to be asked.
    if (svc.assignedTo && onLeaveIds.has(svc.assignedTo)) {
      return { key: 'active_on_holiday', label: 'Active · on holiday', hint: 'Assignee on approved leave today', tone: 'sky' };
    }
    const etaStr = svc.eta || wf.eta;
    if (etaStr) {
      try {
        const eta = parseISO(etaStr);
        if (differenceInCalendarDays(eta, new Date()) < 0) {
          return { key: 'active_delayed', label: 'Active · delayed', tone: 'warning' };
        }
      } catch { /* malformed eta — fall through to on-time */ }
    }
    return { key: 'active_on_time', label: 'Active · on time', tone: 'success' };
  }

  // pending — check inactivity
  const lastAtStr = wf.lastUpdate?.at;
  if (lastAtStr) {
    try {
      const days = differenceInCalendarDays(new Date(), parseISO(lastAtStr));
      if (days >= INACTIVE_DAYS) {
        return { key: 'inactive', label: `Inactive · ${days} days`, tone: 'warning' };
      }
    } catch { /* ignore */ }
  }
  return { key: 'not_started', label: 'Not started', tone: 'neutral' };
}

function pillClasses(t: StatusInfo['tone']): string {
  switch (t) {
    case 'success': return 'bg-emerald-500/12 text-emerald-700';
    case 'warning': return 'bg-amber-500/15 text-amber-700';
    case 'danger':  return 'bg-rose-500/12 text-rose-700';
    case 'info':    return 'bg-blue-500/12 text-blue-700';
    case 'sky':     return 'bg-sky-500/15 text-sky-700';
    case 'neutral':
    default:        return 'bg-muted text-muted-foreground';
  }
}

// Match a query against name / phone / email. Used to find which
// brand to expand. Phone matches strip non-digits so spaces/dashes
// don't kill the match.
function matchBrand(list: FocusedWorkflow[], query: string): FocusedWorkflow | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const qDigits = q.replace(/[^0-9]/g, '');
  for (const wf of list) {
    if (wf.clientName?.toLowerCase().includes(q)) return wf;
    if (wf.clientEmail?.toLowerCase().includes(q)) return wf;
    if (qDigits.length >= 6 && wf.clientPhone) {
      const wfDigits = wf.clientPhone.replace(/[^0-9]/g, '');
      if (wfDigits.includes(qDigits)) return wf;
    }
  }
  return null;
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

// ── KPI helper ──────────────────────────────────────────────────────
function computeKpis(list: FocusedWorkflow[]) {
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
      const t = Date.parse(wf.eta);
      if (!Number.isNaN(t) && t - nowMs > 0 && t - nowMs <= weekMs) launching++;
    }
  }
  return { total: list.length - completed, onTrack, atRisk, awaitingClient, delayed, launching };
}

// ── Main component ──────────────────────────────────────────────────
export function PipelineFocusedView({ list, users, query, onQuery, onOpenDrawer }: Props) {
  // Who is on leave today? One fetch, cached for the page session.
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set());
  const [leavesLoaded, setLeavesLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (api as any).onLeaveToday?.()
      .then((rows: Array<{ userId: string }>) => {
        if (cancelled) return;
        setOnLeaveIds(new Set(rows.map(r => r.userId)));
        setLeavesLoaded(true);
      })
      .catch(() => { if (!cancelled) setLeavesLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const kpis = useMemo(() => computeKpis(list), [list]);
  const match = useMemo(() => matchBrand(list, query), [list, query]);

  // ── Auto-collapse on inactivity ──────────────────────────────────
  // Owner spec (May 2026): expand on hover/click, collapse 1 s after
  // the mouse leaves the detail card. Crucially we DON'T listen to
  // windowwide mousemove anymore — that collapsed while the user was
  // reading without touching anything. Instead we arm a 1s timer only
  // on onMouseLeave of the card itself; onMouseEnter cancels it and
  // re-expands. This matches the OS-tooltip pattern (Apple, macOS).
  const COLLAPSE_AFTER_MS = 1_000;
  const [collapsed, setCollapsed] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Called from onMouseLeave on the detail card. Starts the 1s
  // countdown; onMouseEnter cancels it and re-expands instantly.
  const armCollapse = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => setCollapsed(true), COLLAPSE_AFTER_MS);
  };
  const cancelCollapse = () => {
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
    setCollapsed(false);
  };

  // New match → always start expanded, cancel any pending collapse.
  useEffect(() => {
    if (!match) {
      cancelCollapse();
      return;
    }
    cancelCollapse();
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?._id]);

  // Stage focus — clicking a stage card sets this to the stage's key
  // and the detail panel narrows to just that stage's content. Click
  // the same stage again to clear and see all stages.
  const [focusedStage, setFocusedStage] = useState<string | null>(null);
  useEffect(() => { setFocusedStage(null); }, [match?._id]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ── KPI strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi icon={Inbox}         label="Active projects"     value={kpis.total} />
        <Kpi icon={CheckCircle2}  label="On track"            value={kpis.onTrack}        tone="emerald" />
        <Kpi icon={AlertTriangle} label="At risk"             value={kpis.atRisk}         tone="amber"   />
        <Kpi icon={UserCheck}     label="Awaiting client"     value={kpis.awaitingClient} tone="blue"    />
        <Kpi icon={Clock}         label="Delayed"             value={kpis.delayed}        tone="rose"    />
        <Kpi icon={Rocket}        label="Launching this week" value={kpis.launching}      tone="violet"  />
      </div>

      {/* ── Big centred search ───────────────────────────────────── */}
      <div className="max-w-2xl mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder="Enter brand name, phone, or email — one client at a time"
            className="w-full pl-11 pr-10 py-3.5 bg-card border border-border rounded-2xl text-[14px] focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
            autoFocus
          />
          {query && (
            <button onClick={() => onQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {query && !match && (
          <p className="text-[12px] text-muted-foreground mt-2 text-center">
            No brand matches that search. Try a different name or phone.
          </p>
        )}
      </div>

      {/* ── The expanded brand detail ────────────────────────────── */}
      {match && (
        <div
          onMouseEnter={cancelCollapse}
          onMouseLeave={armCollapse}
          onFocus={cancelCollapse}
        >
          {collapsed ? (
            <CollapsedSummary wf={match} users={users} onExpand={cancelCollapse} />
          ) : (
            <FullDetail
              wf={match}
              users={users}
              onLeaveIds={onLeaveIds}
              leavesLoaded={leavesLoaded}
              focusedStage={focusedStage}
              onFocusStage={(key) => setFocusedStage(prev => prev === key ? null : key)}
              onOpenFull={() => onOpenDrawer?.(match._id, match.clientName)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── KPI card ────────────────────────────────────────────────────────
function Kpi({
  icon: Icon, label, value, tone,
}: {
  icon:  typeof Inbox;
  label: string;
  value: number;
  tone?: 'emerald' | 'amber' | 'blue' | 'rose' | 'violet';
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
    </div>
  );
}

// ── Collapsed summary (post-inactivity) ─────────────────────────────
function CollapsedSummary({
  wf, users, onExpand,
}: {
  wf:    FocusedWorkflow;
  users: Record<string, FocusedUser>;
  onExpand: () => void;
}) {
  const activeSvc = wf.services.find(s => s.status === 'in_progress')
                 || wf.services.find(s => s.status !== 'done')
                 || wf.services[0];
  const assigneeName = activeSvc?.assignedTo ? users[activeSvc.assignedTo]?.name : undefined;
  return (
    <div
      onMouseEnter={onExpand}
      className="rounded-2xl border border-border bg-card px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors flex items-center gap-3"
    >
      <div className="h-9 w-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[12px] font-bold">
        {initials(wf.clientName)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold truncate">{wf.clientName}</p>
        <p className="text-[12px] text-muted-foreground truncate">
          {activeSvc?.label || 'No active stage'}
          {assigneeName && <> · {assigneeName}</>}
          {wf.lastUpdate?.detail && <> · {wf.lastUpdate.detail}</>}
        </p>
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── Full detail (the focus mode) ────────────────────────────────────
function FullDetail({
  wf, users, onLeaveIds, leavesLoaded, focusedStage, onFocusStage, onOpenFull,
}: {
  wf:            FocusedWorkflow;
  users:         Record<string, FocusedUser>;
  onLeaveIds:    Set<string>;
  leavesLoaded:  boolean;
  focusedStage:  string | null;
  onFocusStage:  (key: string) => void;
  onOpenFull?:   () => void;
}) {
  // Which stages to show. If focusedStage is set, narrow to just that
  // one (per spec: "When a stage is selected: Display only information
  // related to that stage. Hide everything unrelated").
  const visibleStages = focusedStage
    ? STAGES.filter(s => s.key === focusedStage)
    : STAGES;

  // Top-level workflow status — derived from services. Sets the
  // headline pill next to the client name.
  const workflowStatus = computeWorkflowStatus(wf, onLeaveIds);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header — client identity + headline status + contacts */}
      <div className="px-5 py-4 border-b border-border flex items-start gap-3 flex-wrap">
        <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[14px] font-bold shrink-0">
          {initials(wf.clientName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[16px] font-bold tracking-tight">{wf.clientName || 'Unnamed client'}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap ${pillClasses(workflowStatus.tone)}`}>
              {workflowStatus.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12px]">
            {wf.clientPhone && (
              <a href={`tel:${wf.clientPhone}`} className="text-primary hover:underline tabular-nums inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {wf.clientPhone}
              </a>
            )}
            {wf.clientEmail && (
              <a href={`mailto:${wf.clientEmail}`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Mail className="h-3 w-3" /> {wf.clientEmail}
              </a>
            )}
          </div>
        </div>
        {focusedStage && (
          <button
            onClick={() => onFocusStage(focusedStage)}
            className="text-[12px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-foreground"
            title="Show all stages again"
          >
            <Filter className="h-3 w-3" /> Showing one stage · clear
          </button>
        )}
        {onOpenFull && !focusedStage && (
          <button
            onClick={onOpenFull}
            className="text-[12px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-foreground"
          >
            Full drawer <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Per-stage breakdown */}
      <div className="divide-y divide-border">
        {visibleStages.map(stage => {
          const svc = wf.services.find(stage.matches);
          const status = computeStageStatus(svc, wf, onLeaveIds);
          const assignee = svc?.assignedTo ? users[svc.assignedTo] : undefined;
          const onLeave  = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
          const etaStr = svc?.eta || wf.eta || undefined;
          const meetingStr = svc?.nextMeetingAt || wf.nextMeetingAt || undefined;
          const isFocused = focusedStage === stage.key;

          return (
            <button
              key={stage.key}
              onClick={() => onFocusStage(stage.key)}
              className={`w-full text-left px-5 py-4 grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-x-4 gap-y-2 items-start transition-colors ${
                isFocused ? 'bg-primary/[0.04]' : 'hover:bg-muted/30'
              }`}
              title={isFocused ? 'Click to show all stages again' : `Click to focus only on ${stage.label}`}
            >
              {/* Stage label */}
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
                  {stage.label}
                </p>
                {svc?.label && <p className="text-[12px] text-foreground/80 mt-0.5">{svc.label}</p>}
              </div>

              {/* Meta — assignee, dates, meeting */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9.5px] font-bold text-muted-foreground">
                      {initials(assignee?.name) || '·'}
                    </span>
                    <span className={onLeave ? 'text-sky-700 font-medium' : 'text-foreground'}>
                      {assignee?.name || <span className="text-muted-foreground italic">Unassigned</span>}
                    </span>
                    {onLeave && (
                      <Plane className="h-3 w-3 text-sky-600" aria-label="On approved leave today" />
                    )}
                  </span>
                  {etaStr && (
                    <span className="inline-flex items-center gap-1 text-foreground/80">
                      <Calendar className="h-3 w-3" />
                      End date: <span className="font-medium">{formatDate(etaStr)}</span>
                    </span>
                  )}
                  {meetingStr && (
                    <span className="inline-flex items-center gap-1 text-foreground/80">
                      <Calendar className="h-3 w-3 text-emerald-600" />
                      Next meeting: <span className="font-medium">{formatDate(meetingStr)}</span>
                    </span>
                  )}
                </div>
                {/* Last comment scoped to this stage when available */}
                {wf.lastUpdate?.detail && (
                  <div className="flex items-start gap-1.5 text-[12px] text-foreground/85 leading-snug">
                    <MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="truncate">
                      {wf.lastUpdate.detail}
                      {wf.lastUpdate.at && (
                        <span className="text-muted-foreground">
                          {' '}· {wf.lastUpdate.actorId ? users[wf.lastUpdate.actorId]?.name + ' · ' : ''}
                          {formatDistanceToNow(parseISO(wf.lastUpdate.at), { addSuffix: true })}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Status pill */}
              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${pillClasses(status.tone)}`}
                  title={status.hint || ''}>
                  {status.label}
                </span>
                {status.key === 'inactive' && (
                  <span className="text-[10.5px] text-muted-foreground inline-flex items-center gap-0.5">
                    <ArrowLeft className="h-2.5 w-2.5" /> Moved back
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Activity timeline — chronological history (calls, notes, stage
          changes, approvals, deliveries). Embedded inline so users
          don't have to open the drawer to see what happened. */}
      <div className="border-t border-border">
        <div className="px-5 pt-3 pb-1 flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
            Activity {focusedStage ? `· ${STAGES.find(s => s.key === focusedStage)?.label}` : ''}
          </p>
        </div>
        <ActivityTimeline workflowId={wf._id} refreshKey={0} />
      </div>

      {/* Footer — small "loading leaves" hint while the fetch is in flight */}
      {!leavesLoaded && (
        <div className="px-5 py-2 border-t border-border text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking who's on leave today…
        </div>
      )}
    </div>
  );
}

// ── Workflow-level status ──────────────────────────────────────────
// Aggregates the per-stage statuses into one headline pill. Priority
// order picks the "worst" — completed last, blocked first, etc.
function computeWorkflowStatus(wf: FocusedWorkflow, onLeaveIds: Set<string>): StatusInfo {
  const allDone = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
  if (allDone) return { key: 'completed', label: 'Completed', tone: 'success' };

  const stageStatuses = STAGES.map(s => computeStageStatus(wf.services.find(s.matches), wf, onLeaveIds));
  // Priority: blocked > delayed > on holiday > inactive > on time > not started
  const priority: Status[] = ['blocked', 'active_delayed', 'active_on_holiday', 'inactive', 'active_on_time', 'not_started'];
  for (const p of priority) {
    const hit = stageStatuses.find(s => s.key === p);
    if (hit) return hit;
  }
  return { key: 'not_started', label: 'Not started', tone: 'neutral' };
}

// ── Tiny date helper — "Tue, 28 May" style ──────────────────────────
function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try { return format(parseISO(iso), 'EEE, d MMM'); }
  catch { return iso; }
}

export default PipelineFocusedView;
