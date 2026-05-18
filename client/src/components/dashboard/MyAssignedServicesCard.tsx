import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Workflow, ArrowRight, Lock, Clock, CheckCircle2, Circle,
} from 'lucide-react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';

/**
 * MyAssignedServicesCard — dashboard widget for employees showing the
 * services they own across all client pipelines. Each row links straight
 * to the workflow detail so they can tick checklist items.
 *
 * Hidden when the user has no assigned services (keeps the dashboard tidy
 * for admins and brand-new hires).
 */
export function MyAssignedServicesCard() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api.cwListWorkflows({ mine: '1' });
      setList(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useVisiblePoll(load, 90_000);

  if (loading && list.length === 0) return null;

  // Flatten: row per (workflow, service) where I'm the assignee.
  const rows = list.flatMap((wf: any) =>
    (wf.services || [])
      .filter((s: any) => s.assignedTo === user?.id)
      .map((s: any) => ({ wf, s })),
  );
  if (rows.length === 0) return null;

  const active = rows.filter(r => r.s.status !== 'done').length;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <Workflow className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Your client work
            <span className="text-muted-foreground font-normal ml-1.5">·  {active} active</span>
          </p>
        </div>
        <Link to="/clients/pipeline"
          className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-0.5 shrink-0">
          See all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="divide-y divide-border">
        {rows.slice(0, 5).map(({ wf, s }) => {
          const Icon =
            s.status === 'done'    ? CheckCircle2 :
            s.status === 'blocked' ? Lock         :
            s.status === 'in_progress' ? Clock    : Circle;
          const tone =
            s.status === 'done'    ? 'text-emerald-600' :
            s.status === 'blocked' ? 'text-slate-500'   :
            s.status === 'in_progress' ? 'text-blue-600' : 'text-muted-foreground';
          const ticked = (s.checklist || []).filter((c: any) => c.done).length;
          const total = (s.checklist || []).length;
          return (
            <Link key={`${wf._id}-${s._id}`} to={`/clients/pipeline/${wf._id}`}
              className="block px-4 py-2.5 hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-3">
                <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{wf.clientName || 'Client'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{s.label} · {ticked}/{total} steps</p>
                </div>
                {s.status === 'blocked' && (
                  <span className="text-[10px] font-semibold text-slate-600">waiting</span>
                )}
                {s.status === 'in_progress' && (
                  <span className="text-[10px] font-semibold text-blue-600">{Math.round((ticked / Math.max(total, 1)) * 100)}%</span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </Link>
          );
        })}
      </div>
    </motion.div>
  );
}

export default MyAssignedServicesCard;
