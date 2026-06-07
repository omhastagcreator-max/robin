import { useEffect, useState } from 'react';
import { Target, Sparkles } from 'lucide-react';
import * as api from '@/api';

/**
 * MyTargetsCard — current-month performance card.
 *
 * Compact: shows month label + each target line as a horizontal bar
 * with actual / target. No edit UI on the workroom — admin sets
 * targets on the executive dashboard. This is read-only encouragement.
 */

interface Target { _id?: string; label: string; target: number; unit?: string; actual: number; source: string }

const TONE_FOR_PCT = (pct: number) =>
  pct >= 1   ? 'bg-emerald-500' :
  pct >= 0.7 ? 'bg-blue-500' :
  pct >= 0.4 ? 'bg-amber-500' :
               'bg-rose-500';

export function MyTargetsCard() {
  const [data, setData] = useState<{ month: string; targets: Target[]; exists: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyTargets()
      .then((d: any) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const monthLabel = data?.month
    ? new Date(data.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-violet-600" />
          <p className="text-[12px] font-bold">My targets</p>
        </div>
        <p className="text-[10.5px] text-muted-foreground">{monthLabel}</p>
      </div>
      {loading ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
          <Sparkles className="h-3 w-3 animate-pulse" /> Loading…
        </p>
      ) : !data || data.targets.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">
          No targets set for this month yet.
        </p>
      ) : (
        <ul className="px-4 py-3 space-y-2.5 max-h-[260px] overflow-y-auto">
          {data.targets.slice(0, 6).map((t, i) => {
            const pct = t.target > 0 ? Math.min(1.5, t.actual / t.target) : 0;
            const pctVis = Math.min(1, pct);
            const display = `${t.actual} / ${t.target}${t.unit ? ' ' + t.unit : ''}`;
            return (
              <li key={t._id || i}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11.5px] font-medium truncate">{t.label}</span>
                  <span className={`text-[11px] tabular-nums font-bold ${pct >= 1 ? 'text-emerald-600' : 'text-foreground'}`}>
                    {display}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${TONE_FOR_PCT(pct)}`} style={{ width: `${pctVis * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
