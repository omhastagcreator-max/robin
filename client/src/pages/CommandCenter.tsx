import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  AlertTriangle, AlertCircle, Building2, ChevronRight, Clock, Flame,
  Sparkles, Users, Calendar, Activity, Target, TrendingUp,
  ArrowUpRight, Briefcase, ShieldCheck, Settings2,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import * as api from '@/api';

/**
 * CommandCenter — the agency mission-control admin landing.
 *
 * "If you only look at one Robin screen all day, this is the one."
 *
 * Layout (top → bottom, ALL above-the-fold on desktop):
 *
 *   1. KPI hero strip — 8 numbers, one row. Read in 5 seconds.
 *   2. Critical Alerts feed — auto-hides when clear.
 *   3. Three-column main:
 *        a) Smart client cards grid (left, dominant — health-sorted)
 *        b) Team Accountability board (right, sticky)
 *   4. Upcoming meetings strip — auto-hides when empty.
 *
 * Hits ONE endpoint (/api/command-center/snapshot) so the paint is
 * fast (one round-trip, parallel server-side queries).
 *
 * Refresh strategy: auto-refresh every 60s in the background; manual
 * refresh button in the header. We don't socket-push this page — the
 * data here is rolled up from multiple sources and a periodic full
 * fetch is simpler and just as fresh for an admin's decision speed.
 */

interface Snapshot {
  kpis: {
    totalBrands: number;
    activeBrands: number;
    atRiskBrands: number;
    delayedBrands: number;
    overdueTasks: number;
    upcomingDeadlines7d: number;
    teamCapacityPct: number;
    overallCompletionPct: number;
  };
  criticalAlerts: Array<{
    id: string;
    severity: 'critical' | 'warning';
    emoji: string;
    title: string;
    detail: string;
    link?: string;
    entity?: { kind: string; id: string; name?: string };
  }>;
  accountability: Array<{
    userId: string;
    name: string;
    avatarUrl?: string;
    role: string;
    assignedBrands: number;
    activeTasks: number;
    overdueTasks: number;
    doneThisWeek: number;
    workloadPct: number;
    efficiencyScore: number;
    flag?: 'overloaded' | 'underloaded' | 'bottleneck';
  }>;
  clientCards: Array<{
    id: string;
    name: string;
    priority: string;
    healthLevel: 'green' | 'yellow' | 'orange' | 'red';
    healthScore: number;
    healthFactors: string[];
    currentStage: string;
    completionPct: number;
    nextDeadline?: { kind: string; at: string; label: string };
    currentOwner?: { userId: string; name: string };
    pendingTaskCount: number;
    nextAction: string;
    lastUpdate?: { at: string; detail: string; actorName?: string };
    upcomingMeeting?: { at: string; title: string };
  }>;
  upcomingMeetings: Array<{ id: string; title: string; startTime: string; attendeeCount: number }>;
  generatedAt: string;
}

// Customisable widgets — admin can toggle each on/off. Persisted
// per-browser via localStorage. Defaults: everything on.
type WidgetKey = 'kpis' | 'alerts' | 'clients' | 'team' | 'meetings';
const ALL_WIDGETS: { key: WidgetKey; label: string }[] = [
  { key: 'kpis',     label: 'KPI strip' },
  { key: 'alerts',   label: 'Critical alerts' },
  { key: 'clients',  label: 'Client cards' },
  { key: 'team',     label: 'Team accountability' },
  { key: 'meetings', label: 'Upcoming meetings' },
];
const LS_WIDGETS = 'robin.cc.widgets';

