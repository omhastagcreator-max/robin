import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Sunrise, CloudSun, Moon, CheckCircle2, Circle, Clock, AlertCircle,
  RefreshCw, Search, ChevronLeft, ChevronRight, Calendar,
  Users, ListChecks, AlertTriangle, Sparkles,
} from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import * as api from '@/api';

/**
 * TeamPulsePage — admin / Om-style manager dashboard for the daily
 * 3-popup pulse.
 *
 * Owner ask (June 2026): "Create a new dashboard in Om and admin
 * where they can see the daily tasks and half-day update of all
 * employees, also last based on the popup that they have entered."
 *
 * One full-page surface that:
 *   • Shows everyone's morning brand pulse + planned tasks at the top
 *   • Shows the midday status the teammate set (done/in-progress/
 *     blocked/not-started) on each of those tasks + their blockers
 *   • Shows the evening status + reason + tomorrow plan
 *   • Filters by date (browse history), by team, by status (only
 *     overdue / only blocked / only meetings)
 *   • Live updates via the shared robin:data-changed socket event
 *
 * Reads from /api/checkin/admin/report (which the existing controller
 * builds in one query). No new backend models.
 */

interface PulseTask {
  title: string;
  priority: string;
  kind?: 'task' | 'meeting';
  meetingAt?: string | null;
  middayStatus: string;
  eveningStatus: string;
  eveningReason: string;
}
interface PulseBrand {
  clientName: string;
  metaStatus: string;
  note: string;
}
interface PulseRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  team: string;
  avatarUrl: string;
  morningDone: boolean;
  middayDone: boolean;
  eveningDone: boolean;
  morningTasks: number;
  doneTasks: number;
  leftTasks: number;
  blockers: string;
  tomorrowPlan: string;
  tasks: PulseTask[];
  brands: PulseBrand[];
}

type FilterKind = 'all' | 'incomplete' | 'blocked' | 'meetings';

