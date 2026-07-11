import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, ChevronDown, ChevronUp,
  CalendarCheck, Clock, Target, ListChecks, Sparkles, Megaphone, CornerUpRight,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell,
} from 'recharts';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * TeamProgressPage — weekly employee scorecards + improvement trends.
 *
 * Every internal staff member gets a 0–100 weekly score built from four
 * pillars (see server services/progressReport.ts for exact formulas):
 *
 *   Reliability /25 · Focus /25 · Delivery /30 · Discipline /20
 *
 * "Progress" = the trend of that score across weeks: the line chart per
 * employee is the improvement graph, and the ▲/▼ delta compares the
 * live current week against the last completed one.
 *
 * Access: admin / sales / canManageWorkroom (Om) — server-gated; the
 * route itself is loose like Team Pulse and plain employees get a 403.
 */

interface WeekPoint { weekStartIST: string; score: number; provisional?: boolean }
interface Row {
  userId: string; name: string; email: string; role: string; team: string;
  current: null | {
    weekStartIST: string; score: number;
    breakdown: { reliability: number; focus: number; delivery: number; discipline: number };
    metrics: Record<string, number | null>;
  };
  delta: number | null;
  history: WeekPoint[];
}

/** Plain-language read of a score — numbers alone don't land. */
const scoreLabel = (s: number) =>
  s >= 75 ? { text: 'Excellent', cls: 'text-emerald-700 bg-emerald-500/15 border-emerald-500/30' } :
  s >= 50 ? { text: 'Good', cls: 'text-amber-700 bg-amber-500/15 border-amber-500/30' } :
            { text: 'Needs attention', cls: 'text-rose-700 bg-rose-500/15 border-rose-500/30' };
const scoreColor = (s: number) => s >= 75 ? '#10b981' : s >= 50 ? '#f59e0b' : '#f43f5e';

