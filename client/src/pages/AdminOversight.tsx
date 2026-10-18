import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CalendarOff, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock,
  Coffee, Headphones, ListChecks, Loader2, LogIn, LogOut, MonitorUp, Phone, RefreshCw, Search,
  ShieldCheck, Sunrise, Timer, UserX, Users, X, UserPlus,
} from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Avatar } from '@/components/shared/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { AddMemberModal } from '@/components/admin/AddMemberModal';
import * as api from '@/api';

/**
 * Team Oversight — Oct 2026 (owner ask: "a dashboard at admin end where he
 * can see everything — login, break hrs, activity — and Rahul is manager
 * so he should be able to see everything also").
 *
 * One screen, one API call (/api/oversight/day). Per teammate: live status,
 * when they first opened Robin / signed in (+device), clock-in/out, worked
 * vs 8h, every break with times, huddle time, check-ins, tasks, client
 * activity, a 7-day hours trend — plus an org-wide activity feed.
 *
 * Access: admin, or anyone admin grants via "Manage access" (User.canViewOversight).
 * All time math is server-side through sessionTime.ts — same numbers as the
 * live timer, Attendance and the payroll report.
 */

type Status = 'working' | 'on_break' | 'away' | 'clocked_out' | 'not_in' | 'on_leave';

interface BreakRow { startedAt: string; endedAt: string | null; durationMs: number; ongoing: boolean }
interface SessionRow { id: string; startTime: string; endTime: string | null; effectiveEnd: string; status: string; autoClosedAt: string | null; activeMs: number; breakMs: number; huddleMs: number }
interface LoginRow { at: string; method: string; kind: 'login' | 'opened'; device: string; ip: string }
interface Row {
  user: { id: string; name: string; email: string; role: string; team?: string; avatarUrl?: string };
  status: Status;
  inHuddle: boolean; onCall: boolean; screenSharing: boolean;
  firstSeen: string | null; logins: LoginRow[];
  firstClockIn: string | null; lastClockOut: string | null; lastSeen: string | null;
  workedMs: number; activeMs: number; breakMs: number; huddleMs: number;
  breakCount: number; longestBreakMs: number; breaks: BreakRow[]; sessions: SessionRow[];
  leave: null | { status: string; dayType: string; reason: string };
  checkin: { morningAt: string | null; middayAt: string | null; eveningAt: string | null; planned: number; done: number; blockers: string; tomorrowPlan: string; tasks: { title: string; client: string; status: string; reason: string }[] };
  tasks: { done: number; created: number; open: number; overdue: number; doneTitles: string[] };
  activity: { clientWork: number; leadNotes: number; meetings: number; chats: number };
  week: { date: string; activeMs: number; breakMs: number }[];
  weekAvgActiveMs: number;
  flags: string[];
}
interface Ev { at: string; userId: string; userName: string; type: string; label: string; detail?: string }
interface Payload {
  date: string; isToday: boolean; generatedAt: string;
  kpis: Record<string, number>;
  rows: Row[];
  timeline: Ev[];
}

