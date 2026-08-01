import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Calendar, ChevronDown, ChevronRight, ChevronLeft, Loader2, AlertTriangle,
  Coffee, CheckCircle2, Activity, CalendarDays, CalendarRange, LayoutGrid, Sparkles, Wand2,
} from 'lucide-react';

import { AppLayout }  from '@/components/AppLayout';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar }     from '@/components/shared/Avatar';
import * as api from '@/api';

/**
 * AdminAttendance v2 — rebuilt on design-system primitives.
 *
 * Three views (owner ask, July 2026 — previously only a single date
 * was selectable):
 *   · Daily    — original: one date, every teammate, expandable sessions
 *   · Monthly  — one row per day of the month, org-wide rollup
 *   · Calendar — one employee, a month grid, color-coded by day status
 *
 * Monthly + Calendar both run on ONE server endpoint
 * (/admin/attendance/monthly) so the three views never disagree — same
 * sessionTotals() math as the live timer and My Hours.
 */

interface BreakEvent { startedAt: string; endedAt?: string }

interface SessionRow {
  _id: string;
  startTime: string;
  endTime: string | null;
  effectiveEnd: string;
  status: 'active' | 'on_break' | 'ended';
  autoClosedAt: string | null;
  lastHeartbeatAt: string | null;
  breakEvents: BreakEvent[];
  workedMs: number;
  breakMs: number;
  activeMs: number;
}

interface AttendanceRow {
  user: { _id: string; name: string; email: string; role: string; team?: string; avatarUrl?: string };
  firstClockIn: string | null;
  lastClockOut: string | null;
  isStillActive: boolean;
  sessionCount: number;
  totalWorkedMs: number;
  totalActiveMs: number;
  totalBreakMs: number;
  sessions: SessionRow[];
}

interface AttendancePayload { date: string; rows: AttendanceRow[] }

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
};
const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
};
const todayKey = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const monthKey = () => todayKey().slice(0, 7);

type ViewMode = 'daily' | 'monthly' | 'calendar' | 'range';

