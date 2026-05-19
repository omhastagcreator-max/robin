import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Loader2, X, Sparkles, Workflow,
  ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle,
  MoreVertical, ArrowRight, TrendingUp, Users, Activity, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { useDrawer } from '@/components/ui/RightDrawer';
import { ProjectDetailPanel } from '@/components/panels/ProjectDetailPanel';
import { useShortcut } from '@/hooks/useShortcut';
import { StatusPill, type Status } from '@/components/ui/StatusPill';

/**
 * ClientPipelinePage — universal "where is X at?" view.
 *
 * Sales + admin can:
 *   - Search any client by phone, name or email in the big search bar
 *   - See every client's progress at a glance (overall % + current stage)
 *   - Click "+ New pipeline" to onboard a client + pick their services
 *     (system auto-assigns the right teammates and creates SOP checklists)
 *
 * Employees see only the workflows that include a service assigned to them.
 *
 * One screen, no jargon, role-aware. Click any row → workflow detail.
 */

interface ServiceSummary {
  _id?: string;
  serviceType: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  // The server stores the per-item label as `text` (see ClientWorkflow
  // model). Older code paths called it `title` — we accept both for
  // defensive forward-compatibility, but `text` is what's actually on
  // disk. This is what fixed the "Untitled step" everywhere bug.
  checklist: Array<{ _id?: string; text?: string; title?: string; done: boolean }>;
  assignedTo?: string;
}
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: ServiceSummary[];
  updatedAt: string;
  /** Decorated by the server — last activity-log entry, used to show
   *  "Last update: …" on each card without shipping the full activity. */
  lastUpdate?: {
    at?: string;
    action?: string;
    detail?: string;
    serviceType?: string;
    actorId?: string;
  } | null;
}

