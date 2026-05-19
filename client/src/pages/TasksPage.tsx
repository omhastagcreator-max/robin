import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Calendar as CalIcon, List, CheckCircle2, Circle, Clock,
  Trash2, Loader2, X, ChevronDown,
} from 'lucide-react';
import { format, isToday, isBefore, startOfDay } from 'date-fns';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { EmptyState }  from '@/components/ui/EmptyState';
import { useTasks }    from '@/hooks/useTasks';
import { useAuth }     from '@/contexts/AuthContext';
import {
  TASK_STATUSES, TASK_TYPES, TASK_PRIORITIES,
  TASK_STATUS_LABEL, TASK_TYPE_LABEL, nextTaskStatus,
  type TaskStatus, type TaskType, type TaskPriority,
} from '@/lib/enums';

/**
 * TasksPage v2 — rebuilt on design-system primitives.
 *
 * What changed vs v1:
 *   • The priority chips were rendered as `text-red-400`, `text-orange-400`,
 *     `text-yellow-400`, `text-green-400` — `/400` Tailwind weights that
 *     were almost unreadable on a light background. Fixed: every priority
 *     chip now uses the deeper `-700` text weight on a `/12` background,
 *     matching the StatusPill palette.
 *   • Status chip duplicated the StatusPill role inline — replaced with
 *     the canonical pill.
 *   • Hardcoded list-card chrome → semantic tokens.
 *   • Filter pills got concrete counts inline + Button-style hover.
 *
 * What stayed:
 *   • List vs Board view toggle.
 *   • Filters: All / Today / Overdue / Done.
 *   • New task form (title / priority / type / due).
 *   • Cycle status via a single click on the round check icon.
 *   • Delete on hover.
 */

// ─── Priority chip (text-700 weights = readable) ───────────────────────────
const priorityTone: Record<TaskPriority, string> = {
  urgent: 'bg-rose-500/12   text-rose-700    border-rose-500/25',
  high:   'bg-orange-500/12 text-orange-700  border-orange-500/25',
  medium: 'bg-amber-500/12  text-amber-700   border-amber-500/25',
  low:    'bg-emerald-500/12 text-emerald-700 border-emerald-500/25',
};