const fmtH = (ms?: number | null) => ms == null ? '—' : `${(ms / 3_600_000).toFixed(1)}h`;
const fmtPct = (r?: number | null) => r == null ? '—' : `${Math.round(r * 100)}%`;
const fmtStart = (mins?: number | null) => {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function TeamProgressPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [weekStart, setWeekStart] = useState('');
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pulseReport, setPulseReport] = useState<any>(null);

  const load = async () => {
    try {
      const r = await api.getTeamProgress(8);
      setRows(r.team || []);
      setWeekStart(r.weekStartIST || '');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to load progress report');
      setRows([]);
    } finally { setLoading(false); }
    // Brand Pulse report loads independently — a failure here shouldn't
    // blank the scorecards.
    api.getBrandPulseReport(14).then(setPulseReport).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const recompute = async () => {
    setRecomputing(true);
    try {
      await api.recomputeProgress();           // freezes/refreshes LAST week
      await load();
      toast.success('Last week recomputed from current data.');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Recompute failed');
    } finally { setRecomputing(false); }
  };

  const teamAvg = useMemo(() => {
    const scores = (rows || []).map(r => r.current?.score ?? 0).filter(s => s > 0);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }, [rows]);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading progress report…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Team Progress
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Weekly scorecards (Mon–Sun IST) · week of <span className="font-mono">{weekStart}</span> ·
            team average <span className="font-bold text-foreground">{teamAvg}</span>/100
          </p>
        </div>
        <button
          onClick={recompute}
          disabled={recomputing}
          className="h-8 px-3 rounded-lg border border-border bg-card text-xs font-semibold flex items-center gap-1.5 hover:bg-muted/50 disabled:opacity-50"
          title="Re-freeze last week's snapshots (use after data repairs)"
        >
          {recomputing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Recompute last week
        </button>
      </div>

      {/* Team at a glance — one bar per person, colour = health.
          The single easiest visual: taller + greener = doing better. */}
      {(rows || []).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Team at a glance — this week's scores
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(rows || []).map(r => ({ name: (r.name || '').split(' ')[0], score: r.current?.score ?? 0 }))}
                margin={{ top: 16, right: 8, bottom: 0, left: -22 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [`${v}/100`, 'Score']} />
                <Bar dataKey="score" radius={[6, 6, 0, 0]} label={{ position: 'top', fontSize: 11 }}>
                  {(rows || []).map((r, i) => (
                    <Cell key={i} fill={scoreColor(r.current?.score ?? 0)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
            <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1" />75+ Excellent</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1" />50–74 Good</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-rose-500 mr-1" />&lt;50 Needs attention</span>
          </div>
        </div>
      )}

      {/* Score legend */}
      <div className="flex flex-wrap gap-2 text-[10.5px] text-muted-foreground">
        <LegendChip icon={<CalendarCheck className="h-3 w-3" />} label="Reliability /25 — attendance + punctuality" />
        <LegendChip icon={<Clock className="h-3 w-3" />} label="Focus /25 — hours vs 8h, breaks, presence" />
        <LegendChip icon={<Target className="h-3 w-3" />} label="Delivery /30 — promised vs done, on-time" />
        <LegendChip icon={<ListChecks className="h-3 w-3" />} label="Discipline /20 — daily check-ins" />
      </div>

      {/* Employee cards */}
      <div className="space-y-3">
        {(rows || []).map(r => (
          <EmployeeCard key={r.userId} row={r} open={open === r.userId}
            onToggle={() => setOpen(open === r.userId ? null : r.userId)} />
        ))}
        {(rows || []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No staff found — or you don't have access to this report.
          </div>
        )}
      </div>

      {/* Brand Pulse — the random-question accountability report */}
      {pulseReport && <BrandPulseSection report={pulseReport} />}
    </div>
  );
}

/** Answers + responsiveness from the random brand questions (last 14 days). */
function BrandPulseSection({ report }: { report: any }) {
  const [showAll, setShowAll] = useState(false);
  const employees: any[] = report.employees || [];
  const recent: any[] = report.recent || [];
  const shown = showAll ? recent : recent.slice(0, 12);

  return (
    <div className="space-y-3 pt-2">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-indigo-600" /> Brand Pulse — random question report
        </h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Last {report.days} days · random brand questions asked during work hours ·
          who answered, who passed it on, and what they said.
        </p>
      </div>

      {/* Responsiveness per employee */}
      {employees.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => (
            <div key={e.userId} className="rounded-2xl border border-border bg-card px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-sm truncate">{e.name}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${scoreLabel(e.answerRate).cls}`}>
                  {e.answerRate}% answered
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                asked <b>{e.asked}</b> · answered <b>{e.answered}</b> · passed on <b>{e.redirected}</b>
                {e.pending > 0 && <> · <span className="text-rose-600 font-semibold">{e.pending} waiting</span></>}
                {e.avgResponseMins !== null && <> · replies in ~<b>{e.avgResponseMins}m</b></>}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Recent Q&A feed */}
      <div className="rounded-2xl border border-border bg-card divide-y divide-border/60">
        {shown.map((it) => (
          <div key={it.id} className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="font-bold text-foreground">{it.clientName}</span>
              <span className="text-muted-foreground">→ {it.askedTo}</span>
              {it.status === 'answered' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">answered{it.responseMins !== null ? ` in ${it.responseMins}m` : ''}</span>}
              {it.status === 'redirected' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/30 flex items-center gap-1"><CornerUpRight className="h-3 w-3" />passed to {it.redirectedTo}</span>}
              {it.status === 'pending' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-700 border border-rose-500/30">awaiting answer</span>}
              <span className="ml-auto text-muted-foreground">{new Date(it.askedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
            </div>
            <p className="text-[12px] text-muted-foreground mt-1">{it.question}</p>
            {it.answer && (
              <p className="text-[12.5px] mt-1.5 rounded-lg bg-muted/40 border border-border/60 px-2.5 py-1.5 whitespace-pre-wrap">
                {it.answer}
              </p>
            )}
          </div>
        ))}
        {recent.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No questions fired yet — they start randomly during work hours (10:30–18:30 IST, Mon–Sat).
          </p>
        )}
        {recent.length > 12 && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="w-full py-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {showAll ? 'Show less' : `Show all ${recent.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

function LegendChip({ icon, label }: { icon: any; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 border border-border px-2 py-0.5">
      {icon}{label}
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-rose-600';
  const track = score >= 75 ? 'stroke-emerald-500' : score >= 50 ? 'stroke-amber-500' : 'stroke-rose-500';
  const C = 2 * Math.PI * 20;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
        <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" className="stroke-muted" />
        <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" strokeLinecap="round"
          className={track} strokeDasharray={`${(score / 100) * C} ${C}`} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums ${tone}`}>
        {score}
      </span>
    </div>
  );
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Minus className="h-3 w-3" /> first week</span>;
  if (delta > 0) return <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> +{delta} vs last wk</span>;
  if (delta < 0) return <span className="text-[11px] font-bold text-rose-600 flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> {delta} vs last wk</span>;
  return <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Minus className="h-3 w-3" /> flat</span>;
}

function PillarBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const tone = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="font-mono tabular-nums">{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mt-0.5 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmployeeCard({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  const cur = row.current;
  const m = cur?.metrics || {};
  const chart = useMemo(() => {
    const pts = row.history.map(h => ({
      week: h.weekStartIST.slice(5),          // MM-DD
      score: h.score,
    }));
    // Ensure the live current week is on the chart even before Monday's freeze.
    if (cur && !row.history.some(h => h.weekStartIST === cur.weekStartIST)) {
      pts.push({ week: cur.weekStartIST.slice(5), score: cur.score });
    }
    return pts;
  }, [row, cur]);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors">
        <ScoreRing score={cur?.score ?? 0} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-sm truncate">{row.name}</p>
            <span className="text-[10px] uppercase tracking-wider font-semibold bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">
              {row.role}{row.team ? ` · ${row.team}` : ''}
            </span>
            {cur && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${scoreLabel(cur.score).cls}`}>
                {scoreLabel(cur.score).text}
              </span>
            )}
          </div>
          <div className="mt-1"><Delta delta={row.delta} /></div>
        </div>
        {/* Pillar mini-bars */}
        {cur && (
          <div className="hidden md:grid grid-cols-2 gap-x-4 gap-y-1.5 w-64 shrink-0">
            <PillarBar label="Reliability" value={cur.breakdown.reliability} max={25} />
            <PillarBar label="Focus" value={cur.breakdown.focus} max={25} />
            <PillarBar label="Delivery" value={cur.breakdown.delivery} max={30} />
            <PillarBar label="Discipline" value={cur.breakdown.discipline} max={20} />
          </div>
        )}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 grid gap-5 lg:grid-cols-2">
          {/* Trend chart — this line IS the improvement */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Score trend (8 weeks)</p>
            {chart.length >= 2 ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => [`${v}/100`, 'Score']} />
                    <Line type="monotone" dataKey="score" stroke="hsl(178 65% 26%)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border p-4">
                Trend appears after two weeks of snapshots — first freeze runs Monday 00:30 IST.
              </p>
            )}
          </div>

          {/* Metric detail */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">This week's numbers</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Metric label="Days worked" value={`${m.daysWorked ?? 0}/${m.expectedDays ?? 0}`} />
              <Metric label="8h-target days" value={String(m.targetHitDays ?? 0)} />
              <Metric label="Avg start (IST)" value={fmtStart(m.avgStartMins as number | null)} />
              <Metric label="Avg worked/day" value={fmtH(m.avgActiveMsDay as number)} />
              <Metric label="Break (week)" value={fmtH(m.totalBreakMs as number)} />
              <Metric label="Huddle presence" value={fmtPct(m.huddleRatio as number)} />
              <Metric label="Planned tasks" value={String(m.tasksPlanned ?? 0)} />
              <Metric label="Delivered" value={`${m.tasksDelivered ?? 0} (${fmtPct(m.promiseRate as number | null)})`} />
              <Metric label="On-time rate" value={fmtPct(m.onTimeRate as number | null)} />
              <Metric label="Check-in rate" value={fmtPct(m.checkinRate as number)} />
              <Metric label="Tasks closed" value={String(m.projTasksDone ?? 0)} />
              <Metric label="Leave days" value={String(m.leaveDays ?? 0)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/30 border border-border px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      <p className="text-[13px] font-bold font-mono tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

export default TeamProgressPage;
