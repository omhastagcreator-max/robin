import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Loader2, X, Sparkles, Workflow,
  ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle,
  ArrowRight, Users, Activity, Clock, ShieldX, Unlock, MessageSquare,
  Send, Flame, CalendarClock, Wifi,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { useDrawer } from '@/components/ui/RightDrawer';
import { ProjectDetailPanel } from '@/components/panels/ProjectDetailPanel';
import { useShortcut } from '@/hooks/useShortcut';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Avatar } from '@/components/shared/Avatar';
import { AIInsight } from '@/components/ai/AIInsight';
import {
  PipelineToolbar, PipelineFocusView, PipelineTableView, PipelineFlowView,
  usePipelineState, applyFilters,
  type FlowStage,
} from '@/components/pipeline/PipelineRevamp';

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
  // ── Operational fields surfaced inline on each pipeline card ─────────
  // All of these are already on the ClientWorkflow Mongo doc and shipped
  // by /api/client-workflows. We just weren't rendering them before.
  health?:         Status;
  healthReason?:   string;
  eta?:            string | null;
  etaConfidence?:  '' | 'high' | 'medium' | 'low';
  lastActivityAt?: string | null;
  priority?:       'low' | 'medium' | 'high' | 'urgent';
  currentOwnerTeam?: '' | 'sales' | 'development' | 'meta' | 'influencer' | 'qa';
  nextActionOwnerId?: string | null;
  nextAction?:     string;
  blockerType?:    '' | 'waiting_client_input' | 'waiting_internal_approval' | 'dependency' | 'technical' | 'budget';
  blockerReason?:  string;
  blockedSince?:   string | null;
  // ── AI operational insights (computed by healthInference cron) ────
  riskScore?:             number;            // 0–100
  delayCause?:             string;
  nextBestAction?:        string;
  predictedCompletionAt?: string | null;
  insightsComputedAt?:    string | null;
}

interface UserLite { _id: string; name?: string; email?: string; avatarUrl?: string }

