import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  Activity, AlertTriangle, AlertCircle, Briefcase, Calendar, Clock,
  ChevronRight, Plus, Search as SearchIcon, Settings2, Sparkles, Users,
  TrendingUp, TrendingDown, ShieldCheck, ArrowUpRight, FileText, UserPlus,
  ListChecks, CalendarPlus, Wallet, MoreHorizontal,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { DayPlanEditorSection } from '@/components/command/DayPlanEditorSection';
import { TodayActivityTable } from '@/components/command/TodayActivityTable';
import { DailyCheckinsReport } from '@/components/command/DailyCheckinsReport';
import { useNetworkAware } from '@/hooks/useNetworkAware';
import * as api from '@/api';

/**
 * CommandCenter — premium SaaS executive dashboard (June 2026 redesign).
 *
 * Sections (top → bottom):
 *
 *   1. Executive Overview — 6 KPI cards: Total Clients, Active Projects,
 *      Overdue Tasks, Revenue This Month, Team Utilization, Project
 *      Health Score. Each: icon + value + trend indicator + sparkline.
 *
 *   2. Command Actions — five large action buttons.
 *
 *   3. Critical Attention Center — severity-grouped alerts.
 *
 *   4. Agency Health Dashboard — two-column charts:
 *      Project Status Distribution (donut) + Team Capacity (heatmap).
 *
 *   5. Client Portfolio — table view with search + filter + sort.
 *
 *   6. Team Performance — compact people cards with color-coded capacity.
 *
 *   7. Upcoming Events — timeline grouped by Today / Tomorrow / This Week.
 *
 * Design principles:
 *   - Inter font hierarchy (32px page title, 16px section, 14px body).
 *   - Aggressive whitespace; clean borders; no shadows.
 *   - Visual hierarchy: Critical > Important > Informational.
 *   - Mobile-first responsive grids.
 */

// ─── Types (mirror server snapshot) ──────────────────────────────────
interface Snapshot {
  kpis: {
    totalBrands: number; activeBrands: number; atRiskBrands: number;
    delayedBrands: number; overdueTasks: number; upcomingDeadlines7d: number;
    teamCapacityPct: number; overallCompletionPct: number;
    revenueThisMonth: number; revenueLastMonth: number;
    trends: { brands: number[]; activeProjects: number[]; overdueTasks: number[]; revenue: number[] };
    statusDistribution: { completed: number; inProgress: number; atRisk: number; delayed: number };
  };
  criticalAlerts: Array<{ id: string; severity: 'critical' | 'warning'; emoji: string; title: string; detail: string; link?: string }>;
  accountability: Array<{ userId: string; name: string; avatarUrl?: string; role: string; assignedBrands: number; activeTasks: number; overdueTasks: number; doneThisWeek: number; workloadPct: number; efficiencyScore: number; flag?: string }>;
  clientCards: Array<{
    id: string; name: string; priority: string;
    healthLevel: 'green' | 'yellow' | 'orange' | 'red'; healthScore: number;
    healthFactors: string[]; currentStage: string; completionPct: number;
    nextDeadline?: { kind: string; at: string; label: string };
    currentOwner?: { userId: string; name: string };
    pendingTaskCount: number; nextAction: string;
    lastUpdate?: { at: string; detail: string; actorName?: string };
    upcomingMeeting?: { at: string; title: string };
  }>;
  upcomingMeetings: Array<{ id: string; title: string; startTime: string; attendeeCount: number }>;
  generatedAt: string;
}

