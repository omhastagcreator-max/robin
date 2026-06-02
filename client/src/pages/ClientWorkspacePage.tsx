import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, AlertTriangle, Clock, User as UserIcon,
  Rocket, Calendar, Sparkles, ChevronDown, ChevronUp, CheckCircle2,
  Loader2, RotateCcw, ShieldX, Unlock, Plane, MessageSquare, Send,
  Activity as ActivityIcon, Flag, Building2,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { ActivityTimeline } from '@/components/panels/ProjectDetailPanel';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * ClientWorkspacePage — the "project command center" rebuild.
 *
 * Replaces the legacy ClientWorkflowDetailPage with an enterprise SaaS
 * layout inspired by Salesforce Lightning / Odoo / HubSpot. Owner spec
 * (May 2026):
 *
 *   "The page should answer 'what is happening with this project right
 *   now' — not 'what tasks exist'."
 *
 * Anatomy (top → bottom):
 *
 *   1. BACK + HERO band
 *      ↳ Large client name, contact strip, project dates on the left.
 *      ↳ Health card on the right — % score, on-track / at-risk
 *        badge, current department owner, current active stage as a
 *        big chip.
 *
 *   2. COMMAND BAR
 *      ↳ A single horizontal band that's impossible to miss. Carries
 *        the current blocker, waiting-since, responsible person, next
 *        milestone, and due date. Tinted amber/rose when there IS a
 *        blocker; neutral green when there isn't.
 *
 *   3. PROJECT JOURNEY (horizontal timeline)
 *      ↳ Discovery → Development → Video → Meta Ads → Launch → Scaling.
 *        Completed stages green, current stage glowing, future gray,
 *        blocked rose. One-glance "where are we".
 *
 *   4. SERVICE TRACKER (3 cards)
 *      ↳ Development / Video / Meta Ads. Each shows progress %, owner
 *        (with leave indicator), status, current action, blockers,
 *        ETA. NOT giant checklists — the spec was explicit on that.
 *
 *   5. LATEST UPDATE card (big)
 *      ↳ The most recent team note, with actor + time-ago.
 *
 *   6. AI PROJECT ANALYSIS
 *      ↳ Pulls from /api/ai/summarize-workflow. Health %, risk level,
 *        bottleneck, predicted launch, one-line recommendation.
 *
 *   7. TASKS (collapsed by default)
 *      ↳ "Open (5) · Completed (12)" chips that expand into the
 *        checklist when clicked. Hidden by default per spec.
 *
 *   STICKY RIGHT SIDEBAR
 *      ↳ Project health · Team · Upcoming milestones · Recent activity.
 *
 * Data: reuses cwGetWorkflow / cwBlock / cwUnblock / cwAddNote /
 * cwListActivity / aiSummarizeWorkflow / onLeaveToday. No new backend
 * needed; some computed fields (Discovery stage, Scaling stage,
 * predictedLaunch) are derived client-side from the existing shape.
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
  health?: 'on_track' | 'at_risk' | 'blocked' | 'done' | string;
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

interface UserLite { _id: string; name?: string; email?: string; avatarUrl?: string }

// ── Stage definitions (project journey) ────────────────────────────
const JOURNEY = [
  { key: 'discovery', label: 'Discovery' },
  { key: 'dev',       label: 'Development' },
  { key: 'video',     label: 'Video' },
  { key: 'meta',      label: 'Meta ads' },
  { key: 'launch',    label: 'Launch' },
  { key: 'scaling',   label: 'Scaling' },
] as const;
type StageKey = typeof JOURNEY[number]['key'];