export default function ClientPipelinePage() {
  const { role } = useAuth();
  const isAdminOrSales = ['admin', 'sales'].includes(role);

  const [query, setQuery]       = useState('');
  const [mineOnly, setMineOnly] = useState(role === 'employee'); // employees default to their own
  const [list, setList]         = useState<Workflow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Pipeline revamp — view toggle (kanban / focus / table), filter chips,
  // saved-views, and bulk selection state. All persisted via usePipelineState().
  const { view, setView, filters, setFilters, savedViews, setSavedViews } = usePipelineState();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const clearSelected = () => setSelectedIds([]);

  // Page-level users lookup — every card needs the owner's name+avatar but
  // listWorkflows ships userIds, not populated documents. Loading the team
  // once here is far cheaper than every card hitting its own endpoint.
  const [users, setUsers] = useState<Record<string, UserLite>>({});
  useEffect(() => {
    api.listUsers()
      .then((arr: any[]) => {
        const map: Record<string, UserLite> = {};
        (Array.isArray(arr) ? arr : []).forEach(u => { map[u._id] = u; });
        setUsers(map);
      })
      .catch(() => {});
  }, []);

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

  // Apply client-side filters (server already handled q + mineOnly).
  const filteredList = useMemo(() => applyFilters(list, filters), [list, filters]);

  // Bulk action handler — fans out to the server bulk endpoint, surfaces
  // a "12 updated, 1 skipped" toast, refreshes the list, clears selection.
  const handleBulk = async (action: 'priority'|'note'|'mark-on-track', payload?: any) => {
    if (selectedIds.length === 0) return;
    try {
      const res = await api.cwBulk({ ids: selectedIds, action, payload });
      if (res.errors.length > 0) {
        toast.warning(`${res.updated} updated, ${res.skipped} skipped. First error: ${res.errors[0]}`);
      } else {
        toast.success(`${res.updated} project${res.updated === 1 ? '' : 's'} updated.`);
      }
      clearSelected();
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Bulk action failed.');
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" /> Projects
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every client, every step. Search by phone, name or email. Click any card to see what's left to do.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* AI: one-paragraph brief covering EVERY active project. The
                model output lands in the BriefPanel just below this row. */}
            <AllProjectsBriefButton />
            {isAdminOrSales && (
              <button onClick={() => setShowCreate(true)}
                className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold shadow-sm">
                <Plus className="h-4 w-4" /> Add client
              </button>
            )}
          </div>
        </div>

        {/* Search — kept full-width as the primary affordance. The mine-only
            toggle is now in the toolbar below alongside the view switcher. */}
        <div className="relative">
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

        {/* Pipeline toolbar — view toggle, filters, saved views, bulk-action bar. */}
        <PipelineToolbar
          view={view} onView={setView}
          filters={filters} onFilters={setFilters}
          savedViews={savedViews} onSavedViews={setSavedViews}
          mineOnly={mineOnly} onMineOnly={setMineOnly}
          selectedIds={selectedIds} onClearSelected={clearSelected}
          onBulk={handleBulk}
          totalCount={list.length} filteredCount={filteredList.length}
          role={role}
        />

        {/* Overview report — always upfront. Quick scan of where things
            stand BEFORE diving into individual cards. Note: stats are
            computed over the UNFILTERED list so the user sees the agency
            shape, not a slice of it. */}
        {!loading && list.length > 0 && <OverviewReport list={list} />}

        {/* View body — kanban (stage flow), focus (health-grouped), or table. */}
        {loading && list.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <EmptyState query={query} isAdminOrSales={isAdminOrSales} onCreate={() => setShowCreate(true)} />
        ) : view === 'kanban' ? (
          <PipelineKanban
            list={filteredList}
            users={users}
            isAdminOrSales={isAdminOrSales}
            onAdd={() => setShowCreate(true)}
            onMutated={load}
            onOpenDrawer={openProject}
          />
        ) : view === 'flow' ? (
          (() => {
            // Bucket workflows into the same first-match scheme the Kanban
            // uses. Done inline so the flow view stays a leaf component
            // and doesn't need to know about ColumnDef/matches() — the
            // page owns the matching logic for both layouts.
            const byStage: Record<string, Workflow[]> = {};
            for (const s of FLOW_STAGES) byStage[s.key] = [];
            for (const wf of filteredList) {
              const col = PIPELINE_COLUMNS.find(c => c.matches(wf));
              if (col && byStage[col.key]) byStage[col.key].push(wf);
            }
            return (
              <PipelineFlowView<Workflow>
                stages={FLOW_STAGES}
                byStage={byStage}
                totalCount={filteredList.length}
                renderCard={(wf) => (
                  <ClientCard
                    wf={wf}
                    users={users}
                    onMutated={load}
                    onOpenDrawer={openProject}
                  />
                )}
              />
            );
          })()
        ) : view === 'focus' ? (
          <PipelineFocusView
            list={filteredList}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            renderCard={(wf) => (
              <ClientCard
                wf={wf}
                users={users}
                onMutated={load}
                onOpenDrawer={openProject}
              />
            )}
          />
        ) : (
          <PipelineTableView
            list={filteredList}
            onOpen={openProject}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
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

// Flow-view stage definitions. Mirrors PIPELINE_COLUMNS one-for-one and
// reuses the same tone tokens (shopify / meta / influencer / done) so the
// Flow view inherits Robin's existing accent ramps — just lightened to
// the -100 stop for the shape fills. The `shape` field varies geometry
// across the row (rounded-rect → circle → square → circle) so the
// pipeline reads as a deliberate flow diagram, not a uniform grid.
const FLOW_STAGES: FlowStage[] = [
  { key: 'shopify',    label: 'Website Work',    tone: 'shopify',    shape: 'rounded-rect', exitLabel: 'Website done' },
  { key: 'meta',       label: 'Meta Work',       tone: 'meta',       shape: 'circle',       exitLabel: 'Meta done' },
  { key: 'influencer', label: 'Influencer Work', tone: 'influencer', shape: 'square',       exitLabel: 'Influencer done' },
  { key: 'done',       label: 'All Done',        tone: 'done',       shape: 'circle' },
];

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

function PipelineKanban({ list, users, isAdminOrSales, onAdd, onMutated, onOpenDrawer }: {
  list: Workflow[]; users: Record<string, UserLite>; isAdminOrSales: boolean; onAdd: () => void; onMutated: () => void;
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
              users={users}
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
              users={users}
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

function Column({ col, clients, users, isAdminOrSales, onAdd, onMutated, onOpenDrawer }: {
  col: ColumnDef; clients: Workflow[]; users: Record<string, UserLite>; isAdminOrSales: boolean; onAdd: () => void; onMutated: () => void;
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
            <ClientCard key={wf._id} wf={wf} users={users} highlightServiceType={col.serviceType} onMutated={onMutated} onOpenDrawer={onOpenDrawer} />
          ))
        )}
      </div>
    </div>
  );
}

function ClientCard({ wf, users, highlightServiceType, onMutated, onOpenDrawer }: {
  wf: Workflow;
  users: Record<string, UserLite>;
  highlightServiceType?: string;
  onMutated: () => void;
  onOpenDrawer?: (wfId: string, clientName?: string) => void;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [busy, setBusy]           = useState(false);
  const [confirmMarkDone, setConfirmMarkDone] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [unblockModal, setUnblockModal] = useState(false);
  const [commentOpen, setCommentOpen]   = useState(false);
  const [commentText, setCommentText]   = useState('');

  // ── Derived data ───────────────────────────────────────────────────
  const totalItems = wf.services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const doneItems  = wf.services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct        = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  // Relevant service for the column we're in (Website / Meta / Influencer)
  const relevant   = highlightServiceType ? wf.services.find(s => s.serviceType === highlightServiceType) : undefined;
  const relTicked  = relevant?.checklist.filter(c => c.done).length || 0;
  const relTotal   = relevant?.checklist.length || 0;
  const relPct     = relTotal ? Math.round((relTicked / relTotal) * 100) : 0;

  // Owner — the assignee on the relevant service (or the first non-done
  // service when we're on the All-Done column). userId → user via the map.
  const ownerId    = relevant?.assignedTo || wf.services.find(s => s.status !== 'done')?.assignedTo || wf.services[0]?.assignedTo;
  const owner      = ownerId ? users[ownerId] : undefined;

  // What's left on the relevant service (or all services on All-Done).
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

  // Next action — prefer the cron-computed `nextBestAction`, then the
  // workflow's explicit `nextAction`, then the first un-ticked step.
  const nextAction = wf.nextBestAction || wf.nextAction || remaining[0]?.title || '';

  // ── AI predicted-completion (cron-derived heuristic) ──────────────
  let predictedLabel = '';
  if (wf.predictedCompletionAt) {
    const predMs = new Date(wf.predictedCompletionAt).getTime();
    const days   = Math.round((predMs - Date.now()) / (24 * 3600 * 1000));
    if (days < 0)       predictedLabel = `${Math.abs(days)}d past prediction`;
    else if (days === 0) predictedLabel = 'Predicts today';
    else                predictedLabel = `Predicts in ${days}d`;
  }
  const riskTone: 'success' | 'warning' | 'danger' | 'muted' =
    (wf.riskScore ?? 0) >= 70 ? 'danger'  :
    (wf.riskScore ?? 0) >= 40 ? 'warning' :
                                'muted';

  // ── ETA logic ──────────────────────────────────────────────────────
  let etaLabel = '';
  let etaTone: 'muted' | 'warning' | 'danger' = 'muted';
  if (wf.eta) {
    const etaMs = new Date(wf.eta).getTime();
    const now   = Date.now();
    const days  = Math.round((etaMs - now) / (24 * 3600 * 1000));
    if (days < 0)         { etaLabel = `${Math.abs(days)}d past ETA`; etaTone = 'danger'; }
    else if (days === 0)  { etaLabel = 'ETA today';                   etaTone = 'warning'; }
    else if (days <= 3)   { etaLabel = `ETA in ${days}d`;             etaTone = 'warning'; }
    else                  { etaLabel = `ETA in ${days}d`;             etaTone = 'muted'; }
  }

  // ── Inactivity ─────────────────────────────────────────────────────
  let inactivityLabel = '';
  let inactivityTone: 'muted' | 'warning' | 'danger' = 'muted';
  if (wf.lastActivityAt) {
    const idleH = (Date.now() - new Date(wf.lastActivityAt).getTime()) / (3600 * 1000);
    if (idleH > 72)      { inactivityLabel = `Quiet ${Math.round(idleH / 24)}d`; inactivityTone = 'danger'; }
    else if (idleH > 24) { inactivityLabel = `Quiet ${Math.round(idleH / 24)}d`; inactivityTone = 'warning'; }
  }

  // ── Priority chip (only when not 'medium') ────────────────────────
  const priorityTone: Record<string, string> =
    { urgent: 'bg-rose-500/12 text-rose-700 border-rose-500/25',
      high:   'bg-orange-500/12 text-orange-700 border-orange-500/25',
      low:    'bg-muted text-muted-foreground border-border' };

  // ── Status pill for the relevant service ──────────────────────────
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

  // ── Mutations ──────────────────────────────────────────────────────
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

  const handleBlock = async (payload: { blockerType: string; blockerReason: string; comment: string }) => {
    setBusy(true);
    try {
      await api.cwBlock(wf._id, payload);
      toast.success('Marked blocked');
      onMutated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to block');
      throw err;
    } finally { setBusy(false); }
  };

  const handleUnblock = async (comment: string) => {
    setBusy(true);
    try {
      await api.cwUnblock(wf._id, { comment });
      toast.success('Unblocked');
      onMutated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to unblock');
      throw err;
    } finally { setBusy(false); }
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (text.length < 3) { toast.error('At least 3 characters'); return; }
    setBusy(true);
    try {
      await api.cwAddNote(wf._id, { detail: text, serviceType: relevant?.serviceType });
      setCommentText('');
      setCommentOpen(false);
      toast.success('Note added');
      onMutated();
    } catch { /* interceptor toasts */ }
    finally { setBusy(false); }
  };

  const isBlocked = Boolean(wf.blockerType);

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-all ${
      isBlocked ? 'border-rose-500/30 shadow-sm shadow-rose-500/5' : 'border-border hover:border-primary/30'
    }`}>
      <div className="px-3 pt-2.5 pb-2 space-y-2">
        {/* ── Line 1 ─ Identity + priority + health ─────────────────── */}
        <div className="flex items-start gap-2">
          <button
            onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
            className="flex-1 min-w-0 text-left group"
            title="Open project"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[13px] font-bold truncate group-hover:text-primary transition-colors">
                {wf.clientName || 'Unnamed client'}
              </p>
              {wf.priority === 'urgent' && (
                <span className={`inline-flex items-center gap-0.5 px-1 h-[15px] rounded text-[9px] font-bold uppercase border ${priorityTone.urgent}`}>
                  <Flame className="h-2.5 w-2.5" /> urgent
                </span>
              )}
              {wf.priority === 'high' && (
                <span className={`inline-flex items-center px-1 h-[15px] rounded text-[9px] font-bold uppercase border ${priorityTone.high}`}>
                  high
                </span>
              )}
              {wf.health && (
                <StatusPill state={wf.health as Status} size="xs" icon="none" />
              )}
            </div>
            {wf.clientPhone && (
              <p className="text-[10px] text-muted-foreground tabular-nums truncate mt-0.5">
                {wf.clientPhone}
              </p>
            )}
          </button>

          {/* Status mini-pill — quick visual scan of the relevant service */}
          <span className={`shrink-0 px-1.5 h-[18px] inline-flex items-center rounded-md text-[10px] font-semibold ${statusStyle}`}>
            {statusLabel}
          </span>
        </div>

        {/* ── Line 2 ─ Owner + service + ETA + inactivity ──────────── */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          {owner ? (
            <div className="flex items-center gap-1 min-w-0">
              <Avatar name={owner.name} email={owner.email} url={owner.avatarUrl} size="xs" tone="primary" />
              <span className="truncate text-foreground/80 font-medium">{owner.name || owner.email || 'Owner'}</span>
            </div>
          ) : (
            <span className="text-muted-foreground italic">Unassigned</span>
          )}
          {relevant && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-medium text-foreground/70 truncate">{relevant.label || relevant.serviceType}</span>
            </>
          )}
          {etaLabel && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className={`inline-flex items-center gap-0.5 ${
                etaTone === 'danger'  ? 'text-rose-600 font-semibold'  :
                etaTone === 'warning' ? 'text-amber-700 font-semibold' :
                                        'text-muted-foreground'
              }`}>
                <CalendarClock className="h-2.5 w-2.5" /> {etaLabel}
              </span>
            </>
          )}
          {inactivityLabel && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className={`inline-flex items-center gap-0.5 ${
                inactivityTone === 'danger' ? 'text-rose-600 font-semibold' : 'text-amber-700'
              }`}>
                <Wifi className="h-2.5 w-2.5" /> {inactivityLabel}
              </span>
            </>
          )}
        </div>

        {/* ── Line 3 ─ Next action (when set) ───────────────────────── */}
        {nextAction && (
          <p className="text-[11.5px] leading-snug text-foreground/85 flex items-start gap-1.5">
            <ArrowRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
            <span className="line-clamp-1" title={nextAction}>{nextAction}</span>
          </p>
        )}

        {/* ── Blocker strip ─ red, mandatory visibility ─────────────── */}
        {isBlocked && (
          <div className="flex items-start gap-1.5 text-[11px] rounded-md border border-rose-500/25 bg-rose-500/[0.06] px-2 py-1">
            <ShieldX className="h-3 w-3 text-rose-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-rose-700 capitalize">{wf.blockerType?.replace(/_/g, ' ')}</p>
              {wf.blockerReason && (
                <p className="text-rose-700/85 line-clamp-2 leading-snug">{wf.blockerReason}</p>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setUnblockModal(true); }}
              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 h-[20px] rounded text-[10px] font-semibold text-rose-700 hover:bg-rose-500/12 transition-colors"
              title="Unblock"
            >
              <Unlock className="h-2.5 w-2.5" /> Unblock
            </button>
          </div>
        )}

        {/* ── AI insight strip ─ risk / delay cause / predicted ETA ─────
            Heuristic-derived (no model call). Always-fresh because the
            healthInference cron computes them every 15 min and on every
            workflow mutation via performWorkflowAction's postHook.
            Hidden when the workflow is healthy + on track. */}
        {((wf.riskScore ?? 0) >= 40 || (wf.delayCause && !isBlocked) || predictedLabel) && (
          <div className="flex items-center gap-1.5 text-[10.5px] flex-wrap rounded-md bg-muted/40 border border-border px-2 py-1">
            <AIInsight.Badge aiUsed={false} />
            {typeof wf.riskScore === 'number' && wf.riskScore > 0 && (
              <span className={`inline-flex items-center gap-1 font-bold ${
                riskTone === 'danger'  ? 'text-rose-700'   :
                riskTone === 'warning' ? 'text-amber-700'  :
                                         'text-muted-foreground'
              }`}>
                Risk {wf.riskScore}
              </span>
            )}
            {wf.delayCause && !isBlocked && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground/80 line-clamp-1" title={wf.delayCause}>{wf.delayCause}</span>
              </>
            )}
            {predictedLabel && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">{predictedLabel}</span>
              </>
            )}
          </div>
        )}

        {/* ── Progress + step count ────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
              {relevant ? `${relTicked}/${relTotal} steps` : `${pct}% overall`}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {relevant ? `${relPct}%` : `${doneItems}/${totalItems}`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className={`h-full transition-all duration-300 ${
              (relevant ? relTicked === relTotal : pct === 100) ? 'bg-emerald-500'
              : isBlocked ? 'bg-rose-500'
              : 'bg-primary'
            }`}
              style={{ width: `${relevant ? relPct : pct}%` }} />
          </div>
        </div>

        {/* ── Last update ─ "2h ago — Sakshi ticked Pixel verified" ── */}
        {wf.lastUpdate?.detail && (
          <p className="text-[10.5px] text-muted-foreground leading-snug">
            <Clock className="h-2.5 w-2.5 inline-block -mt-0.5 mr-1" />
            {wf.lastUpdate.at && (
              <span className="font-medium text-foreground/70">
                {formatDistanceToNowStrict(new Date(wf.lastUpdate.at), { addSuffix: true })}
              </span>
            )}
            <span className="ml-1 line-clamp-1 inline">— {wf.lastUpdate.detail}</span>
          </p>
        )}

        {/* ── Inline action row ────────────────────────────────────── */}
        <div className="flex items-center gap-1 flex-wrap pt-0.5">
          {relevant && relevant.status !== 'done' && (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmMarkDone(true); }}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 h-[22px] rounded text-[10.5px] font-semibold bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50"
              title="Mark current stage done"
            >
              <CheckCircle2 className="h-2.5 w-2.5" /> Done
            </button>
          )}
          {!isBlocked && (
            <button
              onClick={(e) => { e.stopPropagation(); setBlockModal(true); }}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 h-[22px] rounded text-[10.5px] font-semibold text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-50"
              title="Mark blocked"
            >
              <ShieldX className="h-2.5 w-2.5" /> Block
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setCommentOpen(v => !v); }}
            disabled={busy}
            className={`inline-flex items-center gap-0.5 px-1.5 h-[22px] rounded text-[10.5px] font-semibold disabled:opacity-50 ${
              commentOpen
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
            }`}
            title="Drop a quick comment"
          >
            <MessageSquare className="h-2.5 w-2.5" /> Note
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            className="ml-auto inline-flex items-center gap-0.5 px-1.5 h-[22px] rounded text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title={expanded ? "Hide what's left" : "See what's left"}
          >
            {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            {remaining.length > 0 ? `${remaining.length} left` : 'detail'}
          </button>
        </div>

        {/* ── Inline comment row ─ no modal, just a one-line input ─── */}
        <AnimatePresence>
          {commentOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  autoFocus
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); submitComment(); }
                    if (e.key === 'Escape') { setCommentOpen(false); setCommentText(''); }
                  }}
                  placeholder="Quick note for the audit log…"
                  className="flex-1 min-w-0 px-2 h-7 bg-background border border-input rounded-md text-[11.5px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); submitComment(); }}
                  disabled={busy || commentText.trim().length < 3}
                  className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 hover:bg-primary/90"
                  title="Send"
                >
                  <Send className="h-3 w-3" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Expandable "what's left" — checklist of pending items so admin
          can see EXACTLY what's blocking advance without opening the
          detail page. */}
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
                  <CheckCircle2 className="h-3 w-3" /> Nothing left — ready to advance.
                </div>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                    {remaining.length} step{remaining.length === 1 ? '' : 's'} left
                  </p>
                  {remaining.slice(0, 5).map((r, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                      <Circle className="h-2.5 w-2.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="truncate" title={r.title}>{r.title}</span>
                    </div>
                  ))}
                  {remaining.length > 5 && (
                    <button
                      onClick={() => onOpenDrawer?.(wf._id, wf.clientName)}
                      className="block text-[10px] text-primary hover:underline mt-1"
                    >
                      View all {remaining.length} →
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modals ──────────────────────────────────────────────────── */}
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
      {blockModal && (
        <InlineBlockModal
          onSubmit={handleBlock}
          onClose={() => setBlockModal(false)}
        />
      )}
      {unblockModal && (
        <CommentRequiredModal
          title="Unblock this project?"
          description="What changed — e.g. client confirmed assets received."
          placeholder="What unblocked the project?"
          primaryLabel="Unblock"
          tone="success"
          onSubmit={handleUnblock}
          onClose={() => setUnblockModal(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// InlineBlockModal — same UX as drawer's BlockProjectModal but inlined here
// so cards don't need to import that big component. Captures blockerType +
// reason and uses the audit-trail comment field as both the reason AND
// the log entry (they're the same thing in a Block action).
// ─────────────────────────────────────────────────────────────────────────
const BLOCKER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'waiting_client_input',      label: 'Waiting on client'             },
  { value: 'waiting_internal_approval', label: 'Waiting on internal approval'  },
  { value: 'dependency',                label: 'Dependency blocked'            },
  { value: 'technical',                 label: 'Technical issue'               },
  { value: 'budget',                    label: 'Budget / scope hold'           },
];

function InlineBlockModal({
  onSubmit, onClose,
}: {
  onSubmit: (p: { blockerType: string; blockerReason: string; comment: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [blockerType, setBlockerType] = useState('waiting_client_input');
  const [reason, setReason]           = useState('');
  const [submitting, setSubmitting]   = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ blockerType, blockerReason: trimmed, comment: trimmed });
      onClose();
    } catch { /* caller toasts */ }
    finally { setSubmitting(false); }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldX className="h-4 w-4 text-rose-600" />
              <p className="text-sm font-semibold">Mark project blocked</p>
            </div>
            <button onClick={onClose} disabled={submitting} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Blocker type</label>
              <select
                value={blockerType}
                onChange={e => setBlockerType(e.target.value)}
                disabled={submitting}
                className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {BLOCKER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Reason</label>
              <textarea
                autoFocus
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Say WHY this is blocked — e.g. waiting on Meta ad-account access."
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} disabled={submitting}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit}
                className="px-4 h-9 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white">
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? 'Saving…' : 'Mark blocked'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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
      <p className="font-semibold">{query ? 'No clients match that search' : 'No Client CRM entries yet'}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {query ? 'Try the phone number, full name, or email.' : 'When sales onboards a client and picks their services, the entry shows up here.'}
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
      toast.success('Client CRM entry created — teammates have been auto-assigned');
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
              Add to Client CRM
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