// ─── Page ────────────────────────────────────────────────────────────
export default function CommandCenter() {
  const [snap, setSnap]       = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = (silent = false) => {
    // Guard: skip when offline or in huddle-only mode so socket-
    // driven refreshes inherit the same pause as the timer-driven
    // ones. Re-running load() on connectivity recovery is handled
    // by the visibilitychange / online listeners.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (typeof window !== 'undefined' && (window as any).__robinHuddleOnly) return;
    if (!silent) setLoading(true);
    setRefreshing(true);
    api.getCommandSnapshot()
      .then((d: Snapshot) => setSnap(d))
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  };
  // Network-aware polling: see WorkroomHome for the same pattern.
  const network = useNetworkAware();
  useEffect(() => {
    load();
    const baseMs = 30_000;
    const ms = Number.isFinite(network.intervalMultiplier) ? baseMs * network.intervalMultiplier : 86_400_000;
    const iv = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      // Huddle-only mode skips the snapshot to free bandwidth for the
      // live call. Resumes automatically when connection improves.
      if (typeof window !== 'undefined' && (window as any).__robinHuddleOnly) return;
      load(true);
    }, ms);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => load(true), 800);
    };
    window.addEventListener('robin:data-changed', onDataChanged);
    return () => {
      clearInterval(iv);
      window.removeEventListener('robin:data-changed', onDataChanged);
      if (debounce) clearTimeout(debounce);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network.intervalMultiplier]);

  return (
    <AppLayout>
      <div className="max-w-[1440px] mx-auto pb-12" style={{ fontFamily: "'Inter', 'system-ui', '-apple-system', sans-serif" }}>
        <Header refreshing={refreshing} onRefresh={() => load()} generatedAt={snap?.generatedAt} />
        {loading && !snap ? (
          <SkeletonShell />
        ) : !snap ? (
          <p className="py-20 text-center text-[14px] text-muted-foreground">Couldn't load the snapshot. Refresh.</p>
        ) : (
          <>
            {/* 1. Executive Overview — 6 KPI cards. */}
            <SectionHeader title="Executive Overview" subtitle="Agency status, at a glance." />
            <ExecutiveOverview k={snap.kpis} />

            {/* 2. Command Actions — large action buttons. */}
            <SectionHeader title="Quick Actions" />
            <CommandActions />

            {/* 3. Critical Attention Center. */}
            <SectionHeader title="Critical Attention Center" subtitle="Sorted by severity. Click any item to drill in." />
            <CriticalAttentionCenter alerts={snap.criticalAlerts} />

            {/* 4. Agency Health Dashboard — charts. */}
            <SectionHeader title="Agency Health" />
            <AgencyHealthDashboard k={snap.kpis} accountability={snap.accountability} />

            {/* 5. Client Portfolio — table view. */}
            <SectionHeader title="Client Portfolio" subtitle={`${snap.clientCards.length} brands`} />
            <ClientPortfolioTable cards={snap.clientCards} />

            {/* 6. Team Performance. */}
            <SectionHeader title="Team Performance" subtitle="Color-coded by capacity." />
            <TeamPerformance rows={snap.accountability} />

            {/* 6a. Today's activity — fresh, IST-day counts per teammate.
                Live-updates on any data change. Derived from existing
                audit trail; nothing to reset. */}
            <SectionHeader title="Today's activity" subtitle="Counts since 00:00 IST. Updates live." />
            <TodayActivityTable />

            {/* Daily check-ins — morning/midday/evening pulse per teammate.
                Drilldown view: morning's tasks + brand Meta pulse + the
                end-of-day reason for anything not done. */}
            <SectionHeader title="Daily check-ins" subtitle="Morning · midday · evening pulse per teammate. Updates live." />
            <DailyCheckinsReport />

            {/* 6b. Day plan editor — admin sets each teammate's weekday
                schedule + weekly target. Employees see this live on
                their Workroom. */}
            <SectionHeader title="Day Plan" subtitle="Round-robin client schedule + weekly target per teammate." />
            <DayPlanEditorSection />

            {/* 7. Upcoming Events. */}
            <SectionHeader title="Upcoming Events" />
            <UpcomingEventsTimeline rows={snap.upcomingMeetings} />
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ─── Header ──────────────────────────────────────────────────────────
function Header({ refreshing, onRefresh, generatedAt }: { refreshing: boolean; onRefresh: () => void; generatedAt?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1 pt-2 pb-7">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground mb-1">Mission Control</p>
        <h1 className="text-[32px] font-bold tracking-tight leading-none">Command Center</h1>
        <p className="text-[14px] text-muted-foreground mt-1.5">Decision-ready agency operations.</p>
      </div>
      <div className="flex items-center gap-2">
        {generatedAt && (
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            Updated {formatDistanceToNowStrict(parseISO(generatedAt), { addSuffix: true })}
          </p>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-[12px] font-medium hover:bg-muted/40 disabled:opacity-50 transition-colors"
        >
          <Activity className={`h-3.5 w-3.5 ${refreshing ? 'animate-pulse text-primary' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        <button
          className="inline-flex items-center gap-1.5 p-1.5 rounded-lg border border-border bg-background text-[12px] hover:bg-muted/40 transition-colors"
          title="More options"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3.5 mt-9 px-1">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function SkeletonShell() {
  return <div className="space-y-3 mt-6">{[1,2,3].map(i => <div key={i} className="h-28 rounded-xl bg-muted/30 animate-pulse" />)}</div>;
}

// ─── 1. Executive Overview ───────────────────────────────────────────
function ExecutiveOverview({ k }: { k: Snapshot['kpis'] }) {
  const revenueDelta = k.revenueLastMonth > 0
    ? Math.round(((k.revenueThisMonth - k.revenueLastMonth) / k.revenueLastMonth) * 100)
    : 0;
  const overdueDelta = (() => {
    const a = k.trends.overdueTasks.slice(0, 3).reduce((s, v) => s + v, 0);
    const b = k.trends.overdueTasks.slice(3, 7).reduce((s, v) => s + v, 0);
    return b === 0 ? 0 : Math.round(((a - b) / Math.max(1, b)) * 100);
  })();
  const healthScore = (() => {
    const total = k.totalBrands;
    if (!total) return 100;
    return Math.max(0, 100 - Math.round((k.atRiskBrands * 8 + k.delayedBrands * 14) / total));
  })();

  const cards = [
    {
      label: 'Total Clients', value: `${k.totalBrands}`, trend: 0,
      icon: <Briefcase className="h-3.5 w-3.5" />, sparkline: k.trends.brands, tone: 'blue',
    },
    {
      label: 'Active Projects', value: `${k.activeBrands}`, trend: 0,
      icon: <Activity className="h-3.5 w-3.5" />, sparkline: k.trends.activeProjects, tone: 'violet',
    },
    {
      label: 'Overdue Tasks', value: `${k.overdueTasks}`, trend: overdueDelta,
      // Lower overdue is better; flip the colour logic.
      icon: <AlertCircle className="h-3.5 w-3.5" />, sparkline: k.trends.overdueTasks, tone: 'rose',
      invertTrend: true,
    },
    {
      label: 'Revenue This Month', value: formatCurrencyINR(k.revenueThisMonth), trend: revenueDelta,
      icon: <Wallet className="h-3.5 w-3.5" />, sparkline: k.trends.revenue, tone: 'emerald',
    },
    {
      label: 'Team Utilization', value: `${k.teamCapacityPct}%`, trend: 0,
      icon: <Users className="h-3.5 w-3.5" />,
      sparkline: [],
      tone: k.teamCapacityPct > 90 ? 'rose' : k.teamCapacityPct > 70 ? 'amber' : 'emerald',
    },
    {
      label: 'Health Score', value: `${healthScore}`, trend: 0,
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      sparkline: [], tone: healthScore >= 90 ? 'emerald' : healthScore >= 70 ? 'amber' : 'rose',
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c, i) => <KpiCard key={i} {...c} />)}
    </div>
  );
}

const TONE_TEXT: Record<string, string> = {
  blue:    'text-blue-600',
  violet:  'text-violet-600',
  rose:    'text-rose-600',
  emerald: 'text-emerald-600',
  amber:   'text-amber-600',
};
const TONE_STROKE: Record<string, string> = {
  blue:    'stroke-blue-500',
  violet:  'stroke-violet-500',
  rose:    'stroke-rose-500',
  emerald: 'stroke-emerald-500',
  amber:   'stroke-amber-500',
};

function KpiCard({ label, value, trend, icon, sparkline, tone, invertTrend }: {
  label: string; value: string; trend: number;
  icon: React.ReactNode; sparkline: number[]; tone: string; invertTrend?: boolean;
}) {
  const trendColour = trend === 0 ? 'text-muted-foreground'
    : ((invertTrend ? -trend : trend) > 0 ? 'text-emerald-600' : 'text-rose-600');
  const TrendIcon = trend === 0 ? null : ((invertTrend ? -trend : trend) > 0 ? TrendingUp : TrendingDown);
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 hover:border-foreground/20 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground truncate">{label}</p>
        <span className={TONE_TEXT[tone]}>{icon}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[24px] font-bold tabular-nums leading-none tracking-tight">{value}</p>
        {TrendIcon && (
          <span className={`inline-flex items-center gap-0.5 text-[10.5px] font-semibold ${trendColour}`}>
            <TrendIcon className="h-2.5 w-2.5" />{Math.abs(trend)}%
          </span>
        )}
      </div>
      {sparkline.length > 0 && (
        <Sparkline values={sparkline} className={TONE_STROKE[tone]} />
      )}
    </div>
  );
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2 || values.every(v => v === values[0])) {
    return <div className="h-6 mt-2" />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const w = 100, h = 24;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="h-6 w-full mt-2" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" strokeWidth="1.5" className={className} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatCurrencyINR(n: number): string {
  if (!n) return '₹0';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

// ─── 2. Command Actions ──────────────────────────────────────────────
function CommandActions() {
  const ACTIONS = [
    { label: 'Add Client',       to: '/clients/pipeline', icon: UserPlus },
    { label: 'Create Project',   to: '/admin/projects',   icon: Briefcase },
    { label: 'Assign Task',      to: '/tasks',            icon: ListChecks },
    { label: 'Schedule Meeting', to: '/team/calendar',    icon: CalendarPlus },
    { label: 'Generate Report',  to: '/sales',            icon: FileText },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {ACTIONS.map(a => (
        <Link
          key={a.label}
          to={a.to}
          className="rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/[.02] p-3 flex items-center gap-2.5 transition-colors group"
        >
          <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary inline-flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <a.icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] font-medium truncate">{a.label}</span>
          <Plus className="h-3 w-3 text-muted-foreground/60 ml-auto shrink-0" />
        </Link>
      ))}
    </div>
  );
}

// ─── 3. Critical Attention Center ────────────────────────────────────
function CriticalAttentionCenter({ alerts }: { alerts: Snapshot['criticalAlerts'] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <p className="text-[14px] font-semibold text-emerald-800">All clear. No issues need your attention.</p>
        </div>
      </div>
    );
  }
  const criticals = alerts.filter(a => a.severity === 'critical');
  const warnings  = alerts.filter(a => a.severity === 'warning');
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AlertColumn
        title={`${criticals.length} Critical`}
        items={criticals}
        tone="rose"
        icon={<AlertCircle className="h-3.5 w-3.5" />}
      />
      <AlertColumn
        title={`${warnings.length} Warnings`}
        items={warnings}
        tone="amber"
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

function AlertColumn({ title, items, tone, icon }: {
  title: string; items: Snapshot['criticalAlerts']; tone: 'rose' | 'amber'; icon: React.ReactNode;
}) {
  const ringCls = tone === 'rose' ? 'border-rose-500/25 bg-rose-500/[0.03]' : 'border-amber-500/25 bg-amber-500/[0.03]';
  const tagCls  = tone === 'rose' ? 'text-rose-700' : 'text-amber-700';
  return (
    <div className={`rounded-xl border ${ringCls} overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-2">
        <span className={tagCls}>{icon}</span>
        <span className={`text-[11.5px] uppercase tracking-wider font-bold ${tagCls}`}>{title}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-[12.5px] text-muted-foreground italic">Nothing here right now.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.slice(0, 8).map(a => {
            const Body = (
              <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                <span className="text-[14px] shrink-0">{a.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate">{a.title}</p>
                  {a.detail && <p className="text-[11px] text-muted-foreground truncate">{a.detail}</p>}
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            );
            return <li key={a.id}>{a.link ? <Link to={a.link}>{Body}</Link> : Body}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

// ─── 4. Agency Health Dashboard ──────────────────────────────────────
function AgencyHealthDashboard({ k, accountability }: { k: Snapshot['kpis']; accountability: Snapshot['accountability'] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <ProjectStatusDonut dist={k.statusDistribution} />
      <TeamCapacityPanel rows={accountability} />
    </div>
  );
}

function ProjectStatusDonut({ dist }: { dist: Snapshot['kpis']['statusDistribution'] }) {
  const entries = [
    { label: 'Completed',   value: dist.completed,   color: '#10b981' },
    { label: 'In Progress', value: dist.inProgress,  color: '#3b82f6' },
    { label: 'At Risk',     value: dist.atRisk,      color: '#f97316' },
    { label: 'Delayed',     value: dist.delayed,     color: '#f43f5e' },
  ];
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  // Donut path math.
  const r = 38, c = 50, sw = 14;
  let offset = 0;
  const circ = 2 * Math.PI * r;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-[14px] font-semibold mb-1">Project Status Distribution</h3>
      <p className="text-[11.5px] text-muted-foreground mb-4">Live across all active brands.</p>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 100 100" className="w-32 h-32 -rotate-90 shrink-0">
          {/* Background ring */}
          <circle cx={c} cy={c} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={sw} />
          {entries.map(e => {
            if (e.value === 0) return null;
            const dash = (e.value / total) * circ;
            const seg = (
              <circle
                key={e.label}
                cx={c} cy={c} r={r} fill="none" stroke={e.color} strokeWidth={sw}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return seg;
          })}
        </svg>
        <ul className="flex-1 space-y-2 min-w-0">
          {entries.map(e => {
            const pct = Math.round((e.value / total) * 100);
            return (
              <li key={e.label} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: e.color }} />
                <span className="font-medium truncate flex-1">{e.label}</span>
                <span className="text-muted-foreground tabular-nums">{e.value}</span>
                <span className="text-muted-foreground/60 tabular-nums w-9 text-right">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function TeamCapacityPanel({ rows }: { rows: Snapshot['accountability'] }) {
  const overloaded = rows.filter(r => r.workloadPct >= 100).length;
  const totalCapacity   = rows.length * 100;
  const allocatedCapacity = rows.reduce((s, r) => s + Math.min(100, r.workloadPct), 0);
  const availableCapacity = Math.max(0, totalCapacity - allocatedCapacity);
  const allocPct = totalCapacity > 0 ? Math.round((allocatedCapacity / totalCapacity) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-[14px] font-semibold mb-1">Team Capacity</h3>
      <p className="text-[11.5px] text-muted-foreground mb-4">Hours allocated vs. available.</p>
      <div className="space-y-3">
        <CapacityRow label="Allocated" value={`${allocPct}%`} pct={allocPct} color="bg-blue-500" />
        <CapacityRow label="Available" value={`${Math.max(0, 100 - allocPct)}%`} pct={Math.max(0, 100 - allocPct)} color="bg-emerald-500" />
        <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-border/60">
          <span className="text-[12px] text-muted-foreground">Overloaded members</span>
          <span className={`text-[14px] font-bold tabular-nums ${overloaded > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{overloaded}</span>
        </div>
      </div>
    </div>
  );
}

function CapacityRow({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <span className="text-[12px] font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

// ─── 5. Client Portfolio (Table view) ───────────────────────────────
function ClientPortfolioTable({ cards }: { cards: Snapshot['clientCards'] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'green' | 'yellow' | 'orange' | 'red'>('all');
  const [sortKey, setSortKey] = useState<'name' | 'progress' | 'score' | 'deadline'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = cards.filter(c => filter === 'all' || c.healthLevel === filter);
    if (q) r = r.filter(c => c.name.toLowerCase().includes(q) || c.currentStage.toLowerCase().includes(q) || c.currentOwner?.name?.toLowerCase().includes(q));
    r = r.slice().sort((a, b) => {
      let v = 0;
      if (sortKey === 'name')        v = a.name.localeCompare(b.name);
      else if (sortKey === 'progress') v = (a.completionPct || 0) - (b.completionPct || 0);
      else if (sortKey === 'score')    v = (a.healthScore || 0) - (b.healthScore || 0);
      else if (sortKey === 'deadline') {
        const aD = a.nextDeadline?.at ? new Date(a.nextDeadline.at).getTime() : Infinity;
        const bD = b.nextDeadline?.at ? new Date(b.nextDeadline.at).getTime() : Infinity;
        v = aD - bD;
      }
      return sortDir === 'asc' ? v : -v;
    });
    return r;
  }, [cards, search, filter, sortKey, sortDir]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Toolbar — search + filters + sort */}
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <SearchIcon className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search brand, stage, or owner…"
            className="w-full pl-8 pr-2 h-8 rounded-lg border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          {(['all', 'red', 'orange', 'yellow', 'green'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded-md transition-colors ${filter === f ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f === 'all' ? 'All' : f === 'red' ? '🔴' : f === 'orange' ? '🟠' : f === 'yellow' ? '🟡' : '🟢'}
            </button>
          ))}
        </div>
        <select
          value={`${sortKey}-${sortDir}`}
          onChange={e => {
            const [k, d] = e.target.value.split('-') as [typeof sortKey, typeof sortDir];
            setSortKey(k); setSortDir(d);
          }}
          className="h-8 px-2 rounded-lg border border-input bg-background text-[11.5px]"
        >
          <option value="score-asc">Sort: Worst health</option>
          <option value="score-desc">Sort: Best health</option>
          <option value="name-asc">Sort: Brand A→Z</option>
          <option value="progress-desc">Sort: Most done</option>
          <option value="deadline-asc">Sort: Next deadline</option>
        </select>
      </div>
      {/* Header row */}
      <div className="hidden md:grid grid-cols-[2fr_1.4fr_0.8fr_1fr_0.9fr_0.9fr_0.6fr] gap-3 px-4 py-2 border-b border-border/60 text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">
        <div>Client</div>
        <div>Stage</div>
        <div>Progress</div>
        <div>Owner</div>
        <div>Status</div>
        <div>Deadline</div>
        <div>Score</div>
      </div>
      {/* Rows */}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground italic">No brands match.</p>
      ) : (
        <ul>
          {rows.map(c => <PortfolioRow key={c.id} c={c} />)}
        </ul>
      )}
    </div>
  );
}

const HEALTH_BADGE: Record<string, { dot: string; text: string; label: string }> = {
  green:  { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Healthy' },
  yellow: { dot: 'bg-amber-400',   text: 'text-amber-700',   label: 'Stable' },
  orange: { dot: 'bg-orange-500',  text: 'text-orange-700',  label: 'Attention' },
  red:    { dot: 'bg-rose-500',    text: 'text-rose-700',    label: 'Critical' },
};
const PR_BADGE: Record<string, string> = {
  urgent: 'bg-rose-500/12 text-rose-700',
  high:   'bg-amber-500/12 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};

function PortfolioRow({ c }: { c: Snapshot['clientCards'][number] }) {
  const tone = HEALTH_BADGE[c.healthLevel] || HEALTH_BADGE.green;
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <Link
        to={`/clients/pipeline/${c.id}`}
        className="grid grid-cols-1 md:grid-cols-[2fr_1.4fr_0.8fr_1fr_0.9fr_0.9fr_0.6fr] gap-3 px-4 py-3 hover:bg-muted/30 transition-colors items-center"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-muted/60 inline-flex items-center justify-center text-[10.5px] font-bold shrink-0">
            {c.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate">{c.name}</p>
            <span className={`text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PR_BADGE[c.priority] || PR_BADGE.medium}`}>{c.priority}</span>
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground truncate">{c.currentStage}</p>
        <div>
          <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden mb-0.5">
            <div className={`h-full ${tone.dot}`} style={{ width: `${c.completionPct}%` }} />
          </div>
          <p className="text-[10.5px] tabular-nums">{c.completionPct}%</p>
        </div>
        <p className="text-[12px] truncate">{c.currentOwner?.name || <span className="italic text-muted-foreground">Unassigned</span>}</p>
        <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {tone.label}
        </span>
        <p className="text-[11.5px] tabular-nums text-muted-foreground">
          {c.nextDeadline?.at ? format(parseISO(c.nextDeadline.at), 'd MMM') : '—'}
        </p>
        <p className={`text-[13px] font-bold tabular-nums ${tone.text}`}>{c.healthScore}</p>
      </Link>
    </li>
  );
}

// ─── 6. Team Performance ────────────────────────────────────────────
function TeamPerformance({ rows }: { rows: Snapshot['accountability'] }) {
  if (rows.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground italic">No team data yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {rows.slice(0, 12).map(r => <TeamCard key={r.userId} r={r} />)}
    </div>
  );
}

function TeamCard({ r }: { r: Snapshot['accountability'][number] }) {
  const capacityColour = r.workloadPct > 100 ? 'bg-rose-500'
    : r.workloadPct > 80 ? 'bg-amber-500'
    : 'bg-emerald-500';
  const completionPct = Math.max(0, Math.min(100, r.efficiencyScore));
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 hover:border-foreground/20 transition-colors">
      <div className="flex items-center gap-2.5 mb-3">
        {r.avatarUrl
          ? <img src={r.avatarUrl} alt={r.name} className="h-9 w-9 rounded-lg object-cover" />
          : <div className="h-9 w-9 rounded-lg bg-primary/12 text-primary inline-flex items-center justify-center text-[12px] font-bold">{r.name.slice(0, 1).toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold truncate">{r.name}</p>
          <p className="text-[10.5px] text-muted-foreground capitalize">{r.role}</p>
        </div>
        {r.flag && (
          <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 ${
            r.flag === 'overloaded' ? 'bg-rose-500/15 text-rose-700'
            : r.flag === 'bottleneck' ? 'bg-orange-500/15 text-orange-700'
            : 'bg-blue-500/12 text-blue-700'
          }`}>{r.flag}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10.5px] mb-2.5">
        <Stat label="Projects" value={r.assignedBrands} />
        <Stat label="Active" value={r.activeTasks} />
        <Stat label="Done" value={r.doneThisWeek} tone="emerald" />
      </div>
      <div className="space-y-1.5">
        <RowMeter label="Completion" pct={completionPct} value={`${completionPct}%`} color="bg-emerald-500" />
        <RowMeter label="Capacity"   pct={Math.min(100, r.workloadPct)} value={`${r.workloadPct}%`} color={capacityColour} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' }) {
  const cls = tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-foreground';
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-[13px] font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function RowMeter({ label, pct, value, color }: { label: string; pct: number; value: string; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10.5px] tabular-nums font-semibold">{value}</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── 7. Upcoming Events Timeline ────────────────────────────────────
function UpcomingEventsTimeline({ rows }: { rows: Snapshot['upcomingMeetings'] }) {
  const groups = useMemo(() => {
    const today: Snapshot['upcomingMeetings']    = [];
    const tomorrow: Snapshot['upcomingMeetings'] = [];
    const thisWeek: Snapshot['upcomingMeetings'] = [];
    const todayKey = new Date().toDateString();
    const tomorrowKey = new Date(Date.now() + 86_400_000).toDateString();
    for (const m of rows) {
      const d = new Date(m.startTime).toDateString();
      if (d === todayKey)      today.push(m);
      else if (d === tomorrowKey) tomorrow.push(m);
      else                     thisWeek.push(m);
    }
    return { today, tomorrow, thisWeek };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-8 text-center">
        <Calendar className="h-6 w-6 text-muted-foreground/60 mx-auto mb-2" />
        <p className="text-[12.5px] text-muted-foreground italic">No upcoming events.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border/60">
      {groups.today.length    > 0 && <TimelineGroup label="Today"    items={groups.today} />}
      {groups.tomorrow.length > 0 && <TimelineGroup label="Tomorrow" items={groups.tomorrow} />}
      {groups.thisWeek.length > 0 && <TimelineGroup label="This week" items={groups.thisWeek} />}
    </div>
  );
}

function TimelineGroup({ label, items }: { label: string; items: Snapshot['upcomingMeetings'] }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-2.5">{label}</p>
      <ul className="space-y-2 relative">
        <div className="absolute left-[55px] top-1 bottom-1 w-px bg-border/60" />
        {items.map(m => (
          <li key={m.id} className="flex items-center gap-3">
            <span className="text-[11px] tabular-nums font-semibold text-muted-foreground w-[55px] shrink-0">
              {format(parseISO(m.startTime), 'h:mm a')}
            </span>
            <span className="h-2 w-2 rounded-full bg-primary shrink-0 relative z-10" />
            <span className="text-[13px] font-medium truncate flex-1">{m.title}</span>
            {m.attendeeCount > 0 && (
              <span className="text-[10.5px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0">
                <Users className="h-2.5 w-2.5" />{m.attendeeCount}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Silence unused-import warnings (placeholders for future SaaS widgets).
void ArrowUpRight; void MoreHorizontal; void Sparkles;