// Compute each journey stage's state from the workflow's services.
// Discovery = done once any service is past pending.
// Launch    = done once every service is done.
// Scaling   = in_progress once meta_ads is done (and we're post-launch).
type StageState = 'future' | 'current' | 'completed' | 'blocked';
function computeJourneyStates(wf: Workflow): Record<StageKey, StageState> {
  const shopify    = wf.services.find(s => s.serviceType === 'shopify');
  const meta       = wf.services.find(s => s.serviceType === 'meta_ads');
  const influencer = wf.services.find(s => s.serviceType === 'influencer');
  const allDone    = wf.services.length > 0 && wf.services.every(s => s.status === 'done');
  const anyStarted = wf.services.some(s => s.status !== 'pending');

  const states: Record<StageKey, StageState> = {
    discovery: anyStarted ? 'completed' : 'current',
    dev:       'future',
    video:     'future',
    meta:      'future',
    launch:    'future',
    scaling:   'future',
  };
  const mark = (key: StageKey, svc?: Service) => {
    if (!svc)                          return;
    if (svc.status === 'done')         states[key] = 'completed';
    else if (svc.status === 'blocked') states[key] = 'blocked';
    else if (svc.status === 'in_progress') states[key] = 'current';
  };
  mark('dev',   shopify);
  mark('video', influencer);
  mark('meta',  meta);

  if (allDone) {
    states.launch  = 'current';
    states.scaling = 'future';
  } else if (meta?.status === 'done') {
    states.launch  = 'completed';
    states.scaling = 'current';
  }
  return states;
}