export default function CommandCenter() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [widgets, setWidgets] = useState<Record<WidgetKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem(LS_WIDGETS);
      if (raw) return { ...defaultWidgets(), ...JSON.parse(raw) };
    } catch { /* private mode */ }
    return defaultWidgets();
  });
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(LS_WIDGETS, JSON.stringify(widgets)); } catch { /* ignore */ }
  }, [widgets]);

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    api.getCommandSnapshot()
      .then((d: Snapshot) => setSnap(d))
      .catch(() => { /* stay on last good snap */ })
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 60_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4 pb-8">
        <Header
          refreshing={refreshing}
          onRefresh={() => load()}
          onCustomize={() => setCustomizing(true)}
          generatedAt={snap?.generatedAt}
        />
        {loading && !snap ? (
          <p className="py-20 text-center text-[13px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Loading mission control…
          </p>
        ) : !snap ? (
          <p className="py-20 text-center text-[13px] text-muted-foreground">
            Couldn't load the snapshot. Refresh to try again.
          </p>
        ) : (
          <>
            {widgets.kpis    && <KpiStrip k={snap.kpis} />}
            {widgets.alerts  && <CriticalAlerts alerts={snap.criticalAlerts} />}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
              {widgets.clients ? <ClientCardsGrid cards={snap.clientCards} /> : <div />}
              <div className="space-y-4 xl:sticky xl:top-4">
                {widgets.team     && <TeamAccountability rows={snap.accountability} />}
                {widgets.meetings && <UpcomingMeetings rows={snap.upcomingMeetings} />}
              </div>
            </div>
          </>
        )}
        {customizing && (
          <CustomizeWidgetsModal
            widgets={widgets}
            onToggle={(k) => setWidgets(prev => ({ ...prev, [k]: !prev[k] }))}
            onClose={() => setCustomizing(false)}
          />
        )}
      </div>
    </AppLayout>
  );
}

function defaultWidgets(): Record<WidgetKey, boolean> {
  return { kpis: true, alerts: true, clients: true, team: true, meetings: true };
}

