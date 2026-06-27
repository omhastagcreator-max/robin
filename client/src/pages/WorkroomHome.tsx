import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  Activity, AlertTriangle, AlertCircle, Calendar, CheckSquare, ChevronRight,
  Clock, Flame, ListChecks, Sparkles, Target as TargetIcon, TrendingUp, Users,
  CheckCircle2, ShieldCheck, MessageCircleQuestion, Send, Wand2,
} from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useHuddle } from '@/contexts/HuddleContext';
import { useNetworkAware } from '@/hooks/useNetworkAware';
import { PendingAcceptanceBanner } from '@/components/workroom/PendingAcceptanceBanner';
import { DayPlanTable } from '@/components/workroom/DayPlanTable';
import * as api from '@/api';

/**
 * WorkroomHome — the premium agency Operating System landing.
 *
 * Three-layer architecture (per June 2026 redesign spec):
 *
 *   Layer 1 — Executive Command Bar (sticky top)
 *     8 KPI tiles: Agency Health, Active Brands, At-Risk, Tasks Due Today,
 *     Overdue, Meetings Today, Team Utilisation, Revenue at risk.
 *
 *   Layer 2 — AI Priority Center
 *     6 AI-ranked buckets: Critical, Delayed, Upcoming Deadlines,
 *     Approvals, Client Follow-ups, Today's Priorities. Each row has a
 *     deep-link.
 *
 *   Layer 3 — Project + Execution + Team
 *     - ProjectCommandCenter — full-width brand cards with 7-stage
 *       timeline, team avatars, next action, completion, health.
 *     - MyExecutionBoard — 5-column kanban: Today / Week / Blocked /
 *       Waiting / Overdue.
 *     - TeamWorkloadHeatmap — utilisation bars per teammate.
 *
 *   Right rail — Persistent AI Copilot (replaces unused whitespace).
 *
 * All data comes from ONE endpoint (/api/workroom/snapshot) so the
 * page paints in <500ms.
 */

interface Brand {
  id: string;
  name: string;
  priority: string;
  healthLevel: 'green' | 'yellow' | 'orange' | 'red';
  healthScore: number;
  healthFactors: string[];
  currentStage: string;
  completionPct: number;
  eta: string | null;
  owner?: { userId: string; name: string; avatarUrl?: string };
  team: Array<{ userId: string; name: string; avatarUrl?: string }>;
  pendingTaskCount: number;
  upcomingMeeting?: { title: string; at: string };
  nextAction: string;
  lastUpdate?: { at: string; detail: string; actorName?: string };
  stages: Array<{ key: string; label: string; status: 'done' | 'active' | 'upcoming' }>;
}
interface ExecRow {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  brand: string;
  brandId: string;
  owner: string;
  dependsOnCount: number;
  hasReviewer: boolean;
  hasApprover: boolean;
}
interface Snap {
  kpis: {
    agencyHealthScore: number;
    activeBrands: number;
    atRiskBrands: number;
    tasksDueToday: number;
    overdueTasks: number;
    meetingsToday: number;
    teamUtilisationPct: number;
    revenueAtRiskBrands: number;
  };
  priorityCenter: Array<{ bucket: string; id: string; title: string; meta?: string; link?: string }>;
  brandCards: Brand[];
  executionBoard: { today: ExecRow[]; week: ExecRow[]; blocked: ExecRow[]; waiting: ExecRow[]; overdue: ExecRow[] };
  teamWorkload: Array<{ userId: string; name: string; avatarUrl?: string; role: string; workloadPct: number; overdue: number; flag: string | null }>;
  generatedAt: string;
}

