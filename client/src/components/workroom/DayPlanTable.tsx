import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Target as TargetIcon, ChevronRight, Sparkles } from 'lucide-react';
import * as api from '@/api';

/**
 * DayPlanTable — week-at-a-glance schedule pinned to the top of the
 * Workroom. Each weekday column shows the brands the employee is
 * focusing on that day + the tasks to do + the weekly target.
 *
 * Read-only for the employee — only admins edit (from the Command
 * Center). Auto-hides when there's no plan set for the current week.
 *
 * Round-robin guarantee: the auto-distribute endpoint spreads every
 * brand the employee owns across Mon-Fri evenly, so no client gets
 * skipped between weekly meetings.
 */

const DAYS = [
  { idx: 1, short: 'Mon', long: 'Monday'    },
  { idx: 2, short: 'Tue', long: 'Tuesday'   },
  { idx: 3, short: 'Wed', long: 'Wednesday' },
  { idx: 4, short: 'Thu', long: 'Thursday'  },
  { idx: 5, short: 'Fri', long: 'Friday'    },
];

interface Entry {
  dayOfWeek: number;
  clients: string[];   // workflowIds
  tasks: string[];
  target: string;
  notes?: string;
}
interface Plan {
  entries: Entry[];
  weeklyTarget: string;
  weekKey?: string;
  exists?: boolean;
}
interface Brand { _id: string; clientName?: string; healthLevel?: string }

const HEALTH_DOT: Record<string, string> = {
  green:  'bg-emerald-500',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-500',
  red:    'bg-rose-500',
};

export function DayPlanTable() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [brands, setBrands] = useState<Record<string, Brand>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getMyDayPlan()
      .then((p: Plan) => setPlan(p))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Live refresh — when admin updates the plan, the server broadcasts
  // 'data:changed' and AppLayout re-fires 'robin:data-changed' on
  // window. We pick that up and reload.
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener('robin:data-changed', onChanged);
    return () => window.removeEventListener('robin:data-changed', onChanged);
  }, []);

  // Resolve brand names once.
  useEffect(() => {
    api.cwListWorkflows({})
      .then((arr: any[]) => {
        const map: Record<string, Brand> = {};
        (Array.isArray(arr) ? arr : []).forEach(b => { map[b._id] = b; });
        setBrands(map);
      })
      .catch(() => {});
  }, []);

  // Today's day-of-week (ISO; Mon=1..Sun=7) so we can highlight today.
  const todayDow = useMemo(() => {
    const d = new Date().getDay();    // 0..6 (Sun..Sat)
    return d === 0 ? 7 : d;            // ISO 1..7
  }, []);

  if (loading) return null;
  // Hide entirely when the plan is empty AND nothing has been set —
  // keeps the Workroom clean for users without an admin-curated plan.
  if (!plan) return null;
  if (!plan.exists) {
    const anyContent = plan.entries.some(e => e.clients.length > 0 || e.tasks.length > 0 || e.target);
    if (!anyContent && !plan.weeklyTarget) return null;
  }

  const entryByDay = new Map(plan.entries.map(e => [e.dayOfWeek, e]));

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <p className="text-[12px] font-bold">This week's plan</p>
          {plan.weekKey && <span className="text-[10.5px] text-muted-foreground">{plan.weekKey}</span>}
        </div>
        {plan.weeklyTarget && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <TargetIcon className="h-3 w-3 text-violet-600" />
            <span className="font-semibold text-violet-700">Target:</span>
            <span className="text-foreground/85 truncate max-w-[420px]" title={plan.weeklyTarget}>
              {plan.weeklyTarget}
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
        {DAYS.map(d => {
          const e = entryByDay.get(d.idx);
          const isToday = d.idx === todayDow;
          const hasContent = !!e && (e.clients.length > 0 || e.tasks.length > 0 || e.target);
          return (
            <div
              key={d.idx}
              className={`px-3 py-2.5 min-w-0 ${isToday ? 'bg-primary/5' : ''}`}
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <p className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {d.short}
                </p>
                {isToday && <span className="text-[9px] uppercase tracking-wider font-bold text-primary">Today</span>}
              </div>
              {!hasContent ? (
                <p className="text-[10.5px] italic text-muted-foreground/80">No focus set.</p>
              ) : (
                <div className="space-y-1.5">
                  {e!.clients.length > 0 && (
                    <ul className="space-y-0.5">
                      {e!.clients.slice(0, 4).map(id => {
                        const b = brands[id];
                        return (
                          <li key={id}>
                            <Link
                              to={`/clients/pipeline/${id}`}
                              className="inline-flex items-center gap-1.5 text-[11.5px] hover:text-primary group truncate"
                            >
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${HEALTH_DOT[b?.healthLevel || 'green']}`} />
                              <span className="font-medium truncate">{b?.clientName || 'Brand'}</span>
                              <ChevronRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </Link>
                          </li>
                        );
                      })}
                      {e!.clients.length > 4 && (
                        <li className="text-[10px] text-muted-foreground italic">+ {e!.clients.length - 4} more</li>
                      )}
                    </ul>
                  )}
                  {e!.tasks.length > 0 && (
                    <ul className="space-y-0.5 pl-1 border-l-2 border-border/60">
                      {e!.tasks.slice(0, 3).map((t, i) => (
                        <li key={i} className="text-[10.5px] text-foreground/85 truncate" title={t}>· {t}</li>
                      ))}
                      {e!.tasks.length > 3 && (
                        <li className="text-[10px] text-muted-foreground italic">+ {e!.tasks.length - 3} more</li>
                      )}
                    </ul>
                  )}
                  {e!.target && (
                    <p className="text-[10px] text-violet-700/90 leading-snug mt-1">
                      <TargetIcon className="h-2.5 w-2.5 inline mr-0.5" />
                      {e!.target}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Suppress unused-import warnings (Sparkles reserved for future
// loading shimmer state).
void Sparkles;
