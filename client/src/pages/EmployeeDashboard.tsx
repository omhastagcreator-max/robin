import { useState, useEffect, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Play, Pause, StopCircle, CheckCircle2, AlertTriangle,
  Plus, Calendar, Target, Bell, Loader2, X, Send, UserPlus, Info,
  TrendingUp, Megaphone, Code2, Users, BarChart3, IndianRupee,
  Star, Zap, Globe, Share2
} from 'lucide-react';
import { format, isToday, isBefore, startOfDay } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import * as api from '@/api';
import { useSession } from '@/hooks/useSession';
import { useTasks } from '@/hooks/useTasks';
import { SessionClockCard } from '@/components/shared/SessionClockCard';
import { HuddleQuickPill } from '@/components/shared/HuddleQuickPill';
import { QuickActionsCard } from '@/components/shared/QuickActionsCard';
import { WeeklyPlanner } from '@/components/shared/WeeklyPlanner';
import { AIMorningBrief } from '@/components/dashboard/AIMorningBrief';


const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400'
};
const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-400',
  done:        'bg-green-500/15 text-green-400',
  blocked:     'bg-red-500/15 text-red-400',
};
const STATUSES = ['pending', 'in_progress', 'done', 'blocked'] as const;

// ── Team / Role specific widget ────────────────────────────────────────────
function TeamRoleWidget({ team, tasks }: { team: string; tasks: any[] }) {
  const done    = tasks.filter(t => t.status === 'done').length;
  const total   = tasks.length;
  const pct     = total ? Math.round((done / total) * 100) : 0;
  const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date()))).length;

  if (team === 'ads') return (
    <div className="grid sm:grid-cols-4 gap-3">
      {[
        { label: 'Active Campaigns', value: '3',     icon: Megaphone, color: 'text-blue-600',   bg: 'bg-blue-50'   },
        { label: 'Avg. ROAS',        value: '2.8x',  icon: TrendingUp,color: 'text-green-600',  bg: 'bg-green-50'  },
        { label: 'Tasks Done',       value: `${done}/${total}`, icon: BarChart3, color: 'text-violet-600', bg: 'bg-violet-50' },
        { label: 'Overdue',          value: String(overdue),    icon: Zap, color: 'text-red-500', bg: 'bg-red-50' },
      ].map(k => (
        <div key={k.label} className={`${k.bg} rounded-2xl px-4 py-3 flex items-center gap-3 border border-gray-100`}>
          <k.icon className={`h-5 w-5 ${k.color} opacity-80 shrink-0`} />
          <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-lg font-bold ${k.color}`}>{k.value}</p></div>
        </div>
      ))}
    </div>
  );

  if (team === 'influencer') return (
    <div className="grid sm:grid-cols-4 gap-3">
      {[
        { label: 'Active Campaigns', value: '2',       icon: Star,    color: 'text-pink-600',   bg: 'bg-pink-50'   },
        { label: 'Influencers Live', value: '12',      icon: Users,   color: 'text-purple-600', bg: 'bg-purple-50' },
        { label: 'Avg Engagement',   value: '4.2%',    icon: Share2,  color: 'text-amber-600',  bg: 'bg-amber-50'  },
        { label: 'Tasks Progress',   value: `${pct}%`, icon: Target,  color: 'text-emerald-600',bg: 'bg-emerald-50'},
      ].map(k => (
        <div key={k.label} className={`${k.bg} rounded-2xl px-4 py-3 flex items-center gap-3 border border-gray-100`}>
          <k.icon className={`h-5 w-5 ${k.color} opacity-80 shrink-0`} />
          <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-lg font-bold ${k.color}`}>{k.value}</p></div>
        </div>
      ))}
    </div>
  );

  if (team === 'dev') return (
    <div className="grid sm:grid-cols-4 gap-3">
      {[
        { label: 'Active Projects', value: '1',       icon: Globe,   color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { label: 'Tasks Done',      value: `${done}/${total}`, icon: Code2,   color: 'text-blue-600',   bg: 'bg-blue-50'   },
        { label: 'Overdue',         value: String(overdue),    icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
        { label: 'Progress',        value: `${pct}%`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
      ].map(k => (
        <div key={k.label} className={`${k.bg} rounded-2xl px-4 py-3 flex items-center gap-3 border border-gray-100`}>
          <k.icon className={`h-5 w-5 ${k.color} opacity-80 shrink-0`} />
          <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-lg font-bold ${k.color}`}>{k.value}</p></div>
        </div>
      ))}
    </div>
  );

  // default
  return null;
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { session } = useSession();
  const { tasks, loading: tasksLoading, refresh, createTask, updateTask, deleteTask } = useTasks();

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', dueDate: '', taskType: 'dev', assignToId: '', projectId: '' });
  const [saving, setSaving] = useState(false);
  const [viewPast, setViewPast] = useState(false);

  // Task buckets — split is OPEN vs DONE so nothing disappears.
  //   • todayTasks   = every open task you might work on (status !== done).
  //                    Sorted so today's due dates and overdue surface first.
  //   • pastTasks    = completed history (status === done).
  //   • overdueTasks = open + dueDate < today, used for the KPI card.
  //   The previous strict `dueDate === today` filter silently dropped tasks
  //   with no due date or future dates, which looked like data loss.
  const todayStartLocal = startOfDay(new Date());
  const isOverdueT = (t: any) => t.status !== 'done' && t.dueDate && isBefore(new Date(t.dueDate), todayStartLocal);
  const todayTasks = tasks
    .filter(t => t.status !== 'done')
    .slice()
    .sort((a, b) => {
      // Overdue and "today" first, then no-due-date, then upcoming
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
  const pendingToday = todayTasks.length;
  const overdueTasks = tasks.filter(isOverdueT);
  const pastTasks = tasks.filter(t => t.status === 'done');
  const dayLocked = !session && tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate))).length < 3;

  useEffect(() => {
    refresh();
    api.listUsers().then(d => setAllUsers(Array.isArray(d) ? d.filter((u: any) => u._id !== user?.id) : []));
    api.listNotifications({ limit: 10 }).then(d => setNotifications(Array.isArray(d) ? d.slice(0, 5) : []));
    api.listProjects().then(d => setProjects(Array.isArray(d) ? d.filter(p => p.status === 'active') : []));
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title) return;
    setSaving(true);
    try {
      const payload: any = { ...newTask, status: 'pending', dueDate: newTask.dueDate || new Date().toISOString().split('T')[0] };
      if (newTask.assignToId) payload.assignedTo = newTask.assignToId;
      if (!payload.projectId) delete payload.projectId;
      await createTask(payload);
      setNewTask({ title: '', priority: 'medium', dueDate: '', taskType: 'dev', assignToId: '', projectId: '' });
      setAddingTask(false);
      toast.success(newTask.assignToId ? 'Task assigned to teammate!' : 'Task added!');
    } catch { toast.error('Failed to create task'); }
    finally { setSaving(false); }
  };

  const cycleStatus = async (task: any) => {
    const MAP: Record<string, 'pending' | 'in_progress' | 'done' | 'blocked'> = { pending: 'in_progress', in_progress: 'done', done: 'pending', blocked: 'in_progress' };
    const next = MAP[task.status as string] ?? 'pending';
    await updateTask(task._id, { status: next });
  };

  // KPI summary
  const doneTasks    = tasks.filter(t => t.status === 'done').length;
  const blockedTasks = tasks.filter(t => t.status === 'blocked').length;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.name?.split(' ')[0] || 'there'} 👋</h1>
            <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
          </div>
          <HuddleQuickPill />
        </div>

        {/* AI Morning Brief — Claude-generated personalized briefing */}
        <AIMorningBrief />

        {/* Quick actions — start your day in one click */}
        <QuickActionsCard />

        {/* Team/role specific widget */}
        {user?.team && <TeamRoleWidget team={user.team} tasks={tasks} />}

        {/* Day-Start Gate Banner */}
        <AnimatePresence>
          {dayLocked && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">Add {3 - todayTasks.length} more task{3 - todayTasks.length !== 1 ? 's' : ''} to start your day</p>
                <p className="text-xs text-amber-400/70 mt-0.5">You must plan at least 3 tasks for today before clocking in.</p>
                <button onClick={() => setAddingTask(true)} className="mt-2 text-xs text-amber-400 underline">+ Add task now</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notifications strip */}
        {notifications.filter(n => !n.isRead).length > 0 && (
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-3 space-y-1.5">
            <p className="text-xs font-semibold text-primary">🔔 Unread notifications</p>
            {notifications.filter(n => !n.isRead).slice(0, 3).map(n => (
              <div key={n._id} className="flex items-start gap-2">
                <Bell className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium">{n.title}</p>
                  {n.message && <p className="text-xs text-muted-foreground">{n.message}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* KPI strip — compact horizontal cards, scannable at a glance */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open Tasks',  value: todayTasks.length,    sub: `${tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate)) && t.status !== 'done').length} due today`, color: 'text-primary',  accent: 'border-primary/20 bg-primary/5' },
            { label: 'Done',        value: doneTasks,            sub: 'all time',                                                                                                color: 'text-green-500', accent: 'border-green-500/20 bg-green-500/5' },
            { label: 'Overdue',     value: overdueTasks.length,  sub: 'need attention',                                                                                          color: 'text-red-500',   accent: 'border-red-500/20 bg-red-500/5' },
            { label: 'Blocked',     value: blockedTasks,         sub: 'need help',                                                                                               color: 'text-amber-500', accent: 'border-amber-500/20 bg-amber-500/5' },
          ].map(k => (
            <div key={k.label} className={`rounded-2xl border ${k.accent} p-3 flex items-center gap-3`}>
              <p className={`text-3xl font-black ${k.color} tabular-nums leading-none`}>{k.value}</p>
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-tight">{k.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{k.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tasks (2/3) + Today rail (1/3) */}
        <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">My Tasks <span className="text-muted-foreground font-normal">({tasks.length})</span></h2>
              <button onClick={() => setAddingTask(v => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                <Plus className="h-3.5 w-3.5" /> Add / Assign
              </button>
            </div>

            {/* Add task inline form */}
            <AnimatePresence>
              {addingTask && (
                <motion.form initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  onSubmit={handleCreateTask} className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">New Task / Assign to Team</p>
                    <button type="button" onClick={() => setAddingTask(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </div>
                  <input autoFocus value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} required
                    placeholder="Task title…" className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
                      className="col-span-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                      {['low','medium','high','urgent'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select value={newTask.taskType} onChange={e => setNewTask(p => ({ ...p, taskType: e.target.value }))}
                      className="col-span-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                      {['dev','ads','content','design','admin_task','pixel','seo'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <input type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                      className="col-span-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs" />
                    <select value={newTask.assignToId} onChange={e => setNewTask(p => ({ ...p, assignToId: e.target.value }))}
                      className="col-span-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                      <option value="">Assign to me</option>
                      {allUsers.map((u: any) => <option key={u._id} value={u._id}>{u.name || u.email} ({u.team || u.role})</option>)}
                    </select>
                    <select value={newTask.projectId} onChange={e => setNewTask(p => ({ ...p, projectId: e.target.value }))}
                      className="col-span-2 px-2 py-1.5 bg-background border border-input rounded-lg text-xs">
                      <option value="">No Project</option>
                      {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  {newTask.assignToId && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 rounded-lg px-2 py-1.5">
                      <UserPlus className="h-3 w-3" /> Task will be assigned to teammate with notification
                    </div>
                  )}
                  <button type="submit" disabled={!newTask.title || saving}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    {newTask.assignToId ? 'Assign Task' : 'Add Task'}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Open / Done tabs — Open shows everything not finished so
                no task ever disappears just because the date drifted. */}
            <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-full w-fit">
              <button
                onClick={() => setViewPast(false)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  !viewPast ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Open <span className="text-muted-foreground ml-0.5">{todayTasks.length}</span>
              </button>
              <button
                onClick={() => setViewPast(true)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  viewPast ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Done <span className="text-muted-foreground ml-0.5">{pastTasks.length}</span>
              </button>
              {viewPast && (
                <span className="ml-2 text-[10px] text-muted-foreground italic">archive · view-only</span>
              )}
            </div>

            {/* Task card grid */}
            {tasksLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : (
              <>
                {!viewPast && todayTasks.length === 0 && (
                  <div className="bg-card border border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">
                    <Target className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">All caught up — no open tasks</p>
                    <button onClick={() => setAddingTask(true)} className="text-xs text-primary hover:underline mt-1">+ Add a task</button>
                  </div>
                )}
                {viewPast && pastTasks.length === 0 && (
                  <div className="bg-card border border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">
                    <Calendar className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No completed tasks yet</p>
                  </div>
                )}

                {/* ONE card containing all tasks as compact rows */}
                {(viewPast ? pastTasks : todayTasks).length > 0 && (
                  <div className="bg-card border border-border rounded-2xl divide-y divide-border/50 overflow-hidden">
                    <AnimatePresence initial={false}>
                      {(viewPast ? pastTasks : todayTasks).map(task => {
                        const overdue = task.dueDate && isBefore(new Date(task.dueDate), startOfDay(new Date())) && task.status !== 'done';
                        return (
                          <motion.div
                            key={task._id}
                            layout
                            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors ${viewPast ? 'opacity-90' : ''}`}
                          >
                            <button
                              onClick={() => !viewPast && cycleStatus(task)}
                              disabled={viewPast}
                              className="shrink-0 disabled:cursor-default"
                              title={viewPast ? 'Past tasks are view-only' : 'Cycle status'}
                            >
                              <CheckCircle2 className={`h-4 w-4 transition-colors ${
                                task.status === 'done' ? 'text-green-500' :
                                viewPast ? 'text-muted-foreground/40' :
                                'text-muted-foreground/30 hover:text-green-500'
                              }`} />
                            </button>

                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                                {task.title}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {viewPast ? (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[task.status]}`}>
                                    {task.status.replace('_', ' ')}
                                  </span>
                                ) : (
                                  <select
                                    value={task.status}
                                    onChange={e => updateTask(task._id, { status: e.target.value as 'pending' | 'in_progress' | 'done' | 'blocked' })}
                                    onClick={e => e.stopPropagation()}
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border-0 cursor-pointer ${STATUS_COLORS[task.status]}`}
                                    style={{ background: 'transparent' }}
                                  >
                                    {STATUSES.map(s => <option key={s} value={s} className="bg-background text-foreground">{s.replace('_', ' ')}</option>)}
                                  </select>
                                )}
                                <span className={`text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_COLORS[task.priority]}`}>
                                  {task.priority}
                                </span>
                                {task.taskType && (
                                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">
                                    {task.taskType}
                                  </span>
                                )}
                              </div>
                            </div>

                            {task.dueDate && (
                              <span className={`text-[11px] flex items-center gap-1 shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                                <Calendar className="h-3 w-3" />{format(new Date(task.dueDate), 'MMM d')}
                              </span>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─── Right rail — Weekly planner, reminders, quick links ─── */}
          <aside className="space-y-3">
            {/* Weekly planner — track every day this week + add reminders */}
            <WeeklyPlanner
              tasks={tasks}
              onDeleteTask={async (id) => {
                try { await deleteTask(id); toast.success('Task deleted'); }
                catch { toast.error('Could not delete task'); }
              }}
            />

            {/* Reminders / unread notifications */}
            {notifications.filter(n => !n.isRead).length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
                <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                  <Bell className="h-4 w-4 text-primary" /> Reminders
                  <span className="text-[10px] text-muted-foreground font-normal ml-auto">
                    {notifications.filter(n => !n.isRead).length} unread
                  </span>
                </h3>
                <div className="space-y-2">
                  {notifications.filter(n => !n.isRead).slice(0, 4).map(n => (
                    <div key={n._id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{n.title}</p>
                        {n.message && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{n.message}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick links — light, accessible from one place */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="font-semibold text-sm mb-3">Quick links</h3>
              <div className="space-y-1">
                <button onClick={() => window.location.assign('/vault')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 text-xs">
                  <span className="text-violet-500">🔑</span> Client vault
                </button>
                <button onClick={() => window.location.assign('/leaves')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 text-xs">
                  <span className="text-purple-500">📅</span> Apply leave
                </button>
                <button onClick={() => window.location.assign('/chat')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 text-xs">
                  <span className="text-pink-500">💬</span> Group chat
                </button>
                <button onClick={() => window.location.assign('/workroom')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 text-xs">
                  <span className="text-green-500">🎙️</span> Work room
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