const IST = 330 * 60_000;
const todayKey = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const shiftDay = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const fmtDur = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(t / 60), m = t % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const ago = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`;
};
const istMins = (iso: string) => { const d = new Date(new Date(iso).getTime() + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
  working:     { label: 'Working',      cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-500' },
  on_break:    { label: 'On break',     cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30', dot: 'bg-amber-500' },
  away:        { label: 'Idle', cls: 'bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/30', dot: 'bg-orange-500' },
  clocked_out: { label: 'Clocked out',  cls: 'bg-slate-500/12 text-slate-700 dark:text-slate-300 border-slate-500/30', dot: 'bg-slate-400' },
  not_in:      { label: 'Not logged in', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30', dot: 'bg-rose-500' },
  on_leave:    { label: 'On leave',     cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30', dot: 'bg-sky-500' },
};
const FLAG: Record<string, { label: string; tone: 'bad' | 'warn' }> = {
  late:          { label: 'Late in', tone: 'warn' },
  over_break:    { label: 'Break > 1h', tone: 'bad' },
  long_break:    { label: 'Long break', tone: 'warn' },
  auto_closed:   { label: 'Forgot to log out', tone: 'warn' },
  short_day:     { label: 'Under 8h', tone: 'warn' },
  no_checkin:    { label: 'No morning check-in', tone: 'warn' },
  idle:          { label: 'Idle', tone: 'bad' },
  overdue_tasks: { label: 'Overdue tasks', tone: 'bad' },
};
const EV_ICON: Record<string, { icon: any; cls: string }> = {
  login:        { icon: LogIn,        cls: 'text-sky-600 bg-sky-500/10' },
  clock_in:     { icon: Sunrise,      cls: 'text-emerald-600 bg-emerald-500/10' },
  clock_out:    { icon: LogOut,       cls: 'text-slate-600 bg-slate-500/10' },
  break_start:  { icon: Coffee,       cls: 'text-amber-600 bg-amber-500/10' },
  break_end:    { icon: Timer,        cls: 'text-amber-600 bg-amber-500/10' },
  checkin:      { icon: ListChecks,   cls: 'text-indigo-600 bg-indigo-500/10' },
  task_done:    { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-500/10' },
  task_created: { icon: ListChecks,   cls: 'text-violet-600 bg-violet-500/10' },
  client_work:  { icon: Activity,     cls: 'text-teal-600 bg-teal-500/10' },
  lead_note:    { icon: Phone,        cls: 'text-orange-600 bg-orange-500/10' },
  meeting:      { icon: Users,        cls: 'text-fuchsia-600 bg-fuchsia-500/10' },
  leave:        { icon: CalendarOff,  cls: 'text-sky-600 bg-sky-500/10' },
  other:        { icon: Activity,     cls: 'text-muted-foreground bg-muted' },
};
const EV_FILTERS: { key: string; label: string; types: string[] }[] = [
  { key: 'all', label: 'All', types: [] },
  { key: 'time', label: 'Login & clock', types: ['login', 'clock_in', 'clock_out'] },
  { key: 'breaks', label: 'Breaks', types: ['break_start', 'break_end'] },
  { key: 'work', label: 'Work', types: ['task_done', 'task_created', 'client_work', 'lead_note', 'meeting'] },
  { key: 'checkins', label: 'Check-ins', types: ['checkin'] },
];
const STATUS_FILTERS: { key: string; label: string; test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'Everyone', test: () => true },
  { key: 'working', label: 'Working', test: r => r.status === 'working' },
  { key: 'on_break', label: 'On break', test: r => r.status === 'on_break' },
  { key: 'not_in', label: 'Not in', test: r => r.status === 'not_in' || r.status === 'on_leave' },
  { key: 'flagged', label: 'Needs attention', test: r => r.flags.some(f => FLAG[f]?.tone === 'bad') || r.flags.includes('late') },
];

export default function AdminOversight() {
  const { user, role } = useAuth();
  const isAdmin = [role, ...((user as any)?.roles || [])].includes('admin');
  const allowed = isAdmin || (user as any)?.canViewOversight === true;

  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [evFilter, setEvFilter] = useState('all');
  const [evUser, setEvUser] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async (d: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try { setData(await api.getOversightDay(d)); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Could not load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) load(date); }, [date, allowed, load]);
  // Live refresh every 60s while viewing today and the tab is visible.
  useEffect(() => {
    if (!allowed || date !== todayKey()) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(date, true); }, 60_000);
    return () => clearInterval(id);
  }, [date, allowed, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = STATUS_FILTERS.find(s => s.key === statusFilter) || STATUS_FILTERS[0];
    const needle = q.trim().toLowerCase();
    const order: Record<Status, number> = { working: 0, on_break: 1, away: 2, clocked_out: 3, not_in: 4, on_leave: 5 };
    return data.rows
      .filter(f.test)
      .filter(r => !needle || r.user.name.toLowerCase().includes(needle) || (r.user.team || '').toLowerCase().includes(needle))
      .sort((a, b) => order[a.status] - order[b.status] || a.user.name.localeCompare(b.user.name));
  }, [data, statusFilter, q]);

  const events = useMemo(() => {
    if (!data) return [];
    const types = EV_FILTERS.find(f => f.key === evFilter)?.types || [];
    return data.timeline.filter(e => (!types.length || types.includes(e.type)) && (evUser === 'all' || e.userId === evUser));
  }, [data, evFilter, evUser]);

  if (!allowed) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto mt-16 text-center border border-border rounded-2xl bg-card p-6">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground" />
          <h1 className="mt-2 text-lg font-bold">Team Oversight is for admin and managers</h1>
          <p className="text-sm text-muted-foreground mt-1">Ask an admin to give you access from Team Oversight → Manage access.</p>
        </div>
      </AppLayout>
    );
  }

  const k = data?.kpis;
  const isToday = date === todayKey();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap pb-3 border-b border-border">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Team Oversight
            </h1>
            <p className="text-[12px] text-muted-foreground">
              Everyone's sign-ins, hours, breaks and work for the day (IST).
              {data && isToday && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />Live · updated {ago(data.generatedAt)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-lg border border-border bg-card">
              <button aria-label="Previous day" onClick={() => setDate(d => shiftDay(d, -1))} className="h-8 w-8 grid place-items-center hover:bg-muted/60 rounded-l-lg"><ChevronLeft className="h-4 w-4" /></button>
              <input type="date" value={date} max={todayKey()} onChange={e => e.target.value && setDate(e.target.value)}
                className="h-8 bg-transparent px-2 text-[12.5px] border-x border-border focus:outline-none" />
              <button aria-label="Next day" disabled={isToday} onClick={() => setDate(d => shiftDay(d, 1))} className="h-8 w-8 grid place-items-center hover:bg-muted/60 rounded-r-lg disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
            {!isToday && <button onClick={() => setDate(todayKey())} className="h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-semibold hover:bg-muted/60">Today</button>}
            <button onClick={() => load(date)} className="h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-semibold hover:bg-muted/60 inline-flex items-center gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setAddOpen(true)} className="h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-semibold hover:bg-muted/60 inline-flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5" /> Add team member
            </button>
            {isAdmin && (
              <button onClick={() => setAccessOpen(true)} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Manage access
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="border border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300 rounded-xl px-4 py-3 text-[13px] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? null : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Kpi icon={<Users className="h-4 w-4" />} label="Came in" value={`${k!.present}/${k!.staff}`} sub={k!.onLeave ? `${k!.onLeave} on leave` : undefined} />
              {isToday ? (
                <Kpi icon={<Activity className="h-4 w-4" />} label="Working now" value={k!.workingNow} tone="good"
                  sub={`${k!.onBreakNow} on break · ${k!.inHuddleNow} in huddle`} />
              ) : (
                <Kpi icon={<UserX className="h-4 w-4" />} label="Didn't come in" value={k!.notIn} tone={k!.notIn ? 'bad' : undefined} />
              )}
              <Kpi icon={<Clock className="h-4 w-4" />} label="Hours worked" value={fmtDur(k!.totalActiveMs)} sub={`avg ${fmtDur(k!.avgActiveMs)} / person`} />
              <Kpi icon={<Coffee className="h-4 w-4" />} label="Break time" value={fmtDur(k!.totalBreakMs)} tone={k!.overBreak ? 'warn' : undefined} sub={k!.overBreak ? `${k!.overBreak} over the limit` : 'all within limits'} />
              <Kpi icon={<Sunrise className="h-4 w-4" />} label="Late arrivals" value={k!.late} tone={k!.late ? 'warn' : undefined} sub="after 9:30 AM" />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Tasks done" value={k!.tasksDone} tone={k!.overdueTasks ? 'warn' : 'good'} sub={`${k!.overdueTasks} overdue open`} />
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
              {/* Team table */}
              <section className="border border-border rounded-xl bg-card overflow-hidden min-w-0">
                <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-border">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search teammate"
                      className="h-8 w-44 pl-8 pr-2 rounded-md border border-input bg-background text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {STATUS_FILTERS.map(f => {
                      const n = data.rows.filter(f.test).length;
                      return (
                        <button key={f.key} onClick={() => setStatusFilter(f.key)}
                          className={`h-7 px-2.5 rounded-full text-[11.5px] font-semibold border transition-colors ${statusFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted/60'}`}>
                          {f.label} <span className="opacity-70">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[860px]">
                    <div className="grid grid-cols-[minmax(170px,1.6fr)_1.1fr_0.8fr_0.8fr_1.3fr_1fr_0.7fr_0.8fr_0.7fr_24px] gap-2 px-3 h-9 items-center border-b border-border bg-muted/30 text-[10px] uppercase tracking-[0.12em] font-bold text-muted-foreground">
                      <div>Teammate</div><div>Status</div><div>First seen</div><div>Clock in</div>
                      <div>Worked</div><div>Breaks</div><div>Huddle</div><div>Check-ins</div><div>Tasks</div><div />
                    </div>
                    {rows.length === 0 && <div className="py-10"><EmptyState title="Nobody matches this filter" /></div>}
                    {rows.map(r => (
                      <PersonRow key={r.user.id} r={r} isToday={isToday} open={expanded === r.user.id}
                        onToggle={() => setExpanded(x => x === r.user.id ? null : r.user.id)}
                        events={data.timeline.filter(e => e.userId === r.user.id)} />
                    ))}
                  </div>
                </div>
              </section>

              {/* Activity feed */}
              <section className="border border-border rounded-xl bg-card overflow-hidden 2xl:sticky 2xl:top-4">
                <div className="px-3 py-2.5 border-b border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[13px] font-bold inline-flex items-center gap-1.5"><Activity className="h-4 w-4 text-primary" /> Activity feed</h2>
                    <select value={evUser} onChange={e => setEvUser(e.target.value)} className="h-7 rounded-md border border-input bg-background text-[11.5px] px-1.5 max-w-[150px]">
                      <option value="all">Everyone</option>
                      {data.rows.map(r => <option key={r.user.id} value={r.user.id}>{r.user.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {EV_FILTERS.map(f => (
                      <button key={f.key} onClick={() => setEvFilter(f.key)}
                        className={`h-6 px-2 rounded-full text-[11px] font-semibold border ${evFilter === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:bg-muted/60'}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[520px] 2xl:max-h-[70vh] overflow-y-auto">
                  {events.length === 0 ? <div className="py-10"><EmptyState title="No activity yet" /></div> : <Feed events={events} showName={evUser === 'all'} />}
                </div>
              </section>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Worked = clocked-in time minus breaks (same as the live timer). "First seen" = first sign-in or app open that day; sign-ins are recorded from Oct 2026 onwards.
              Late = clock-in after 9:30 AM · Break limit = 1h total, 30 min single · Full day = 8h.
            </p>
          </>
        )}
      </div>
      {isAdmin && <AccessModal open={accessOpen} onClose={() => setAccessOpen(false)} />}
      <AddMemberModal open={addOpen} isAdmin={isAdmin} onClose={() => setAddOpen(false)} onAdded={() => load(date, true)} />
    </AppLayout>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneCls = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-rose-600' : 'text-foreground';
  return (
    <div className="border border-border rounded-xl bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 text-[22px] font-bold tabular-nums leading-none ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function PersonRow({ r, isToday, open, onToggle, events }: { r: Row; isToday: boolean; open: boolean; onToggle: () => void; events: Ev[] }) {
  const st = STATUS[r.status];
  const pct = Math.min(100, (r.activeMs / (8 * 3600_000)) * 100);
  const overBreak = r.flags.includes('over_break');
  return (
    <div className="border-b border-border last:border-b-0">
      <button onClick={onToggle} aria-expanded={open}
        className="w-full grid grid-cols-[minmax(170px,1.6fr)_1.1fr_0.8fr_0.8fr_1.3fr_1fr_0.7fr_0.8fr_0.7fr_24px] gap-2 px-3 py-2.5 items-center text-left hover:bg-primary/[0.03] transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={r.user.name} url={r.user.avatarUrl} size="sm" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">{r.user.name}</div>
            <div className="flex gap-1 flex-wrap mt-0.5">
              {r.flags.filter(f => FLAG[f]).slice(0, 2).map(f => (
                <span key={f} className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-px rounded ${FLAG[f].tone === 'bad' ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300' : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'}`}>{FLAG[f].label}</span>
              ))}
              {r.flags.length > 2 && <span className="text-[9.5px] text-muted-foreground">+{r.flags.length - 2}</span>}
              {!r.flags.length && <span className="text-[11px] text-muted-foreground capitalize">{r.user.role}{r.user.team ? ` · ${r.user.team}` : ''}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 items-start">
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${st.dot} ${r.status === 'working' ? 'animate-pulse' : ''}`} />{st.label}
          </span>
          {isToday && (r.inHuddle || r.onCall || r.screenSharing) && (
            <span className="flex gap-1.5 text-muted-foreground">
              {r.inHuddle && <span title="In huddle"><Headphones className="h-3.5 w-3.5 text-emerald-600" /></span>}
              {r.onCall && <span title="On a call"><Phone className="h-3.5 w-3.5 text-fuchsia-600" /></span>}
              {r.screenSharing && <span title="Sharing screen"><MonitorUp className="h-3.5 w-3.5 text-sky-600" /></span>}
            </span>
          )}
        </div>
        <div className="text-[12.5px] tabular-nums whitespace-nowrap">{fmtTime(r.firstSeen)}</div>
        <div className={`text-[12.5px] tabular-nums whitespace-nowrap ${r.flags.includes('late') ? 'text-amber-600 font-semibold' : ''}`}>
          {fmtTime(r.firstClockIn)}
          {r.lastClockOut && <div className="text-[11px] text-muted-foreground whitespace-nowrap">out {fmtTime(r.lastClockOut)}</div>}
        </div>
        <div>
          <div className="text-[13px] font-semibold tabular-nums">{r.sessions.length ? fmtDur(r.activeMs) : '—'}</div>
          {r.sessions.length > 0 && (
            <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden" title={`${Math.round(pct)}% of 8h`}>
              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className={`text-[12.5px] tabular-nums ${overBreak ? 'text-rose-600 font-semibold' : ''}`}>
          {r.breakCount ? <>{fmtDur(r.breakMs)}<div className="text-[11px] text-muted-foreground font-normal">{r.breakCount} break{r.breakCount > 1 ? 's' : ''}</div></> : '—'}
        </div>
        <div className="text-[12.5px] tabular-nums">{r.huddleMs ? fmtDur(r.huddleMs) : '—'}</div>
        <div className="flex gap-1" aria-label="Check-ins: morning, midday, evening">
          {[['M', r.checkin.morningAt], ['Mid', r.checkin.middayAt], ['E', r.checkin.eveningAt]].map(([l, at]) => (
            <span key={l as string} title={at ? `${l} at ${fmtTime(at as string)}` : `${l}: not submitted`}
              className={`h-5 min-w-5 px-1 rounded text-[9.5px] font-bold grid place-items-center ${at ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground/60'}`}>{l}</span>
          ))}
        </div>
        <div className="text-[12.5px] tabular-nums">
          <span className="font-semibold">{r.tasks.done}</span> done
          {r.tasks.overdue > 0 && <div className="text-[11px] text-rose-600">{r.tasks.overdue} overdue</div>}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <PersonDetail r={r} events={events} />}
    </div>
  );
}