export default function AdminAttendance() {
  const [view, setView] = useState<ViewMode>('daily');

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight inline-flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> Attendance
            </h1>
            <p className="text-[12px] text-muted-foreground">
              When each teammate clocked in and out (IST).
            </p>
          </div>
          {/* View switcher */}
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
            <ViewTab active={view === 'daily'}    onClick={() => setView('daily')}    icon={<CalendarDays className="h-3.5 w-3.5" />}  label="Daily" />
            <ViewTab active={view === 'monthly'}  onClick={() => setView('monthly')}  icon={<CalendarRange className="h-3.5 w-3.5" />} label="Monthly" />
            <ViewTab active={view === 'calendar'} onClick={() => setView('calendar')} icon={<LayoutGrid className="h-3.5 w-3.5" />}    label="Calendar" />
            <ViewTab active={view === 'range'}     onClick={() => setView('range')}     icon={<Sparkles className="h-3.5 w-3.5" />}      label="Date range + AI" />
          </div>
        </div>

        {view === 'daily' && <DailyView />}
        {view === 'monthly' && <MonthlyView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'range' && <RangeView />}
      </div>
    </AppLayout>
  );
}

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/60'
      }`}
    >
      {icon}{label}
    </button>
  );
}

/* ── Daily view (original behaviour, unchanged) ─────────────────────── */
function DailyView() {
  const [date, setDate]         = useState<string>(todayKey());
  const [data, setData]         = useState<AttendancePayload | null>(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async (d: string) => {
    setLoading(true);
    try { setData(await api.adminAttendance(d)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(date); }, [date]);

  const toggleRow = (uid: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });

  const isToday = date === todayKey();
  const totals = data?.rows.reduce(
    (acc, r) => {
      if (r.firstClockIn) acc.cameIn += 1;
      if (r.isStillActive) acc.stillActive += 1;
      acc.totalWorked += r.totalActiveMs;
      acc.totalBreak  += r.totalBreakMs;
      return acc;
    },
    { cameIn: 0, stillActive: 0, totalWorked: 0, totalBreak: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Filter + KPI strip */}
      <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-5 flex-wrap">
        <label className="flex items-center gap-2 text-[12px]">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={e => setDate(e.target.value)}
            className="bg-background border border-input rounded-md px-2.5 h-8 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        {totals && data && (
          <>
            <Stat value={`${totals.cameIn}/${data.rows.length}`} label="came in" />
            {isToday && <Stat value={totals.stillActive} label="still working" tone="success" />}
            <Stat value={fmtDuration(totals.totalWorked)} label="active total" />
            <Stat value={fmtDuration(totals.totalBreak)}  label="break total" tone="warning" />
          </>
        )}
      </div>

      {/* Table */}
      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState size="lg" title="No staff configured" />
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 h-9 border-b border-border bg-muted/30 items-center text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
            <div className="col-span-4">Employee</div>
            <div className="col-span-2">Clocked in</div>
            <div className="col-span-2">Clocked out</div>
            <div className="col-span-2 text-right">Active</div>
            <div className="col-span-1 text-right">Break</div>
            <div className="col-span-1 text-right">Sessions</div>
          </div>

          {data.rows.map((r, i) => {
            const open = expanded.has(r.user._id);
            return (
              <div key={r.user._id} className={i > 0 ? 'border-t border-border' : ''}>
                <button
                  onClick={() => toggleRow(r.user._id)}
                  className="w-full grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-left hover:bg-primary/[0.03] transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <Avatar name={r.user.name} email={r.user.email} size="sm" tone="primary" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{r.user.name || r.user.email}</p>
                      <p className="text-[10.5px] text-muted-foreground truncate capitalize">
                        {r.user.role}{r.user.team ? ` · ${r.user.team}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 text-[12.5px] tabular-nums">
                    {r.firstClockIn ? fmtTime(r.firstClockIn) : <span className="text-muted-foreground">absent</span>}
                  </div>
                  <div className="col-span-2 text-[12.5px] tabular-nums">
                    {r.isStillActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-[11.5px] font-semibold">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> still working
                      </span>
                    ) : r.lastClockOut ? fmtTime(r.lastClockOut) : <span className="text-muted-foreground">—</span>}
                  </div>
                  <div className="col-span-2 text-right text-[12.5px] tabular-nums font-semibold">
                    {r.totalActiveMs > 0 ? fmtDuration(r.totalActiveMs) : <span className="text-muted-foreground font-normal">—</span>}
                  </div>
                  <div className="col-span-1 text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {r.totalBreakMs > 0 ? fmtDuration(r.totalBreakMs) : '—'}
                  </div>
                  <div className="col-span-1 text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {r.sessionCount || '—'}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden bg-muted/[0.15]"
                    >
                      <div className="px-12 py-3 space-y-2">
                        {r.sessions.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">No sessions on this day.</p>
                        ) : r.sessions.map(s => <SessionDetail key={s._id} session={s} />)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Monthly view — one row per day, org-wide rollup ────────────────── */