function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-1.5 h-[18px] rounded border ${priorityTone[priority]}`}>
      {priority}
    </span>
  );
}

// ─── Status chip — uses StatusPill-aligned tokens ──────────────────────────
const statusTone: Record<TaskStatus, string> = {
  pending: 'bg-muted          text-muted-foreground border-border',
  ongoing: 'bg-blue-500/12    text-blue-700         border-blue-500/25',
  done:    'bg-emerald-500/12 text-emerald-700      border-emerald-500/25',
};

function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-1.5 h-[18px] rounded border ${statusTone[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

interface NewTaskForm { title: string; priority: TaskPriority; dueDate: string; taskType: TaskType; }
const EMPTY_FORM: NewTaskForm = { title: '', priority: 'medium', dueDate: '', taskType: 'dev' };

export default function TasksPage() {
  const { user } = useAuth();
  const { tasks, loading, refresh, updateTask, createTask, deleteTask } = useTasks();
  const [view, setView]       = useState<'list' | 'board'>('list');
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState<NewTaskForm>(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const [filter, setFilter]   = useState<'all' | 'today' | 'overdue' | 'done'>('all');

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = tasks.filter(t => {
    const due   = t.dueDate ? new Date(t.dueDate) : null;
    const today = startOfDay(new Date());
    if (filter === 'today')   return due && isToday(due);
    if (filter === 'overdue') return t.status !== 'done' && due && isBefore(due, today);
    if (filter === 'done')    return t.status === 'done';
    return true;
  });

  const counts = {
    all:     tasks.length,
    today:   tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate))).length,
    overdue: tasks.filter(t => t.status !== 'done' && t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date()))).length,
    done:    tasks.filter(t => t.status === 'done').length,
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    setSaving(true);
    try {
      await createTask({ ...form, status: 'pending', assignedTo: user?.id } as any);
      setForm(EMPTY_FORM);
      setAdding(false);
      toast.success('Task created');
    } catch { toast.error('Failed to create task'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string, status: string) => {
    const current = (TASK_STATUSES as readonly string[]).includes(status) ? status as TaskStatus : 'pending';
    const next = nextTaskStatus(current);
    try { await updateTask(id, { status: next }); }
    catch { /* interceptor toasts */ }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await deleteTask(id);
      toast.success('Task deleted');
    } catch { /* interceptor toasts */ }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">My Tasks</h1>
            <p className="text-[12px] text-muted-foreground">
              {tasks.filter(t => t.status !== 'done').length} remaining · {counts.done} done
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(['list', 'board'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={v === 'list' ? 'List view' : 'Board view'}
                className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                  view === v ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {v === 'list' ? <List className="h-3.5 w-3.5" /> : <CalIcon className="h-3.5 w-3.5" />}
              </button>
            ))}
            <Button size="sm" intent="primary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(v => !v)} className="ml-1">
              Add task
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-1.5 flex-wrap">
          {([['all', 'All'], ['today', 'Today'], ['overdue', 'Overdue'], ['done', 'Done']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-semibold transition-colors ${
                filter === val
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {label}
              <span className={`tabular-nums text-[10.5px] font-bold ${filter === val ? 'opacity-80' : 'opacity-70'}`}>
                {counts[val]}
              </span>
            </button>
          ))}
        </div>

        {/* New task form */}
        <AnimatePresence>
          {adding && (
            <motion.form
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              onSubmit={handleCreate}
              className="border border-border rounded-xl bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold">New task</p>
                <button type="button" onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                autoFocus
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="What needs to get done?"
                className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Priority" value={form.priority} onChange={v => setForm(p => ({ ...p, priority: v as TaskPriority }))}>
                  {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </SelectField>
                <SelectField label="Type" value={form.taskType} onChange={v => setForm(p => ({ ...p, taskType: v as TaskType }))}>
                  {TASK_TYPES.map(t => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
                </SelectField>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Due</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <Button type="submit" size="sm" intent="primary" loading={saving} disabled={!form.title} iconLeft={<Plus className="h-3.5 w-3.5" />}>
                Create
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Tasks */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            size="lg"
            icon={<CheckCircle2 className="h-7 w-7" />}
            title={filter === 'done' ? 'No completed tasks' : filter === 'overdue' ? 'No overdue tasks — nice' : 'No tasks here'}
            hint={filter === 'all' ? 'Add one above to get started.' : 'Switch filters or add a new task.'}
          />
        ) : view === 'list' ? (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <AnimatePresence initial={false}>
              {filtered.map((t, i) => (
                <motion.div
                  key={t._id}
                  layout
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`flex items-start gap-3 px-3 py-2.5 group transition-colors hover:bg-primary/[0.03] ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <button onClick={() => toggle(t._id, t.status)} className="mt-0.5 shrink-0" title="Cycle status">
                    {t.status === 'done'
                      ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-600" />
                      : t.status === 'ongoing'
                        ? <CheckCircle2 className="h-[18px] w-[18px] text-blue-600/60 hover:text-blue-600" />
                        : <Circle className="h-[18px] w-[18px] text-muted-foreground/40 hover:text-emerald-600" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13.5px] font-medium leading-snug ${t.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                      {t.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <PriorityChip priority={t.priority} />
                      <StatusChip status={t.status} />
                      {t.dueDate && (
                        <span className={`text-[10.5px] flex items-center gap-1 ${
                          isBefore(new Date(t.dueDate), startOfDay(new Date())) && t.status !== 'done'
                            ? 'text-rose-600 font-semibold'
                            : 'text-muted-foreground'
                        }`}>
                          <Clock className="h-2.5 w-2.5" />
                          {format(new Date(t.dueDate), 'MMM d')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(t._id)}
                    className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-all shrink-0"
                    title="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          /* Board view */
          <div className="grid grid-cols-3 gap-3">
            {TASK_STATUSES.map(status => {
              const colItems = filtered.filter(t => t.status === status);
              const accent =
                status === 'done'    ? 'border-t-emerald-500' :
                status === 'ongoing' ? 'border-t-blue-500'    :
                                        'border-t-muted-foreground/40';
              return (
                <div key={status} className={`border-t-2 ${accent} border-x border-b border-border bg-card rounded-xl overflow-hidden flex flex-col`}>
                  <div className="px-3 h-9 flex items-center gap-2 border-b border-border">
                    <p className="text-[12.5px] font-semibold">{TASK_STATUS_LABEL[status]}</p>
                    <span className="ml-auto text-[10.5px] font-bold text-muted-foreground bg-muted px-1.5 h-[18px] inline-flex items-center rounded">
                      {colItems.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-1.5 min-h-[160px] max-h-[480px] overflow-y-auto">
                    {colItems.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/70 text-center py-6">Empty</p>
                    ) : (
                      colItems.map(t => (
                        <div key={t._id} className="border border-border rounded-lg bg-background p-2.5 text-[12px] space-y-1.5 group">
                          <p className={`font-medium leading-snug line-clamp-2 ${t.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>{t.title}</p>
                          <div className="flex items-center justify-between">
                            <PriorityChip priority={t.priority} />
                            <button onClick={() => remove(t._id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-all">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          {t.dueDate && (
                            <p className={`text-[10.5px] flex items-center gap-1 ${
                              isBefore(new Date(t.dueDate), startOfDay(new Date())) && t.status !== 'done'
                                ? 'text-rose-600 font-semibold'
                                : 'text-muted-foreground'
                            }`}>
                              <Clock className="h-2.5 w-2.5" />
                              {format(new Date(t.dueDate), 'MMM d')}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ─── Small select with chevron decoration ─────────────────────────────────
function SelectField({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
}
