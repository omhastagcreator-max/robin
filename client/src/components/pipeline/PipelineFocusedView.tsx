import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format, parseISO, differenceInCalendarDays } from 'date-fns';
import {
  Search, X, Phone, Mail, UserCheck, Plane, AlertTriangle,
  CheckCircle2, Clock, Inbox, Rocket, ArrowLeft, MessageSquare,
  ChevronDown, Loader2,
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
  /** Optional escape hatch — power users can still pop a full drawer
   *  from elsewhere in the app. The focused view itself no longer
   *  uses this; opening a brand here is purely inline. */
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
export function PipelineFocusedView({ list, users, query, onQuery }: Props) {
  // Clicking a stage card or the brand panel sends the user to the
  // existing Salesforce-style full-record page at /clients/pipeline/:id.
  // Owner ask (May 2026): "I have something else like Salesforce
  // client CRM" — the inline panel is the preview, the dedicated route
  // is the canonical full client view.
  const navigate = useNavigate();
  const openFullClient = (wfId: string) => navigate(`/clients/pipeline/${wfId}`);
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

  // Stage clicks now navigate to the full Salesforce-style page
  // (see openFullClient above). No inline focus-stage state needed.

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
            <CollapsedSummary
              wf={match}
              users={users}
              onExpand={cancelCollapse}
              onOpenFull={() => openFullClient(match._id)}
            />
          ) : (
            <FullDetail
              wf={match}
              users={users}
              onLeaveIds={onLeaveIds}
              leavesLoaded={leavesLoaded}
              onOpenFull={() => openFullClient(match._id)}
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
  wf, users, onExpand, onOpenFull,
}: {
  wf:    FocusedWorkflow;
  users: Record<string, FocusedUser>;
  onExpand: () => void;
  onOpenFull: () => void;
}) {
  const activeSvc = wf.services.find(s => s.status === 'in_progress')
                 || wf.services.find(s => s.status !== 'done')
                 || wf.services[0];
  const assigneeName = activeSvc?.assignedTo ? users[activeSvc.assignedTo]?.name : undefined;
  return (
    <div
      onMouseEnter={onExpand}
      onClick={onOpenFull}
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
//
// Layout philosophy (May 2026 redesign):
//   - Hero band at top — generous, calm, brand-first. Big avatar, big
//     name, headline status pill, contact links underneath.
//   - Progress band — overall % done as an SVG arc + counts of stages
//     done / in progress / waiting. One quick read.
//   - Stage cards in a grid, NOT a stack of dense rows. Each card has
//     a colored top stripe, generous padding, a single status pill,
//     and exactly three rows of meta (assignee · end date · last
//     comment). Clickable → narrows to one-stage focus mode.
//   - Focused-stage mode renders ONE big card with everything the
//     spec listed (assignee + availability, dates, checklist, comments,
//     stage-scoped activity).
//   - Activity timeline at the bottom as a properly-headed section.
//
// The visual difference from v1 — bigger type, fewer borders, more
// whitespace, a single accent colour per stage instead of pills
// everywhere, and the SVG progress arc as the one "hero" data point
// the eye lands on.
function FullDetail({
  wf, users, onLeaveIds, leavesLoaded, onOpenFull,
}: {
  wf:            FocusedWorkflow;
  users:         Record<string, FocusedUser>;
  onLeaveIds:    Set<string>;
  leavesLoaded:  boolean;
  /** Navigates to the Salesforce-style full-page client view at
   *  /clients/pipeline/:id. Wired to the hero "Open full client" CTA
   *  and to each stage card's click handler. */
  onOpenFull:    () => void;
}) {
  // Headline status pill — aggregates per-stage states.
  const workflowStatus = computeWorkflowStatus(wf, onLeaveIds);

  // Per-stage state for both the progress counters and the card grid.
  const stageStates = STAGES.map(s => {
    const svc = wf.services.find(s.matches);
    return { stage: s, svc, status: computeStageStatus(svc, wf, onLeaveIds) };
  });
  const doneCount       = stageStates.filter(s => s.status.key === 'completed').length;
  const inProgressCount = stageStates.filter(s => ['active_on_time', 'active_delayed', 'active_on_holiday'].includes(s.status.key)).length;
  const blockedCount    = stageStates.filter(s => s.status.key === 'blocked').length;

  // Overall percent — average of per-service checklist progress.
  const overallPct = (() => {
    if (wf.services.length === 0) return 0;
    let total = 0, done = 0;
    for (const s of wf.services) {
      const cl = s.checklist || [];
      total += cl.length;
      done  += cl.filter(c => c.done).length;
      // Empty checklist but done → count as fully complete (1 of 1).
      if (cl.length === 0 && s.status === 'done') { total += 1; done += 1; }
    }
    return total === 0 ? 0 : Math.round((done / total) * 100);
  })();

  return (
    <div className="rounded-3xl border border-border bg-card overflow-hidden">
      {/* ── Hero band ─────────────────────────────────────────────── */}
      <div className="px-6 sm:px-8 pt-6 pb-5 border-b border-border">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-[18px] font-bold shrink-0">
            {initials(wf.clientName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-[22px] sm:text-[24px] font-bold tracking-tight leading-none">
                {wf.clientName || 'Unnamed client'}
              </h2>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${pillClasses(workflowStatus.tone)}`}>
                {workflowStatus.label}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12.5px]">
              {wf.clientPhone && (
                <a href={`tel:${wf.clientPhone}`} className="text-primary hover:underline tabular-nums inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> {wf.clientPhone}
                </a>
              )}
              {wf.clientEmail && (
                <a href={`mailto:${wf.clientEmail}`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {wf.clientEmail}
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onOpenFull}
            className="text-[12.5px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-sm"
            title="Open the full client record"
          >
            Open full client view <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
          </button>
        </div>
      </div>

      {/* ── Progress band ─────────────────────────────────────────── */}
      <div className="px-6 sm:px-8 py-5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-6 flex-wrap">
          <ProgressArc pct={overallPct} />
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">
              Pipeline progress
            </p>
            <div className="flex flex-wrap gap-2">
              <CountChip label="Done"        n={doneCount}       tone="emerald" />
              <CountChip label="In progress" n={inProgressCount} tone="amber" />
              <CountChip label="Blocked"     n={blockedCount}    tone="rose" />
              <CountChip label="Total stages" n={STAGES.length}  tone="neutral" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Stages ────────────────────────────────────────────────── */}
      {/* Tab strip + single focused stage. Owner spec: ONE STAGE AT A
          TIME, auto-selected to the in-progress stage so the user
          lands directly on the stage that needs attention. Other
          stages live in the tab strip — click to switch focus. The
          big "Open full client view →" button in the hero is the
          only path to the dedicated record page. */}
      <FocusedStagesBlock
        wf={wf}
        users={users}
        onLeaveIds={onLeaveIds}
        stageStates={stageStates}
        onOpenFull={onOpenFull}
      />

      {/* Footer — leaves-loading hint */}
      {!leavesLoaded && (
        <div className="px-6 py-2 border-t border-border text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking who's on leave today…
        </div>
      )}
    </div>
  );
}

// ── FocusedStagesBlock ──────────────────────────────────────────────
// The middle band of the panel. Three responsibilities:
//   1. Tab strip — one chip per stage, each showing its status pill.
//      Active chip = currently focused stage. Clicking a chip swaps
//      focus. Auto-defaults to the in-progress stage so the user
//      doesn't have to find it manually.
//   2. Focused stage detail — assignee + dates + comment in a tight
//      left-to-right meta row (matches "left to right xyz" from the
//      voice memo). Completed stages collapse to ONE LINE per spec.
//   3. Activity timeline — chronological feed. Stays here so the user
//      sees what just happened on this brand without leaving.
function FocusedStagesBlock({
  wf, users, onLeaveIds, stageStates, onOpenFull,
}: {
  wf:          FocusedWorkflow;
  users:       Record<string, FocusedUser>;
  onLeaveIds:  Set<string>;
  stageStates: Array<{ stage: { key: string; label: string }; svc?: ServiceSummary; status: StatusInfo }>;
  onOpenFull:  () => void;
}) {
  // Default focus → in-progress stage. If none in progress, fall back
  // to the first blocked/inactive stage, then the first stage outright.
  const defaultStageKey =
    stageStates.find(s => ['active_on_time','active_delayed','active_on_holiday'].includes(s.status.key))?.stage.key
    || stageStates.find(s => s.status.key === 'blocked')?.stage.key
    || stageStates.find(s => s.status.key === 'inactive')?.stage.key
    || stageStates[0]?.stage.key
    || '';
  const [activeKey, setActiveKey] = useState<string>(defaultStageKey);

  // Reset when workflow changes — fresh brand should always land on
  // the new brand's current active stage, never carry over the old
  // selection.
  useEffect(() => { setActiveKey(defaultStageKey); }, [wf._id, defaultStageKey]);

  const active = stageStates.find(s => s.stage.key === activeKey) || stageStates[0];
  if (!active) return null;

  // "Moved back" detection: this stage is in_progress while a stage
  // AFTER it (in the canonical sequence) has been completed or is
  // ahead. That implies the project regressed. Per spec: surface as
  // a small badge so the user sees it without asking.
  const movedBack = (() => {
    const idx = stageStates.findIndex(s => s.stage.key === activeKey);
    if (idx < 0) return false;
    if (!active.svc || active.svc.status === 'done') return false;
    return stageStates.slice(idx + 1).some(s =>
      s.svc?.status === 'done' || s.svc?.status === 'in_progress'
    );
  })();

  return (
    <>
      {/* Tab strip */}
      <div className="px-6 sm:px-8 pt-5 pb-4 border-b border-border">
        <div className="inline-flex items-center rounded-xl bg-muted/40 p-1 gap-1 flex-wrap">
          {stageStates.map(({ stage, status }) => {
            const tone = stageTone(stage.key);
            const isActive = stage.key === activeKey;
            return (
              <button
                key={stage.key}
                onClick={() => setActiveKey(stage.key)}
                onMouseEnter={() => setActiveKey(stage.key)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${
                  isActive ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tone.stripe}`} />
                {stage.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${pillClasses(status.tone)}`}>
                  {status.label.split(' · ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active stage detail */}
      <div className="px-6 sm:px-8 py-6 border-b border-border">
        <ActiveStageDetail
          stage={active.stage}
          svc={active.svc}
          status={active.status}
          wf={wf}
          users={users}
          onLeaveIds={onLeaveIds}
          movedBack={movedBack}
        />
      </div>

      {/* Activity timeline */}
      <div>
        <div className="px-6 sm:px-8 pt-5 pb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
              Activity
            </p>
          </div>
          <button
            onClick={onOpenFull}
            className="text-[11px] text-primary hover:underline"
          >
            See full timeline →
          </button>
        </div>
        <ActivityTimeline workflowId={wf._id} refreshKey={0} />
      </div>
    </>
  );
}

// ── ActiveStageDetail ──────────────────────────────────────────────
// The content shown for whichever stage is currently selected in
// FocusedStagesBlock. Layout intentionally left-to-right to match the
// voice memo's "left to right xyz" guidance. Completed stages
// collapse to one line per spec ("bas ek hi point bahut hai").
function ActiveStageDetail({
  stage, svc, status, wf, users, onLeaveIds, movedBack,
}: {
  stage:       { key: string; label: string };
  svc?:        ServiceSummary;
  status:      StatusInfo;
  wf:          FocusedWorkflow;
  users:       Record<string, FocusedUser>;
  onLeaveIds:  Set<string>;
  movedBack:   boolean;
}) {
  const tone = stageTone(stage.key);
  const assignee = svc?.assignedTo ? users[svc.assignedTo] : undefined;
  const onLeave  = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
  const etaStr = svc?.eta || wf.eta || undefined;
  const meetingStr = svc?.nextMeetingAt || wf.nextMeetingAt || undefined;

  // Completed → one-liner. Per spec: nothing else should appear under
  // a completed stage. Show the stage label, "Completed" pill, and a
  // small "Moved to next task" hint when a next-stage exists.
  if (status.key === 'completed') {
    return (
      <div className="flex items-center gap-3 py-2">
        <span className={`h-2 w-2 rounded-full ${tone.stripe}`} />
        <p className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${tone.text}`}>
          {stage.label}
        </p>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/12 text-emerald-700">
          Completed
        </span>
        <span className="text-[11.5px] text-muted-foreground">· Moved to next task</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row: stage label + status pill + moved-back badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone.stripe}`} />
          <p className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${tone.text}`}>
            {stage.label}
          </p>
        </div>
        {svc?.label && (
          <h3 className="text-[16px] font-bold leading-none">{svc.label}</h3>
        )}
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${pillClasses(status.tone)}`} title={status.hint || ''}>
          {status.label}
        </span>
        {movedBack && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-500/12 text-amber-700">
            <ArrowLeft className="h-3 w-3" /> Moved back to this stage
          </span>
        )}
      </div>

      {/* Left-to-right meta row: assignee · end date · next meeting */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
        <MetaCell label="Assignee">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
              {initials(assignee?.name) || '·'}
            </span>
            <span className={`truncate ${onLeave ? 'text-sky-700 font-medium' : ''}`}>
              {assignee?.name || <span className="text-muted-foreground italic">Unassigned</span>}
            </span>
            {onLeave && <Plane className="h-3 w-3 text-sky-600 shrink-0" />}
          </div>
        </MetaCell>
        <MetaCell label="End date">
          {etaStr ? <span className="font-medium">{formatDate(etaStr)}</span> : <span className="text-muted-foreground italic">Not set</span>}
        </MetaCell>
        <MetaCell label="Next meeting">
          {meetingStr ? <span className="font-medium">{formatDate(meetingStr)}</span> : <span className="text-muted-foreground italic">None scheduled</span>}
        </MetaCell>
      </div>

      {/* Comment / blocker */}
      {wf.lastUpdate?.detail && (
        <div className={`rounded-xl ${tone.soft} px-4 py-3`}>
          <div className="flex items-start gap-2">
            <MessageSquare className={`h-3.5 w-3.5 mt-0.5 ${tone.text} shrink-0`} />
            <div className="min-w-0">
              <p className="text-[13px] leading-snug">{wf.lastUpdate.detail}</p>
              {wf.lastUpdate.at && (
                <p className="text-[10.5px] text-muted-foreground mt-1">
                  {wf.lastUpdate.actorId ? `${users[wf.lastUpdate.actorId]?.name} · ` : ''}
                  {formatDistanceToNow(parseISO(wf.lastUpdate.at), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
        {label}
      </p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

// ── Stage tone resolver (matches the executive view convention) ────
function stageTone(key: string): { stripe: string; soft: string; text: string } {
  switch (key) {
    case 'dev':   return { stripe: 'bg-emerald-500', soft: 'bg-emerald-50',  text: 'text-emerald-700' };
    case 'video': return { stripe: 'bg-amber-500',   soft: 'bg-amber-50',    text: 'text-amber-700'   };
    case 'meta':  return { stripe: 'bg-blue-500',    soft: 'bg-blue-50',     text: 'text-blue-700'    };
    default:      return { stripe: 'bg-slate-400',   soft: 'bg-slate-50',    text: 'text-slate-700'   };
  }
}

// (StageCard removed — the 3-card grid was replaced by the tab strip +
// single ActiveStageDetail. See FocusedStagesBlock above. Per spec:
// one stage at a time, auto-focused on the in-progress stage.)

// ── Small atoms ─────────────────────────────────────────────────────

function ProgressArc({ pct }: { pct: number }) {
  // 72px diameter SVG arc — same visual weight as a metric card. The
  // strokeDashoffset trick draws a partial circle equal to pct%.
  const R = 30, C = 2 * Math.PI * R;
  const offset = C - (Math.max(0, Math.min(100, pct)) / 100) * C;
  return (
    <div className="relative" style={{ width: 72, height: 72 }}>
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle cx="36" cy="36" r={R} fill="none" stroke="hsl(var(--primary))" strokeWidth="6"
          strokeDasharray={C} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[14px] font-bold tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function CountChip({ label, n, tone }: { label: string; n: number; tone: 'emerald' | 'amber' | 'rose' | 'neutral' }) {
  const cls =
    tone === 'emerald' ? 'bg-emerald-500/12 text-emerald-700' :
    tone === 'amber'   ? 'bg-amber-500/15 text-amber-700'    :
    tone === 'rose'    ? 'bg-rose-500/12 text-rose-700'      :
                          'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium ${cls}`}>
      <span className="font-bold tabular-nums">{n}</span> {label}
    </span>
  );
}

// (Meta atom removed alongside FocusedStageCard — was only used there.)

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