interface MonthlyDay { firstClockIn: string | null; lastClockOut: string | null; activeMs: number; breakMs: number; status: string }
interface MonthlyEmployee { user: any; days: Record<string, MonthlyDay>; totals: { daysPresent: number; daysPartial: number; daysAbsent: number; daysLeave: number; totalActiveMs: number; totalBreakMs: number } }
interface MonthlyPayload { month: string; daysInMonth: number; employees: MonthlyEmployee[] }

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function MonthlyView() {
  const [month, setMonth] = useState(monthKey());
  const [data, setData] = useState<MonthlyPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.adminAttendanceMonthly(month).then(d => { if (!cancelled) setData(d); }).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [month]);

  // Roll the per-employee data up into per-day org totals.
  const dayRows = useMemo(() => {
    if (!data) return [];
    const dates = new Set<string>();
    for (const e of data.employees) for (const d of Object.keys(e.days)) dates.add(d);
    return [...dates].sort().map(date => {
      let cameIn = 0, present = 0, partial = 0, absent = 0, leave = 0, off = 0;
      let totalActive = 0, totalBreak = 0;
      for (const e of data.employees) {
        const d = e.days[date];
        if (!d) continue;
        if (d.firstClockIn) cameIn++;
        if (d.status === 'present') present++;
        else if (d.status === 'partial') partial++;
        else if (d.status === 'absent') absent++;
        else if (d.status === 'leave') leave++;
        else if (d.status === 'off') off++;
        totalActive += d.activeMs;
        totalBreak += d.breakMs;
      }
      const isOff = off === data.employees.length;
      return { date, cameIn, present, partial, absent, leave, isOff, totalActive, totalBreak };
    });
  }, [data]);

  return (
    <div className="space-y-4">
      <MonthPicker month={month} onChange={setMonth} />

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !data || dayRows.length === 0 ? (
        <EmptyState size="lg" title="No attendance data for this month" />
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 h-9 border-b border-border bg-muted/30 items-center text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
            <div className="col-span-3">Date</div>
            <div className="col-span-3">Came in</div>
            <div className="col-span-2 text-right">Full day</div>
            <div className="col-span-2 text-right">Active (total)</div>
            <div className="col-span-2 text-right">Break (total)</div>
          </div>
          {dayRows.map((d, i) => (
            <div key={d.date} className={`grid grid-cols-12 gap-2 px-4 py-2 items-center text-[12.5px] ${i > 0 ? 'border-t border-border' : ''} ${d.isOff ? 'opacity-50' : ''}`}>
              <div className="col-span-3 font-semibold tabular-nums">
                {new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}
              </div>
              <div className="col-span-3 tabular-nums text-muted-foreground">
                {d.isOff ? <span className="italic">Sunday</span> : `${d.cameIn} came in${d.leave ? ` · ${d.leave} on leave` : ''}${d.absent ? ` · ${d.absent} absent` : ''}`}
              </div>
              <div className="col-span-2 text-right tabular-nums">{d.present || '—'}</div>
              <div className="col-span-2 text-right tabular-nums font-semibold">{fmtDuration(d.totalActive)}</div>
              <div className="col-span-2 text-right tabular-nums text-muted-foreground">{fmtDuration(d.totalBreak)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Calendar view — one employee, a colour-coded month grid ────────── */
const STATUS_TONE: Record<string, string> = {
  present: 'bg-emerald-500/80 text-white',
  partial: 'bg-amber-500/80 text-white',
  absent:  'bg-rose-500/70 text-white',
  leave:   'bg-indigo-400/70 text-white',
  off:     'bg-muted text-muted-foreground',
};
const STATUS_LABEL: Record<string, string> = {
  present: 'Full day', partial: 'Partial', absent: 'Absent', leave: 'Leave', off: 'Off',
};

function CalendarView() {
  const [month, setMonth] = useState(monthKey());
  const [data, setData] = useState<MonthlyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.adminAttendanceMonthly(month).then(d => {
      if (cancelled) return;
      setData(d);
      if (!userId && d.employees.length > 0) setUserId(String(d.employees[0].user._id));
    }).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const employee = data?.employees.find(e => String(e.user._id) === userId);

  // Build a Mon-start calendar grid for the month.
  const grid = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const leadBlank = (first.getUTCDay() + 6) % 7;   // Mon=0
    const cells: Array<{ date: string; dayNum: number } | null> = [];
    for (let i = 0; i < leadBlank; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dayNum: d });
    }
    return cells;
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <MonthPicker month={month} onChange={setMonth} />
        {data && data.employees.length > 0 && (
          <select
            value={userId}
            onChange={e => setUserId(e.target.value)}
            className="h-8 px-2.5 rounded-md bg-background border border-input text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {data.employees.map(e => (
              <option key={e.user._id} value={e.user._id}>{e.user.name || e.user.email}</option>
            ))}
          </select>
        )}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !employee ? (
        <EmptyState size="lg" title="No staff configured" />
      ) : (
        <div className="border border-border rounded-xl bg-card p-4 space-y-3">
          {/* Totals strip */}
          <div className="flex items-center gap-5 flex-wrap pb-1">
            <Stat value={employee.totals.daysPresent} label="full days" tone="success" />
            <Stat value={employee.totals.daysPartial} label="partial days" tone="warning" />
            <Stat value={employee.totals.daysAbsent}  label="absent" tone={employee.totals.daysAbsent ? 'danger' : 'muted'} />
            <Stat value={employee.totals.daysLeave}   label="on leave" />
            <Stat value={fmtDuration(employee.totals.totalActiveMs)} label="active total" />
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] uppercase tracking-wide font-bold text-muted-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d}>{d}</div>)}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {grid.map((cell, i) => {
              if (!cell) return <div key={i} />;
              const day = employee.days[cell.date];
              const tone = day ? (STATUS_TONE[day.status] || 'bg-muted') : 'bg-muted/40';
              const title = day
                ? `${cell.date} — ${STATUS_LABEL[day.status] || day.status}` +
                  (day.firstClockIn ? ` · in ${fmtTime(day.firstClockIn)}` : '') +
                  (day.lastClockOut ? ` · out ${fmtTime(day.lastClockOut)}` : '') +
                  (day.activeMs > 0 ? ` · ${fmtDuration(day.activeMs)} worked` : '')
                : cell.date;
              return (
                <div key={cell.date} title={title}
                  className={`rounded-lg ${tone} px-1.5 py-1.5 min-h-[60px] flex flex-col justify-between text-[10px] leading-tight transition-transform hover:scale-[1.03]`}>
                  <span className="font-bold">{cell.dayNum}</span>
                  {day && day.status !== 'off' && (
                    <div className="space-y-0.5">
                      {day.firstClockIn && <div className="tabular-nums">{fmtTime(day.firstClockIn)}</div>}
                      {day.activeMs > 0 && <div className="tabular-nums opacity-90">{fmtDuration(day.activeMs)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1 text-[10.5px] text-muted-foreground">
            {(['present', 'partial', 'absent', 'leave', 'off'] as const).map(s => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_TONE[s]}`} />{STATUS_LABEL[s]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Date-range view — custom from/to + AI executive summary ────────── */
interface RangePayload { from: string; to: string; totalDays: number; employees: MonthlyEmployee[] }

function daysAgoKey(n: number) {
  return new Date(Date.now() + 330 * 60_000 - n * 24 * 3600_000).toISOString().slice(0, 10);
}

function RangeView() {
  const [from, setFrom] = useState(daysAgoKey(6));   // last 7 days by default
  const [to, setTo] = useState(todayKey());
  const [data, setData] = useState<RangePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryRange, setSummaryRange] = useState<string>('');

  const load = async () => {
    if (!from || !to || to < from) return;
    setLoading(true);
    setSummary(null);
    try { setData(await api.adminAttendanceRange(from, to)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const generateSummary = async () => {
    if (!from || !to || to < from) return;
    setSummarizing(true);
    try {
      const r = await api.adminAttendanceRangeSummary(from, to);
      setSummary(r.summary);
      setSummaryRange(`${from} → ${to}`);
    } finally { setSummarizing(false); }
  };

  const rows = data?.employees.map(e => ({
    ...e,
    attendanceRate: data.totalDays > 0
      ? Math.round(((e.totals.daysPresent + e.totals.daysPartial) / Math.max(1, Object.values(e.days).filter(d => d.status !== 'off').length)) * 100)
      : 0,
  })) || [];

  return (
    <div className="space-y-4">
      {/* Pickers */}
      <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[12px]">
          <span className="text-muted-foreground">From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="bg-background border border-input rounded-md px-2 h-8 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="flex items-center gap-1.5 text-[12px]">
          <span className="text-muted-foreground">To</span>
          <input type="date" value={to} max={todayKey()} min={from} onChange={e => setTo(e.target.value)}
            className="bg-background border border-input rounded-md px-2 h-8 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <button onClick={load} disabled={loading}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
        </button>
        <button onClick={generateSummary} disabled={summarizing || !data}
          className="h-8 px-3 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ml-auto"
        >
          {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Generate AI summary
        </button>
      </div>

      {/* AI summary */}
      {summary && (
        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3.5 w-3.5" /> AI summary · {summaryRange}
          </p>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      {/* Table */}
      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !data || rows.length === 0 ? (
        <EmptyState size="lg" title="No staff configured" />
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 h-9 border-b border-border bg-muted/30 items-center text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
            <div className="col-span-4">Employee</div>
            <div className="col-span-2 text-right">Attendance</div>
            <div className="col-span-2 text-right">Full / partial</div>
            <div className="col-span-1 text-right">Absent</div>
            <div className="col-span-1 text-right">Leave</div>
            <div className="col-span-2 text-right">Active total</div>
          </div>
          {rows.map((r, i) => (
            <div key={r.user._id} className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-[12.5px] ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="col-span-4 flex items-center gap-2 min-w-0">
                <Avatar name={r.user.name} email={r.user.email} size="sm" tone="primary" />
                <p className="font-semibold truncate">{r.user.name || r.user.email}</p>
              </div>
              <div className="col-span-2 text-right tabular-nums font-semibold">
                <span className={r.attendanceRate >= 90 ? 'text-emerald-600' : r.attendanceRate >= 70 ? 'text-amber-600' : 'text-rose-600'}>
                  {r.attendanceRate}%
                </span>
              </div>
              <div className="col-span-2 text-right tabular-nums text-muted-foreground">
                {r.totals.daysPresent} / {r.totals.daysPartial}
              </div>
              <div className="col-span-1 text-right tabular-nums">
                {r.totals.daysAbsent > 0 ? <span className="text-rose-600 font-semibold">{r.totals.daysAbsent}</span> : '—'}
              </div>
              <div className="col-span-1 text-right tabular-nums text-muted-foreground">{r.totals.daysLeave || '—'}</div>
              <div className="col-span-2 text-right tabular-nums font-semibold">{fmtDuration(r.totals.totalActiveMs)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1 border border-border rounded-lg bg-card px-2 h-9">
      <button onClick={() => onChange(shiftMonth(month, -1))} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/60">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-[12.5px] font-semibold px-2 min-w-[120px] text-center">{monthLabel(month)}</span>
      <button
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={shiftMonth(month, 1) > monthKey()}
        className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/60 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SessionDetail({ session }: { session: SessionRow }) {
  const isAuto = !!session.autoClosedAt;
  return (
    <div className="border border-border rounded-lg bg-card px-3 py-2 text-[11.5px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold tabular-nums">
          {fmtTime(session.startTime)} → {session.endTime ? fmtTime(session.endTime) : 'still active'}
        </span>
        {session.status === 'ended' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-muted text-muted-foreground">
            <CheckCircle2 className="h-2.5 w-2.5" /> Ended
          </span>
        )}
        {session.status === 'on_break' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-amber-500/15 text-amber-700">
            <Coffee className="h-2.5 w-2.5" /> On break
          </span>
        )}
        {session.status === 'active' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-emerald-500/15 text-emerald-700">
            <Activity className="h-2.5 w-2.5" /> Active
          </span>
        )}
        {isAuto && (
          <span
            className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-amber-500/12 text-amber-700 border border-amber-500/25"
            title="Closed by the end-of-day cron because the user forgot to clock out"
          >
            <AlertTriangle className="h-2.5 w-2.5" /> Auto-closed
          </span>
        )}
        <span className="ml-auto text-muted-foreground tabular-nums">
          worked <strong className="text-foreground">{fmtDuration(session.activeMs)}</strong>
          {session.breakMs > 0 && <> · break <strong className="text-foreground">{fmtDuration(session.breakMs)}</strong></>}
        </span>
      </div>
      {session.breakEvents.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {session.breakEvents.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded bg-amber-500/10 text-amber-700 text-[10px]">
              <Coffee className="h-2.5 w-2.5" />
              {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : '...'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