function DayStrip({ r }: { r: Row }) {
  // Visual of the day: worked segments (teal) with breaks (amber) on top, 08:00–21:00 IST
  // (widened automatically if someone worked outside that window).
  const segs = r.sessions.map(s => [istMins(s.startTime), istMins(s.endTime || s.effectiveEnd)] as const);
  const brks = r.breaks.map(b => [istMins(b.startedAt), b.endedAt ? istMins(b.endedAt) : istMins(b.startedAt) + Math.round(b.durationMs / 60000)] as const);
  const lo = Math.min(8 * 60, ...segs.map(s => s[0])), hi = Math.max(21 * 60, ...segs.map(s => s[1]));
  const span = Math.max(1, hi - lo);
  const pos = (a: number, b: number) => ({ left: `${((a - lo) / span) * 100}%`, width: `${Math.max(0.4, ((Math.max(b, a) - a) / span) * 100)}%` });
  const ticks: number[] = []; for (let t = Math.ceil(lo / 60) * 60; t <= hi; t += 120) ticks.push(t);
  return (
    <div>
      <div className="relative h-6 rounded-md bg-muted/60 overflow-hidden">
        {segs.map(([a, b], i) => <div key={i} className="absolute inset-y-0 bg-teal-500/70" style={pos(a, b)} />)}
        {brks.map(([a, b], i) => <div key={i} className="absolute inset-y-0 bg-amber-400" style={pos(a, b)} title={`Break ${Math.max(0, b - a)} min`} />)}
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
        {ticks.map(t => <span key={t} className={`absolute ${t - lo < span * 0.04 ? '' : '-translate-x-1/2'}`} style={{ left: `${((t - lo) / span) * 100}%` }}>{String(Math.floor(t / 60) % 24).padStart(2, '0')}:00</span>)}
      </div>
      <div className="flex gap-3 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-teal-500/70" />Clocked in</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-amber-400" />Break</span>
      </div>
    </div>
  );
}

