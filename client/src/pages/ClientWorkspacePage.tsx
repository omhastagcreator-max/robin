import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, AlertTriangle, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, Loader2, RotateCcw, ShieldX, Unlock, Plane,
  Clock, Flag,
} from 'lucide-react';
// Clock is used by BrandTaskEtaInline below; harmless if also used above.

import { AppLayout } from '@/components/AppLayout';
import { ActivityTimeline } from '@/components/panels/ProjectDetailPanel';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * ClientWorkspacePage — mission-control rebuild (May 2026, v3).
 *
 * Layout philosophy: the CURRENT STAGE block is the visual hero. Every
 * other section is secondary and arranged around it. Owner spec —
 * a user lands on the page and answers in 5 seconds:
 *
 *   1. What stage is the project in?       (Hero block, 28-32 px name)
 *   2. What is blocking it?                  (Attention bar above hero)
 *   3. Who owns it?                          (Hero block + header strip)
 *   4. What happens next?                    (Hero block · Next action)
 *   5. Is it healthy?                        (Health pill in header)
 *
 * Section order:
 *
 *   1. Header strip (~52 px tall)
 *      Avatar · Brand · Contact | Health | Launch | Owner | Priority | Stage
 *
 *   2. Attention required bar (conditional — only when blocker exists)
 *      Full-width rose strip with the blocker reason, owner, age, impact.
 *
 *   3. CURRENT STAGE HERO (~180 px tall)
 *      The dominant block on the page. Big stage label, six labelled
 *      meta cells (Owner · Status · Next action · Started · ETA · Risk).
 *
 *   4. Project journey (~44 px)
 *      Compact horizontal 6-stage timeline.
 *
 *   5. Service overview (~150 px)
 *      Three compact cards in a 12-col grid. Currently-active card is
 *      visually elevated (slightly bigger, primary accent border).
 *
 *   6. Three-column footer
 *      Latest activity (5-line feed) | Team panel | AI insights (4 lines)
 *
 *   7. Tasks (collapsed counter row)
 *
 * All inside ONE bordered container with internal dividers — keeps
 * the page reading as a unified surface, not a stack of cards.
 *
 * Reuses the existing data hooks (cwGetWorkflow, cwBlock, cwUnblock,
 * aiSummarizeWorkflow, onLeaveToday, ActivityTimeline). No new backend.
 */

// ── Local Workflow shape ────────────────────────────────────────────
interface ChecklistItem { _id?: string; text?: string; title?: string; done: boolean }
interface Service {
  _id?: string;
  label: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  assignedTo?: string;
  eta?: string | null;
}
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: Service[];
  health?: string;
  healthReason?: string;
  blockerType?: string;
  blockerReason?: string;
  blockedSince?: string | null;
  lastUpdate?: { detail?: string; at?: string; actorId?: string; serviceType?: string } | null;
  updatedAt?: string;
  createdAt?: string;
  eta?: string | null;
  etaConfidence?: '' | 'high' | 'medium' | 'low';
  priority?: string;
  currentOwnerTeam?: string;
  nextAction?: string;
  nextBestAction?: string;
  delayCause?: string;
  riskScore?: number;
  predictedCompletionAt?: string | null;
}
interface UserLite { _id: string; name?: string }

const JOURNEY = [
  { key: 'discovery', label: 'Discovery'   },
  { key: 'dev',       label: 'Development' },
  { key: 'video',     label: 'Video'       },
  { key: 'meta',      label: 'Meta ads'    },
  { key: 'launch',    label: 'Launch'      },
  { key: 'scaling',   label: 'Scaling'     },
] as const;
type StageKey = typeof JOURNEY[number]['key'];
type StageState = 'future' | 'current' | 'completed' | 'blocked';

function computeJourneyStates(wf: Workflow): Record<StageKey, StageState> {
  const shopify    = wf.services.find(s => s.serviceType === 'shopify');
  const meta       = wf.services.find(s => s.serviceType === 'meta_ads');
  const influencer = wf.services.find(s => s.serviceType === 'influencer');
  const allDone    = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
  const anyStarted = wf.services.some(s => s.status !== 'pending');
  const states: Record<StageKey, StageState> = {
    discovery: anyStarted ? 'completed' : 'current',
    dev: 'future', video: 'future', meta: 'future', launch: 'future', scaling: 'future',
  };
  const mark = (key: StageKey, svc?: Service) => {
    if (!svc) return;
    if (svc.status === 'done')              states[key] = 'completed';
    else if (svc.status === 'blocked')      states[key] = 'blocked';
    else if (svc.status === 'in_progress')  states[key] = 'current';
  };
  mark('dev',   shopify);
  mark('video', influencer);
  mark('meta',  meta);
  if (allDone) { states.launch = 'current'; }
  else if (meta?.status === 'done') { states.launch = 'completed'; states.scaling = 'current'; }
  return states;
}

