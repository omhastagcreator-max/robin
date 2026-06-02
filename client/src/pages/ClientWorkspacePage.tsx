import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, AlertTriangle, Sparkles,
  ChevronDown, ChevronUp, CheckCircle2, Loader2, RotateCcw,
  ShieldX, Unlock, Plane, ArrowRight,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { ActivityTimeline } from '@/components/panels/ProjectDetailPanel';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * ClientWorkspacePage — mission-control rebuild (May 2026, v2).
 *
 * Density-first redesign. Spec: agency owner understands the entire
 * project in 3 seconds, no scrolling, single viewport.
 *
 * Layout (top → bottom, all visible above the fold on 1440×900):
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ HEADER ROW — 1 line: avatar, name, contact, stage, health,    │
 *   │              owner, launch, next action                        │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ STATUS BAR — 1 line: blocker, owner, waiting, next, risk,     │
 *   │              estimated delay                                   │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ JOURNEY STRIP — compact horizontal: 6 stages, current dominant │
 *   ├───────────────────────────────────┬───────────────────────────┤
 *   │ SERVICES TABLE                     │ SIDEBAR                    │
 *   │  Dev | Active | Rishi | 100% | …  │   Team                     │
 *   │  Vid | Wait   | Priya | 45%  | …  │   Milestones               │
 *   │  Met | Block. | Om    | 10%  | …  │   Client pending           │
 *   │                                    │                            │
 *   │ LATEST UPDATES — 5-line feed       │                            │
 *   │ AI INSIGHTS — 4 lines              │                            │
 *   │ TASKS — counter (collapsed)        │                            │
 *   └───────────────────────────────────┴───────────────────────────┘
 *
 * Visual rules:
 *   - One bordered container — internal sections separated by 1-px
 *     dividers, not stacked rounded cards. Saves ~80 px of vertical
 *     gutters and reads as a single "command center" surface.
 *   - Padding is 12–16 px throughout (was 20–32). Section headers are
 *     10.5-px uppercase muted text, inline with content.
 *   - Tables, not cards, for the services. Enterprise-density rows.
 *   - Activity feed is one-line bullets, max 5.
 *   - AI is 4 lines max. No paragraph wall.
 *   - Sidebar is ~280 px wide (was 320), 3 stacked sections only.
 *
 * Reuses the data hooks unchanged from v1.
 */

// ── Local Workflow shape (matches the server payload) ──────────────
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