export default function ClientPipelinePage() {
  const { role } = useAuth();
  const isAdminOrSales = ['admin', 'sales'].includes(role);

  const [query, setQuery]       = useState('');
  const [mineOnly, setMineOnly] = useState(role === 'employee'); // employees default to their own
  const [list, setList]         = useState<Workflow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const drawer = useDrawer();

  // Open a workflow in the drawer (rather than navigating to a detail page).
  // Keeps the user's place in the kanban/filter context — admin can review
  // three projects in 15 seconds without losing scroll position.
  const openProject = (wfId: string, clientName?: string) => {
    drawer.open({
      title: clientName || 'Project',
      width: 'lg',
      content: <ProjectDetailPanel workflowId={wfId} />,
    });
  };

  // `n` — quick "new project" when admin/sales is on this page.
  useShortcut('n', () => { if (isAdminOrSales) setShowCreate(true); });
  // Last fingerprint of the workflow list — we compare incoming poll data
  // against this and SKIP setState when nothing changed. This is what kills
  // the visible refresh: even though the data was identical, setList(new
  // ref) was re-rendering the kanban every minute and resetting expanded
  // cards / open dropdowns. No diff → no re-render → no flicker.
  const lastSigRef = useRef<string>('');

  // Build a tiny structural fingerprint — enough to detect real changes
  // (new client, status change, checklist tick) without doing an expensive
  // deep equal on every poll.
  const fingerprint = (data: Workflow[]) =>
    data.map(w => `${w._id}:${w.services.map(s =>
      `${s.serviceType}/${s.status}/${s.checklist?.filter(c => c.done).length || 0}/${s.checklist?.length || 0}`
    ).join('|')}`).join(';');

  /**
   * load(options.background = true) — when called from the poll we DON'T
   * touch `loading`, DON'T show toasts for transient errors, and skip
   * setList when the data is structurally identical. The axios interceptor
   * also bounces 401s to /login globally; we add the `X-Silent` header on
   * background polls so a momentary 5xx doesn't blow up the UI with a toast
   * either.
   */
  const load = async (opts: { background?: boolean } = {}) => {
    const isBg = !!opts.background;
    try {
      const data = await api.cwListWorkflows({ q: query || undefined, mine: mineOnly ? '1' : undefined });
      const arr  = Array.isArray(data) ? data : [];
      const sig  = fingerprint(arr);
      if (sig === lastSigRef.current && isBg) return;  // no change → no re-render
      lastSigRef.current = sig;
      setList(arr);
    } catch { /* axios toast (foreground) or silent (background) */ }
    finally { if (!isBg) setLoading(false); }
  };

  // Debounce search — foreground load (user-initiated)
  useEffect(() => {
    const t = setTimeout(() => load(), query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mineOnly]);

  // Background refresh — stretched to 5 minutes (was 60s, which made the
  // board feel like it was constantly "refreshing"). Background polls
  // don't touch the loading flag and skip the state update when the data
  // hasn't actually changed, so the user never sees a flicker.
  useVisiblePoll(() => load({ background: true }), 300_000, [query, mineOnly]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" /> Project Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every project, every stage — searchable by phone, name or email. Click any card to see what's left.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* AI: one-paragraph brief covering EVERY active project. The
                model output lands in the BriefPanel just below this row. */}
            <AllProjectsBriefButton />
            {isAdminOrSales && (
              <button onClick={() => setShowCreate(true)}
                className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold shadow-sm">
                <Plus className="h-4 w-4" /> New project
              </button>
            )}
          </div>
        </div>

        {/* Search — no card chrome, lives in the page flow. The "Only mine"
            toggle moves alongside it for sales/employee, hidden for admin. */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by phone, name or email…"
              className="w-full pl-10 pr-9 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary" />
            Only mine
          </label>
        </div>

        {/* Overview report — always upfront. Quick scan of where things
            stand BEFORE diving into individual cards. */}
        {!loading && list.length > 0 && <OverviewReport list={list} />}

        {/* Kanban board — one column per service stage with pipe-style
            connectors between them so you can FEEL the flow:
            Website → Meta → Influencer → Done.  Each card shows the clients
            currently at that stage and (on click) what's left to do. */}
        {loading && list.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <EmptyState query={query} isAdminOrSales={isAdminOrSales} onCreate={() => setShowCreate(true)} />
        ) : (
          <PipelineKanban
            list={list}
            isAdminOrSales={isAdminOrSales}
            onAdd={() => setShowCreate(true)}
            onMutated={load}
            onOpenDrawer={openProject}
          />
        )}
      </div>

      {showCreate && (
        <CreateWorkflowModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// OverviewReport — top-of-page summary so the user doesn't HAVE to scan
// every card to feel the state of the agency. Click "View details" to
// drop into the kanban below.
// ─────────────────────────────────────────────────────────────────────────
function OverviewReport({ list }: { list: Workflow[] }) {
  const stats = useMemo(() => {
    let total = 0, done = 0, blocked = 0;
    let totalItems = 0, doneItems = 0;
    for (const wf of list) {
      total += 1;
      const allDone = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
      if (allDone) done += 1;
      if (wf.services.some(s => s.status === 'blocked')) blocked += 1;
      for (const s of wf.services) {
        totalItems += s.checklist?.length || 0;
        doneItems  += s.checklist?.filter(c => c.done).length || 0;
      }
    }
    const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
    const active = total - done;
    return { total, done, active, blocked, pct, totalItems, doneItems };
  }, [list]);

  // Visual stat strip — progress ring on the left, four micro-stats on
  // the right. Designed to read at a glance instead of taking up four
  // dashboard cards' worth of vertical space.
  const ringSize = 48;
  const ringStroke = 5;
  const ringR = (ringSize - ringStroke) / 2;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - stats.pct / 100);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-5 flex-wrap">
      {/* Progress ring */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          <svg width={ringSize} height={ringSize} className="-rotate-90">
            <circle cx={ringSize/2} cy={ringSize/2} r={ringR}
              fill="none" stroke="hsl(var(--muted))" strokeWidth={ringStroke} />
            <circle cx={ringSize/2} cy={ringSize/2} r={ringR}
              fill="none" stroke="hsl(var(--primary))" strokeWidth={ringStroke}
              strokeDasharray={ringC} strokeDashoffset={ringOffset}
              strokeLinecap="round"
              className="transition-all duration-500" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums">{stats.pct}%</span>
        </div>
        <div className="leading-tight">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Overall</p>
          <p className="text-sm font-bold">{stats.doneItems} of {stats.totalItems} steps</p>
        </div>
      </div>

      {/* Vertical divider, hidden on mobile */}
      <div className="hidden sm:block h-10 w-px bg-border" />

      {/* Micro stats */}
      <div className="flex items-center gap-5 sm:gap-7 flex-wrap">
        <MicroStat icon={<Users className="h-3.5 w-3.5" />} value={stats.active} label="active" tone="primary" />
        <MicroStat icon={<CheckCircle2 className="h-3.5 w-3.5" />} value={stats.done} label="done" tone="success" />
        <MicroStat icon={<AlertTriangle className="h-3.5 w-3.5" />} value={stats.blocked} label="blocked" tone={stats.blocked > 0 ? 'danger' : 'muted'} />
        <MicroStat icon={<Activity className="h-3.5 w-3.5" />} value={stats.total} label="total" tone="muted" />
      </div>
    </div>
  );
}

function MicroStat({ icon, value, label, tone }: {
  icon: React.ReactNode; value: number; label: string;
  tone: 'primary' | 'success' | 'danger' | 'muted';
}) {
  const colorMap: Record<typeof tone, string> = {
    primary: 'text-primary',
    success: 'text-emerald-600',
    danger:  'text-rose-600',
    muted:   'text-muted-foreground',
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className={colorMap[tone]}>{icon}</span>
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Kanban — one column per service stage, matching the Client Schedule
// design. Each column is a card with a header (+ add button) and a list
// of clients currently at that service. Empty columns show a dashed
// "No clients yet" placeholder.
// ─────────────────────────────────────────────────────────────────────────

interface ColumnDef {
  key:         string;
  label:       string;
  matches:     (wf: Workflow) => boolean;
  serviceType?: string;   // for highlighting the relevant service inside
  accent?:     string;    // header accent class (active column)
}

const PIPELINE_COLUMNS: ColumnDef[] = [
  {
    key: 'shopify',
    label: 'Website Work',
    serviceType: 'shopify',
    matches: (wf) => wf.services.some(s => s.serviceType === 'shopify' && s.status !== 'done'),
    accent: 'text-emerald-700',
  },
  {
    key: 'meta',
    label: 'Meta Work',
    serviceType: 'meta_ads',
    // Anything that's not 'done' on Meta belongs in this column — including
    // 'blocked' (was previously dropping off the board when meta got stuck
    // after shopify finished). Now stuck clients stay visible.
    matches: (wf) => wf.services.some(s => s.serviceType === 'meta_ads' && s.status !== 'done'),
    accent: 'text-blue-700',
  },
  {
    key: 'influencer',
    label: 'Influencer Work',
    serviceType: 'influencer',
    matches: (wf) => wf.services.some(s => s.serviceType === 'influencer' && s.status !== 'done'),
    accent: 'text-amber-700',
  },
  {
    key: 'done',
    label: 'All Done',
    matches: (wf) => wf.services.length > 0 && wf.services.every(s => s.status === 'done'),
    accent: 'text-foreground',
  },
];

function PipelineKanban({ list, isAdminOrSales, onAdd, onMutated, onOpenDrawer }: {
  list: Workflow[]; isAdminOrSales: boolean; onAdd: () => void; onMutated: () => void;
  onOpenDrawer?: (wfId: string, clientName?: string) => void;
}) {
  // Bucket each workflow into the FIRST matching column so a client only
  // appears once on the board. Order matters — Website before Meta means
  // a client mid-build with both services shows in Website (its blocker).
  const byColumn = useMemo(() => {
    const buckets: Record<string, Workflow[]> = {};
    for (const col of PIPELINE_COLUMNS) buckets[col.key] = [];
    for (const wf of list) {
      const col = PIPELINE_COLUMNS.find(c => c.matches(wf));
      // After the meta-matcher fix the only thing that drops here is a
      // workflow with services=[] (i.e. half-onboarded, no real work yet)
      // — fine to leave invisible. If a column-less workflow ever shows
      // up in practice, the OverviewReport's "Active clients" count and
      // sum will surface the discrepancy.
      if (col) buckets[col.key].push(wf);
    }
    return buckets;
  }, [list]);

  return (
    <>
      {/* DESKTOP / TABLET — kanban with pipe-style flow connectors between
          columns. The chevrons sit BETWEEN cards (negative offsets) so it
          reads as a single pipeline of stages, not 4 unrelated cards. */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-1 items-stretch">
        {PIPELINE_COLUMNS.map((col, i) => (
          <Fragment key={col.key}>
            <Column
              col={col}
              clients={byColumn[col.key]}
              isAdminOrSales={isAdminOrSales}
              onAdd={onAdd}
              onMutated={onMutated}
              onOpenDrawer={onOpenDrawer}
            />
            {i < PIPELINE_COLUMNS.length - 1 && (
              <div className="flex items-center justify-center px-0.5">
                <div className="flex flex-col items-center gap-1">
                  <div className="h-[2px] w-3 bg-border" />
                  <div className={`h-7 w-7 rounded-full border-2 border-border bg-card flex items-center justify-center ${
                    i === PIPELINE_COLUMNS.length - 2 ? 'border-emerald-300 bg-emerald-50' : ''
                  }`}>
                    <ArrowRight className={`h-3.5 w-3.5 ${
                      i === PIPELINE_COLUMNS.length - 2 ? 'text-emerald-600' : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div className="h-[2px] w-3 bg-border" />
                </div>
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* MOBILE — stacked columns with a vertical pipe between them */}
      <div className="sm:hidden space-y-1">
        {PIPELINE_COLUMNS.map((col, i) => (
          <div key={col.key}>
            <Column
              col={col}
              clients={byColumn[col.key]}
              isAdminOrSales={isAdminOrSales}
              onAdd={onAdd}
              onMutated={onMutated}
              onOpenDrawer={onOpenDrawer}
            />
            {i < PIPELINE_COLUMNS.length - 1 && (
              <div className="flex items-center justify-center py-1.5">
                <div className="h-6 w-[2px] bg-border" />
                <div className="h-6 w-6 -ml-3 -mr-3 rounded-full border-2 border-border bg-card flex items-center justify-center">
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="h-6 w-[2px] bg-border" />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Column({ col, clients, isAdminOrSales, onAdd, onMutated, onOpenDrawer }: {
  col: ColumnDef; clients: Workflow[]; isAdminOrSales: boolean; onAdd: () => void; onMutated: () => void;
  onOpenDrawer?: (wfId: string, clientName?: string) => void;
}) {
  // Map column key → soft tinted top accent strip + matching count chip
  // background. The accent makes each column glance-recognisable without
  // shouting.
  const accentBar: Record<string, string> = {
    shopify:    'bg-emerald-500',
    meta:       'bg-blue-500',
    influencer: 'bg-amber-500',
    done:       'bg-foreground/30',
  };
  const accentChip: Record<string, string> = {
    shopify:    'bg-emerald-500/15 text-emerald-700',
    meta:       'bg-blue-500/15 text-blue-700',
    influencer: 'bg-amber-500/15 text-amber-700',
    done:       'bg-muted text-muted-foreground',
  };
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-h-[320px]">
      {/* Coloured accent strip at the very top of the column — same as
          Notion / Linear kanban headers. Makes each column instantly
          recognisable. */}
      <div className={`h-1 ${accentBar[col.key] || 'bg-border'}`} />

      {/* Header — service label, count chip, (admin/sales only) add btn */}
      <div className="px-3 py-3 border-b border-border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-[0.14em] font-bold ${col.accent || 'text-muted-foreground'}`}>
            {col.label}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-1.5 h-5 inline-flex items-center rounded text-[10px] font-bold tabular-nums ${accentChip[col.key] || 'bg-muted'}`}>
              {clients.length}
            </span>
            <p className="text-[11px] text-muted-foreground">
              {clients.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
        </div>
        {isAdminOrSales && col.key !== 'done' && (
          <button onClick={onAdd}
            title="Onboard a new client"
            className="h-7 w-7 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 flex items-center justify-center transition-colors">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Cards inside the column */}
      <div className="p-2 space-y-2 flex-1 overflow-y-auto bg-muted/10">
        {clients.length === 0 ? (
          <div className="h-28 rounded-xl border border-dashed border-border bg-card flex flex-col items-center justify-center gap-1.5 text-center px-3">
            <Circle className="h-4 w-4 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">No projects in this stage</p>
          </div>
        ) : (
          clients.map(wf => (
            <ClientCard key={wf._id} wf={wf} highlightServiceType={col.serviceType} onMutated={onMutated} onOpenDrawer={onOpenDrawer} />
          ))
        )}
      </div>
    </div>
  );
}

function ClientCard({ wf, highlightServiceType, onMutated, onOpenDrawer }: {
  wf: Workflow; highlightServiceType?: string; onMutated: () => void; onOpenDrawer?: (wfId: string, clientName?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the popover when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Overall % across all services
  const totalItems = wf.services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const doneItems  = wf.services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct        = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  // The service relevant to THIS column (if any) — show its progress
  // inline so you can see "Website: 2/7" without opening the workflow.
  const relevant = highlightServiceType ? wf.services.find(s => s.serviceType === highlightServiceType) : undefined;
  const relTicked = relevant?.checklist.filter(c => c.done).length || 0;
  const relTotal  = relevant?.checklist.length || 0;

  // The "what's left" list — pending checklist items on the relevant
  // service (or overall pending across all services if no column-specific
  // service was found, e.g. the All Done column).
  const remaining = useMemo(() => {
    const src = relevant ? [relevant] : wf.services;
    const items: { service: string; title: string }[] = [];
    for (const s of src) {
      for (const c of (s.checklist || [])) {
        if (!c.done) items.push({ service: s.label || s.serviceType, title: c.text || c.title || 'Untitled step' });
      }
    }
    return items;
  }, [relevant, wf.services]);

  // Status pill colour for the relevant service (or overall completion if none)
  const status = relevant?.status || (wf.services.every(s => s.status === 'done') ? 'done' : 'in_progress');
  const statusStyle =
    status === 'done'        ? 'bg-emerald-500/15 text-emerald-700' :
    status === 'blocked'     ? 'bg-rose-500/15 text-rose-700' :
    status === 'in_progress' ? 'bg-blue-500/15 text-blue-700' :
                               'bg-amber-500/15 text-amber-700';
  const statusLabel =
    status === 'done'        ? 'Done' :
    status === 'blocked'     ? 'Blocked' :
    status === 'in_progress' ? 'In progress' :
                               'Pending';

  const [confirmMarkDone, setConfirmMarkDone] = useState(false);

  const markDone = () => {
    if (!relevant?._id || busy) return;
    setMenuOpen(false);
    // Open the proper styled modal instead of window.prompt. The actual
    // API call happens in modal.onSubmit so the modal can render a
    // loading state while it's in flight.
    setConfirmMarkDone(true);
  };

  const performMarkDone = async (comment: string) => {
    if (!relevant?._id) return;
    setBusy(true);
    try {
      await api.cwCompleteService(wf._id, relevant._id, { comment });
      toast.success(`${relevant.label || 'Service'} marked done`);
      onMutated();
    } catch { /* axios interceptor */ }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 hover:shadow-sm transition-all">
      {/* Top row — name + status pill + action menu */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex-1 min-w-0 text-left group"
            title={expanded ? 'Hide what\'s left' : 'See what\'s left'}
          >
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{wf.clientName || 'Unnamed client'}</p>
              {expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {wf.clientPhone && (
                <span className="text-[10px] text-muted-foreground truncate tabular-nums">{wf.clientPhone}</span>
              )}
              {/* Health pill — defaults to 'healthy' until the inference job
                  is wired (Phase 5). Renders consistently with project
                  detail and admin dashboard. */}
              {(wf as any).health && (
                <StatusPill state={(wf as any).health as Status} size="xs" icon="none" />
              )}
            </div>
          </button>

          {/* Open in drawer — single click, keeps the kanban context. */}
          {onOpenDrawer && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDrawer(wf._id, wf.clientName); }}
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
              title="Open project (drawer)"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Stage dropdown — change the service status without leaving the
              board. Mark done, bounce back, or jump to full detail. */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(v => !v); }}
              className={`px-1.5 h-6 rounded-md text-[10px] font-semibold flex items-center gap-0.5 ${statusStyle} hover:opacity-90 transition`}
              title="Update stage"
            >
              {statusLabel}
              <ChevronDown className="h-3 w-3" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden"
                >
                  {relevant && relevant.status !== 'done' && (
                    <button
                      onClick={markDone}
                      disabled={busy}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Mark this stage done
                    </button>
                  )}
                  <Link
                    to={`/clients/pipeline/${wf._id}`}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2"
                    onClick={() => setMenuOpen(false)}
                  >
                    <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    Open full pipeline
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Progress — thicker bar + clearer step count. Shows the
            relevant-service progress when in a service column; overall
            otherwise (e.g. "All Done"). */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
              {relevant ? `${relTicked} of ${relTotal} steps` : `${pct}% overall`}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {relevant ? `${relTotal ? Math.round((relTicked / relTotal) * 100) : 0}%` : `${doneItems}/${totalItems}`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className={`h-full transition-all duration-300 ${
              (relevant ? relTicked === relTotal : pct === 100) ? 'bg-emerald-500' : 'bg-primary'
            }`}
              style={{ width: `${relevant ? (relTotal ? (relTicked / relTotal) * 100 : 0) : pct}%` }} />
          </div>
        </div>

        {/* Last major update — most recent activity-log entry, pulled
            from the server. Anyone glancing at the board sees what just
            happened on this project. */}
        {wf.lastUpdate?.detail && (
          <div className="mt-2.5 -mx-3 px-3 py-1.5 bg-muted/30 border-t border-border">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-bold">Last update</p>
            <p className="text-[11px] text-foreground line-clamp-2 mt-0.5 leading-snug">{wf.lastUpdate.detail}</p>
          </div>
        )}
      </div>

      {/* Expandable "what's left" — checklist of pending items so you can
          see EXACTLY what's blocking the move to the next stage without
          having to open the workflow detail page. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border bg-muted/20"
          >
            <div className="px-3 py-2 space-y-1">
              {remaining.length === 0 ? (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" /> Nothing left in this stage — ready to advance.
                </div>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    {remaining.length} step{remaining.length === 1 ? '' : 's'} left
                  </p>
                  {remaining.slice(0, 5).map((r, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                      <Circle className="h-2.5 w-2.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="truncate" title={r.title}>{r.title}</span>
                    </div>
                  ))}
                  {remaining.length > 5 && (
                    <Link to={`/clients/pipeline/${wf._id}`} className="block text-[10px] text-primary hover:underline mt-1">
                      View all {remaining.length} →
                    </Link>
                  )}
                </>
              )}
              <Link
                to={`/clients/pipeline/${wf._id}`}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1.5"
              >
                Click for details <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comment-required modal — replaces the old window.prompt(). */}
      {confirmMarkDone && (
        <CommentRequiredModal
          title={`Mark "${relevant?.label || 'service'}" done`}
          description="Add a short note that admin can audit later. Cmd-Enter to save."
          placeholder="e.g. Shopify store live, products imported, payments tested."
          primaryLabel="Mark done"
          tone="success"
          onSubmit={performMarkDone}
          onClose={() => setConfirmMarkDone(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ query, isAdminOrSales, onCreate }: { query: string; isAdminOrSales: boolean; onCreate: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const seed = async () => {
    setSeeding(true);
    try {
      const res = await api.seedDemoClients();
      toast.success(res.message || 'Demo clients seeded', { duration: 6000 });
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Seed failed');
    } finally { setSeeding(false); }
  };
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
      <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
      <p className="font-semibold">{query ? 'No clients match that search' : 'No client pipelines yet'}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {query ? 'Try the phone number, full name, or email.' : 'When sales onboards a client and picks their services, the pipeline shows up here.'}
      </p>
      {!query && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {isAdminOrSales && (
            <button onClick={onCreate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Onboard a client
            </button>
          )}
          {/* Demo seeder — visible to ALL internal staff so any teammate
              can populate test data without needing admin access. */}
          <button onClick={seed} disabled={seeding}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm font-semibold hover:bg-muted disabled:opacity-50">
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {seeding ? 'Seeding…' : 'Seed 3 demo clients'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Create modal — pick a client + pick services
// ─────────────────────────────────────────────────────────────────────────
function CreateWorkflowModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [templates, setTemplates] = useState<Record<string, any>>({});
  const [clientId, setClientId] = useState('');
  const [chosen, setChosen]     = useState<Set<string>>(new Set());
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    api.listUsers({ role: 'client' }).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
    api.cwGetTemplates().then(setTemplates).catch(() => {});
  }, []);

  const toggleSvc = (key: string) => setChosen(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const save = async () => {
    if (!clientId) { toast.error('Pick a client'); return; }
    if (chosen.size === 0) { toast.error('Pick at least one service'); return; }
    setSaving(true);
    try {
      await api.cwCreateWorkflow({ clientId, services: Array.from(chosen) });
      toast.success('Pipeline created — teammates have been auto-assigned');
      onCreated();
    } catch { /* interceptor toasts */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold">Onboard a client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Client */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
              <option value="">— pick a client —</option>
              {clients.map(c => (
                <option key={c._id} value={c._id}>
                  {c.name || c.email}{(c as any).phone ? ` · ${(c as any).phone}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Don't see them? Add them in Admin → Clients first.</p>
          </div>

          {/* Services */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Services for this client</label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(templates).map(([key, tpl]: any) => {
                const active = chosen.has(key);
                return (
                  <button key={key} type="button" onClick={() => toggleSvc(key)}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/30'
                    }`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{tpl.label}</p>
                      <span className={`h-4 w-4 rounded border ${active ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {tpl.checklist.length} step{tpl.checklist.length === 1 ? '' : 's'} · auto-assigned to <strong>{tpl.team}</strong> team
                    </p>
                    {tpl.dependsOn?.length > 0 && (
                      <p className="text-[10px] text-amber-700 mt-0.5">starts after {tpl.dependsOn.join(', ')}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={save} disabled={saving || !clientId || chosen.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create pipeline
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AllProjectsBriefButton — top-right button on the Project Pipeline page
// that fires a single Gemini call summarizing every active project. The
// resulting paragraph drops into a modal so the owner reads it once and
// closes. Cheap (one model call regardless of project count) and gives
// a "state of the agency" answer in 2 seconds.
// ─────────────────────────────────────────────────────────────────────────
function AllProjectsBriefButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>('');
  const [count, setCount] = useState<number>(0);

  const run = async () => {
    setOpen(true);
    if (brief) return; // already loaded — just re-open the modal
    setLoading(true);
    try {
      const r = await api.aiBriefAllProjects();
      setBrief(r.text || '');
      setCount(r.projectCount || 0);
    } catch { /* axios toast */ }
    finally { setLoading(false); }
  };

  return (
    <>
      <button
        onClick={run}
        title="AI brief covering every active project"
        className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-card border border-primary/30 text-primary hover:bg-primary/10 text-sm font-semibold transition-colors"
      >
        <Sparkles className="h-4 w-4" /> Brief all projects
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-2xl max-w-xl w-full p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-primary">AI brief</p>
                  <p className="text-base font-bold">State of {count || ''} active project{count === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Asking Gemini for a status sweep…
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{brief}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => { setBrief(''); run(); }}
                  className="text-xs font-semibold text-primary hover:underline">
                  Regenerate
                </button>
                <button onClick={() => setOpen(false)}
                  className="ml-auto px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
