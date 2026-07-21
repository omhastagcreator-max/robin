import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import * as api from '@/api';

/**
 * MyHoursCard — compact personal hours strip.
 *
 * Owner feedback (July 2026): keep it small, don't preach "8h" all over
 * the card, and never call someone "behind" for a day that isn't over.
 * So:
 *   · today's worked time + a slim progress bar (target implied, not shouted)
 *   · small Mon→today day dots/bars
 *   · lag line counts COMPLETED days only ("carrying 1h 20m from earlier
 *     this week") — today's remaining time is shown quietly, not as debt
 *
 * Sundays + approved leave days carry zero expectation. Same math as the
 * live timer and admin reports.
 */

interface DayRow { date: string; dow: number; workedMs: number; breakMs: number; expectedMs: number; onLeave: boolean; isToday: boolean }
interface MyHours {
  days: DayRow[];
  totalWorkedMs: number; totalExpectedMs: number;
  deficitMs: number; carriedLagMs?: number;
  todayWorkedMs: number; todayRemainingMs: number; targetPerDayMs: number;
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const fmtHM = (ms: number) => {
  const mins = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

export function MyHoursCard() {
  const [data, setData] = useState<MyHours | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.getMyHours().then(d => { if (!cancelled) setData(d); }).catch(() => {});
    load();
    const i = setInterval(load, 120_000);
    const onRefresh = () => load();
    window.addEventListener('robin:session-refresh', onRefresh);
    return () => { cancelled = true; clearInterval(i); window.removeEventListener('robin:session-refresh', onRefresh); };
  }, []);

  if (!data) return null;

  const target = data.targetPerDayMs || 8 * 3600_000;
  const todayPct = Math.min(100, Math.round((data.todayWorkedMs / target) * 100));
  const lag = data.carriedLagMs ?? 0;
  const behind = lag > 5 * 60_000;
  const ahead = lag < -5 * 60_000;

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Hourglass className="h-4 w-4 text-primary shrink-0" />

        {/* Today — number + slim bar, target implied by the bar */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] text-muted-foreground">today</span>
          <span className="font-mono font-bold tabular-nums text-sm">{fmtHM(data.todayWorkedMs)}</span>
          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden" title={`${todayPct}% of the day done`}>
            <div
              className={`h-full rounded-full transition-all ${todayPct >= 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${todayPct}%` }}
            />
          </div>
          {data.todayRemainingMs > 0 && todayPct < 100 && (
            <span className="text-[11px] text-muted-foreground">{fmtHM(data.todayRemainingMs)} to go</span>
          )}
          {todayPct >= 100 && (
            <span className="text-[11px] font-semibold text-emerald-600">day done ✓</span>
          )}
        </div>

        {/* Week mini-dots */}
        <div className="flex items-end gap-1 ml-auto">
          {data.days.map(d => {
            const pct = d.expectedMs > 0 ? Math.min(100, (d.workedMs / d.expectedMs) * 100) : 0;
            const free = d.expectedMs === 0;
            return (
              <div key={d.date} className="flex flex-col items-center gap-0.5"
                title={`${DOW[d.dow]} — ${fmtHM(d.workedMs)}${free ? (d.onLeave ? ' (leave)' : ' (off)') : ''}`}>
                <div className="w-4 h-7 rounded-sm bg-muted relative overflow-hidden">
                  <div
                    className={`absolute bottom-0 left-0 right-0 ${
                      free ? 'bg-slate-300/70' : pct >= 100 ? 'bg-emerald-500' : d.isToday ? 'bg-primary' : 'bg-amber-500'
                    }`}
                    style={{ height: `${free ? (d.workedMs > 0 ? 40 : 0) : Math.max(pct, d.workedMs > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <span className={`text-[8px] leading-none ${d.isToday ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                  {DOW[d.dow]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Carried lag — completed days only, one quiet line */}
        <div className="w-full sm:w-auto sm:ml-3">
          {behind && (
            <span className="text-[11.5px] font-semibold text-rose-600">
              carrying {fmtHM(lag)} from earlier this week — cover it when you can
            </span>
          )}
          {ahead && (
            <span className="text-[11.5px] font-semibold text-emerald-600">
              {fmtHM(lag)} ahead from earlier this week
            </span>
          )}
          {!behind && !ahead && (
            <span className="text-[11.5px] text-muted-foreground">on track this week</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyHoursCard;
