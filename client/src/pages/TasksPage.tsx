import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar as CalIcon, List, CheckCircle2, Clock, AlertTriangle, Trash2, Loader2, X } from 'lucide-react';
import { format, isToday, isBefore, startOfDay, isThisWeek } from 'date-fns';
import { useTasks } from '@/hooks/useTasks';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import * as api from '@/api';

const priorityColor: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-400 border-red-500/30',
  high:   'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low:    'bg-green-500/15 text-green-400 border-green-500/30',
};

const statusColor: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  ongoing: 'bg-blue-500/15 text-blue-400',
  done:    'bg-green-500/15 text-green-400',
};

interface NewTaskForm { title: string; priority: string; dueDate: string; taskType: string; }

const EMPTY_FORM: NewTaskForm = { title: '', priority: 'medium', dueDate: '', taskType: 'dev' };

export default function TasksPage() {
  const { tasks, loading, refresh, updateTask, createTask, deleteTask } = useTasks();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewTaskForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'today' | 'overdue' | 'done'>('all');

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = tasks.filter(t => {
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const today = startOfDay(new Date());
    if (filter === 'today')   return due && isToday(due);
    if (filter === 'overdue') return t.status !== 'done' && due && isBefore(due, today);
    if (filter === 'done')    return t.status === 'done';
    return true;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    setSaving(true);
    try {
      await createTask({ ...form, status: 'pending' } as any);
      setForm(EMPTY_FORM); setAdding(false);
      toast.success('Task created!');
    } catch { toast.error('Failed to create task'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string, status: string) => {
    const next = status === 'done' ? 'pending' : status === 'pending' ? 'ongoing' : 'done';
    await updateTask(id, { status: next });
  };

  const remove = async (id: string) => {
    await deleteTask(id);
    toast.success('Task deleted');
  };

  const TaskRow = ({ task }: { task: typeof tasks[0] }) => (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/30 group transition-colors">
      <button onClick={() => toggle(task._id, task.status)} className="mt-0.5 shrink-0">
        <CheckCircle2 className={`h-5 w-5 transition-colors ${task.status === 'done' ? 'text-green-400' : 'text-muted-foreground/30 hover:text-green-400'}`} />
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : ''} truncate`}>{task.title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityColor[task.priority]}`}>{task.priority}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor[task.status]}`}>{task.status}</span>
          {task.dueDate && (
            <span className={`text-[10px] flex items-center gap-1 ${isBefore(new Date(task.dueDate), startOfDay(new Date())) && task.status !== 'done' ? 'text-red-400' : 'text-muted-foreground'}`}>
              <Clock className="h-2.5 w-2.5" /> {format(new Date(task.dueDate), 'MMM d')}
            </span>
          )}
        </div>
      </div>
      <button onClick={() => remove(task._id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );

  const STATUSES = ['pending', 'ongoing', 'done'] as const;
  const boardColors: Record<string, string> = {
    pending: 'border-t-muted-foreground/30',
    ongoing: 'border-t-blue-500',
    done:    'border-t-green-500',
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">My Tasks</h1>
            <p className="text-sm text-muted-foreground">{tasks.filter(t => t.status !== 'done').length} remaining</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-border p-0.5 bg-card">
              {(['list', 'board'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {v === 'list' ? <List className="h-3.5 w-3.5" /> : <CalIcon className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
            <button onClick={() => setAdding(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 transition-all">
              <Plus className="h-3.5 w-3.5" /> Add Task
            </button>
          </div>
        </div>

        {/* New Task Form */}
        <AnimatePresence>
          {adding && (
            <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              onSubmit={handleCreate} className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold">New Task</p>
                <button type="button" onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <input autoFocus value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Task title…"
                className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                    {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Type</label>
                  <select value={form.taskType} onChange={e => setForm(p => ({ ...p, taskType: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                    {['dev', 'ads', 'content', 'admin_task'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-xs" />
                </div>
              </div>
              <button type="submit" disabled={!form.title || saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {([['all', 'All'], ['today', 'Today'], ['overdue', 'Overdue'], ['done', 'Done']] as const).map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === val ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}>
              {label}
              <span className="ml-1.5 text-[10px] opacity-70">
                {val === 'all' ? tasks.length : val === 'done' ? tasks.filter(t => t.status === 'done').length : val === 'overdue' ? tasks.filter(t => t.status !== 'done' && t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date()))).length : tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate))).length}
              </span>
            </button>
          ))}
        </div>

        {/* Tasks */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No tasks" description="Add one above to get started." />
        ) : view === 'list' ? (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border/50">
            <AnimatePresence initial={false}>
              {filtered.map(t => <TaskRow key={t._id} task={t} />)}
            </AnimatePresence>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {STATUSES.map(status => (
              <div key={status} className={`bg-card border-t-2 ${boardColors[status]} border-x border-b border-border rounded-2xl overflow-hidden`}>
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                  <p className="text-xs font-semibold capitalize">{status}</p>
                  <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{filtered.filter(t => t.status === status).length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-96 overflow-y-auto">
                  {filtered.filter(t => t.status === status).map(t => (
                    <div key={t._id} className="bg-background border border-border/60 rounded-xl p-2.5 text-xs space-y-1.5 cursor-default group">
                      <p className="font-medium line-clamp-2">{t.title}</p>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${priorityColor[t.priority]}`}>{t.priority}</span>
                        <button onClick={() => remove(t._id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      {t.dueDate && <p className="text-[10px] text-muted-foreground">{format(new Date(t.dueDate), 'MMM d')}</p>}
                    </div>
                  ))}
                  {filtered.filter(t => t.status === status).length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-4">Empty</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