// Headline status for the project health card.
function healthDisplay(wf: Workflow): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; pct: number } {
  // Pct = average per-service checklist completion.
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
  if (wf.health === 'blocked') return { label: 'Blocked',  tone: 'danger',  pct };
  if (wf.health === 'at_risk') return { label: 'At risk',  tone: 'warning', pct };
  if (wf.health === 'on_track') return { label: 'On track', tone: 'success', pct };
  return { label: 'In progress', tone: 'neutral', pct };
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
export default function ClientWorkspacePage() {
  const { id }   = useParams();
  const { role } = useAuth();
  const isAdminOrSales = role === 'admin' || role === 'sales';

  const [wf,        setWf]        = useState<Workflow | null>(null);
  const [users,     setUsers]     = useState<Record<string, UserLite>>({});
  const [loading,   setLoading]   = useState(true);
  const [activityRev, setActivityRev] = useState(0);

  // Block / unblock modal state.
  const [blockOpen,   setBlockOpen]   = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);

  // AI snapshot.
  const [ai, setAi]                 = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiBusy, setAiBusy]         = useState(false);

  // Tasks expand state (collapsed by default per spec).
  const [tasksOpen, setTasksOpen]   = useState(false);

  // On-leave-today set, looked up once per page mount.
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set());

  // ── Loaders ──────────────────────────────────────────────────────
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

  // Auto-generate AI summary on first load. Owner ask: the AI take
  // should be visible without an extra click.
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
    catch { /* silent — surfaced via the panel's empty state */ }
    finally { setAiBusy(false); }
  };

  const bumpActivity = () => setActivityRev(r => r + 1);

  const handleBlock = async (payload: { blockerType: string; blockerReason: string; comment: string }) => {
    if (!id) return;
    try {
      const updated = await api.cwBlock(id, payload);
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

  const handleAddNote = async (text: string) => {
    if (!id) return;
    try {
      await (api as any).cwAddNote?.(id, { text });
      bumpActivity();
      toast.success('Note added');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add note');
    }
  };

  // ── Loading / not-found ──────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout>
        <div className="py-24 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }
  if (!wf) {
    return (
      <AppLayout>
        <div className="py-24 text-center text-sm text-muted-foreground">
          Client CRM entry not found.
        </div>
      </AppLayout>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────
  const health   = healthDisplay(wf);
  const journey  = computeJourneyStates(wf);
  const isBlocked = !!wf.blockerType;
  const currentStage = (() => {
    const order: StageKey[] = ['scaling', 'launch', 'meta', 'video', 'dev', 'discovery'];
    for (const k of order) if (journey[k] === 'current')   return k;
    for (const k of order) if (journey[k] === 'blocked')   return k;
    for (const k of order) if (journey[k] === 'completed') return k;
    return 'discovery';
  })();
  const currentStageLabel = JOURNEY.find(s => s.key === currentStage)?.label || 'Discovery';

  // Owner team — heuristic from the in-progress service.
  const ownerTeam = (() => {
    if (wf.currentOwnerTeam) return wf.currentOwnerTeam.replace(/^\w/, c => c.toUpperCase()) + ' team';
    const inProg = wf.services.find(s => s.status === 'in_progress');
    if (inProg?.serviceType === 'shopify')    return 'Development team';
    if (inProg?.serviceType === 'meta_ads')   return 'Meta ads team';
    if (inProg?.serviceType === 'influencer') return 'Video team';
    return 'Sales team';
  })();

  // Waiting-since for the blocker.
  const waitingSince = wf.blockedSince
    ? formatDistanceToNow(parseISO(wf.blockedSince), { addSuffix: false })
    : null;

  // Latest update digest.
  const lastUpdater = wf.lastUpdate?.actorId ? users[wf.lastUpdate.actorId] : undefined;

  // Open vs completed task counts (collapsed view).
  const allChecklist = wf.services.flatMap(s => (s.checklist || []).map(c => ({ ...c, serviceLabel: s.label })));
  const openTasks      = allChecklist.filter(c => !c.done);
  const completedTasks = allChecklist.filter(c => c.done);

  // Team list from per-service assignees (unique).
  const teamList = (() => {
    const seen = new Set<string>();
    const out: Array<{ userId: string; role: string }> = [];
    for (const s of wf.services) {
      if (s.assignedTo && !seen.has(s.assignedTo)) {
        seen.add(s.assignedTo);
        const roleLabel =
          s.serviceType === 'shopify'    ? 'Development' :
          s.serviceType === 'meta_ads'   ? 'Meta ads'    :
          s.serviceType === 'influencer' ? 'Video'       : 'Team';
        out.push({ userId: s.assignedTo, role: roleLabel });
      }
    }
    return out;
  })();

  return (
    <AppLayout>
      <div className="max-w-[1280px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">

        {/* ── Back link ────────────────────────────────────────────── */}
        <Link to="/clients/pipeline" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Client CRM
        </Link>

        {/* ── HERO BAND ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <Hero wf={wf} />
          <HealthCard
            health={health}
            ownerTeam={ownerTeam}
            currentStageLabel={currentStageLabel}
            isBlocked={isBlocked}
          />
        </div>

        {/* ── COMMAND BAR ──────────────────────────────────────────── */}
        <CommandBar
          wf={wf}
          users={users}
          waitingSince={waitingSince}
          isAdminOrSales={isAdminOrSales}
          onBlock={() => setBlockOpen(true)}
          onUnblock={() => setUnblockOpen(true)}
        />

        {/* ── Main grid: content + sticky sidebar ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

          <div className="space-y-6">
            <JourneyStrip states={journey} />

            <ServiceTracker
              wf={wf}
              users={users}
              onLeaveIds={onLeaveIds}
            />

            <LatestUpdateCard
              wf={wf}
              actor={lastUpdater}
              onAddNote={handleAddNote}
            />

            <AIAnalysis ai={ai} busy={aiBusy} onRegenerate={generateAI} wf={wf} />

            <TasksBlock
              open={tasksOpen}
              onToggle={() => setTasksOpen(o => !o)}
              openCount={openTasks.length}
              doneCount={completedTasks.length}
              services={wf.services}
            />
          </div>

          {/* ── Sticky right sidebar ──────────────────────────────── */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <SidebarCard title="Team" icon={UserIcon}>
              {teamList.length === 0 ? (
                <SidebarEmpty>No assignments yet.</SidebarEmpty>
              ) : teamList.map(({ userId, role }) => {
                const u = users[userId];
                const onLeave = onLeaveIds.has(userId);
                return (
                  <div key={userId} className="flex items-center gap-2.5 py-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10.5px] font-bold shrink-0">
                      {initials(u?.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold truncate flex items-center gap-1.5">
                        {u?.name || 'Unknown'}
                        {onLeave && <Plane className="h-3 w-3 text-sky-600 shrink-0" />}
                      </p>
                      <p className="text-[10.5px] text-muted-foreground">{role}</p>
                    </div>
                  </div>
                );
              })}
            </SidebarCard>

            <SidebarCard title="Upcoming milestones" icon={Calendar}>
              {wf.eta ? (
                <SidebarRow
                  left="Project ETA"
                  right={format(parseISO(wf.eta), 'd MMM')}
                  hint={wf.etaConfidence ? `${wf.etaConfidence} confidence` : undefined}
                />
              ) : <SidebarEmpty>No ETA set.</SidebarEmpty>}
              {(wf as any).nextMeetingAt && (
                <SidebarRow
                  left="Next meeting"
                  right={format(parseISO((wf as any).nextMeetingAt), 'd MMM')}
                />
              )}
            </SidebarCard>

            <SidebarCard title="Recent activity" icon={ActivityIcon}>
              <div className="-mx-3 -mb-3">
                <ActivityTimeline workflowId={wf._id} refreshKey={activityRev} />
              </div>
            </SidebarCard>
          </aside>
        </div>
      </div>

      {/* ── Block / Unblock modals ─────────────────────────────────
          CommentRequiredModal is single-field. For richer per-blocker
          metadata (waiting_client / waiting_internal / dependency /
          technical / budget), the user can still use the legacy detail
          page at /clients/pipeline/:id/legacy. Default blocker type
          here is waiting_client_input — the most common case in this
          agency's workflow. */}
      {blockOpen && (
        <CommentRequiredModal
          title="Mark project blocked"
          description="Tell the audit log WHY — e.g. 'waiting for product photos from client'."
          placeholder="What's blocking the project?"
          primaryLabel="Mark blocked"
          tone="danger"
          onSubmit={async (comment) => {
            await handleBlock({ blockerType: 'waiting_client_input', blockerReason: comment, comment });
            setBlockOpen(false);
          }}
          onClose={() => setBlockOpen(false)}
        />
      )}
      {unblockOpen && (
        <CommentRequiredModal
          title="Unblock this project?"
          description="Tell the audit log what changed — e.g. client confirmed assets received."
          placeholder="What unblocked the project?"
          primaryLabel="Unblock"
          tone="success"
          onSubmit={async (comment) => {
            await handleUnblock(comment);
            setUnblockOpen(false);
          }}
          onClose={() => setUnblockOpen(false)}
        />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero — client identity + contact + dates
// ─────────────────────────────────────────────────────────────────────
function Hero({ wf }: { wf: Workflow }) {
  const startDate = wf.createdAt ? format(parseISO(wf.createdAt), 'd MMM yyyy') : null;
  const launchDate = wf.eta ? format(parseISO(wf.eta), 'd MMM yyyy') : null;
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-[18px] font-bold shrink-0">
          {initials(wf.clientName)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-none">
            {wf.clientName || 'Unnamed client'}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[13px]">
            {wf.clientPhone && (
              <a href={`tel:${wf.clientPhone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline tabular-nums">
                <Phone className="h-3.5 w-3.5" /> {wf.clientPhone}
              </a>
            )}
            {wf.clientEmail && (
              <a href={`mailto:${wf.clientEmail}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                <Mail className="h-3.5 w-3.5" /> {wf.clientEmail}
              </a>
            )}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Brand · {wf.clientName}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12px] text-muted-foreground">
            {startDate && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> Started {startDate}
              </span>
            )}
            {launchDate && (
              <span className="inline-flex items-center gap-1.5">
                <Rocket className="h-3 w-3" /> Launch {launchDate}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HealthCard — % score + tone + owner team + active stage chip
// ─────────────────────────────────────────────────────────────────────
function HealthCard({
  health, ownerTeam, currentStageLabel, isBlocked,
}: {
  health: ReturnType<typeof healthDisplay>;
  ownerTeam: string;
  currentStageLabel: string;
  isBlocked: boolean;
}) {
  const toneRing =
    health.tone === 'success' ? 'ring-emerald-500/30' :
    health.tone === 'warning' ? 'ring-amber-500/30' :
    health.tone === 'danger'  ? 'ring-rose-500/30' : 'ring-border';
  const toneAccent =
    health.tone === 'success' ? 'text-emerald-700' :
    health.tone === 'warning' ? 'text-amber-700' :
    health.tone === 'danger'  ? 'text-rose-700' : 'text-foreground';
  const R = 38, C = 2 * Math.PI * R;
  const offset = C - (Math.max(0, Math.min(100, health.pct)) / 100) * C;

  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ring-1 ${toneRing}`}>
      <div className="flex items-center gap-4">
        <div className="relative" style={{ width: 90, height: 90 }}>
          <svg width="90" height="90" className="-rotate-90">
            <circle cx="45" cy="45" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
            <circle cx="45" cy="45" r={R} fill="none"
              stroke={
                health.tone === 'success' ? 'hsl(160 80% 32%)' :
                health.tone === 'warning' ? 'hsl(35  100% 45%)' :
                health.tone === 'danger'  ? 'hsl(0   75% 50%)' :
                                            'hsl(var(--primary))'
              }
              strokeWidth="7" strokeDasharray={C} strokeDashoffset={offset} strokeLinecap="round"
              className="transition-all duration-500" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-[18px] font-bold tabular-nums ${toneAccent}`}>
            {health.pct}%
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Project health</p>
          <p className={`text-[18px] font-bold ${toneAccent} leading-tight mt-0.5`}>{health.label}</p>
          {isBlocked && (
            <p className="text-[11px] text-rose-600 mt-1 inline-flex items-center gap-1">
              <ShieldX className="h-3 w-3" /> Blocker active
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border space-y-2.5">
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Owned by</p>
          <p className="text-[13px] font-semibold mt-0.5">{ownerTeam}</p>
        </div>
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Current active stage</p>
          <span className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-bold bg-primary/10 text-primary">
            <Flag className="h-3 w-3" /> {currentStageLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CommandBar — impossible-to-miss blocker / next-milestone strip
// ─────────────────────────────────────────────────────────────────────
function CommandBar({
  wf, users, waitingSince, isAdminOrSales, onBlock, onUnblock,
}: {
  wf: Workflow;
  users: Record<string, UserLite>;
  waitingSince: string | null;
  isAdminOrSales: boolean;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  const blocked = !!wf.blockerType;
  const ownerId = wf.services.find(s => s.assignedTo)?.assignedTo;
  const ownerName = ownerId ? users[ownerId]?.name : undefined;
  const nextAction = wf.nextAction || wf.nextBestAction;
  const dueLabel = wf.eta
    ? `Due ${format(parseISO(wf.eta), 'd MMM')}${wf.etaConfidence ? ` · ${wf.etaConfidence} confidence` : ''}`
    : 'Due date not set';

  if (!blocked) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 sm:p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-10 w-10 rounded-full bg-emerald-500/15 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-emerald-700">No active blocker</p>
            <p className="text-[14.5px] font-semibold text-foreground mt-0.5">
              {nextAction || 'Project running cleanly · no blockers reported'}
            </p>
            <p className="text-[12px] text-emerald-700/80 mt-0.5">
              {dueLabel}{ownerName && <> · Owner {ownerName}</>}
            </p>
          </div>
          {isAdminOrSales && (
            <button
              onClick={onBlock}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-[12px] font-semibold shrink-0"
            >
              <ShieldX className="h-3.5 w-3.5" /> Mark blocked
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-4 sm:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto_auto] gap-4 items-center">
        <div className="h-10 w-10 rounded-full bg-rose-500/15 text-rose-700 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-rose-700">Current blocker</p>
          <p className="text-[14.5px] font-bold text-foreground mt-0.5 truncate">
            {wf.blockerReason || wf.blockerType?.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6 col-span-full lg:col-span-1 lg:col-start-3 lg:row-start-1">
          <CommandStat icon={Clock}    label="Waiting since" value={waitingSince ? `${waitingSince}` : '—'} />
          <CommandStat icon={UserIcon} label="Owner"         value={ownerName || '—'} />
          <CommandStat icon={Flag}     label="Next"          value={nextAction || '—'} />
          <CommandStat icon={Calendar} label="Due"           value={wf.eta ? format(parseISO(wf.eta), 'EEE, d MMM') : '—'} />
        </div>
        {isAdminOrSales && (
          <button
            onClick={onUnblock}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-foreground text-background text-[12px] font-semibold shrink-0 col-span-full lg:col-auto"
          >
            <Unlock className="h-3.5 w-3.5" /> Mark unblocked
          </button>
        )}
      </div>
    </div>
  );
}
function CommandStat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground inline-flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-[12.5px] font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Journey strip — horizontal 6-stage timeline
// ─────────────────────────────────────────────────────────────────────
function JourneyStrip({ states }: { states: Record<StageKey, StageState> }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 overflow-x-auto">
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-4">
        Project journey
      </p>
      <div className="flex items-center gap-1.5 min-w-fit">
        {JOURNEY.map((stage, i) => {
          const s = states[stage.key];
          const dotCls =
            s === 'completed' ? 'bg-emerald-500 text-white'  :
            s === 'current'   ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
            s === 'blocked'   ? 'bg-rose-500 text-white'     :
                                'bg-muted text-muted-foreground';
          const labelCls =
            s === 'completed' ? 'text-emerald-700' :
            s === 'current'   ? 'text-primary font-bold' :
            s === 'blocked'   ? 'text-rose-700' :
                                'text-muted-foreground';
          const connectorCls =
            s === 'completed' ? 'bg-emerald-500/60' :
            s === 'current' || s === 'blocked' ? 'bg-muted' :
                                'bg-muted';
          return (
            <div key={stage.key} className="flex items-center gap-1.5">
              <div className="flex flex-col items-center gap-1.5 min-w-[88px]">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center text-[10.5px] font-bold ${dotCls}`}>
                  {s === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <p className={`text-[11px] text-center ${labelCls}`}>{stage.label}</p>
              </div>
              {i < JOURNEY.length - 1 && (
                <div className={`h-[2px] w-12 ${connectorCls}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Service tracker — 3 cards
// ─────────────────────────────────────────────────────────────────────
function ServiceTracker({
  wf, users, onLeaveIds,
}: {
  wf: Workflow;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
}) {
  const cards = [
    { key: 'shopify',    label: 'Development', tone: 'emerald' },
    { key: 'influencer', label: 'Video',       tone: 'amber'   },
    { key: 'meta_ads',   label: 'Meta ads',    tone: 'blue'    },
  ] as const;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {cards.map(c => {
        const svc = wf.services.find(s => s.serviceType === c.key);
        return <ServiceCard key={c.key} title={c.label} tone={c.tone} svc={svc} users={users} onLeaveIds={onLeaveIds} />;
      })}
    </div>
  );
}
function ServiceCard({
  title, tone, svc, users, onLeaveIds,
}: {
  title: string;
  tone: 'emerald' | 'amber' | 'blue';
  svc?: Service;
  users: Record<string, UserLite>;
  onLeaveIds: Set<string>;
}) {
  const stripe = tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
  const tText  = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-blue-700';
  const tBar   = tone === 'emerald' ? 'bg-emerald-500'   : tone === 'amber' ? 'bg-amber-500'   : 'bg-blue-500';
  const total = svc?.checklist?.length || 0;
  const done  = svc?.checklist?.filter(c => c.done).length || 0;
  const pct   = total === 0 ? (svc?.status === 'done' ? 100 : 0) : Math.round((done / total) * 100);
  const assignee = svc?.assignedTo ? users[svc.assignedTo] : undefined;
  const onLeave  = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
  const statusLabel =
    !svc                          ? 'Not started' :
    svc.status === 'done'         ? 'Completed'   :
    svc.status === 'blocked'      ? 'Blocked'     :
    svc.status === 'in_progress'  ? 'In progress' : 'Not started';
  const statusPill =
    !svc || svc.status === 'pending' ? 'bg-muted text-muted-foreground' :
    svc.status === 'done'            ? 'bg-emerald-500/12 text-emerald-700' :
    svc.status === 'blocked'         ? 'bg-rose-500/12 text-rose-700' :
                                       'bg-amber-500/15 text-amber-700';
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className={`h-1 ${stripe}`} />
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${tText}`}>{title}</p>
            <h3 className="text-[16px] font-bold mt-0.5 leading-tight">{svc?.label || 'Not configured'}</h3>
          </div>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusPill}`}>
            {statusLabel}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground">Progress</p>
            <p className="text-[12px] font-semibold tabular-nums">{pct}%</p>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${tBar} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          {total > 0 && (
            <p className="text-[10.5px] text-muted-foreground mt-1">{done}/{total} steps</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-1">Owner</p>
            <div className="flex items-center gap-1.5">
              <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                {initials(assignee?.name) || '·'}
              </span>
              <span className={`text-[12px] truncate ${onLeave ? 'text-sky-700 font-medium' : ''}`}>
                {assignee?.name || 'Unassigned'}
              </span>
              {onLeave && <Plane className="h-3 w-3 text-sky-600 shrink-0" />}
            </div>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-1">ETA</p>
            <p className="text-[12px]">
              {svc?.eta ? format(parseISO(svc.eta), 'd MMM') : <span className="text-muted-foreground italic">Not set</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LatestUpdateCard — prominent note + inline add
// ─────────────────────────────────────────────────────────────────────
function LatestUpdateCard({
  wf, actor, onAddNote,
}: {
  wf: Workflow;
  actor?: UserLite;
  onAddNote: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    try { await onAddNote(t); setText(''); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Latest update</p>
      </div>
      {wf.lastUpdate?.detail ? (
        <>
          <p className="text-[15px] leading-relaxed text-foreground/90">
            "{wf.lastUpdate.detail}"
          </p>
          <p className="text-[12px] text-muted-foreground mt-3">
            {actor?.name || 'Team'}{wf.lastUpdate.at && <> · {formatDistanceToNow(parseISO(wf.lastUpdate.at), { addSuffix: true })}</>}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground italic">No updates yet — be the first to add a note.</p>
      )}
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
          placeholder="Add a note — visible to the whole team on this client…"
          maxLength={600}
          className="flex-1 min-w-0 px-3 h-9 bg-background border border-input rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={send}
          disabled={busy || text.trim().length < 3}
          className="h-9 px-3 rounded-lg bg-primary text-primary-foreground flex items-center gap-1.5 disabled:opacity-50 hover:bg-primary/90 text-[12.5px] font-semibold"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AIAnalysis
// ─────────────────────────────────────────────────────────────────────
function AIAnalysis({
  ai, busy, onRegenerate, wf,
}: {
  ai: { text: string; aiUsed: boolean } | null;
  busy: boolean;
  onRegenerate: () => void;
  wf: Workflow;
}) {
  const riskLabel =
    typeof wf.riskScore === 'number'
      ? wf.riskScore > 66 ? 'High' : wf.riskScore > 33 ? 'Medium' : 'Low'
      : null;
  const predicted = wf.predictedCompletionAt
    ? format(parseISO(wf.predictedCompletionAt), 'd MMM')
    : wf.eta ? format(parseISO(wf.eta), 'd MMM') : null;
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-primary/85">AI project analysis</p>
        </div>
        <button
          onClick={onRegenerate}
          disabled={busy}
          className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Risk level" value={riskLabel || '—'} />
        <Stat label="Bottleneck" value={wf.delayCause || (wf.blockerType ? wf.blockerType.replace(/_/g, ' ') : '—')} />
        <Stat label="Predicted launch" value={predicted || '—'} />
        <Stat label="Priority" value={wf.priority || 'Medium'} />
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        {busy && !ai ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating recommendation…
          </div>
        ) : ai ? (
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{ai.text}</p>
        ) : (
          <p className="text-[12px] text-muted-foreground italic">Click Refresh to generate the AI take.</p>
        )}
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-1">{label}</p>
      <p className="text-[14px] font-semibold capitalize truncate">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TasksBlock — collapsed by default, expand to show checklist
// ─────────────────────────────────────────────────────────────────────
function TasksBlock({
  open, onToggle, openCount, doneCount, services,
}: {
  open: boolean;
  onToggle: () => void;
  openCount: number;
  doneCount: number;
  services: Service[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Tasks</p>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700">
              <span className="font-bold tabular-nums mr-1">{openCount}</span> open
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/12 text-emerald-700">
              <span className="font-bold tabular-nums mr-1">{doneCount}</span> done
            </span>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-border overflow-hidden"
          >
            <div className="p-5 space-y-4">
              {services.map(svc => (
                <div key={svc._id || svc.serviceType}>
                  <p className="text-[12px] font-semibold mb-2">{svc.label}</p>
                  {(svc.checklist || []).length === 0 ? (
                    <p className="text-[11.5px] text-muted-foreground italic">No checklist items.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {svc.checklist.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-[12.5px]">
                          <span className={`h-3.5 w-3.5 rounded-full flex items-center justify-center ${c.done ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                            {c.done && <CheckCircle2 className="h-2.5 w-2.5" />}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar atoms
// ─────────────────────────────────────────────────────────────────────
function SidebarCard({ title, icon: Icon, children }: { title: string; icon: typeof UserIcon; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}
function SidebarRow({ left, right, hint }: { left: string; right: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="text-[12.5px] truncate">{left}</p>
        {hint && <p className="text-[10.5px] text-muted-foreground">{hint}</p>}
      </div>
      <p className="text-[11.5px] text-muted-foreground tabular-nums">{right}</p>
    </div>
  );
}
function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[11.5px] text-muted-foreground text-center italic">{children}</p>;
}