export default function WorkroomHome() {
  const { user } = useAuth();
  const huddle = useHuddle();
  const [snap, setSnap]       = useState<Snap | null>(null);
  const [loading, setLoading] = useState(true);

  // Network-aware polling: multiplier 1 on good connections, 2 on 3G,
  // 4 on 2G/slow-2G, Infinity when offline (which makes setInterval
  // a no-op below). Polls automatically slow down on bad connections
  // to save bandwidth + speed up the browser; speed up the moment
  // connectivity improves.
  const network = useNetworkAware();
  useEffect(() => {
    const load = () => {
      // Don't fire while offline — no point, will resume on 'online'.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      api.getWorkroomSnapshot().then(setSnap).catch(() => {}).finally(() => setLoading(false));
    };
    load();
    // Base 30s × network multiplier. Clamped to Number.MAX_SAFE_INTEGER
    // when offline so setInterval doesn't reject the Infinity.
    const baseMs = 30_000;
    const ms = Number.isFinite(network.intervalMultiplier) ? baseMs * network.intervalMultiplier : 86_400_000;
    const iv = setInterval(load, ms);

    // Real-time refresh: server emits 'data:changed' on every mutation
    // (checklist tick, service complete, task create/update/accept,
    // workflow create). AppLayout's socket listener re-dispatches it
    // as 'robin:data-changed' on window so any page can pick it up
    // without owning its own socket subscription. Debounced to avoid
    // hammering the API when several mutations land at once.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(load, 800);
    };
    window.addEventListener('robin:data-changed', onDataChanged);

    return () => {
      clearInterval(iv);
      window.removeEventListener('robin:data-changed', onDataChanged);
      if (debounce) clearTimeout(debounce);
    };
  // Re-create the interval when the network multiplier changes (e.g.
  // 4G → 2G → 4G) so the polling cadence retunes itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network.intervalMultiplier]);

  const firstName = (user?.name || user?.email || '').split(' ')[0] || 'there';

  return (
    <AppLayout>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8">
        {/* Page chrome — full-bleed dark band reminds you you're in the
            agency OS, not a generic page. */}
        <div className="bg-gradient-to-br from-background via-background to-muted/30 min-h-[calc(100vh-4rem)]">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 p-4 sm:p-5 lg:p-6">

            {/* ── MAIN COLUMN ────────────────────────────────────────── */}
            <div className="space-y-4 min-w-0">
              <Greeting firstName={firstName} onJoinHuddle={() => { try { huddle.join(); } catch { /* */ } }} />

              {/* Pending-acceptance banner — auto-hides when empty. Top
                  of the page so cross-team handoffs aren't missed. */}
              <PendingAcceptanceBanner />

              {/* Weekly day-plan table — admin-curated round-robin
                  schedule. Pinned at the very top of the working area
                  (above the dashboard widgets and the huddle area
                  further down the page) so it's the first thing each
                  employee sees when they sit down. Auto-hides when no
                  plan has been set for the current week. */}
              <DayPlanTable />

              {loading && !snap ? (
                <SkeletonBlock />
              ) : !snap ? (
                <p className="py-20 text-center text-[13px] text-muted-foreground">
                  Couldn't load your workroom. Refresh.
                </p>
              ) : (
                <>
                  <ExecutiveCommandBar k={snap.kpis} />
                  <AiPriorityCenter rows={snap.priorityCenter} />
                  <ProjectCommandCenter brands={snap.brandCards} />
                  <MyExecutionBoard board={snap.executionBoard} />
                  <TeamWorkloadHeatmap rows={snap.teamWorkload} />
                </>
              )}
            </div>

            {/* ── AI COPILOT SIDEBAR ─────────────────────────────────── */}
            <aside className="hidden xl:block">
              <div className="sticky top-4 max-h-[calc(100vh-2rem)]">
                <PersistentCopilot />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Greeting ────────────────────────────────────────────────────────
function Greeting({ firstName, onJoinHuddle }: { firstName: string; onJoinHuddle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground">Robin · Agency OS</p>
        <h1 className="text-[24px] sm:text-[28px] font-black tracking-tight leading-tight">
          Welcome back, {firstName}.
        </h1>
        <p className="text-[12px] text-muted-foreground">Here's exactly what needs your attention.</p>
      </div>
      <button
        onClick={onJoinHuddle}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold transition-colors"
        title="Join the agency-wide voice channel"
      >
        <Wand2 className="h-3 w-3" /> Join huddle
      </button>
    </div>
  );
}

function SkeletonBlock() {
  return <div className="rounded-xl border border-border bg-card animate-pulse h-32" />;
}

// ─── Section 1: Executive Command Bar ────────────────────────────────
function ExecutiveCommandBar({ k }: { k: Snap['kpis'] }) {
  const health = k.agencyHealthScore;
  const healthTone =
    health >= 90 ? { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Healthy' } :
    health >= 70 ? { dot: 'bg-amber-500',   text: 'text-amber-700',   label: 'Attention' } :
    health >= 40 ? { dot: 'bg-orange-500',  text: 'text-orange-700',  label: 'At risk' } :
                   { dot: 'bg-rose-500',    text: 'text-rose-700',    label: 'Critical' };
  return (
    <div className="sticky top-2 z-20">
      <div className="rounded-2xl bg-card/95 backdrop-blur border border-border shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
          <KpiCell
            icon={<ShieldCheck className={`h-3.5 w-3.5 ${healthTone.text}`} />}
            label="Agency health"
            value={`${health}`}
            valueClass={healthTone.text}
            sub={healthTone.label}
            big
          />
          <KpiCell icon={<Activity   className="h-3 w-3 text-blue-600" />}    label="Active brands"   value={`${k.activeBrands}`} />
          <KpiCell icon={<AlertTriangle className="h-3 w-3 text-amber-600" />} label="At risk"        value={`${k.atRiskBrands}`} valueClass={k.atRiskBrands > 0 ? 'text-amber-700' : ''} />
          <KpiCell icon={<Flame      className="h-3 w-3 text-violet-600" />}  label="Due today"      value={`${k.tasksDueToday}`} valueClass={k.tasksDueToday > 0 ? 'text-violet-700' : ''} />
          <KpiCell icon={<AlertCircle className="h-3 w-3 text-rose-600" />}   label="Overdue"        value={`${k.overdueTasks}`} valueClass={k.overdueTasks > 0 ? 'text-rose-700' : 'text-emerald-700'} />
          <KpiCell icon={<Calendar   className="h-3 w-3 text-blue-600" />}    label="Meetings today" value={`${k.meetingsToday}`} />
          <KpiCell
            icon={<Users className="h-3 w-3 text-violet-600" />}
            label="Team cap"
            value={`${k.teamUtilisationPct}%`}
            valueClass={k.teamUtilisationPct > 90 ? 'text-rose-700' : k.teamUtilisationPct > 70 ? 'text-amber-700' : 'text-emerald-700'}
          />
          <KpiCell icon={<TrendingUp className="h-3 w-3 text-rose-600" />}    label="Revenue at risk" value={`${k.revenueAtRiskBrands}`} valueClass={k.revenueAtRiskBrands > 0 ? 'text-rose-700' : 'text-emerald-700'} />
        </div>
      </div>
    </div>
  );
}

function KpiCell({ icon, label, value, valueClass = '', sub, big }: { icon: React.ReactNode; label: string; value: string; valueClass?: string; sub?: string; big?: boolean }) {
  return (
    <div className={`px-3 ${big ? 'py-3' : 'py-2.5'} min-w-0`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground truncate">{label}</p>
        {icon}
      </div>
      <p className={`${big ? 'text-[26px]' : 'text-[22px]'} font-bold tabular-nums leading-none ${valueClass}`}>
        {value}
      </p>
      {sub && <p className={`text-[10px] font-semibold mt-0.5 ${valueClass}`}>{sub}</p>}
    </div>
  );
}

// ─── Section 2: AI Priority Center ───────────────────────────────────
const BUCKET_META: Record<string, { emoji: string; label: string; tone: string }> = {
  critical:   { emoji: '🚨', label: 'Critical issues',     tone: 'rose'   },
  delayed:    { emoji: '⚠️', label: 'Delayed projects',    tone: 'orange' },
  upcoming:   { emoji: '📅', label: 'Upcoming deadlines',  tone: 'violet' },
  approvals:  { emoji: '👥', label: 'Waiting approvals',   tone: 'blue'   },
  follow_ups: { emoji: '📞', label: 'Client follow-ups',   tone: 'amber'  },
  today:      { emoji: '🎯', label: "Today's priorities",  tone: 'emerald'},
};
function AiPriorityCenter({ rows }: { rows: Snap['priorityCenter'] }) {
  const buckets = useMemo(() => {
    const out: Record<string, Snap['priorityCenter']> = {};
    for (const r of rows) (out[r.bucket] ||= []).push(r);
    return out;
  }, [rows]);
  const order = ['critical', 'delayed', 'upcoming', 'approvals', 'follow_ups', 'today'];
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <p className="text-[12px] font-bold">AI Priority Center</p>
        <span className="text-[10.5px] text-muted-foreground">Ranked by urgency, refreshed every minute.</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/60">
        {order.map(b => {
          const meta = BUCKET_META[b];
          const items = buckets[b] || [];
          const toneCls =
            meta.tone === 'rose'    ? 'text-rose-700 bg-rose-500/10'    :
            meta.tone === 'orange'  ? 'text-orange-700 bg-orange-500/10' :
            meta.tone === 'violet'  ? 'text-violet-700 bg-violet-500/10' :
            meta.tone === 'blue'    ? 'text-blue-700 bg-blue-500/10'     :
            meta.tone === 'amber'   ? 'text-amber-700 bg-amber-500/10'   :
                                       'text-emerald-700 bg-emerald-500/10';
          return (
            <div key={b} className="px-3 py-2.5 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[11px] inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md ${toneCls}`}>
                  <span>{meta.emoji}</span>
                  <span className="font-semibold">{meta.label}</span>
                </span>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-[11px] italic text-muted-foreground/80">Clear.</p>
              ) : (
                <ul className="space-y-1">
                  {items.slice(0, 4).map(item => {
                    const Body = (
                      <div className="text-[11.5px] truncate">
                        <span className="font-semibold">{item.title}</span>
                        {item.meta && <span className="text-muted-foreground"> · {item.meta}</span>}
                      </div>
                    );
                    return (
                      <li key={item.id}>
                        {item.link ? (
                          <Link to={item.link} className="block hover:bg-muted/40 -mx-1 px-1 py-0.5 rounded">{Body}</Link>
                        ) : <div className="px-1 py-0.5">{Body}</div>}
                      </li>
                    );
                  })}
                  {items.length > 4 && (
                    <li className="text-[10px] text-muted-foreground italic">+ {items.length - 4} more</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section 3: Project Command Center ───────────────────────────────
function ProjectCommandCenter({ brands }: { brands: Brand[] }) {
  if (brands.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-[13px] font-semibold mb-1">No brands assigned to you yet.</p>
        <p className="text-[11.5px] text-muted-foreground">Ask your admin to assign you to a brand from the Client CRM.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-rose-600" />
          <p className="text-[12px] font-bold">Project Command Center</p>
          <span className="text-[10.5px] text-muted-foreground tabular-nums">({brands.length})</span>
        </div>
        <Link to="/clients/pipeline" className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5">
          See all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
        {brands.map(b => <ProjectCard key={b.id} brand={b} />)}
      </div>
    </div>
  );
}

const HEALTH_TONE: Record<string, { dot: string; ring: string; text: string; bg: string }> = {
  green:  { dot: 'bg-emerald-500', ring: 'border-emerald-500/30', text: 'text-emerald-700', bg: 'bg-emerald-500/5' },
  yellow: { dot: 'bg-amber-400',   ring: 'border-amber-500/30',   text: 'text-amber-700',   bg: 'bg-amber-500/5' },
  orange: { dot: 'bg-orange-500',  ring: 'border-orange-500/40',  text: 'text-orange-700',  bg: 'bg-orange-500/5' },
  red:    { dot: 'bg-rose-500',    ring: 'border-rose-500/50',    text: 'text-rose-700',    bg: 'bg-rose-500/8' },
};
const PR_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/15 text-rose-700',
  high:   'bg-amber-500/15 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};

function ProjectCard({ brand }: { brand: Brand }) {
  const tone = HEALTH_TONE[brand.healthLevel] || HEALTH_TONE.green;
  return (
    <Link
      to={`/clients/pipeline/${brand.id}`}
      className={`block rounded-xl border ${tone.ring} ${tone.bg} hover:border-foreground/30 transition-colors p-3 group`}
    >
      {/* Top row — name + priority + score + ETA */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} title={brand.healthLevel} />
        <p className="text-[13.5px] font-bold truncate flex-1">{brand.name}</p>
        <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PR_CLS[brand.priority] || PR_CLS.medium}`}>
          {brand.priority}
        </span>
        <span className={`text-[10.5px] tabular-nums font-bold ${tone.text}`}>{brand.healthScore}</span>
      </div>
      {/* Stage + completion */}
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10.5px] text-muted-foreground truncate flex-1">{brand.currentStage}</p>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${tone.dot}`} style={{ width: `${brand.completionPct}%` }} />
          </div>
          <span className="text-[10px] tabular-nums font-semibold text-foreground/80">{brand.completionPct}%</span>
        </div>
      </div>
      {/* Stage timeline */}
      <div className="flex items-center gap-0.5 mb-2">
        {brand.stages.map((s, i) => (
          <div
            key={s.key}
            title={`${s.label} · ${s.status}`}
            className={`h-1 flex-1 rounded-full ${
              s.status === 'done'   ? 'bg-emerald-500' :
              s.status === 'active' ? 'bg-blue-500 animate-pulse' :
                                       'bg-muted'
            }`}
            style={{ marginLeft: i === 0 ? 0 : undefined }}
          />
        ))}
      </div>
      {/* Stage labels under bar — readable on hover */}
      <div className="flex items-center gap-0.5 mb-2 text-[8.5px] uppercase tracking-wider">
        {brand.stages.map(s => (
          <span
            key={s.key}
            className={`flex-1 text-center truncate ${
              s.status === 'done' ? 'text-emerald-700/80' :
              s.status === 'active' ? 'text-blue-700 font-semibold' :
                                       'text-muted-foreground/60'
            }`}
          >{s.label.slice(0, 4)}</span>
        ))}
      </div>
      {/* Team avatars + meta strip */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center -space-x-1.5">
          {brand.team.slice(0, 4).map(t => (
            <Avatar key={t.userId} name={t.name} avatarUrl={t.avatarUrl} />
          ))}
          {brand.team.length > 4 && (
            <div className="h-5 w-5 rounded-full bg-muted text-[9px] font-bold flex items-center justify-center border-2 border-card">
              +{brand.team.length - 4}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {brand.pendingTaskCount > 0 && (
            <span className="inline-flex items-center gap-0.5"><TargetIcon className="h-2.5 w-2.5" />{brand.pendingTaskCount}</span>
          )}
          {brand.eta && (
            <span className="inline-flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{format(parseISO(brand.eta), 'MMM d')}</span>
          )}
          {brand.upcomingMeeting && (
            <span className="inline-flex items-center gap-0.5"><Calendar className="h-2.5 w-2.5" />{format(parseISO(brand.upcomingMeeting.at), 'MMM d')}</span>
          )}
        </div>
      </div>
      {/* Next action */}
      {brand.nextAction && (
        <p className="text-[10.5px] truncate">
          <span className="text-muted-foreground">Next: </span>
          <span className="text-foreground/90">{brand.nextAction}</span>
        </p>
      )}
      {brand.healthLevel !== 'green' && brand.healthFactors.length > 0 && (
        <p className={`text-[10px] mt-1 truncate ${tone.text}`}>{brand.healthFactors.slice(0, 2).join(' · ')}</p>
      )}
    </Link>
  );
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="h-5 w-5 rounded-full object-cover border-2 border-card" title={name} />;
  }
  return (
    <div className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[8.5px] font-bold flex items-center justify-center border-2 border-card" title={name}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

// ─── My Execution Board ──────────────────────────────────────────────
const COLUMN_META = [
  { key: 'overdue', label: 'Overdue',    icon: AlertCircle,   tone: 'border-rose-500/40    text-rose-700' },
  { key: 'today',   label: 'Today',      icon: Flame,         tone: 'border-violet-500/30  text-violet-700' },
  { key: 'week',    label: 'This week',  icon: Calendar,      tone: 'border-blue-500/30    text-blue-700' },
  { key: 'blocked', label: 'Blocked',    icon: AlertTriangle, tone: 'border-orange-500/40  text-orange-700' },
  { key: 'waiting', label: 'Waiting',    icon: Clock,         tone: 'border-amber-500/30   text-amber-700' },
] as const;

function MyExecutionBoard({ board }: { board: Snap['executionBoard'] }) {
  const totals = COLUMN_META.reduce((sum, c) => sum + (board[c.key as keyof typeof board] as any[]).length, 0);
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        <p className="text-[12px] font-bold">My Execution Board</p>
        <span className="text-[10.5px] text-muted-foreground tabular-nums">({totals} open)</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-3">
        {COLUMN_META.map(col => {
          const items = board[col.key as keyof typeof board] as any[];
          const Icon = col.icon;
          return (
            <div key={col.key} className={`rounded-xl border bg-background ${col.tone.split(' ')[0]} overflow-hidden`}>
              <div className="px-2.5 py-1.5 border-b border-border/60 flex items-center justify-between gap-1.5">
                <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider ${col.tone.split(' ')[1]}`}>
                  <Icon className="h-3 w-3" /> {col.label}
                </span>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="px-3 py-4 text-[10.5px] italic text-muted-foreground text-center">empty</p>
              ) : (
                <ul className="divide-y divide-border/60 max-h-[280px] overflow-y-auto">
                  {items.map(t => <ExecutionTask key={t.id} task={t} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExecutionTask({ task }: { task: ExecRow }) {
  const cardLink = task.brandId ? `/clients/pipeline/${task.brandId}` : '/tasks';
  return (
    <li className="px-2.5 py-1.5 hover:bg-muted/40">
      <Link to={cardLink} className="block">
        <p className="text-[11.5px] font-medium truncate">{task.title}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
          {task.brand && <span className="truncate">{task.brand}</span>}
          {task.brand && task.owner && <span>·</span>}
          {task.owner && <span className="truncate">{task.owner}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[8.5px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${PR_CLS[task.priority] || PR_CLS.medium}`}>
            {task.priority}
          </span>
          {task.dueDate && (
            <span className="text-[10px] tabular-nums text-muted-foreground">{format(parseISO(task.dueDate), 'MMM d')}</span>
          )}
          {task.dependsOnCount > 0 && (
            <span className="text-[9px] text-muted-foreground inline-flex items-center gap-0.5" title="Has dependencies">
              <CheckSquare className="h-2 w-2" />{task.dependsOnCount}
            </span>
          )}
          {task.hasReviewer && <span className="text-[9px] text-blue-700" title="Reviewer set">R</span>}
          {task.hasApprover && <span className="text-[9px] text-violet-700" title="Approver set">A</span>}
        </div>
      </Link>
    </li>
  );
}

// ─── Team Workload Heatmap ───────────────────────────────────────────
function TeamWorkloadHeatmap({ rows }: { rows: Snap['teamWorkload'] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-violet-600" />
        <p className="text-[12px] font-bold">Team workload</p>
        <span className="text-[10.5px] text-muted-foreground">Red bar = overloaded. AI may suggest redistribution.</span>
      </div>
      <ul className="divide-y divide-border/60 max-h-[260px] overflow-y-auto">
        {rows.slice(0, 10).map(r => (
          <li key={r.userId} className="px-4 py-2 flex items-center gap-2.5">
            <Avatar name={r.name} avatarUrl={r.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-[11.5px] font-semibold truncate">{r.name}</p>
                <div className="flex items-center gap-1.5">
                  {r.overdue > 0 && <span className="text-[9.5px] text-rose-700 tabular-nums">{r.overdue} overdue</span>}
                  {r.flag && (
                    <span className={`text-[8.5px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${
                      r.flag === 'overloaded' ? 'bg-rose-500/15 text-rose-700'
                      : r.flag === 'bottleneck' ? 'bg-orange-500/15 text-orange-700'
                      : 'bg-blue-500/12 text-blue-700'
                    }`}>{r.flag}</span>
                  )}
                  <span className={`text-[11px] tabular-nums font-semibold ${
                    r.workloadPct > 100 ? 'text-rose-700' :
                    r.workloadPct > 80 ? 'text-amber-700' :
                                           'text-foreground'
                  }`}>{r.workloadPct}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${
                  r.workloadPct > 100 ? 'bg-rose-500' :
                  r.workloadPct > 80 ? 'bg-amber-500' :
                  r.workloadPct < 25 ? 'bg-blue-400' :
                                       'bg-emerald-500'
                }`} style={{ width: `${Math.min(100, r.workloadPct)}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Persistent AI Copilot (right rail) ──────────────────────────────
const SUGGEST = [
  'What should I focus on today?',
  'Show overdue tasks',
  'Which clients are at risk?',
  'Who is responsible for this brand?',
];

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  entities?: Array<{ kind: string; id: string; name: string; link: string }>;
  at: number;
}

const COPILOT_LS = 'robin.workroom.copilot';

function PersistentCopilot() {
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try {
      const raw = sessionStorage.getItem(COPILOT_LS);
      if (raw) return JSON.parse(raw);
    } catch { /* */ }
    return [];
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem(COPILOT_LS, JSON.stringify(messages.slice(-15))); } catch { /* */ }
  }, [messages]);

  const ask = async (text?: string) => {
    const q = (text ?? draft).trim();
    if (!q || busy) return;
    setMessages(m => [...m, { role: 'user', content: q, at: Date.now() }]);
    setDraft('');
    setBusy(true);
    try {
      const r = await api.copilotAsk(q);
      setMessages(m => [...m, { role: 'assistant', content: r.answer || 'No answer.', entities: r.entities || [], at: Date.now() }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: "I couldn't reach Robin AI right now.", at: Date.now() }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ minHeight: 'min(560px, calc(100vh - 4rem))', maxHeight: 'calc(100vh - 4rem)' }}>
      <div className="px-3.5 py-2.5 flex items-center gap-2 text-white"
           style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}>
        <Wand2 className="h-3.5 w-3.5" />
        <div className="flex-1">
          <p className="text-[12px] font-bold leading-tight">Robin Copilot</p>
          <p className="text-[10px] text-white/85 leading-tight">Ask anything about your agency.</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              I see everything you can — your brands, tasks, team, deadlines. Try:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGEST.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="px-2 py-1 rounded-full bg-muted/60 hover:bg-muted text-[10.5px] text-foreground/80 hover:text-foreground inline-flex items-center gap-1"
                >
                  <MessageCircleQuestion className="h-2.5 w-2.5 text-primary" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-1.5 text-[12px]">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2 text-[12.5px] leading-relaxed">{m.content}</div>
              {m.entities && m.entities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.entities.slice(0, 5).map(e => (
                    <Link key={e.kind + e.id} to={e.link}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-background border border-border text-[10px] hover:border-primary/40">
                      <span className="text-muted-foreground capitalize">{e.kind}</span>
                      <span className="font-semibold">{e.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 animate-pulse text-primary" /> Thinking…</div>}
      </div>
      <form onSubmit={e => { e.preventDefault(); ask(); }} className="border-t border-border flex items-center gap-1.5 px-2 py-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Ask Robin…"
          className="flex-1 px-2 h-8 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="h-8 px-2.5 rounded-md text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
        >
          <Send className="h-3 w-3" /> Send
        </button>
      </form>
    </div>
  );
}

// Unused-import silencers — reserved for future signal additions.
void CheckCircle2;
