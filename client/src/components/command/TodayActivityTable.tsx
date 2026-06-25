import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Clock, Headphones, Plus, Sparkles, Target as TargetIcon, Users } from 'lucide-react';
import * as api from '@/api';

/**
 * TodayActivityTable — one row per teammate, showing what they've
 * done since 00:00 IST today.
 *
 * Surfaces the agency-owner ask "from today I want to take count of
 * everything like tasks and all". The columns are the things that
 * actually move the needle:
 *
 *   Done       — tasks the user marked status=done today
 *   Created    — tasks they assigned to someone today
 *   Accepted   — tasks they committed an ETA to today
 *   Services   — service lines they closed on a brand today
 *   Brands     — distinct brands they touched today
 *   Work       — hours actively working today (clock-on minus breaks)
 *   Huddle     — hours sitting in the agency huddle today
 *
 * Sorted by Done desc by default so top performers float to the top.
 * Auto-refreshes on the global 'robin:data-changed' event so finishing
 * a task somewhere else in Robin updates this row within ~1 second.
 *
 * Reset/baseline note: there's no separate "stats" counter that needs
 * resetting. Every number is derived from the existing audit trail
 * (ProjectTask.completedAt, services[].completedAt, Session times).
 * Reload the page and you get the truth as of right now.
 */

interface Row {
  userId: string;
  name: string;
  email?: string;
  role: string;
  team?: string;
  avatarUrl?: string;
  tasksDoneToday: number;
  tasksCreatedToday: number;
  tasksAcceptedToday: number;
  servicesCompletedToday: number;
  brandsTouchedToday: number;
  hoursWorkedToday: number;
  hoursInHuddleToday: number;
}
interface Totals {
  tasksDone: number;
  tasksCreated: number;
  tasksAccepted: number;
  servicesCompleted: number;
  brandsTouched: number;
  hoursWorked: number;
  hoursInHuddle: number;
}
interface Snap {
  istDate: string;
  rows: Row[];
  totals: Totals;
}

export function TodayActivityTable() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getTodayStats()
      .then((d: Snap) => setSnap(d))
      .catch(() => setSnap(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // Refresh on any data-changed event so finishing a task shows up
    // here within ~1s.
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChanged = () => { if (t) clearTimeout(t); t = setTimeout(load, 800); };
    window.addEventListener('robin:data-changed', onChanged);
    // Also poll every 60s in case the socket misses something.
    const iv = setInterval(load, 60_000);
    return () => {
      window.removeEventListener('robin:data-changed', onChanged);
      clearInterval(iv);
      if (t) clearTimeout(t);
    };
  }, []);

  if (loading && !snap) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
        <Sparkles className="h-3 w-3 animate-pulse" /> Tallying today's activity…
      </div>
    );
  }
  if (!snap || snap.rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-wrap">
        <Activity className="h-3.5 w-3.5 text-emerald-600" />
        <p className="text-[12px] font-bold">Today's activity</p>
        <span className="text-[10.5px] text-muted-foreground">{snap.istDate} · live</span>
        <div className="ml-auto flex items-center gap-3 text-[10.5px] text-muted-foreground flex-wrap">
          <TotalChip icon={<CheckCircle2 className="h-3 w-3 text-emerald-600" />} label="Done"     value={snap.totals.tasksDone} />
          <TotalChip icon={<Plus className="h-3 w-3 text-violet-600" />}         label="Created"  value={snap.totals.tasksCreated} />
          <TotalChip icon={<TargetIcon className="h-3 w-3 text-blue-600" />}     label="Services" value={snap.totals.servicesCompleted} />
          <TotalChip icon={<Users className="h-3 w-3 text-amber-600" />}         label="Brands"   value={snap.totals.brandsTouched} />
          <TotalChip icon={<Clock className="h-3 w-3 text-foreground/70" />}     label="Work"     value={`${snap.totals.hoursWorked}h`} />
          <TotalChip icon={<Headphones className="h-3 w-3 text-rose-600" />}     label="Huddle"   value={`${snap.totals.hoursInHuddle}h`} />
        </div>
      </div>

      <div className="hidden md:grid grid-cols-[1.6fr_60px_60px_60px_60px_60px_60px_60px] gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground bg-muted/20">
        <div>Teammate</div>
        <div className="text-right">Done</div>
        <div className="text-right">Created</div>
        <div className="text-right">Accepted</div>
        <div className="text-right">Services</div>
        <div className="text-right">Brands</div>
        <div className="text-right">Work</div>
        <div className="text-right">Huddle</div>
      </div>

      <ul className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
        {snap.rows.map(r => <ActivityRow key={r.userId} row={r} />)}
      </ul>
    </div>
  );
}

function TotalChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      <span className="uppercase tracking-wider font-semibold">{label}</span>
      <span className="font-bold text-foreground tabular-nums">{value}</span>
    </span>
  );
}

function ActivityRow({ row }: { row: Row }) {
  // Subtle heat highlighting — anyone with zero activity dims out a
  // bit so the eye lands on people who actually moved things today.
  const idle = row.tasksDoneToday === 0
    && row.tasksCreatedToday === 0
    && row.servicesCompletedToday === 0
    && row.hoursWorkedToday < 0.1;
  return (
    <li className={`px-4 py-2 md:grid md:grid-cols-[1.6fr_60px_60px_60px_60px_60px_60px_60px] md:gap-2 md:items-center ${idle ? 'opacity-55' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {row.avatarUrl
          ? <img src={row.avatarUrl} alt="" className="h-6 w-6 rounded-md object-cover shrink-0" />
          : <div className="h-6 w-6 rounded-md bg-primary/12 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
              {(row.name || '?')[0]?.toUpperCase()}
            </div>}
        <div className="min-w-0">
          <p className="text-[12px] font-semibold truncate">{row.name}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{row.role}{row.team ? ` · ${row.team}` : ''}</p>
        </div>
      </div>
      <Cell value={row.tasksDoneToday} tone={row.tasksDoneToday > 0 ? 'emerald' : undefined} />
      <Cell value={row.tasksCreatedToday} />
      <Cell value={row.tasksAcceptedToday} />
      <Cell value={row.servicesCompletedToday} tone={row.servicesCompletedToday > 0 ? 'blue' : undefined} />
      <Cell value={row.brandsTouchedToday} />
      <Cell value={`${row.hoursWorkedToday}h`} />
      <Cell value={`${row.hoursInHuddleToday}h`} />
    </li>
  );
}

function Cell({ value, tone }: { value: string | number; tone?: 'emerald' | 'blue' }) {
  const cls = tone === 'emerald' ? 'text-emerald-700 font-bold' :
              tone === 'blue'    ? 'text-blue-700 font-bold'    :
                                    'text-foreground/80';
  return <div className={`text-right text-[12px] tabular-nums ${cls}`}>{value}</div>;
}
