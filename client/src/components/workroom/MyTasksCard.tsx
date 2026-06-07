import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, CheckSquare, ChevronRight, ArrowRight, Sparkles, Clock, Check } from 'lucide-react';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import * as api from '@/api';

/**
 * MyTasksCard — the cross-team task inbox on the WorkroomHome.
 *
 * Three tabs in one tight card:
 *   - Mine        : tasks assigned to me (the work I owe)
 *   - Delegated   : tasks I created for someone else (what I'm waiting on)
 *   - Brands      : tasks on the brands I touch but assigned to someone else
 *                   (so Sakshi's task on WOODSIFY shows up on Om's brand list
 *                    even though it's not his)
 *
 * Compact: max 5 rows per tab, scrollable if more.
 */

const PR_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/12 text-rose-700',
  high:   'bg-amber-500/15 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};

interface TaskRow {
  _id: string;
  title: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  clientName?: string;
  assignedTo?: string;
  assignedBy?: string;
  clientWorkflowId?: string;
  estimatedHours?: number | null;
  estimatedCompletionAt?: string | null;
}

type Tab = 'mine' | 'delegated' | 'brand';

export function MyTasksCard() {
  const [tab, setTab] = useState<Tab>('mine');
  const [data, setData] = useState<{ mine: TaskRow[]; delegated: TaskRow[]; brandTasks: TaskRow[]; counts: any } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.taskInbox()
      .then((d: any) => setData(d))
      .catch(() => setData({ mine: [], delegated: [], brandTasks: [], counts: { mine: 0, delegated: 0, brand: 0 } }))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const rows: TaskRow[] = !data ? [] : tab === 'mine' ? data.mine : tab === 'delegated' ? data.delegated : data.brandTasks;
  const counts = data?.counts || { mine: 0, delegated: 0, brand: 0 };

  const toggleDone = async (t: TaskRow) => {
    try {
      await api.updateTask(t._id, { status: t.status === 'done' ? 'pending' : 'done' });
      refresh();
    } catch { /* swallow — UI stays consistent */ }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-primary" />
          <p className="text-[12px] font-bold">My tasks</p>
        </div>
        <Link to="/tasks" className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5">
          See all <ArrowRight className="h-2.5 w-2.5" />
        </Link>
      </div>

      {/* Tabs — minimal, no background; counts inline so user sees backlog at a glance. */}
      <div className="px-2 pt-2 flex items-center gap-1 text-[11px] border-b border-border/60">
        <TabBtn active={tab === 'mine'}      onClick={() => setTab('mine')}      label="Mine"      count={counts.mine} />
        <TabBtn active={tab === 'delegated'} onClick={() => setTab('delegated')} label="Delegated" count={counts.delegated} />
        <TabBtn active={tab === 'brand'}     onClick={() => setTab('brand')}     label="Brands"    count={counts.brand} />
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
          <Sparkles className="h-3 w-3 animate-pulse" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">
          {tab === 'mine'      ? 'Nothing assigned to you. Nice.'
          : tab === 'delegated' ? 'You haven\'t delegated anything yet.'
          :                       'No brand-level tasks owed to your brands.'}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[260px] overflow-y-auto">
          {rows.slice(0, 6).map(t => {
            const priority = (t.priority || 'medium') as keyof typeof PR_CLS;
            const isDone = t.status === 'done';
            const due = t.dueDate ? formatDistanceToNowStrict(parseISO(t.dueDate), { addSuffix: true }) : '';
            const overdueCls = t.dueDate && parseISO(t.dueDate).getTime() < Date.now() && !isDone ? 'text-rose-600 font-semibold' : 'text-muted-foreground';
            const canEditEta = tab === 'mine';
            return (
              <li key={t._id} className="px-3 py-2 hover:bg-muted/30 group">
                <div className="flex items-center gap-2.5">
                  {tab === 'mine' && (
                    <button
                      type="button"
                      onClick={() => toggleDone(t)}
                      className={`h-4 w-4 rounded flex items-center justify-center shrink-0 ${
                        isDone ? 'bg-emerald-500 text-white' : 'border border-border hover:border-primary'
                      }`}
                      aria-label={isDone ? 'Re-open' : 'Mark done'}
                    >
                      {isDone && <CheckSquare className="h-2.5 w-2.5" />}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] truncate ${isDone ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                      {t.title}
                    </p>
                    <p className="text-[10.5px] truncate">
                      {t.clientName && <span className="text-foreground/70">{t.clientName}</span>}
                      {t.clientName && due && <span className="text-muted-foreground/60"> · </span>}
                      {due && <span className={overdueCls}>{due}</span>}
                    </p>
                  </div>
                  <span className={`text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PR_CLS[priority]}`}>
                    {priority}
                  </span>
                  {t.clientWorkflowId && (
                    <Link to={`/clients/pipeline/${t.clientWorkflowId}`} className="opacity-60 group-hover:opacity-100">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  )}
                </div>
                {/* Employee-set ETA. Editable only on the 'Mine' tab so
                    you can't accidentally set someone else's estimate. */}
                {!isDone && (
                  <TaskEtaRow
                    task={t}
                    editable={canEditEta}
                    onSaved={refresh}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * TaskEtaRow — inline strip below a task showing the assignee's own
 * estimated completion date + hours of effort. Click "Add ETA" to edit.
 * Read-only when not the assignee (Delegated / Brands tabs).
 *
 * Compact: the row sits inside the task card padding and shows nothing
 * when no ETA is set + the user can't edit (read-only tabs). When the
 * user CAN edit, we show a small "+ I'll finish by" affordance.
 */
function TaskEtaRow({ task, editable, onSaved }: {
  task: TaskRow;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(task.estimatedCompletionAt ? task.estimatedCompletionAt.slice(0, 10) : '');
  const [hours, setHours] = useState(task.estimatedHours != null ? String(task.estimatedHours) : '');
  const [saving, setSaving] = useState(false);

  const hasEta = !!task.estimatedCompletionAt || (task.estimatedHours != null);

  // No ETA, no permission → render nothing (keeps the card clean).
  if (!hasEta && !editable) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateTask(task._id, {
        estimatedCompletionAt: date ? new Date(date).toISOString() : null,
        estimatedHours: hours ? Math.max(0, Number(hours)) : null,
      });
      setEditing(false);
      onSaved();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="ml-6 mt-1.5 flex items-center gap-1.5 text-[10.5px]">
        <Clock className="h-3 w-3 text-violet-600 shrink-0" />
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-1.5 h-6 rounded border border-input bg-background text-[10.5px] focus:ring-1 focus:ring-violet-500"
        />
        <input
          type="number"
          min={0}
          step={0.5}
          value={hours}
          onChange={e => setHours(e.target.value)}
          placeholder="hrs"
          className="px-1.5 h-6 w-14 rounded border border-input bg-background text-[10.5px] tabular-nums focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-6 px-1.5 rounded bg-violet-600 text-white text-[10px] font-semibold inline-flex items-center gap-0.5 disabled:opacity-50 hover:bg-violet-700"
        >
          <Check className="h-2.5 w-2.5" /> Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >Cancel</button>
      </div>
    );
  }

  // Display state — read-only or as-clickable for editor.
  if (!hasEta) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="ml-6 mt-1 text-[10.5px] text-muted-foreground hover:text-violet-700 inline-flex items-center gap-1"
      >
        <Clock className="h-3 w-3" /> Add your ETA
      </button>
    );
  }

  const etaText = task.estimatedCompletionAt
    ? `I'll finish by ${format(parseISO(task.estimatedCompletionAt), 'MMM d')}`
    : '';
  const hrsText = task.estimatedHours != null ? ` · ${task.estimatedHours}h` : '';
  return (
    <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10.5px]">
      <Clock className="h-3 w-3 text-violet-600" />
      <span className="text-foreground/80">{etaText}{hrsText}</span>
      {editable && (
        <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-violet-700 hover:underline">
          edit
        </button>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md transition-colors ${
        active ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      <span className={`ml-1 tabular-nums ${active ? 'opacity-90' : 'opacity-60'}`}>{count}</span>
    </button>
  );
}