function CustomizeWidgetsModal({ widgets, onToggle, onClose }: {
  widgets: Record<WidgetKey, boolean>;
  onToggle: (k: WidgetKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-bold">Customize widgets</p>
          <p className="text-[10.5px] text-muted-foreground">Show only what you actually use.</p>
        </div>
        <ul className="px-2 py-2">
          {ALL_WIDGETS.map(w => (
            <li key={w.key}>
              <label className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={widgets[w.key]}
                  onChange={() => onToggle(w.key)}
                  className="h-3.5 w-3.5"
                />
                <span className="text-[12.5px]">{w.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2.5 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90"
          >Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────
function Header({ refreshing, onRefresh, onCustomize, generatedAt }: { refreshing: boolean; onRefresh: () => void; onCustomize: () => void; generatedAt?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1">
      <div>
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground">Mission Control</p>
        <h1 className="text-[24px] sm:text-[28px] font-black tracking-tight leading-tight">Command Center</h1>
        <p className="text-[12px] text-muted-foreground">Everything that matters, on one screen.</p>
      </div>
      <div className="flex items-center gap-2">
        {generatedAt && (
          <p className="text-[10.5px] text-muted-foreground tabular-nums hidden sm:block">
            Updated {formatDistanceToNowStrict(parseISO(generatedAt), { addSuffix: true })}
          </p>
        )}
        <button
          onClick={onCustomize}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card text-[11.5px] font-semibold hover:bg-muted/40"
          title="Customize widgets"
        >
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="hidden sm:inline">Customize</span>
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card text-[11.5px] font-semibold hover:bg-muted/40 disabled:opacity-50"
        >
          <Activity className={`h-3.5 w-3.5 ${refreshing ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </div>
  );
}

// ─── KPI strip ───────────────────────────────────────────────────────
function KpiStrip({ k }: { k: Snapshot['kpis'] }) {
  const items = [
    { icon: Briefcase, label: 'Brands',        value: k.totalBrands },
    { icon: Activity,  label: 'Active',        value: k.activeBrands,        tone: 'blue' },
    { icon: AlertTriangle, label: 'At risk',   value: k.atRiskBrands,        tone: 'amber' },
    { icon: AlertCircle,   label: 'Critical',  value: k.delayedBrands,       tone: 'rose' },
    { icon: Clock,        label: 'Overdue',    value: k.overdueTasks,        tone: 'rose' },
    { icon: Calendar,     label: 'Due in 7d',  value: k.upcomingDeadlines7d, tone: 'violet' },
    { icon: Users,        label: 'Team cap',   value: k.teamCapacityPct,     unit: '%', tone: k.teamCapacityPct > 90 ? 'rose' : k.teamCapacityPct > 70 ? 'amber' : 'emerald' },
    { icon: ShieldCheck,  label: 'Done',       value: k.overallCompletionPct, unit: '%', tone: 'emerald' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {items.map((it, i) => (
        <Kpi key={i} {...it} />
      ))}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, unit, tone }: { icon: any; label: string; value: number; unit?: string; tone?: string }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700' :
    tone === 'rose'    ? 'text-rose-700' :
    tone === 'blue'    ? 'text-blue-700' :
    tone === 'violet'  ? 'text-violet-700' :
                         'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
        <Icon className="h-3 w-3 text-muted-foreground/70" />
      </div>
      <p className={`text-[22px] font-bold tabular-nums leading-tight ${toneCls}`}>
        {value}{unit && <span className="text-[14px] ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

// ─── Critical alerts ─────────────────────────────────────────────────
function CriticalAlerts({ alerts }: { alerts: Snapshot['criticalAlerts'] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        <p className="text-[12px] font-semibold text-emerald-800">All clear. Nothing critical needs attention right now.</p>
      </div>
    );
  }
  const criticals = alerts.filter(a => a.severity === 'critical');
  const warnings  = alerts.filter(a => a.severity === 'warning');

  return (
    <div className="rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/8 to-amber-500/5 overflow-hidden">
      <div className="px-4 py-2 border-b border-rose-500/20 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-rose-700">Critical alerts</p>
        <span className="text-[10.5px] text-rose-700/70 tabular-nums">{alerts.length}</span>
      </div>
      <ul className="divide-y divide-rose-500/15">
        {criticals.concat(warnings).slice(0, 10).map(a => (
          <li key={a.id}>
            <AlertItem alert={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlertItem({ alert }: { alert: Snapshot['criticalAlerts'][number] }) {
  const Inner = (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-rose-500/5">
      <span className="text-[14px] shrink-0">{alert.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold truncate">{alert.title}</p>
        {alert.detail && <p className="text-[10.5px] text-muted-foreground truncate">{alert.detail}</p>}
      </div>
      {alert.link && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
    </div>
  );
  return alert.link ? <Link to={alert.link} className="block">{Inner}</Link> : Inner;
}

// ─── Client cards grid ───────────────────────────────────────────────
function ClientCardsGrid({ cards }: { cards: Snapshot['clientCards'] }) {
  const [filter, setFilter] = useState<'all' | 'red' | 'orange' | 'yellow' | 'green'>('all');
  const filtered = useMemo(() => filter === 'all' ? cards : cards.filter(c => c.healthLevel === filter), [cards, filter]);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-primary" />
          <p className="text-[12px] font-bold">Clients</p>
          <span className="text-[10.5px] text-muted-foreground tabular-nums">({filtered.length})</span>
        </div>
        <div className="flex items-center gap-1 text-[10.5px]">
          {(['all', 'red', 'orange', 'yellow', 'green'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded-md ${filter === f ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f === 'all' ? 'All' : f === 'red' ? '🔴' : f === 'orange' ? '🟠' : f === 'yellow' ? '🟡' : '🟢'}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-[12px] text-muted-foreground italic">
          {filter === 'all' ? 'No client workflows yet.' : `No ${filter} brands. Nice.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 gap-2 p-3">
          {filtered.map(c => <ClientCard key={c.id} card={c} />)}
        </div>
      )}
    </div>
  );
}

const PR_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/12 text-rose-700',
  high:   'bg-amber-500/15 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};
const HEALTH_TONE: Record<string, { dot: string; ring: string; text: string }> = {
  green:  { dot: 'bg-emerald-500', ring: 'border-emerald-500/30', text: 'text-emerald-700' },
  yellow: { dot: 'bg-amber-400',   ring: 'border-amber-500/30',   text: 'text-amber-700' },
  orange: { dot: 'bg-orange-500',  ring: 'border-orange-500/40',  text: 'text-orange-700' },
  red:    { dot: 'bg-rose-500',    ring: 'border-rose-500/50',    text: 'text-rose-700' },
};

function ClientCard({ card }: { card: Snapshot['clientCards'][number] }) {
  const tone = HEALTH_TONE[card.healthLevel] || HEALTH_TONE.green;
  return (
    <Link
      to={`/clients/pipeline/${card.id}`}
      className={`block rounded-lg border ${tone.ring} bg-background hover:bg-muted/30 transition-colors p-3 group`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`h-2 w-2 rounded-full ${tone.dot} mt-1.5 shrink-0`} title={`Health: ${card.healthLevel}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[13px] font-bold truncate flex-1">{card.name}</p>
            <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PR_CLS[card.priority] || PR_CLS.medium}`}>
              {card.priority}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            {card.currentStage}{card.currentOwner && <> · {card.currentOwner.name}</>}
          </p>
        </div>
      </div>
      {/* Progress */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${tone.dot}`} style={{ width: `${card.completionPct}%` }} />
        </div>
        <span className="text-[10px] tabular-nums font-semibold text-foreground/80">{card.completionPct}%</span>
      </div>
      {/* Meta strip */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
        {card.nextDeadline ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
            <Clock className="h-2.5 w-2.5" />
            <span className="truncate">
              {card.nextDeadline.kind === 'meeting' ? 'Meet' : card.nextDeadline.kind === 'eta' ? 'ETA' : 'Task'}
              {' '}{format(parseISO(card.nextDeadline.at), 'MMM d')}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/60">No deadline set</span>
        )}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {card.pendingTaskCount > 0 && (
            <><Target className="h-2.5 w-2.5" />{card.pendingTaskCount}</>
          )}
        </span>
        <ArrowUpRight className="h-2.5 w-2.5 text-muted-foreground/70 group-hover:text-foreground transition-colors" />
      </div>
      {/* Health factors */}
      {card.healthFactors.length > 0 && card.healthLevel !== 'green' && (
        <p className={`mt-1.5 text-[10px] truncate ${tone.text}`}>
          {card.healthFactors.slice(0, 2).join(' · ')}
        </p>
      )}
    </Link>
  );
}

// ─── Team Accountability ─────────────────────────────────────────────
function TeamAccountability({ rows }: { rows: Snapshot['accountability'] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-violet-600" />
        <p className="text-[12px] font-bold">Team accountability</p>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-muted-foreground italic">No team yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
          {rows.map(r => <TeamRow key={r.userId} row={r} />)}
        </ul>
      )}
    </div>
  );
}

function TeamRow({ row }: { row: Snapshot['accountability'][number] }) {
  const flagCls = row.flag === 'overloaded' ? 'text-rose-700 bg-rose-500/10'
                : row.flag === 'bottleneck'  ? 'text-orange-700 bg-orange-500/10'
                : row.flag === 'underloaded' ? 'text-blue-700 bg-blue-500/10'
                : '';
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        {row.avatarUrl
          ? <img src={row.avatarUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
          : <div className="h-6 w-6 rounded-md bg-violet-500/12 text-violet-700 flex items-center justify-center text-[10px] font-bold">
              {row.name.slice(0, 1).toUpperCase()}
            </div>}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold truncate">{row.name}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{row.role}</p>
        </div>
        {row.flag && (
          <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${flagCls}`}>
            {row.flag}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[10px] mb-1">
        <Stat label="Active" value={row.activeTasks} />
        <Stat label="Overdue" value={row.overdueTasks} tone={row.overdueTasks > 0 ? 'rose' : undefined} />
        <Stat label="Done" value={row.doneThisWeek} tone="emerald" />
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Workload</span>
          <span className="tabular-nums font-semibold">{row.workloadPct}%</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${row.workloadPct > 100 ? 'bg-rose-500' : row.workloadPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, row.workloadPct)}%` }} />
        </div>
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'rose' | 'emerald' }) {
  const cls = tone === 'rose' ? 'text-rose-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-foreground';
  return (
    <div className="bg-muted/40 rounded px-1.5 py-1">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-[12px] font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

// ─── Upcoming meetings (sidebar bottom) ──────────────────────────────
function UpcomingMeetings({ rows }: { rows: Snapshot['upcomingMeetings'] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-blue-600" />
        <p className="text-[12px] font-bold">Upcoming meetings</p>
      </div>
      <ul className="divide-y divide-border/60">
        {rows.slice(0, 5).map(m => (
          <li key={m.id} className="px-3 py-2">
            <p className="text-[12px] font-semibold truncate">{m.title}</p>
            <p className="text-[10.5px] text-muted-foreground tabular-nums">
              {format(parseISO(m.startTime), 'EEE MMM d, h:mm a')}
              {m.attendeeCount > 0 && <> · {m.attendeeCount} {m.attendeeCount === 1 ? 'attendee' : 'attendees'}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Suppress unused-import warnings for icons reserved for future
// scoreboard / trends widgets.
void TrendingUp; void Building2;