function healthDisplay(wf: Workflow): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; pct: number } {
  let total = 0, done = 0;
  for (const s of wf.services) {
    total += s.checklist?.length || 0;
    done  += (s.checklist || []).filter(c => c.done).length;
    if ((s.checklist?.length || 0) === 0 && s.status === 'done') { total += 1; done += 1; }
  }
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  if (wf.services.length > 0 && wf.services.every(s => s.status === 'done')) {
    return { label: 'Completed', tone: 'success', pct: 100 };
  }
  if (wf.health === 'blocked')  return { label: 'Blocked',     tone: 'danger',  pct };
  if (wf.health === 'at_risk')  return { label: 'At risk',     tone: 'warning', pct };
  if (wf.health === 'on_track') return { label: 'On track',    tone: 'success', pct };
  return { label: 'In progress', tone: 'neutral', pct };
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

// Service-type → JOURNEY stage key.
function svcTypeToStageKey(svcType?: string): StageKey | null {
  if (svcType === 'shopify')    return 'dev';
  if (svcType === 'influencer') return 'video';
  if (svcType === 'meta_ads')   return 'meta';
  return null;
}
function stageKeyToSvcType(key: StageKey): string | null {
  if (key === 'dev')   return 'shopify';
  if (key === 'video') return 'influencer';
  if (key === 'meta')  return 'meta_ads';
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export default function ClientWorkspacePage() {
  const { id }   = useParams();
  const { role } = useAuth();
  const isAdminOrSales = role === 'admin' || role === 'sales';
  const navigate = useNavigate();
  // Click a service card → drill into its Stage Workspace (Layer 2).
  const openStage = (stageKey: StageKey) => {
    if (!id) return;
    navigate(`/clients/pipeline/${id}/stage/${stageKey}`);
  };

  const [wf,        setWf]        = useState<Workflow | null>(null);
  const [users,     setUsers]     = useState<Record<string, UserLite>>({});
  const [loading,   setLoading]   = useState(true);
  const [activityRev, setActivityRev] = useState(0);
  const [blockOpen,   setBlockOpen]   = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [ai, setAi]               = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiBusy, setAiBusy]       = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!id) return;
    try { setWf(await api.cwGetWorkflow(id)); }
    catch { /* axios toast */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    api.listUsers()
      .then((arr: any[]) => {
        const map: Record<string, UserLite> = {};
        (Array.isArray(arr) ? arr : []).forEach(u => { map[u._id] = u; });
        setUsers(map);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    (api as any).onLeaveToday?.()
      .then((rows: Array<{ userId: string }>) => setOnLeaveIds(new Set(rows.map(r => r.userId))))
      .catch(() => {});
  }, []);

  const aiFiredRef = useRef(false);
  useEffect(() => {
    if (!wf || aiFiredRef.current || ai) return;
    aiFiredRef.current = true;
    void generateAI();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf]);

  const generateAI = async () => {
    if (!id) return;
    setAiBusy(true);
    try { setAi(await api.aiSummarizeWorkflow(id)); }
    catch { /* silent */ }
    finally { setAiBusy(false); }
  };

  const bumpActivity = () => setActivityRev(r => r + 1);

  const handleBlock = async (comment: string) => {
    if (!id) return;
    try {
      const updated = await api.cwBlock(id, { blockerType: 'waiting_client_input', blockerReason: comment, comment });
      setWf(updated as Workflow);
      bumpActivity();
      toast.success('Project marked blocked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to block');
      throw err;
    }
  };
  const handleUnblock = async (comment: string) => {
    if (!id) return;
    try {
      const updated = await api.cwUnblock(id, { comment });
      setWf(updated as Workflow);
      bumpActivity();
      toast.success('Project unblocked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to unblock');
      throw err;
    }
  };

  if (loading) return <AppLayout><div className="py-24 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppLayout>;
  if (!wf)     return <AppLayout><div className="py-24 text-center text-sm text-muted-foreground">Client CRM entry not found.</div></AppLayout>;

  // ── Derived ──────────────────────────────────────────────────────
  const health   = healthDisplay(wf);
  const journey  = computeJourneyStates(wf);
  const currentStageKey: StageKey = (() => {
    const order: StageKey[] = ['scaling', 'launch', 'meta', 'video', 'dev', 'discovery'];
    for (const k of order) if (journey[k] === 'current')   return k;
    for (const k of order) if (journey[k] === 'blocked')   return k;
    for (const k of order) if (journey[k] === 'completed') return k;
    return 'discovery';
  })();
  const currentStageLabel = JOURNEY.find(s => s.key === currentStageKey)?.label || 'Discovery';

  // Active service for the hero block.
  const activeSvcType = stageKeyToSvcType(currentStageKey);
  const activeSvc = activeSvcType ? wf.services.find(s => s.serviceType === activeSvcType) : undefined;
  const activeAssignee = activeSvc?.assignedTo ? users[activeSvc.assignedTo] : undefined;
  const activeOnLeave  = !!(activeSvc?.assignedTo && onLeaveIds.has(activeSvc.assignedTo));

  const stageStartedAt = (() => {
    // Best-effort: when the assigned service was last updated, the last
    // workflow update timestamp, or creation.
    return wf.lastUpdate?.at || wf.updatedAt || wf.createdAt;
  })();
  const stageEta = activeSvc?.eta || wf.eta;

  const ownerId   = activeSvc?.assignedTo || wf.services.find(s => s.assignedTo)?.assignedTo;
  const ownerName = ownerId ? users[ownerId]?.name : undefined;
  const isBlocked = !!wf.blockerType;
  const nextAction = wf.nextAction || wf.nextBestAction;
  const launchLabel = wf.eta ? format(parseISO(wf.eta), 'd MMM') : 'TBD';

  // Status sentence for the hero.
  const heroStatus = (() => {
    if (activeSvc?.status === 'blocked') return `Blocked · ${wf.blockerReason || 'awaiting resolution'}`;
    if (activeSvc?.status === 'done')    return 'Completed';
    if (wf.blockerType === 'waiting_client_input') return 'Waiting for client';
    if (wf.blockerType)  return wf.blockerType.replace(/_/g, ' ');
    if (activeSvc?.status === 'in_progress') return 'In progress';
    if (activeSvc)                          return 'Pending';
    return '—';
  })();

  // Estimated delay surfaced in the hero (right-side risk meta).
  const riskLabel = wf.riskScore != null
    ? (wf.riskScore > 66 ? 'High' : wf.riskScore > 33 ? 'Medium' : 'Low')
    : (health.tone === 'danger' ? 'High' : health.tone === 'warning' ? 'Medium' : 'Low');

  // Task counts.
  const allChecklist = wf.services.flatMap(s => s.checklist || []);
  const openCount = allChecklist.filter(c => !c.done).length;
  const doneCount = allChecklist.filter(c => c.done).length;

  // Team list (unique assignees, decorated with department + current work).
  const teamSeen = new Set<string>();
  const team: Array<{ userId: string; dept: string; currentWork?: string }> = [];
  for (const s of wf.services) {
    if (s.assignedTo && !teamSeen.has(s.assignedTo)) {
      teamSeen.add(s.assignedTo);
      const dept =
        s.serviceType === 'shopify'    ? 'Development' :
        s.serviceType === 'meta_ads'   ? 'Meta ads'    :
        s.serviceType === 'influencer' ? 'Video'       : 'Team';
      const currentWork = s.status === 'in_progress' ? s.label : (s.status === 'blocked' ? 'Blocked' : undefined);
      team.push({ userId: s.assignedTo, dept, currentWork });
    }
  }

  return (
    <AppLayout>
      <div className="max-w-[1400px] mx-auto p-3 sm:p-4 lg:p-5">

        <Link to="/clients/pipeline" className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-3 w-3" /> Back to Client CRM
        </Link>

        <div className="rounded-xl border border-border bg-card">

          {/* ── 1. HEADER STRIP ───────────────────────────────────── */}
          <HeaderStrip
            wf={wf}
            health={health}
            currentStageLabel={currentStageLabel}
            ownerName={ownerName}
            launchLabel={launchLabel}
          />

          {/* ── 2. ATTENTION REQUIRED (only when blocked) ───────── */}
          {isBlocked && (
            <AttentionBar
              wf={wf}
              ownerName={ownerName}
              waitingSince={wf.blockedSince ? formatDistanceToNow(parseISO(wf.blockedSince), { addSuffix: false }) : null}
              isAdminOrSales={isAdminOrSales}
              onUnblock={() => setUnblockOpen(true)}
            />
          )}

          {/* ── 3. CURRENT STAGE HERO — the dominant block ──────── */}
          <CurrentStageHero
            stageLabel={currentStageLabel}
            activeSvcLabel={activeSvc?.label}
            ownerName={activeAssignee?.name || ownerName}
            ownerOnLeave={activeOnLeave}
            status={heroStatus}
            nextAction={nextAction}
            startedAt={stageStartedAt}
            etaAt={stageEta}
            riskLabel={riskLabel}
            isBlocked={isBlocked}
            isAdminOrSales={isAdminOrSales}
            onBlock={() => setBlockOpen(true)}
          />

          {/* ── 4. PROJECT JOURNEY ──────────────────────────────── */}
          <JourneyStrip states={journey} currentKey={currentStageKey} />

          {/* ── 5. SERVICE OVERVIEW — 3 cards, active elevated.
              Each card click drills into Layer 2 (Stage Workspace) at
              /clients/pipeline/:id/stage/:stageKey. */}
          <ServiceOverview
            wf={wf}
            users={users}
            onLeaveIds={onLeaveIds}
            currentStageKey={currentStageKey}
            onOpen={openStage}
          />

          {/* ── 6. THREE-COLUMN FOOTER ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 border-t border-border">
            <div className="lg:col-span-5 lg:border-r border-border">
              <SectionHeader>Latest activity</SectionHeader>
              <ActivityFeedCompact workflowId={wf._id} refreshKey={activityRev} />
            </div>
            <div className="lg:col-span-4 lg:border-r border-border">
              <SectionHeader>Team</SectionHeader>
              <TeamPanel team={team} users={users} onLeaveIds={onLeaveIds} />
            </div>
            <div className="lg:col-span-3">
              <SectionHeader rightSlot={
                <button onClick={generateAI} disabled={aiBusy} className="text-[10.5px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                  <RotateCcw className={`h-2.5 w-2.5 ${aiBusy ? 'animate-spin' : ''}`} /> Refresh
                </button>
              }>AI insights</SectionHeader>
              <AILines wf={wf} ai={ai} busy={aiBusy} health={health} />
            </div>
          </div>

          {/* ── 7. TASKS — collapsed counter ────────────────────── */}
          <TasksRow
            workflowId={wf._id}
            open={tasksOpen}
            onToggle={() => setTasksOpen(o => !o)}
            openCount={openCount}
            doneCount={doneCount}
            services={wf.services}
          />
        </div>
      </div>

      {/* Modals */}
      {blockOpen && (
        <CommentRequiredModal
          title="Mark project blocked"
          description="Why is the project blocked?"
          placeholder="e.g. waiting for product photos from client"
          primaryLabel="Mark blocked"
          tone="danger"
          onSubmit={async (c) => { await handleBlock(c); setBlockOpen(false); }}
          onClose={() => setBlockOpen(false)}
        />
      )}
      {unblockOpen && (
        <CommentRequiredModal
          title="Unblock this project?"
          description="What changed?"
          placeholder="e.g. client confirmed access"
          primaryLabel="Unblock"
          tone="success"
          onSubmit={async (c) => { await handleUnblock(c); setUnblockOpen(false); }}
          onClose={() => setUnblockOpen(false)}
        />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. Header strip
// ─────────────────────────────────────────────────────────────────────
function HeaderStrip({
  wf, health, currentStageLabel, ownerName, launchLabel,
}: {
  wf: Workflow;
  health: ReturnType<typeof healthDisplay>;
  currentStageLabel: string;
  ownerName?: string;
  launchLabel: string;
}) {
  const healthCls =
    health.tone === 'success' ? 'text-emerald-700' :
    health.tone === 'warning' ? 'text-amber-700'   :
    health.tone === 'danger'  ? 'text-rose-700'    : 'text-foreground';
  const priority = (wf.priority || 'Medium').replace(/^\w/, c => c.toUpperCase());
  return (
    <div className="px-4 py-3 border-b border-border flex items-center gap-5 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[12px] font-bold shrink-0">
          {initials(wf.clientName)}
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold leading-none truncate">{wf.clientName}</h1>
          <div className="flex items-center gap-2.5 text-[10.5px] text-muted-foreground mt-0.5">
            {wf.clientPhone && <a href={`tel:${wf.clientPhone}`} className="hover:text-primary tabular-nums inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{wf.clientPhone}</a>}
            {wf.clientEmail && <a href={`mailto:${wf.clientEmail}`} className="hover:text-foreground inline-flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5" />{wf.clientEmail}</a>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6 ml-auto flex-wrap">
        <HField label="Health"   value={`${health.pct}% · ${health.label}`} cls={healthCls} />
        <HField label="Launch"   value={launchLabel} />
        <HField label="Owner"    value={ownerName || '—'} />
        <HField label="Priority" value={priority} cls={priority.toLowerCase() === 'urgent' || priority.toLowerCase() === 'high' ? 'text-rose-700' : 'text-foreground'} />
        <HField label="Stage"    value={currentStageLabel} cls="text-primary" />
      </div>
    </div>
  );
}
function HField({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</p>
      <p className={`text-[12.5px] font-semibold leading-tight mt-0.5 truncate ${cls || ''}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. Attention Required bar (only when blocked)
// ─────────────────────────────────────────────────────────────────────
function AttentionBar({
  wf, ownerName, waitingSince, isAdminOrSales, onUnblock,
}: {
  wf: Workflow;
  ownerName?: string;
  waitingSince: string | null;
  isAdminOrSales: boolean;
  onUnblock: () => void;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-border bg-rose-500/[0.06] flex items-center gap-4 flex-wrap">
      <span className="inline-flex items-center gap-1.5 font-bold text-rose-700 text-[11.5px] uppercase tracking-wider shrink-0">
        <AlertTriangle className="h-3.5 w-3.5" /> Attention required
      </span>
      <p className="text-[13px] font-semibold flex-1 min-w-0 truncate" title={wf.blockerReason || ''}>
        {wf.blockerReason || wf.blockerType?.replace(/_/g, ' ') || 'Project is blocked'}
      </p>
      <div className="flex items-center gap-4 text-[11.5px]">
        {waitingSince && <span className="text-muted-foreground">Blocked <span className="font-semibold text-rose-700">{waitingSince}</span></span>}
        {ownerName     && <span className="text-muted-foreground">Owner <span className="font-semibold text-foreground">{ownerName}</span></span>}
        <span className="text-muted-foreground">Impact <span className="font-semibold text-rose-700">Launch delay risk</span></span>
      </div>
      {isAdminOrSales && (
        <button onClick={onUnblock} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700">
          <Unlock className="h-3 w-3" /> Unblock
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. CURRENT STAGE HERO — the dominant block
// ─────────────────────────────────────────────────────────────────────
function CurrentStageHero({
  stageLabel, activeSvcLabel, ownerName, ownerOnLeave,
  status, nextAction, startedAt, etaAt, riskLabel, isBlocked,
  isAdminOrSales, onBlock,
}: {
  stageLabel:     string;
  activeSvcLabel?: string;
  ownerName?:     string;
  ownerOnLeave:   boolean;
  status:         string;
  nextAction?:    string;
  startedAt?:     string;
  etaAt?:         string | null;
  riskLabel:      string;
  isBlocked:      boolean;
  isAdminOrSales: boolean;
  onBlock:        () => void;
}) {
  const startedRel = startedAt ? formatDistanceToNow(parseISO(startedAt), { addSuffix: true }) : '—';
  const etaLabel   = etaAt
    ? (() => {
        try {
          const days = Math.round((parseISO(etaAt).getTime() - Date.now()) / 86400000);
          if (days <= 0) return 'Today / overdue';
          if (days === 1) return 'Tomorrow · 1 day';
          return `${format(parseISO(etaAt), 'd MMM')} · ${days} days`;
        } catch { return etaAt; }
      })()
    : '—';
  return (
    <div className="px-6 sm:px-8 py-7 border-b border-border bg-gradient-to-br from-primary/[0.04] via-card to-card relative">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground">Current stage</p>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h2 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-none text-foreground">
              {stageLabel}
            </h2>
            {activeSvcLabel && (
              <span className="text-[14px] text-muted-foreground">· {activeSvcLabel}</span>
            )}
          </div>
        </div>
        {!isBlocked && isAdminOrSales && (
          <button onClick={onBlock} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-muted text-[11.5px] font-semibold shrink-0">
            <ShieldX className="h-3 w-3" /> Mark blocked
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
        <HeroMeta label="Owner" icon={null}>
          <span className="inline-flex items-center gap-1.5">
            {ownerName || <span className="text-muted-foreground italic">Unassigned</span>}
            {ownerOnLeave && <Plane className="h-3 w-3 text-sky-600" />}
          </span>
        </HeroMeta>
        <HeroMeta label="Status">{status}</HeroMeta>
        <HeroMeta label="Next action" wide>
          {nextAction || <span className="text-muted-foreground italic">—</span>}
        </HeroMeta>
        <HeroMeta label="Started"   icon={<Clock className="h-3 w-3 text-muted-foreground" />}>{startedRel}</HeroMeta>
        <HeroMeta label="ETA"       icon={<Flag  className="h-3 w-3 text-muted-foreground" />}>{etaLabel}</HeroMeta>
        <HeroMeta label="Launch risk">
          <span className={
            riskLabel === 'High'   ? 'text-rose-700  font-bold' :
            riskLabel === 'Medium' ? 'text-amber-700 font-bold' :
                                     'text-emerald-700 font-bold'
          }>{riskLabel}</span>
        </HeroMeta>
      </div>
    </div>
  );
}
function HeroMeta({ label, icon, children, wide }: { label: string; icon?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2 lg:col-span-2' : ''}`}>
      <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground inline-flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-[14px] font-semibold mt-1 leading-snug">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. Project journey strip
// ─────────────────────────────────────────────────────────────────────
function JourneyStrip({ states, currentKey }: { states: Record<StageKey, StageState>; currentKey: StageKey }) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center gap-1.5 overflow-x-auto">
      {JOURNEY.map((stage, i) => {
        const s = states[stage.key];
        const isCurrent = stage.key === currentKey;
        const dotCls =
          s === 'completed' ? 'bg-emerald-500 text-white' :
          s === 'current'   ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
          s === 'blocked'   ? 'bg-rose-500 text-white' :
                              'bg-card text-muted-foreground border border-border';
        const labelCls =
          isCurrent ? 'text-foreground font-bold' :
          s === 'completed' ? 'text-foreground/70' :
          s === 'blocked'   ? 'text-rose-700 font-semibold' :
                              'text-muted-foreground';
        // Owner ask (May 2026): blur future stages that haven't been
        // reached so the eye lands on done/current/blocked first. We
        // use a slight blur + 50% opacity instead of full grayscale
        // so the labels are still readable for a stakeholder asking
        // "what comes next" — they just don't compete for attention.
        const futureCls = s === 'future' ? 'opacity-50 blur-[0.5px] grayscale' : '';
        return (
          <div key={stage.key} className={`flex items-center gap-1.5 shrink-0 transition-all ${futureCls}`}>
            <div className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${dotCls}`}>
                {s === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`text-[12px] ${labelCls}`}>{stage.label}</span>
            </div>
            {i < JOURNEY.length - 1 && (
              <div className={`h-px w-6 ${s === 'completed' ? 'bg-emerald-500/50' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 5. Service overview — 3 cards, active elevated
// ─────────────────────────────────────────────────────────────────────
function ServiceOverview({
  wf, users, onLeaveIds, currentStageKey, onOpen,
}: {
  wf: Workflow;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
  currentStageKey: StageKey;
  onOpen: (stageKey: StageKey) => void;
}) {
  const cards = [
    { key: 'shopify',    label: 'Development', tone: 'emerald', stageKey: 'dev'   as StageKey },
    { key: 'influencer', label: 'Video',       tone: 'amber',   stageKey: 'video' as StageKey },
    { key: 'meta_ads',   label: 'Meta ads',    tone: 'blue',    stageKey: 'meta'  as StageKey },
  ];
  return (
    <div className="px-4 py-4 border-b border-border grid grid-cols-1 md:grid-cols-3 gap-3">
      {cards.map(c => {
        const svc = wf.services.find(s => s.serviceType === c.key);
        const isActive = c.stageKey === currentStageKey;
        return (
          <ServiceCard
            key={c.key}
            title={c.label}
            tone={c.tone as 'emerald' | 'amber' | 'blue'}
            elevated={isActive}
            svc={svc}
            users={users}
            onLeaveIds={onLeaveIds}
            nextAction={wf.nextAction || wf.nextBestAction}
            onClick={() => onOpen(c.stageKey)}
          />
        );
      })}
    </div>
  );
}
function ServiceCard({
  title, tone, elevated, svc, users, onLeaveIds, nextAction, onClick,
}: {
  title: string;
  tone: 'emerald' | 'amber' | 'blue';
  elevated: boolean;
  svc?: Service;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
  nextAction?: string;
  onClick: () => void;
}) {
  const stripe = tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
  const ttext  = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-blue-700';
  const total = svc?.checklist?.length || 0;
  const done  = svc?.checklist?.filter(c => c.done).length || 0;
  const pct = total === 0 ? (svc?.status === 'done' ? 100 : 0) : Math.round((done / total) * 100);
  const assignee = svc?.assignedTo ? users[svc.assignedTo] : undefined;
  const onLeave  = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
  const statusLabel =
    !svc                            ? 'Not started' :
    svc.status === 'done'           ? 'Completed'   :
    svc.status === 'blocked'        ? 'Blocked'     :
    svc.status === 'in_progress'    ? 'Active'      : 'Not started';
  const statusCls =
    !svc || svc.status === 'pending' ? 'text-muted-foreground' :
    svc.status === 'done'            ? 'text-emerald-700' :
    svc.status === 'blocked'         ? 'text-rose-700' :
                                       'text-amber-700';

  // Elevated card: primary-tinted border + slightly bigger vertical
  // padding. No hard glow — owner asked for "premium minimal".
  const cardCls = elevated
    ? 'rounded-xl border-2 border-primary/40 bg-card ring-1 ring-primary/10'
    : 'rounded-xl border border-border bg-card';

  return (
    <button
      onClick={onClick}
      type="button"
      title={`Open ${title} workspace`}
      className={`${cardCls} overflow-hidden text-left hover:border-primary/60 transition-colors cursor-pointer w-full`}
    >
      <div className={`h-1 ${stripe}`} />
      <div className={`px-4 ${elevated ? 'py-4' : 'py-3.5'} space-y-3`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.14em] font-bold ${ttext}`}>{title}</p>
            <h3 className="text-[14px] font-bold mt-0.5 leading-tight truncate">{svc?.label || 'Not configured'}</h3>
          </div>
          <span className={`text-[11px] font-semibold whitespace-nowrap ${statusCls}`}>
            {statusLabel}
          </span>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-muted-foreground">Progress</p>
            <p className="text-[11px] font-semibold tabular-nums">{pct}%</p>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${stripe}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Meta label="Owner">
            <span className="inline-flex items-center gap-1.5 truncate">
              <span className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[8.5px] font-bold text-muted-foreground shrink-0">
                {initials(assignee?.name) || '·'}
              </span>
              <span className={onLeave ? 'text-sky-700 font-medium' : ''}>{assignee?.name || 'Unassigned'}</span>
              {onLeave && <Plane className="h-2.5 w-2.5 text-sky-600 shrink-0" />}
            </span>
          </Meta>
          <Meta label="Next action">
            <span className="truncate" title={nextAction || ''}>
              {svc?.status === 'done' ? <span className="text-muted-foreground">—</span>
               : (nextAction || <span className="text-muted-foreground italic">—</span>)}
            </span>
          </Meta>
        </div>
      </div>
    </button>
  );
}
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-0.5">{label}</p>
      <p className="text-[11.5px] font-medium truncate">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 6. Activity feed / Team / AI insights
// ─────────────────────────────────────────────────────────────────────
function SectionHeader({ children, rightSlot }: { children: React.ReactNode; rightSlot?: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{children}</p>
      {rightSlot}
    </div>
  );
}

function ActivityFeedCompact({ workflowId, refreshKey }: { workflowId: string; refreshKey: number }) {
  // Caps to roughly 5 visible rows; ActivityTimeline already loads
  // recent first.
  return (
    <div className="px-2 py-1 max-h-[220px] overflow-hidden">
      <ActivityTimeline workflowId={workflowId} refreshKey={refreshKey} />
    </div>
  );
}

function TeamPanel({
  team, users, onLeaveIds,
}: {
  team: Array<{ userId: string; dept: string; currentWork?: string }>;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
}) {
  if (team.length === 0) {
    return <p className="px-4 py-4 text-[11.5px] text-muted-foreground italic">No assignments yet.</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {team.map(({ userId, dept, currentWork }) => {
        const u = users[userId];
        const onLeave = onLeaveIds.has(userId);
        return (
          <div key={userId} className="px-4 py-2 flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10.5px] font-bold shrink-0">
              {initials(u?.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold truncate inline-flex items-center gap-1.5">
                {u?.name || 'Unknown'}
                {onLeave && <Plane className="h-3 w-3 text-sky-600 shrink-0" />}
              </p>
              <p className="text-[10.5px] text-muted-foreground truncate">
                {dept}{currentWork ? ` · ${currentWork}` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AILines({
  wf, ai, busy, health,
}: {
  wf: Workflow;
  ai: { text: string; aiUsed: boolean } | null;
  busy: boolean;
  health: ReturnType<typeof healthDisplay>;
}) {
  const risk = wf.riskScore != null
    ? (wf.riskScore > 66 ? 'High' : wf.riskScore > 33 ? 'Medium' : 'Low')
    : (health.tone === 'warning' ? 'Medium' : health.tone === 'danger' ? 'High' : 'Low');
  const confidence = Math.max(0, Math.min(100, 100 - (wf.riskScore ?? (health.tone === 'danger' ? 50 : health.tone === 'warning' ? 30 : 15))));
  const bottleneck = wf.delayCause || (wf.blockerType ? wf.blockerType.replace(/_/g, ' ') : '—');
  return (
    <div className="px-4 py-3 text-[12px] space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Health</span>
        <span className="font-semibold tabular-nums">{health.pct}%</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Risk</span>
        <span className={`font-semibold ${risk === 'High' ? 'text-rose-700' : risk === 'Medium' ? 'text-amber-700' : 'text-emerald-700'}`}>{risk}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Launch confidence</span>
        <span className="font-semibold tabular-nums">{confidence}%</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground shrink-0">Bottleneck</span>
        <span className="font-semibold capitalize truncate text-right" title={bottleneck}>{bottleneck}</span>
      </div>
      <div className="pt-1.5 border-t border-border/60 flex items-start gap-1.5">
        <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
        {busy && !ai ? (
          <span className="text-muted-foreground italic text-[11.5px]">Generating recommendation…</span>
        ) : ai?.text ? (
          <span className="text-[11.5px] line-clamp-2">{ai.text}</span>
        ) : (
          <span className="text-muted-foreground italic text-[11.5px]">No recommendation yet.</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 7. Tasks counter row + expand
// ─────────────────────────────────────────────────────────────────────
function TasksRow({
  workflowId, open, onToggle, openCount, doneCount, services,
}: {
  workflowId: string;
  open: boolean;
  onToggle: () => void;
  openCount: number;
  doneCount: number;
  services: Service[];
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between gap-2 hover:bg-muted/30 text-left text-[12px] border-t border-border"
      >
        <div className="flex items-center gap-3">
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Tasks</p>
          <span className="inline-flex items-center gap-1 text-amber-700"><span className="font-bold tabular-nums">{openCount}</span> open</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="inline-flex items-center gap-1 text-emerald-700"><span className="font-bold tabular-nums">{doneCount}</span> done</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
            <div className="p-4 space-y-3">
              {services.map(svc => (
                <div key={svc._id || svc.serviceType}>
                  <p className="text-[11px] font-semibold mb-1.5">{svc.label}</p>
                  {(svc.checklist || []).length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">No checklist items.</p>
                  ) : (
                    <ul className="space-y-1">
                      {svc.checklist.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-[12px]">
                          <span className={`h-3 w-3 rounded-full flex items-center justify-center ${c.done ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                            {c.done && <CheckCircle2 className="h-2 w-2" />}
                          </span>
                          <span className={c.done ? 'line-through text-muted-foreground' : ''}>
                            {c.text || c.title || `Step ${i + 1}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {/* Cross-team tasks scoped to THIS brand. Anything created
                  here also lands on the assignee's WorkroomHome inbox
                  under the 'Mine' tab — single source of truth. */}
              <BrandTasksSection workflowId={workflowId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 7b. Brand-scoped task list (cross-team)
// ─────────────────────────────────────────────────────────────────────
// Lists ProjectTask docs linked to this clientWorkflowId. Lets anyone
// on the brand quick-add a task; the assignee defaults to the current
// user (use the picker to delegate). When marked done the assignee's
// monthly target progress refreshes on next read.
function BrandTasksSection({ workflowId }: { workflowId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([]);
  const [assignee, setAssignee] = useState<string>('');

  const refresh = () => {
    setLoading(true);
    api.tasksForWorkflow(workflowId)
      .then((d: any[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [workflowId]);

  // Lightweight team picker — pull names from /users once. Best-effort.
  useEffect(() => {
    api.listUsers()
      .then((d: any[]) => setTeam((d || []).filter(u => u.role !== 'client').map((u: any) => ({ id: u._id || u.id, name: u.name }))))
      .catch(() => setTeam([]));
  }, []);

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    try {
      await api.createTask({ title, clientWorkflowId: workflowId, assignedTo: assignee || undefined });
      setDraft('');
      refresh();
    } catch { /* swallow — UI re-tries on next add */ }
  };

  const toggleDone = async (t: any) => {
    try {
      await api.updateTask(t._id, { status: t.status === 'done' ? 'pending' : 'done' });
      refresh();
    } catch { /* swallow */ }
  };

  const visible = rows.slice(0, 8);
  const { user } = useAuth();
  return (
    <div className="border-t border-border/60 pt-3 mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold">Brand tasks <span className="text-muted-foreground/70 font-normal">({rows.length})</span></p>
        <p className="text-[10px] text-muted-foreground">Shows up on the assignee's Workroom too.</p>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Quick task — e.g. send launch deck to client"
          className="flex-1 px-2 h-7 text-[11.5px] rounded-md border border-input bg-background focus:ring-1 focus:ring-primary"
        />
        <select
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          className="h-7 text-[11px] rounded-md border border-input bg-background max-w-[140px]"
        >
          <option value="">Assign to me</option>
          {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50 hover:bg-primary/90"
        >Add</button>
      </div>
      {loading ? (
        <p className="text-[11px] text-muted-foreground italic">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No brand tasks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map(t => {
            const isDone = t.status === 'done';
            const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '';
            // Only the assignee can set their own ETA. Admin/other users
            // see it read-only — keeps the "I commit to" model honest.
            const isAssignee = user?.id && (t.assignedTo === user.id);
            return (
              <li key={t._id} className="text-[12px]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleDone(t)}
                    className={`h-3.5 w-3.5 rounded flex items-center justify-center shrink-0 ${
                      isDone ? 'bg-emerald-500 text-white' : 'border border-border hover:border-primary'
                    }`}
                  >
                    {isDone && <CheckCircle2 className="h-2 w-2" />}
                  </button>
                  <span className={`flex-1 truncate ${isDone ? 'line-through text-muted-foreground' : ''}`}>{t.title}</span>
                  {due && <span className="text-[10px] text-muted-foreground">due {due}</span>}
                </div>
                {!isDone && (t.estimatedCompletionAt || t.estimatedHours || isAssignee) && (
                  <BrandTaskEtaInline task={t} editable={!!isAssignee} onSaved={refresh} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Inline ETA editor row used inside BrandTasksSection — slim mirror of
// MyTasksCard's TaskEtaRow, but only one place so it doesn't have to
// be exported (keeps the WorkspacePage file self-contained).
function BrandTaskEtaInline({ task, editable, onSaved }: {
  task: { _id: string; estimatedHours?: number | null; estimatedCompletionAt?: string | null };
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(task.estimatedCompletionAt ? task.estimatedCompletionAt.slice(0, 10) : '');
  const [hours, setHours] = useState(task.estimatedHours != null ? String(task.estimatedHours) : '');
  const [saving, setSaving] = useState(false);

  const hasEta = !!task.estimatedCompletionAt || (task.estimatedHours != null);
  if (!hasEta && !editable) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateTask(task._id, {
        estimatedCompletionAt: date ? new Date(date).toISOString() : null,
        estimatedHours: hours ? Math.max(0, Number(hours)) : null,
      });
      setEditing(false);
      onSaved();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="ml-5 mt-1 flex items-center gap-1.5 text-[10.5px]">
        <Clock className="h-3 w-3 text-violet-600" />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-1.5 h-6 rounded border border-input bg-background text-[10.5px] focus:ring-1 focus:ring-violet-500" />
        <input type="number" min={0} step={0.5} value={hours} onChange={e => setHours(e.target.value)} placeholder="hrs"
          className="px-1.5 h-6 w-14 rounded border border-input bg-background text-[10.5px] tabular-nums focus:ring-1 focus:ring-violet-500" />
        <button type="button" onClick={save} disabled={saving}
          className="h-6 px-1.5 rounded bg-violet-600 text-white text-[10px] font-semibold disabled:opacity-50 hover:bg-violet-700">Save</button>
        <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground">Cancel</button>
      </div>
    );
  }
  if (!hasEta) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="ml-5 mt-0.5 text-[10.5px] text-muted-foreground hover:text-violet-700 inline-flex items-center gap-1">
        <Clock className="h-3 w-3" /> Add ETA
      </button>
    );
  }
  return (
    <div className="ml-5 mt-0.5 flex items-center gap-1.5 text-[10.5px] text-foreground/80">
      <Clock className="h-3 w-3 text-violet-600" />
      {task.estimatedCompletionAt && <span>{`by ${new Date(task.estimatedCompletionAt).toLocaleDateString()}`}</span>}
      {task.estimatedHours != null && <span>· {task.estimatedHours}h</span>}
      {editable && <button type="button" onClick={() => setEditing(true)} className="text-violet-700 hover:underline">edit</button>}
    </div>
  );
}

// Helper to avoid TS6133 on the unused svcTypeToStageKey export when
// downstream callers don't need it. (Kept for symmetry with
// stageKeyToSvcType used above.)
void svcTypeToStageKey;
