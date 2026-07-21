import { useEffect, useState } from 'react';
import { Hourglass, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import * as api from '@/api';

/**
 * MyHoursCard — "how much have I worked, and how much more do I owe?"
 *
 * Owner ask (July 2026): every employee should see their own timings and
 * exactly how much extra they must work to cover their laggings. Shows:
 *   · today — worked vs the 8h target, with a progress bar
 *   · this week — per-day mini bars (Mon→today)
 *   · the verdict — behind by X ("work X more to catch up"), on track,
 *     or ahead by X
 *
 * Sundays and approved leave days carry zero expectation, so nobody
 * "lags" for a day they weren't supposed to work. Same sessionTotals()
 * math as the live timer and admin reports — the numbers always agree.
 */

interface DayRow { date: string; dow: number; workedMs: number; breakMs: number; expectedMs: number; onLeave: boolean; isToday: boolean }
interface MyHours {
  days: DayRow[];
  totalWorkedMs: number; totalExpectedMs: number; deficitMs: number;
  todayWorkedMs: number; todayRemainingMs: number; targetPerDayMs: number;
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const fmtHM = (ms: number) => {
  const mins = Math.round(Math.abs(ms) / 60_000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};

export function MyHoursCard() {
  const [data, setData] = useState<MyHours | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.getMyHours().then(d => { if (!cancelled) setData(d); }).catch(() => {});
    load();
    const i = setInterval(load, 120_000);           // refresh every 2 min
    const onRefresh = () => load();                  // instant after log-in/out
    window.addEventListener('robin:session-refresh', onRefresh);
    return () => { cancelled = true; clearInterval(i); window.removeEventListener('robin:session-refresh', onRefresh); };
  }, []);

  if (!data) return null;

  const target = data.targetPerDayMs || 8 * 3600_000;
  const todayPct = Math.min(100, Math.round((data.todayWorkedMs / target) * 100));
  const behind = data.deficitMs > 5 * 60_000;        // >5min behind = show catch-up
  const ahead = data.deficitMs < -5 * 60_000;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Hourglass className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-sm">My hours</p>
          <p className="text-[11px] text-muted-foreground">This week · 8h/day target · breaks don't count</p>
        </div>
      </div>

      {/* Today */}
      <div>
        <div className="flex justify-between text-[12px] mb-1">
          <span className="text-muted-foreground">Today</span>
          <span className="font-mono font-bold tabular-nums">
            {fmtHM(data.todayWorkedMs)}
            <span className="text-muted-foreground font-normal"> / 8h 00m</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${todayPct >= 100 ? 'bg-emerald-500' : 'bg-primary'}`}
            style={{ width: `${todayPct}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {data.todayRemainingMs > 0
            ? `${fmtHM(data.todayRemainingMs)} left to finish today's 8h`
            : 'Today’s 8h done — great work!'}
        </p>
      </div>

      {/* Week mini-bars */}
      <div className="flex items-end gap-1.5 h-16">
        {data.days.map(d => {
          const pct = d.expectedMs > 0 ? Math.min(100, (d.workedMs / d.expectedMs) * 100) : 0;
          const free = d.expectedMs === 0;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${fmtHM(d.workedMs)}${free ? (d.onLeave ? ' (leave)' : ' (off)') : ''}`}>
              <div className="w-full h-12 rounded-md bg-muted relative overflow-hidden">
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-md ${
                    free ? 'bg-slate-300/60' : pct >= 100 ? 'bg-emerald-500' : d.isToday ? 'bg-primary' : 'bg-amber-500'
                  }`}
                  style={{ height: `${free ? (d.workedMs > 0 ? 30 : 0) : pct}%` }}
                />
              </div>
              <span className={`text-[9px] ${d.isToday ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                {DOW[d.dow]}
              </span>
            </div>
          );
        })}
      </div>

      {/* The verdict */}
      {behind && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-rose-700">
            You're <b>{fmtHM(data.deficitMs)}</b> behind this week — work that much extra to cover the lag.
            <span className="block text-[10.5px] opacity-80 mt-0.5">
              Worked {fmtHM(data.totalWorkedMs)} of {fmtHM(data.totalExpectedMs)} expected so far.
            </span>
          </p>
        </div>
      )}
      {ahead && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
          <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-emerald-700">
            You're <b>{fmtHM(data.deficitMs)}</b> ahead of target this week — keep it up.
          </p>
        </div>
      )}
      {!behind && !ahead && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-emerald-700">Right on track for the week.</p>
        </div>
      )}
    </div>
  );
}

export default MyHoursCard;