function istTodayKey(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

function shiftDay(d: string, deltaDays: number): string {
  const [y, m, day] = d.split('-').map(n => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function humanDate(d: string): string {
  const today = istTodayKey();
  const yest  = shiftDay(today, -1);
  if (d === today) return 'Today';
  if (d === yest)  return 'Yesterday';
  const [y, m, day] = d.split('-').map(n => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TeamPulsePage() {
  const [date, setDate] = useState<string>(istTodayKey());
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [autoExpand, setAutoExpand] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getTeamPulseReport(date);
      if (r?.ok) setRows((r.rows || []) as PulseRow[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  // Live refresh on any checkin mutation today; ignore other days.
  useEffect(() => {
    if (date !== istTodayKey()) return;
    const onData = (e: any) => { if (e?.detail?.entity === 'checkin') void load(); };
    window.addEventListener('robin:data-changed', onData);
    return () => window.removeEventListener('robin:data-changed', onData);
  }, [date, load]);

  // Auto-expand the first row when data loads — gives users an
  // immediate sense of "what does this page show" without a click.
  useEffect(() => {
    if (!autoExpand || rows.length === 0) return;
    const target = rows.find(r => r.morningDone) || rows[0];
    if (target) setExpanded(p => ({ ...p, [target.userId]: true }));
    setAutoExpand(false);
  }, [rows, autoExpand]);

  const teams = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.team) s.add(r.team);
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      if (teamFilter !== 'all' && r.team !== teamFilter) return false;
      if (term && !(r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term))) return false;
      if (filterKind === 'incomplete' && r.morningDone && r.middayDone && r.eveningDone) return false;
      if (filterKind === 'blocked') {
        const anyBlocked = r.blockers.length > 0 || r.tasks.some(t => t.middayStatus === 'blocked' || t.eveningStatus === 'dropped');
        if (!anyBlocked) return false;
      }
      if (filterKind === 'meetings') {
        if (!r.tasks.some(t => t.kind === 'meeting')) return false;
      }
      return true;
    });
  }, [rows, q, teamFilter, filterKind]);

  const totals = useMemo(() => ({
    people:    rows.length,
    morning:   rows.filter(r => r.morningDone).length,
    midday:    rows.filter(r => r.middayDone).length,
    evening:   rows.filter(r => r.eveningDone).length,
    planned:   rows.reduce((s, r) => s + r.morningTasks, 0),
    done:      rows.reduce((s, r) => s + r.doneTasks, 0),
    blockers:  rows.filter(r => r.blockers && r.blockers.trim().length > 0).length,
    meetings:  rows.reduce((s, r) => s + r.tasks.filter(t => t.kind === 'meeting').length, 0),
  }), [rows]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-5">
        {/* ── Hero header ────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-amber-400/15 via-violet-400/15 to-sky-400/15 px-6 py-6">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-violet-400/20 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Team Pulse</p>
              <h1 className="text-2xl sm:text-3xl font-bold mt-1 leading-tight">Everyone's day at a glance</h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Morning plan · halfway pulse · end-of-day wrap. Updates live.
              </p>
            </div>
            <button
              onClick={load}
              className="h-9 px-3 rounded-xl bg-card border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted/40 transition-colors shadow-sm"
            >
              <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
              Refresh
            </button>
          </div>

          {/* Stat strip */}
          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <StatCard icon={<Sunrise className="h-3.5 w-3.5 text-amber-700" />}
              label="Morning done" value={`${totals.morning} / ${totals.people}`} accent="from-amber-500/15 to-amber-500/5" />
            <StatCard icon={<CloudSun className="h-3.5 w-3.5 text-sky-700" />}
              label="Midday done"  value={`${totals.midday} / ${totals.people}`} accent="from-sky-500/15 to-sky-500/5" />
            <StatCard icon={<Moon className="h-3.5 w-3.5 text-indigo-700" />}
              label="Evening done" value={`${totals.evening} / ${totals.people}`} accent="from-indigo-500/15 to-indigo-500/5" />
            <StatCard icon={<ListChecks className="h-3.5 w-3.5 text-emerald-700" />}
              label="Tasks closed" value={`${totals.done} / ${totals.planned}`} accent="from-emerald-500/15 to-emerald-500/5" />
          </div>
        </div>

        {/* ── Filters bar ────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-3 sm:p-4 flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Date stepper */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5">
            <button onClick={() => setDate(shiftDay(date, -1))} className="h-8 w-8 rounded-md hover:bg-card flex items-center justify-center" title="Previous day">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="px-2 text-[12.5px] font-semibold inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              {humanDate(date)}
            </div>
            <button
              onClick={() => setDate(shiftDay(date, +1))}
              disabled={date === istTodayKey()}
              className="h-8 w-8 rounded-md hover:bg-card flex items-center justify-center disabled:opacity-30"
              title="Next day"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Date picker (jump) */}
          <input
            type="date"
            value={date}
            max={istTodayKey()}
            onChange={e => setDate(e.target.value || istTodayKey())}
            className="h-8 px-2 rounded-lg bg-background border border-border text-[12px]"
          />

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search teammate…"
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-background border border-border text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
          </div>

          {/* Team */}
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            className="h-8 px-2 rounded-lg bg-background border border-border text-[12px]"
          >
            <option value="all">All teams</option>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Kind chips */}
          <div className="inline-flex p-0.5 bg-muted/40 rounded-lg text-[11px] font-semibold">
            <KindChip active={filterKind === 'all'}        onClick={() => setFilterKind('all')}>All</KindChip>
            <KindChip active={filterKind === 'incomplete'} onClick={() => setFilterKind('incomplete')}>Incomplete</KindChip>
            <KindChip active={filterKind === 'blocked'}    onClick={() => setFilterKind('blocked')}>Blockers</KindChip>
            <KindChip active={filterKind === 'meetings'}   onClick={() => setFilterKind('meetings')}>
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{totals.meetings}</span>
            </KindChip>
          </div>
        </div>

        {/* ── Cards ──────────────────────────────────────────── */}
        {filtered.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground/60" />
            <p className="text-sm font-semibold mt-2">Nobody matches these filters</p>
            <p className="text-[12px] text-muted-foreground mt-1">Try clearing the search or switching to "All".</p>
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(r => (
            <PersonCard
              key={r.userId}
              row={r}
              expanded={!!expanded[r.userId]}
              onToggle={() => setExpanded(p => ({ ...p, [r.userId]: !p[r.userId] }))}
            />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

/* ───────────────────────────── Components ─────────────────────────────── */

function StatCard({ icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-gradient-to-br ${accent} p-3`}>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground">
        {icon}{label}
      </div>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      onClick={onClick}
      className={
        'h-7 px-2.5 rounded-md transition-all ' +
        (active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-card/60')
      }
    >
      {children}
    </button>
  );
}

function PersonCard({ row, expanded, onToggle }: { row: PulseRow; expanded: boolean; onToggle: () => void }) {
  const initials = (row.name || '?').slice(0, 1).toUpperCase();
  const meetingsToday = row.tasks.filter(t => t.kind === 'meeting').length;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all hover:shadow-sm">
      {/* Top bar */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors"
      >
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-white text-sm font-bold inline-flex items-center justify-center shrink-0 shadow-sm">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold truncate">{row.name}</p>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{row.role}</span>
            {row.team && <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded font-semibold">{row.team}</span>}
            {meetingsToday > 0 && (
              <span className="text-[10px] bg-indigo-500/15 text-indigo-700 border border-indigo-500/30 px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-semibold">
                <Calendar className="h-3 w-3" /> {meetingsToday}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
            <StageDot done={row.morningDone} label="Morning" icon={<Sunrise className="h-3 w-3" />} />
            <StageDot done={row.middayDone}  label="Midday"  icon={<CloudSun className="h-3 w-3" />} />
            <StageDot done={row.eveningDone} label="Evening" icon={<Moon className="h-3 w-3" />} />
            <span className="text-foreground/80">
              <span className={row.leftTasks > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                {row.doneTasks}/{row.morningTasks}
              </span> tasks
            </span>
            {row.blockers && <span className="text-rose-700 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />blocker</span>}
          </div>
        </div>
        <ChevronRight className={'h-4 w-4 text-muted-foreground transition-transform ' + (expanded ? 'rotate-90' : '')} />
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border bg-muted/15 p-4 space-y-4">
          {!row.morningDone && (
            <EmptyHint icon={<Sunrise className="h-3.5 w-3.5 text-amber-700" />} text="Hasn't filled the morning check-in yet for this day." />
          )}

          {/* Brand pulse */}
          {row.brands.length > 0 && (
            <Section title="Brand pulse" icon={<Sparkles className="h-3.5 w-3.5 text-orange-600" />}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {row.brands.map((b, i) => <BrandChip key={i} brand={b} />)}
              </div>
            </Section>
          )}

          {/* Tasks + meetings */}
          {row.tasks.length > 0 && (
            <Section title={`Tasks · ${row.tasks.length}`} icon={<ListChecks className="h-3.5 w-3.5 text-emerald-700" />}>
              <div className="space-y-1.5">
                {row.tasks.map((t, i) => <TaskLine key={i} task={t} />)}
              </div>
            </Section>
          )}

          {/* Midday blockers */}
          {row.blockers && (
            <Section title="Midday blockers" icon={<AlertCircle className="h-3.5 w-3.5 text-rose-700" />}>
              <p className="rounded-lg bg-rose-500/5 border border-rose-500/25 p-2.5 text-[12.5px] text-rose-900">
                {row.blockers}
              </p>
            </Section>
          )}

          {/* Evening tomorrow plan */}
          {row.tomorrowPlan && (
            <Section title="Tomorrow plan" icon={<Moon className="h-3.5 w-3.5 text-indigo-700" />}>
              <p className="rounded-lg bg-indigo-500/5 border border-indigo-500/25 p-2.5 text-[12.5px] text-indigo-900 whitespace-pre-wrap">
                {row.tomorrowPlan}
              </p>
            </Section>
          )}

          {!row.morningDone && row.brands.length === 0 && row.tasks.length === 0 && !row.blockers && (
            <p className="text-[12px] text-muted-foreground italic">No data for this day.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StageDot({ done, label, icon }: { done: boolean; label: string; icon: any }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={'h-1.5 w-1.5 rounded-full ' + (done ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
      {icon}
      <span className={done ? 'text-foreground/80' : 'text-muted-foreground/70'}>{label}</span>
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: any; children: any }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5 inline-flex items-center gap-1.5">
        {icon}{title}
      </p>
      {children}
    </div>
  );
}

function BrandChip({ brand }: { brand: PulseBrand }) {
  const cls =
    brand.metaStatus === 'running' ? 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30' :
    brand.metaStatus === 'paused'  ? 'bg-amber-500/15 text-amber-800 border-amber-500/30'       :
    brand.metaStatus === 'off'     ? 'bg-rose-500/15 text-rose-800 border-rose-500/30'          :
    brand.metaStatus === 'pending' ? 'bg-blue-500/15 text-blue-800 border-blue-500/30'          :
                                     'bg-muted/40 text-muted-foreground border-border';
  return (
    <span className={'h-6 px-2 rounded-full border text-[11px] inline-flex items-center gap-1 font-semibold ' + cls}>
      {brand.clientName} · {brand.metaStatus}
      {brand.note && <span className="opacity-70 font-normal">— {brand.note}</span>}
    </span>
  );
}

function TaskLine({ task }: { task: PulseTask }) {
  const isMeeting = task.kind === 'meeting';
  const time = task.meetingAt ? new Date(task.meetingAt) : null;
  const timeStr = time ? time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const finalStatus = task.eveningStatus || task.middayStatus || '';

  return (
    <div className={
      'flex items-start gap-2 rounded-lg px-2.5 py-2 border ' +
      (isMeeting ? 'bg-indigo-500/5 border-indigo-500/25' : 'bg-background border-border')
    }>
      {isMeeting
        ? <Calendar className="h-3.5 w-3.5 mt-0.5 text-indigo-600 shrink-0" />
        : <StatusIcon status={finalStatus} />}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold truncate">{task.title}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
          <PriorityPill p={task.priority} />
          {task.middayStatus && <span>midday: <strong className="text-foreground">{labelize(task.middayStatus)}</strong></span>}
          {task.eveningStatus && <span>evening: <strong className="text-foreground">{labelize(task.eveningStatus)}</strong></span>}
        </div>
        {task.eveningReason && (
          <p className="text-[11.5px] text-rose-700/90 italic mt-1">↳ {task.eveningReason}</p>
        )}
      </div>
      {isMeeting && timeStr && (
        <span className="h-5 px-1.5 rounded text-[10px] uppercase font-bold bg-indigo-500/15 text-indigo-700 shrink-0">
          {timeStr}
        </span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />;
  if (status === 'blocked' || status === 'dropped') return <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-rose-600 shrink-0" />;
  if (status === 'in_progress' || status === 'rolled_over') return <Clock className="h-3.5 w-3.5 mt-0.5 text-blue-600 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />;
}

function labelize(s: string): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ');
}

function PriorityPill({ p }: { p: string }) {
  const cls =
    p === 'urgent' ? 'bg-rose-500 text-white'   :
    p === 'high'   ? 'bg-orange-500 text-white' :
    p === 'medium' ? 'bg-blue-500 text-white'   :
                     'bg-muted text-muted-foreground';
  return <span className={'h-4 px-1.5 rounded text-[9.5px] uppercase font-bold ' + cls}>{p}</span>;
}

function EmptyHint({ icon, text }: { icon: any; text: string }) {
  return (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-[12px] inline-flex items-center gap-2 text-amber-900">
      {icon}{text}
    </div>
  );
}