function PersonDetail({ r, events }: { r: Row; events: Ev[] }) {
  const maxWeek = Math.max(8 * 3600_000, ...r.week.map(d => d.activeMs + d.breakMs));
  return (
    <div className="px-3 pb-4 pt-1 bg-muted/20 border-t border-border grid gap-3 lg:grid-cols-2">
      <Panel title="Day at a glance" className="lg:col-span-2">
        {r.sessions.length ? <DayStrip r={r} /> : (
          <p className="text-[12.5px] text-muted-foreground">
            {r.leave ? `On ${r.leave.status === 'approved' ? '' : 'requested '}leave (${r.leave.dayType.replace('_', ' ')})${r.leave.reason ? ` — ${r.leave.reason}` : ''}` : 'Did not clock in this day.'}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <Mini label="Clocked in total" value={fmtDur(r.workedMs)} />
          <Mini label="Worked (minus breaks)" value={fmtDur(r.activeMs)} />
          <Mini label="Longest break" value={r.longestBreakMs ? fmtDur(r.longestBreakMs) : '—'} />
          <Mini label="Last seen online" value={r.lastSeen ? `${fmtTime(r.lastSeen)} (${ago(r.lastSeen)})` : '—'} />
          <Mini label="Client updates" value={r.activity.clientWork} />
          <Mini label="Lead notes / calls" value={r.activity.leadNotes} />
          <Mini label="Client meetings" value={r.activity.meetings} />
          <Mini label="Chat messages" value={r.activity.chats} />
        </div>
      </Panel>

      <Panel title={`Breaks (${r.breakCount})`}>
        {r.breaks.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No breaks taken.</p> : (
          <ul className="divide-y divide-border">
            {r.breaks.map((b, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between text-[12.5px] tabular-nums">
                <span>{fmtTime(b.startedAt)} → {b.ongoing ? <span className="text-amber-600 font-semibold">on break now</span> : fmtTime(b.endedAt)}</span>
                <span className={b.durationMs > 30 * 60_000 ? 'text-rose-600 font-semibold' : 'text-muted-foreground'}>{fmtDur(b.durationMs)}</span>
              </li>
            ))}
            <li className="py-1.5 flex justify-between text-[12.5px] font-semibold"><span>Total</span><span className={r.breakMs > 3600_000 ? 'text-rose-600' : ''}>{fmtDur(r.breakMs)} / 1h</span></li>
          </ul>
        )}
      </Panel>

      <Panel title="Sign-ins & sessions">
        <ul className="divide-y divide-border text-[12.5px]">
          {r.logins.map((l, i) => (
            <li key={'l' + i} className="py-1.5 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5"><LogIn className="h-3.5 w-3.5 text-sky-600" />{l.kind === 'login' ? `Signed in${l.method === 'google' ? ' (Google)' : ''}` : 'Opened Robin'} · {fmtTime(l.at)}</span>
              <span className="text-[11px] text-muted-foreground truncate">{l.device}</span>
            </li>
          ))}
          {r.sessions.map(s => (
            <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 tabular-nums">
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-emerald-600" />{fmtTime(s.startTime)} → {s.endTime ? fmtTime(s.endTime) : <span className="text-emerald-600 font-semibold">still on</span>}</span>
              <span className="text-[11px] text-muted-foreground">{fmtDur(s.activeMs)} worked{s.huddleMs ? ` · ${fmtDur(s.huddleMs)} huddle` : ''}{s.autoClosedAt ? ' · auto-closed' : ''}</span>
            </li>
          ))}
          {!r.logins.length && !r.sessions.length && <li className="py-1.5 text-muted-foreground">Nothing recorded.</li>}
        </ul>
      </Panel>

      <Panel title={`Today's plan (check-in) — ${r.checkin.done}/${r.checkin.planned} done`}>
        {r.checkin.tasks.length === 0 ? <p className="text-[12.5px] text-muted-foreground">{r.checkin.morningAt ? 'Checked in without listing tasks.' : 'No morning check-in submitted.'}</p> : (
          <ul className="space-y-1">
            {r.checkin.tasks.map((t, i) => (
              <li key={i} className="text-[12.5px] flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 text-[9.5px] font-bold uppercase px-1.5 py-px rounded ${t.status === 'done' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : t.status === 'blocked' || t.status === 'dropped' ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300' : 'bg-muted text-muted-foreground'}`}>{t.status.replace('_', ' ')}</span>
                <span className="min-w-0">{t.title}{t.client && <span className="text-muted-foreground"> · {t.client}</span>}{t.reason && <span className="block text-[11px] text-muted-foreground">{t.reason}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {r.checkin.blockers && <p className="mt-2 text-[12px]"><span className="font-semibold text-rose-600">Blocker:</span> {r.checkin.blockers}</p>}
        {r.checkin.tomorrowPlan && <p className="mt-1 text-[12px]"><span className="font-semibold">Tomorrow:</span> {r.checkin.tomorrowPlan}</p>}
      </Panel>

      <Panel title={`Last 7 days · avg ${fmtDur(r.weekAvgActiveMs)} on days worked`}>
        <div className="flex items-end gap-1.5">
          {r.week.map(d => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${dayLabel(d.date)}: ${fmtDur(d.activeMs)} worked, ${fmtDur(d.breakMs)} break`}>
              <div className="w-full h-20 flex flex-col justify-end rounded-sm overflow-hidden bg-muted/50">
                <div className="w-full bg-amber-400" style={{ height: `${(d.breakMs / maxWeek) * 100}%` }} />
                <div className={`w-full ${d.activeMs >= 8 * 3600_000 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ height: `${(d.activeMs / maxWeek) * 100}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.activeMs ? (d.activeMs / 3600_000).toFixed(1) : '–'}</span>
              <span className="text-[9.5px] text-muted-foreground">{dayLabel(d.date).split(/[ ,]/)[0]}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`${r.user.name.split(' ')[0]}'s activity (${events.length})`} className="lg:col-span-2">
        {events.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No activity recorded.</p> : (
          <div className="max-h-72 overflow-y-auto -mx-3"><Feed events={events} showName={false} /></div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-border rounded-lg bg-card p-3 ${className}`}>
      <h3 className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-md bg-muted/40 px-2 py-1.5"><div className="text-[10.5px] text-muted-foreground">{label}</div><div className="font-semibold tabular-nums">{value}</div></div>;
}

function Feed({ events, showName }: { events: Ev[]; showName: boolean }) {
  return (
    <ul>
      {events.map((e, i) => {
        const meta = EV_ICON[e.type] || EV_ICON.other;
        const Icon = meta.icon;
        return (
          <li key={i} className="flex gap-2.5 px-3 py-2 border-b border-border last:border-b-0">
            <span className={`h-7 w-7 shrink-0 rounded-full grid place-items-center ${meta.cls}`}><Icon className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] leading-snug">
                {showName && <span className="font-semibold">{e.userName} </span>}
                <span className={showName ? 'text-muted-foreground' : ''}>{showName ? e.label.charAt(0).toLowerCase() + e.label.slice(1) : e.label}</span>
              </div>
              {e.detail && <div className="text-[11.5px] text-muted-foreground line-clamp-2">{e.detail}</div>}
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{fmtTime(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<{ id: string; name: string; email: string; role: string; isAdmin: boolean; canViewOversight: boolean }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (open) api.listOversightAccess().then(setList).catch(() => setList([])); }, [open]);
  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await api.setOversightAccess(id, enabled);
      setList(l => l?.map(u => u.id === id ? { ...u, canViewOversight: enabled } : u) || null);
    } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold">Who can see Team Oversight</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">Admins always can. Turn it on for a manager to give them this full read-only view — it doesn't give any edit rights.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <ul className="mt-4 divide-y divide-border border border-border rounded-lg">
          {!list && <li className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></li>}
          {list?.map(u => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={u.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{u.name}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{u.role}</div>
              </div>
              {u.isAdmin ? <span className="text-[11px] font-semibold text-emerald-600">Admin · always</span> : (
                <button role="switch" aria-checked={u.canViewOversight} disabled={busy === u.id} onClick={() => toggle(u.id, !u.canViewOversight)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${u.canViewOversight ? 'bg-primary' : 'bg-muted-foreground/30'} disabled:opacity-50`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.canViewOversight ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-muted-foreground">They'll see the sidebar link after refreshing Robin.</p>
      </div>
    </Modal>
  );
}