// ── Journey stages ──────────────────────────────────────────────────
const JOURNEY = [
  { key: 'discovery', label: 'Discovery' },
  { key: 'dev',       label: 'Development' },
  { key: 'video',     label: 'Video' },
  { key: 'meta',      label: 'Meta ads' },
  { key: 'launch',    label: 'Launch' },
  { key: 'scaling',   label: 'Scaling' },
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

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export default function ClientWorkspacePage() {
  const { id }   = useParams();
  const { role } = useAuth();
  const isAdminOrSales = role === 'admin' || role === 'sales';

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
      })
      .catch(() => {});
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

  if (loading) {
    return <AppLayout><div className="py-24 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppLayout>;
  }
  if (!wf) {
    return <AppLayout><div className="py-24 text-center text-sm text-muted-foreground">Client CRM entry not found.</div></AppLayout>;
  }

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

  const ownerId   = wf.services.find(s => s.assignedTo)?.assignedTo;
  const ownerName = ownerId ? users[ownerId]?.name : undefined;
  const onLeaveOwner = !!(ownerId && onLeaveIds.has(ownerId));
  const isBlocked = !!wf.blockerType;
  const nextAction = wf.nextAction || wf.nextBestAction;
  const launchLabel = wf.eta ? format(parseISO(wf.eta), 'd MMM') : null;

  // Estimated delay: if past ETA or blockedSince > 0, surface the gap.
  const estimatedDelay = (() => {
    if (wf.blockedSince) {
      try {
        const days = Math.max(1, Math.round((Date.now() - parseISO(wf.blockedSince).getTime()) / 86400000));
        return `${days}d`;
      } catch { return null; }
    }
    if (wf.predictedCompletionAt && wf.eta) {
      try {
        const gap = Math.round((parseISO(wf.predictedCompletionAt).getTime() - parseISO(wf.eta).getTime()) / 86400000);
        if (gap > 0) return `+${gap}d`;
      } catch { /* ignore */ }
    }
    return null;
  })();
  const waitingSince = wf.blockedSince
    ? formatDistanceToNow(parseISO(wf.blockedSince), { addSuffix: false })
    : null;

  // Task counts.
  const allChecklist = wf.services.flatMap(s => s.checklist || []);
  const openCount = allChecklist.filter(c => !c.done).length;
  const doneCount = allChecklist.filter(c => c.done).length;

  // Team list (unique assignees).
  const teamSeen = new Set<string>();
  const team: Array<{ userId: string; role: string }> = [];
  for (const s of wf.services) {
    if (s.assignedTo && !teamSeen.has(s.assignedTo)) {
      teamSeen.add(s.assignedTo);
      team.push({
        userId: s.assignedTo,
        role:
          s.serviceType === 'shopify'    ? 'Development' :
          s.serviceType === 'meta_ads'   ? 'Meta ads'    :
          s.serviceType === 'influencer' ? 'Video'       : 'Team',
      });
    }
  }

  return (
    <AppLayout>
      <div className="max-w-[1400px] mx-auto p-3 sm:p-4 lg:p-5">

        <Link to="/clients/pipeline" className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-3 w-3" /> Back to Client CRM
        </Link>

        {/* ── ONE BORDERED CONTAINER — all sections in flow ───────── */}
        <div className="rounded-xl border border-border bg-card">

          {/* HEADER ROW ──────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b border-border grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto] gap-x-5 gap-y-1.5 items-center">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[12px] font-bold shrink-0">
                {initials(wf.clientName)}
              </div>
              <div className="min-w-0">
                <h1 className="text-[17px] font-bold tracking-tight leading-none truncate">{wf.clientName}</h1>
                <div className="flex items-center gap-2.5 text-[10.5px] text-muted-foreground mt-0.5">
                  {wf.clientPhone && <a href={`tel:${wf.clientPhone}`} className="hover:text-primary tabular-nums inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{wf.clientPhone}</a>}
                  {wf.clientEmail && <a href={`mailto:${wf.clientEmail}`} className="hover:text-foreground inline-flex items-center gap-1"><Mail className="h-2.5 w-2.5" />{wf.clientEmail}</a>}
                </div>
              </div>
            </div>
            <div /> {/* spacer */}
            <HeaderField label="Stage" value={currentStageLabel} accent="primary" />
            <HeaderField label="Health" value={`${health.pct}% ${health.label}`} accent={health.tone} />
            <HeaderField label="Owner" value={ownerName || '—'} extra={onLeaveOwner ? <Plane className="h-2.5 w-2.5 text-sky-600 inline -mt-0.5 ml-1" /> : null} />
            <HeaderField label="Launch" value={launchLabel || 'TBD'} />
            <HeaderField label="Next" value={nextAction || '—'} className="max-w-[180px]" />
          </div>

          {/* STATUS BAR ─────────────────────────────────────────── */}
          <StatusStrip
            blocked={isBlocked}
            blockerReason={wf.blockerReason || (wf.blockerType ? wf.blockerType.replace(/_/g, ' ') : null)}
            ownerName={ownerName}
            waitingSince={waitingSince}
            nextAction={nextAction}
            riskLabel={wf.riskScore != null ? (wf.riskScore > 66 ? 'High' : wf.riskScore > 33 ? 'Medium' : 'Low') : (health.tone === 'warning' ? 'Medium' : health.tone === 'danger' ? 'High' : 'Low')}
            estimatedDelay={estimatedDelay}
            isAdminOrSales={isAdminOrSales}
            onBlock={() => setBlockOpen(true)}
            onUnblock={() => setUnblockOpen(true)}
          />

          {/* JOURNEY STRIP ──────────────────────────────────────── */}
          <JourneyStrip states={journey} currentKey={currentStageKey} />

          {/* MAIN GRID: SERVICES + ACTIVITY (left)  /  SIDEBAR (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">

            <div className="lg:border-r border-border">
              {/* SERVICES TABLE */}
              <SectionHeader>Services</SectionHeader>
              <ServicesTable wf={wf} users={users} onLeaveIds={onLeaveIds} />

              {/* LATEST UPDATES (compact feed) */}
              <SectionHeader>Latest updates</SectionHeader>
              <RecentFeed workflowId={wf._id} refreshKey={activityRev} />

              {/* AI INSIGHTS — 4 lines */}
              <SectionHeader rightSlot={
                <button onClick={generateAI} disabled={aiBusy} className="text-[10.5px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                  <RotateCcw className={`h-2.5 w-2.5 ${aiBusy ? 'animate-spin' : ''}`} /> Refresh
                </button>
              }>AI insights</SectionHeader>
              <AILines wf={wf} ai={ai} busy={aiBusy} health={health} />

              {/* TASKS — collapsed */}
              <TasksRow
                open={tasksOpen}
                onToggle={() => setTasksOpen(o => !o)}
                openCount={openCount}
                doneCount={doneCount}
                services={wf.services}
              />
            </div>

            {/* SIDEBAR ──────────────────────────────────────────── */}
            <aside className="divide-y divide-border">
              <SidebarBlock title="Team">
                {team.length === 0 ? <Empty>No assignments yet.</Empty> : team.map(({ userId, role }) => {
                  const u = users[userId];
                  const onLeave = onLeaveIds.has(userId);
                  return (
                    <div key={userId} className="flex items-center gap-2 py-1">
                      <div className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold shrink-0">
                        {initials(u?.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-semibold truncate inline-flex items-center gap-1">
                          {u?.name || 'Unknown'}
                          {onLeave && <Plane className="h-2.5 w-2.5 text-sky-600" />}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{role}</span>
                    </div>
                  );
                })}
              </SidebarBlock>

              <SidebarBlock title="Upcoming milestones">
                {wf.eta ? (
                  <Row left="Project launch" right={format(parseISO(wf.eta), 'd MMM')} />
                ) : null}
                {(wf as any).nextMeetingAt && (
                  <Row left="Next meeting" right={format(parseISO((wf as any).nextMeetingAt), 'd MMM')} />
                )}
                {!wf.eta && !(wf as any).nextMeetingAt && <Empty>No milestones set.</Empty>}
              </SidebarBlock>

              <SidebarBlock title="Client pending">
                {wf.blockerType === 'waiting_client_input' && wf.blockerReason ? (
                  <Row left={wf.blockerReason} right={waitingSince || ''} />
                ) : (
                  <Empty>Nothing waiting on the client.</Empty>
                )}
              </SidebarBlock>
            </aside>
          </div>
        </div>
      </div>

      {/* Modals */}
      {blockOpen && (
        <CommentRequiredModal
          title="Mark project blocked"
          description="Why is the project blocked? Shown to admin in the audit log."
          placeholder="e.g. waiting for product photos from client"
          primaryLabel="Mark blocked"
          tone="danger"
          onSubmit={async (comment) => { await handleBlock(comment); setBlockOpen(false); }}
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
          onSubmit={async (comment) => { await handleUnblock(comment); setUnblockOpen(false); }}
          onClose={() => setUnblockOpen(false)}
        />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small density atoms — colocated, single file
// ─────────────────────────────────────────────────────────────────────
function HeaderField({
  label, value, extra, accent, className,
}: {
  label: string;
  value: string;
  extra?: React.ReactNode;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}) {
  const valueCls =
    accent === 'success' ? 'text-emerald-700' :
    accent === 'warning' ? 'text-amber-700'   :
    accent === 'danger'  ? 'text-rose-700'    :
    accent === 'primary' ? 'text-primary'     : 'text-foreground';
  return (
    <div className={`min-w-0 ${className || ''}`}>
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</p>
      <p className={`text-[12.5px] font-semibold leading-tight mt-0.5 truncate ${valueCls}`}>{value}{extra}</p>
    </div>
  );
}

function StatusStrip({
  blocked, blockerReason, ownerName, waitingSince, nextAction,
  riskLabel, estimatedDelay, isAdminOrSales, onBlock, onUnblock,
}: {
  blocked: boolean;
  blockerReason: string | null;
  ownerName?: string;
  waitingSince: string | null;
  nextAction?: string;
  riskLabel: string;
  estimatedDelay: string | null;
  isAdminOrSales: boolean;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  if (!blocked) {
    return (
      <div className="px-4 py-2.5 border-b border-border bg-emerald-500/[0.04] flex items-center gap-5 flex-wrap text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> No blocker
        </span>
        <StripField label="Owner" value={ownerName || '—'} />
        <StripField label="Next"  value={nextAction || '—'} />
        <StripField label="Risk"  value={riskLabel} />
        {isAdminOrSales && (
          <button onClick={onBlock} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted text-[11px] font-semibold">
            <ShieldX className="h-3 w-3" /> Mark blocked
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="px-4 py-2.5 border-b border-border bg-rose-500/[0.05] flex items-center gap-5 flex-wrap text-[12px]">
      <span className="inline-flex items-center gap-1.5 font-bold text-rose-700 shrink-0">
        <AlertTriangle className="h-3.5 w-3.5" /> BLOCKER
      </span>
      <span className="font-semibold truncate min-w-0 max-w-[280px]" title={blockerReason || ''}>
        {blockerReason || '—'}
      </span>
      <StripField label="Owner"   value={ownerName || '—'} />
      <StripField label="Waiting" value={waitingSince || '—'} />
      <StripField label="Next"    value={nextAction || '—'} />
      <StripField label="Risk"    value={riskLabel} accent="warning" />
      <StripField label="Delay"   value={estimatedDelay || '—'} accent="danger" />
      {isAdminOrSales && (
        <button onClick={onUnblock} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-semibold">
          <Unlock className="h-3 w-3" /> Unblock
        </button>
      )}
    </div>
  );
}
function StripField({ label, value, accent }: { label: string; value: string; accent?: 'warning' | 'danger' }) {
  const cls = accent === 'warning' ? 'text-amber-700' : accent === 'danger' ? 'text-rose-700' : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold ${cls}`}>{value}</span>
    </span>
  );
}

function JourneyStrip({ states, currentKey }: { states: Record<StageKey, StageState>; currentKey: StageKey }) {
  return (
    <div className="px-4 py-2.5 border-b border-border flex items-center gap-1 overflow-x-auto">
      {JOURNEY.map((stage, i) => {
        const s = states[stage.key];
        const isCurrent = stage.key === currentKey;
        const dotCls =
          s === 'completed' ? 'bg-emerald-500 text-white border-emerald-500' :
          s === 'current'   ? 'bg-primary text-primary-foreground border-primary' :
          s === 'blocked'   ? 'bg-rose-500 text-white border-rose-500' :
                              'bg-card text-muted-foreground border-border';
        const textCls =
          isCurrent ? 'text-foreground font-bold' :
          s === 'completed' ? 'text-foreground/80' :
          s === 'blocked'   ? 'text-rose-700 font-semibold' :
                              'text-muted-foreground';
        return (
          <div key={stage.key} className="flex items-center gap-1 shrink-0">
            <span className={`h-4 w-4 rounded-full border flex items-center justify-center text-[8px] font-bold ${dotCls}`}>
              {s === 'completed' ? <CheckCircle2 className="h-2.5 w-2.5" /> : (s === 'current' ? '●' : i + 1)}
            </span>
            <span className={`text-[11px] ${textCls} ${isCurrent ? 'mr-1' : ''}`}>{stage.label}</span>
            {i < JOURNEY.length - 1 && <span className="h-px w-3 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ children, rightSlot }: { children: React.ReactNode; rightSlot?: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{children}</p>
      {rightSlot}
    </div>
  );
}

function ServicesTable({
  wf, users, onLeaveIds,
}: {
  wf: Workflow;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
}) {
  const rows = [
    { key: 'shopify',    label: 'Development' },
    { key: 'influencer', label: 'Video'       },
    { key: 'meta_ads',   label: 'Meta ads'    },
  ];
  return (
    <table className="w-full border-b border-border text-[12px]">
      <thead>
        <tr className="border-b border-border bg-muted/10 text-muted-foreground">
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-4 py-1.5">Service</th>
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-3 py-1.5">Status</th>
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-3 py-1.5">Owner</th>
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-3 py-1.5 w-[140px]">Progress</th>
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-3 py-1.5">Blocker</th>
          <th className="text-left font-semibold uppercase text-[9.5px] tracking-wider px-3 py-1.5">Next</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const svc = wf.services.find(s => s.serviceType === r.key);
          const total = svc?.checklist?.length || 0;
          const done  = svc?.checklist?.filter(c => c.done).length || 0;
          const pct = total === 0 ? (svc?.status === 'done' ? 100 : 0) : Math.round((done / total) * 100);
          const assignee = svc?.assignedTo ? users[svc.assignedTo] : undefined;
          const onLeave = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
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
          const dot =
            !svc || svc.status === 'pending' ? 'bg-muted-foreground/40' :
            svc.status === 'done'            ? 'bg-emerald-500' :
            svc.status === 'blocked'         ? 'bg-rose-500' :
                                               'bg-amber-500';
          const tone =
            !svc                       ? 'bg-muted' :
            svc.status === 'done'      ? 'bg-emerald-500' :
            svc.status === 'blocked'   ? 'bg-rose-500' :
                                         'bg-amber-500';
          return (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2 font-semibold">{r.label}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 ${statusCls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {statusLabel}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  {assignee?.name || <span className="text-muted-foreground italic">Unassigned</span>}
                  {onLeave && <Plane className="h-2.5 w-2.5 text-sky-600" />}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-1 bg-muted rounded-full overflow-hidden flex-1 max-w-[80px]">
                    <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
                </div>
              </td>
              <td className="px-3 py-2 text-rose-700 truncate max-w-[140px]">
                {svc?.status === 'blocked' ? (wf.blockerReason || 'Yes') : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-3 py-2 truncate max-w-[180px]" title={wf.nextAction || ''}>
                {(svc?.status !== 'done' && (wf.nextAction || wf.nextBestAction)) ? (wf.nextAction || wf.nextBestAction) : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Compact 5-line activity feed. Wraps ActivityTimeline visually but the
// underlying component already paginates; we cap CSS height so only ~5
// rows show without the user opening the full drawer.
function RecentFeed({ workflowId, refreshKey }: { workflowId: string; refreshKey: number }) {
  return (
    <div className="px-2 py-1 max-h-[200px] overflow-hidden border-b border-border">
      <ActivityTimeline workflowId={workflowId} refreshKey={refreshKey} />
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
    <div className="px-4 py-2.5 border-b border-border text-[12px] space-y-1">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-primary" />
        <span className="text-muted-foreground">Risk</span>
        <span className="font-semibold">{risk}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">Launch confidence</span>
        <span className="font-semibold tabular-nums">{confidence}%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Bottleneck</span>
        <span className="font-semibold capitalize">{bottleneck}</span>
      </div>
      <div className="flex items-start gap-1.5">
        <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
        {busy && !ai ? (
          <span className="text-muted-foreground italic">Generating recommendation…</span>
        ) : ai?.text ? (
          <span className="line-clamp-2">{ai.text}</span>
        ) : (
          <span className="text-muted-foreground italic">No recommendation yet.</span>
        )}
      </div>
    </div>
  );
}

function TasksRow({
  open, onToggle, openCount, doneCount, services,
}: {
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
        className="w-full px-4 py-2 flex items-center justify-between gap-2 hover:bg-muted/30 text-left text-[12px]"
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[11.5px]">
      <span className="truncate min-w-0">{left}</span>
      <span className="text-muted-foreground shrink-0">{right}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[11px] text-muted-foreground italic">{children}</p>;
}

// Re-export so the route lazy-loader gets a stable identity.
