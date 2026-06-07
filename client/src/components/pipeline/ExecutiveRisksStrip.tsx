import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Sparkles } from 'lucide-react';
import * as api from '@/api';

/**
 * ExecutiveRisksStrip — top-of-dashboard "Needs attention" row.
 *
 * Reads /api/risks (computed from the existing healthInference cron's
 * denormalised riskScore + delayCause fields on each ClientWorkflow,
 * blended with overdue/blocked tasks). Surfaces the top 5 most
 * pressing items as a horizontal scroller — tap to open the brand
 * workspace or the task.
 *
 * Hides itself entirely when there are no risks so a healthy agency
 * doesn't see a red bar for no reason.
 */

interface Risk {
  kind: 'brand' | 'task';
  severity: 'high' | 'medium';
  workflowId?: string;
  taskId?: string;
  title: string;
  reason: string;
  link: string;
}

export function ExecutiveRisksStrip() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listRisks(8)
      .then((d: Risk[]) => setRisks(Array.isArray(d) ? d : []))
      .catch(() => setRisks([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 animate-pulse" /> Checking risk feed…
      </div>
    );
  }
  if (risks.length === 0) return null;

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-3">
        <div className="shrink-0 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
          <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-rose-700">
            Needs attention
          </span>
          <span className="text-[10.5px] text-rose-700/70 tabular-nums">({risks.length})</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 pb-0.5 -mb-0.5">
          {risks.slice(0, 5).map((r, i) => (
            <Link
              key={(r.workflowId || r.taskId || i) + r.title}
              to={r.link}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] hover:translate-y-[-1px] transition-transform border ${
                r.severity === 'high'
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-800'
                  : 'border-amber-500/40 bg-amber-500/12 text-amber-800'
              }`}
            >
              <span className="font-semibold truncate max-w-[180px]">{r.title}</span>
              <span className="text-[10.5px] opacity-75 truncate max-w-[140px]">· {r.reason}</span>
              <ChevronRight className="h-3 w-3 opacity-70" />
            </Link>
          ))}
          {risks.length > 5 && (
            <span className="shrink-0 text-[11px] text-rose-700/70 px-1">
              + {risks.length - 5} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
