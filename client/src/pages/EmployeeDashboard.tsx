import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Bell, X, Send, UserPlus, Info, Loader2, CheckCircle2, Circle,
  Target, Calendar, KeyRound, CalendarOff, MessageSquare, Video,
  ChevronDown,
} from 'lucide-react';
import { format, isToday, isBefore, startOfDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { Row }         from '@/components/ui/Row';
import { Stat }        from '@/components/ui/Stat';
import { EmptyState }  from '@/components/ui/EmptyState';
import { Tabs }        from '@/components/ui/Tabs';

import { useAuth }     from '@/contexts/AuthContext';
import { useSession }  from '@/hooks/useSession';
import { useTasks }    from '@/hooks/useTasks';

import { HuddleQuickPill }       from '@/components/shared/HuddleQuickPill';
import { WeeklyPlanner }         from '@/components/shared/WeeklyPlanner';
import { HuddleDashboardCard }   from '@/components/shared/HuddleDashboardCard';
import { AIMorningBrief }        from '@/components/dashboard/AIMorningBrief';
import { MetaAdsCard }           from '@/components/dashboard/MetaAdsCard';
import { TodayMeetingsStrip }    from '@/components/dashboard/TodayMeetingsStrip';
import { ActiveClientMeetingsCard } from '@/components/dashboard/ActiveClientMeetingsCard';
import { ScheduleMeetingsSection } from '@/components/dashboard/ScheduleMeetingsSection';
import { TodayClientsCard }      from '@/components/dashboard/TodayClientsCard';
import { MyAssignedServicesCard } from '@/components/dashboard/MyAssignedServicesCard';

import {
  TASK_STATUSES, TASK_TYPES, nextTaskStatus,
  type TaskStatus, type TaskPriority,
} from '@/lib/enums';
import * as api from '@/api';

/**
 * EmployeeDashboard v2 — rebuilt on design-system primitives.
 *
 * What's gone vs v1:
 *   • Bespoke colored team-role KPI grids (4 different color families per
 *     team → 12 total combinations). Unified to a single Stat strip that
 *     reads from team data without bespoke palettes.
 *   • Task list cards with hand-rolled border/divider/hover chrome →
 *     a single Row list with proper accent.
 *   • Hardcoded `text-red-400 / text-yellow-400` priority weights that
 *     read too light on a white BG → matched StatusPill `-700` palette.
 *   • Inline "🔑 / 📅 / 💬 / 🎙️" emoji-button quick links →
 *     real v2 Buttons with lucide icons.
 *   • Multiple competing card chrome variants (rounded-2xl border-border,
 *     rounded-xl bg-muted, rounded-xl border-primary/30, bg-primary/5) →
 *     consistent border-border + bg-card token.
 */

// ─── Priority chip (text-700, readable) ──────────────────────────────────
const priorityTone: Record<TaskPriority, string> = {
  urgent: 'bg-rose-500/12   text-rose-700    border-rose-500/25',
  high:   'bg-orange-500/12 text-orange-700  border-orange-500/25',
  medium: 'bg-amber-500/12  text-amber-700   border-amber-500/25',
  low:    'bg-emerald-500/12 text-emerald-700 border-emerald-500/25',
};

function PriorityChip({ p }: { p: TaskPriority }) {
  return (
    <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-1.5 h-[18px] rounded border ${priorityTone[p]}`}>
      {p}
    </span>
  );
}

const statusTone: Record<TaskStatus, string> = {
  pending: 'bg-muted          text-muted-foreground border-border',
  ongoing: 'bg-blue-500/12    text-blue-700         border-blue-500/25',
  done:    'bg-emerald-500/12 text-emerald-700      border-emerald-500/25',
};

export default function EmployeeDashboard() {
  const { user }    = useAuth();
  const { session } = useSession();
  const { tasks, loading: tasksLoading, refresh, createTask, updateTask, deleteTask } = useTasks();

  const [allUsers, setAllUsers]   = useState<any[]>([]);
  const [projects, setProjects]   = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask]     = useState({ title: '', priority: 'medium' as TaskPriority, dueDate: '', taskType: 'dev', assignToId: '', projectId: '' });
  const [saving, setSaving]       = useState(false);

  // ── Derived task buckets ─────────────────────────────────────────────
  const todayStart = startOfDay(new Date());
  const isOverdueT = (t: any) => t.status !== 'done' && t.dueDate && isBefore(new Date(t.dueDate), todayStart);

  const openTasks = tasks
    .filter(t => t.status !== 'done')
    .slice()
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
  const doneTasks    = tasks.filter(t => t.status === 'done');
  const overdueTasks = tasks.filter(isOverdueT);
  const stuckTasks   = tasks.filter(t => t.status === 'ongoing' && t.dueDate && isBefore(new Date(t.dueDate), todayStart));
  const dayLocked    = !session && tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate))).length < 3;

  useEffect(() => {
    refresh().catch(() => {});
    api.listUsers()
      .then(d => setAllUsers(Array.isArray(d) ? d.filter((u: any) => u._id !== user?.id) : []))
      .catch(() => setAllUsers([]));
    api.listNotifications({ limit: 10 })
      .then(d => setNotifications(Array.isArray(d) ? d.slice(0, 5) : []))
      .catch(() => setNotifications([]));
    api.listProjects()
      .then(d => setProjects(Array.isArray(d) ? d.filter(p => p.status === 'active') : []))
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title) return;
    setSaving(true);
    try {
      const payload: any = { ...newTask, status: 'pending', dueDate: newTask.dueDate || new Date().toISOString().split('T')[0] };
      payload.assignedTo = newTask.assignToId || user?.id;
      if (!payload.projectId) delete payload.projectId;
      await createTask(payload);
      setNewTask({ title: '', priority: 'medium', dueDate: '', taskType: 'dev', assignToId: '', projectId: '' });
      setAddingTask(false);
      toast.success(newTask.assignToId ? 'Task assigned' : 'Task added');
    } catch { toast.error('Failed to create task'); }
    finally { setSaving(false); }
  };

  const cycleStatus = async (task: any) => {
    const current = (TASK_STATUSES as readonly string[]).includes(task.status) ? task.status as TaskStatus : 'pending';
    const next = nextTaskStatus(current);
    try { await updateTask(task._id, { status: next }); } catch {}
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();
  const subline = (() => {
    if (overdueTasks.length > 0) return `${overdueTasks.length} overdue ${overdueTasks.length === 1 ? 'task' : 'tasks'} — clear those first.`;
    const dueToday = tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate)) && t.status !== 'done').length;
    if (dueToday > 0) return `${dueToday} ${dueToday === 1 ? 'task' : 'tasks'} due today.`;
    if (openTasks.length > 0) return `${openTasks.length} open ${openTasks.length === 1 ? 'task' : 'tasks'} on your plate.`;
    return 'Inbox zero on tasks — a good day to ship something deep.';
  })();

  const unread = notifications.filter(n => !n.isRead);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
              {format(new Date(), 'EEEE · dd MMM yyyy')}
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[30px] font-bold tracking-tight">
              {greeting}, <span className="text-primary">{user?.name?.split(' ')[0] || 'there'}</span>.
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{subline}</p>
          </div>
          <HuddleQuickPill />
        </header>

        {/* Day-lock banner */}
        <AnimatePresence>
          {dayLocked && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 flex items-center gap-2 text-[12px] text-amber-700"
            >
              <Info className="h-3.5 w-3.5 shrink-0" />
              <p className="flex-1">
                Plan {3 - openTasks.length} more task{3 - openTasks.length !== 1 ? 's' : ''} before clocking in.
              </p>
              <button onClick={() => setAddingTask(true)} className="font-semibold underline hover:no-underline">
                + Add task
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── KPI strip ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat block value={openTasks.length}     label="Open"      tone="primary" />
          <Stat block value={doneTasks.length}     label="Completed" />
          <Stat block value={overdueTasks.length}  label="Overdue"   tone={overdueTasks.length ? 'danger' : 'muted'} />
          <Stat block value={stuckTasks.length}    label="Stuck"     tone={stuckTasks.length ? 'warning' : 'muted'} />
        </div>

        {/* ── Today + assigned services ──────────────────────────── */}
        <div className="grid lg:grid-cols-2 gap-4">
          <TodayClientsCard />
          <MyAssignedServicesCard />
        </div>

        {/* ── AI brief + meeting rail ─────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <AIMorningBrief />
          </div>
          <div className="space-y-3">
            <HuddleDashboardCard />
            <TodayMeetingsStrip />
            <ActiveClientMeetingsCard />
          </div>
        </div>

        {/* Meta Ads (only renders for ads/admin) */}
        <MetaAdsCard />

        {/* Unread strip — slim, single row */}
        {unread.length > 0 && (
          <Link to="/notifications" className="block rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 flex items-start gap-2 hover:bg-primary/[0.07] transition-colors">
            <Bell className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-primary">
                {unread.length} unread
              </p>
              <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                {unread.slice(0, 2).map(n => n.title).join(' · ')}
              </p>
            </div>
          </Link>
        )}

        {/* ── Tasks + side rail ──────────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Tasks column */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold">
                My tasks <span className="text-muted-foreground font-normal">({tasks.length})</span>
              </h2>
              <Button size="xs" intent="ghost" iconLeft={<Plus className="h-3 w-3" />} onClick={() => setAddingTask(v => !v)}>
                Add / assign
              </Button>
            </div>

            {/* New task form */}
            <AnimatePresence>
              {addingTask && (
                <motion.form
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  onSubmit={handleCreateTask}
                  className="border border-border rounded-xl bg-card p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold">New task / assign</p>
                    <button type="button" onClick={() => setAddingTask(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    autoFocus
                    value={newTask.title}
                    onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                    required
                    placeholder="What needs to get done?"
                    className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <SelectChev value={newTask.priority} onChange={v => setNewTask(p => ({ ...p, priority: v as TaskPriority }))}>
                      {['low','medium','high','urgent'].map(v => <option key={v} value={v}>{v}</option>)}
                    </SelectChev>
                    <SelectChev value={newTask.taskType} onChange={v => setNewTask(p => ({ ...p, taskType: v }))}>
                      {TASK_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                    </SelectChev>
                    <input
                      type="date"
                      value={newTask.dueDate}
                      onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                      className="px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <SelectChev value={newTask.assignToId} onChange={v => setNewTask(p => ({ ...p, assignToId: v }))}>
                      <option value="">Assign to me</option>
                      {allUsers.map((u: any) => <option key={u._id} value={u._id}>{u.name || u.email}</option>)}
                    </SelectChev>
                    <SelectChev value={newTask.projectId} onChange={v => setNewTask(p => ({ ...p, projectId: v }))} className="col-span-2">
                      <option value="">No project</option>
                      {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </SelectChev>
                  </div>
                  {newTask.assignToId && (
                    <p className="text-[11.5px] text-blue-700 bg-blue-500/[0.08] border border-blue-500/20 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5">
                      <UserPlus className="h-3 w-3" /> Will be assigned with a notification
                    </p>
                  )}
                  <Button type="submit" size="sm" intent="primary" loading={saving} disabled={!newTask.title} iconLeft={<Send className="h-3 w-3" />}>
                    {newTask.assignToId ? 'Assign task' : 'Add task'}
                  </Button>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Open / Done tabs */}
            <Tabs initial="open">
              <Tabs.List>
                <Tabs.Tab id="open" count={openTasks.length}>Open</Tabs.Tab>
                <Tabs.Tab id="done" count={doneTasks.length}>Done</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel id="open" className="mt-3">
                <TaskList
                  tasks={openTasks}
                  loading={tasksLoading}
                  emptyTitle="All caught up — no open tasks"
                  emptyHint="Add one above to keep the rhythm going."
                  cycleStatus={cycleStatus}
                  setStatus={(t, s) => updateTask(t._id, { status: s }).catch(() => {})}
                  deleteTask={async id => { try { await deleteTask(id); toast.success('Deleted'); } catch {} }}
                  readOnly={false}
                  onAdd={() => setAddingTask(true)}
                />
              </Tabs.Panel>
              <Tabs.Panel id="done" className="mt-3">
                <TaskList
                  tasks={doneTasks}
                  loading={tasksLoading}
                  emptyTitle="No completed tasks yet"
                  emptyHint="Tick off something above."
                  cycleStatus={cycleStatus}
                  setStatus={() => {}}
                  deleteTask={async id => { try { await deleteTask(id); } catch {} }}
                  readOnly
                />
              </Tabs.Panel>
            </Tabs>
          </div>

          {/* Right rail */}
          <aside className="space-y-3">
            <ScheduleMeetingsSection />

            <WeeklyPlanner
              tasks={tasks}
              onDeleteTask={async (id) => {
                try { await deleteTask(id); toast.success('Task deleted'); }
                catch { toast.error('Could not delete task'); }
              }}
            />

            {/* Reminders */}
            {unread.length > 0 && (
              <section className="rounded-xl border border-primary/20 bg-primary/[0.03] overflow-hidden">
                <div className="px-3 h-9 flex items-center gap-1.5 border-b border-primary/15">
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-primary">Reminders</p>
                  <span className="ml-auto text-[10.5px] text-muted-foreground">{unread.length} unread</span>
                </div>
                <div className="divide-y divide-border/40">
                  {unread.slice(0, 4).map(n => (
                    <div key={n._id} className="px-3 py-2 hover:bg-primary/[0.05] transition-colors">
                      <p className="text-[12px] font-medium leading-tight">{n.title}</p>
                      {n.message && <p className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quick links — v2 buttons, no emoji noise */}
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-3 h-9 flex items-center border-b border-border">
                <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Quick links</p>
              </div>
              <div className="p-2 grid grid-cols-2 gap-1.5">
                <Link to="/vault" className="flex items-center gap-2 h-8 px-2 rounded-md text-[12px] hover:bg-muted/60 transition-colors">
                  <KeyRound className="h-3.5 w-3.5 text-primary" /> Vault
                </Link>
                <Link to="/leaves" className="flex items-center gap-2 h-8 px-2 rounded-md text-[12px] hover:bg-muted/60 transition-colors">
                  <CalendarOff className="h-3.5 w-3.5 text-primary" /> Leaves
                </Link>
                <Link to="/chat" className="flex items-center gap-2 h-8 px-2 rounded-md text-[12px] hover:bg-muted/60 transition-colors">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" /> Chat
                </Link>
                <Link to="/workroom" className="flex items-center gap-2 h-8 px-2 rounded-md text-[12px] hover:bg-muted/60 transition-colors">
                  <Video className="h-3.5 w-3.5 text-primary" /> Workroom
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Task list (shared by Open / Done tabs) ───────────────────────────────
function TaskList({
  tasks, loading, emptyTitle, emptyHint, cycleStatus, setStatus, deleteTask, readOnly, onAdd,
}: {
  tasks: any[];
  loading: boolean;
  emptyTitle: string;
  emptyHint: string;
  cycleStatus: (t: any) => Promise<void>;
  setStatus: (t: any, s: TaskStatus) => void;
  deleteTask: (id: string) => Promise<void>;
  readOnly: boolean;
  onAdd?: () => void;
}) {
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (tasks.length === 0) return (
    <EmptyState
      size="md"
      icon={<Target className="h-7 w-7" />}
      title={emptyTitle}
      hint={emptyHint}
      action={onAdd ? <Button size="xs" intent="primary" iconLeft={<Plus className="h-3 w-3" />} onClick={onAdd}>Add task</Button> : undefined}
    />
  );

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <AnimatePresence initial={false}>
        {tasks.map((t, i) => {
          const overdue = t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date())) && t.status !== 'done';
          return (
            <motion.div
              key={t._id}
              layout
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`flex items-start gap-3 px-3 py-2.5 group hover:bg-primary/[0.03] transition-colors ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <button
                onClick={() => !readOnly && cycleStatus(t)}
                disabled={readOnly}
                className="mt-0.5 shrink-0 disabled:cursor-default"
                title={readOnly ? 'Past tasks are view-only' : 'Cycle status'}
              >
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
                  {readOnly ? (
                    <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-1.5 h-[18px] rounded border ${statusTone[t.status as TaskStatus]}`}>
                      {t.status}
                    </span>
                  ) : (
                    <select
                      value={t.status}
                      onChange={e => setStatus(t, e.target.value as TaskStatus)}
                      onClick={e => e.stopPropagation()}
                      className={`text-[10px] uppercase tracking-wider font-bold pl-1.5 pr-1.5 h-[18px] rounded border cursor-pointer ${statusTone[t.status as TaskStatus]}`}
                      style={{ background: 'transparent' }}
                    >
                      {TASK_STATUSES.map(s => <option key={s} value={s} className="bg-background text-foreground">{s}</option>)}
                    </select>
                  )}
                  <PriorityChip p={t.priority} />
                  {t.taskType && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-1.5 h-[18px] rounded inline-flex items-center">
                      {t.taskType}
                    </span>
                  )}
                  {t.dueDate && (
                    <span className={`text-[10.5px] inline-flex items-center gap-1 ${overdue ? 'text-rose-600 font-semibold' : 'text-muted-foreground'}`}>
                      <Calendar className="h-2.5 w-2.5" />
                      {format(new Date(t.dueDate), 'MMM d')}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteTask(t._id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-all p-1 rounded shrink-0"
                title="Delete"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ─── Helper: chevron-decorated select ─────────────────────────────────────
function SelectChev({
  value, onChange, children, className = '',
}: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none w-full pl-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}
