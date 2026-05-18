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
import { WeeklyPlanner } from '@/components/shared/WeeklyPlanner';
import { AIMorningBrief } from '@/components/dashboard/AIMorningBrief';
import { MetaAdsCard } from '@/components/dashboard/MetaAdsCard';
import { TodayMeetingsStrip } from '@/components/dashboard/TodayMeetingsStrip';
import { ActiveClientMeetingsCard } from '@/components/dashboard/ActiveClientMeetingsCard';
import { ScheduleMeetingsSection } from '@/components/dashboard/ScheduleMeetingsSection';
import { HuddleDashboardCard } from '@/components/shared/HuddleDashboardCard';
import { TodayClientsCard } from '@/components/dashboard/TodayClientsCard';
import { MyAssignedServicesCard } from '@/components/dashboard/MyAssignedServicesCard';
import { TASK_STATUSES, TASK_TYPES, nextTaskStatus, type TaskStatus } from '@/lib/enums';


const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400'
};
// Server enum: pending | ongoing | done. The old in_progress/blocked values
// 400'd on every dropdown change; single source of truth in lib/enums.ts.
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  ongoing: 'bg-blue-500/15 text-blue-400',
  done:    'bg-green-500/15 text-green-400',
};
const STATUSES = TASK_STATUSES;

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
    // Each call gets its own .catch so a single 5xx doesn't trigger an
    // unhandled promise rejection. The axios interceptor still toasts the
    // user-facing error; we just don't want to crash the dashboard if (e.g.)
    // notifications fail to load while everything else works.
    refresh().catch(() => {/* hook handles its own state */});
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
      // If an explicit teammate was picked, assign to them. Otherwise
      // assign to ME so the task is actually visible in MY task list on
      // next refresh — listTasks filters non-admins to assignedTo: userId
      // so an unassigned task would "vanish" the moment you reload.
      payload.assignedTo = newTask.assignToId || user?.id;
      if (!payload.projectId) delete payload.projectId;
      await createTask(payload);
      setNewTask({ title: '', priority: 'medium', dueDate: '', taskType: 'dev', assignToId: '', projectId: '' });
      setAddingTask(false);
      toast.success(newTask.assignToId ? 'Task assigned to teammate!' : 'Task added!');
    } catch { toast.error('Failed to create task'); }
    finally { setSaving(false); }
  };

  const cycleStatus = async (task: any) => {
    // Server enum is `pending | ongoing | done`. The old map used
    // `in_progress`/`blocked` which 400'd every cycle and silently desynced
    // the UI from the database. Use canonical helper from lib/enums.
    const current = (TASK_STATUSES as readonly string[]).includes(task.status) ? task.status : 'pending';
    const next = nextTaskStatus(current);
    try {
      await updateTask(task._id, { status: next });
    } catch { /* axios interceptor toasts the error */ }
  };

  // KPI summary — server has no 'blocked' status, so "stuck" is now derived
  // from overdue+ongoing instead. Avoids showing a stat that's always zero.
  const doneTasks    = tasks.filter(t => t.status === 'done').length;
  const stuckTasks   = tasks.filter(t => t.status === 'ongoing' && t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date()))).length;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        {/* Hero — big confident opening, status snapshot, day stamp */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-border p-5 sm:p-6">
          {/* Decorative accent stripe — saffron, very subtle */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-primary opacity-90" />

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                {format(new Date(), 'EEEE · dd MMM yyyy')}
              </p>
              <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight">
                {(() => {
                  const h = new Date().getHours();
                  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                })()},{' '}
                <span className="text-primary">{user?.name?.split(' ')[0] || 'there'}</span>.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground max-w-xl">
                {(() => {
                  const due = tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate)) && t.status !== 'done').length;
                  const overdue = overdueTasks.length;
                  if (overdue > 0) return `You've got ${overdue} overdue ${overdue === 1 ? 'task' : 'tasks'} — clear those first.`;
                  if (due > 0)     return `${due} ${due === 1 ? 'task is' : 'tasks are'} due today. Let's get to it.`;
                  if (todayTasks.length > 0) return `${todayTasks.length} open ${todayTasks.length === 1 ? 'task' : 'tasks'} on your plate. Nothing on fire.`;
                  return 'Inbox zero on tasks. A good day to ship something deep.';
                })()}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Date stamp tile — big day number */}
              <div className="hidden sm:block text-center px-4 py-2 rounded-xl border border-border bg-background">
                <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground leading-none">
                  {format(new Date(), 'MMM')}
                </p>
                <p className="text-2xl font-black text-primary leading-none mt-1">{format(new Date(), 'dd')}</p>
              </div>
              <HuddleQuickPill />
            </div>
          </div>
        </div>

        {/* Day-start gate — slim inline strip when locked, replaces the
            chunky banner that used to dominate the page. */}
        <AnimatePresence>
          {dayLocked && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-center gap-2 text-xs">
              <Info className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <p className="flex-1 text-amber-700">
                Plan {3 - todayTasks.length} more task{3 - todayTasks.length !== 1 ? 's' : ''} before clocking in.
              </p>
              <button onClick={() => setAddingTask(true)}
                className="text-amber-700 font-semibold underline hover:no-underline">
                + Add task
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* KPI strip — moved UP to be directly under hero. The numbers are the
            most important thing on the page; everything else is secondary. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open tasks', value: todayTasks.length,   hint: `${tasks.filter(t => t.dueDate && isToday(new Date(t.dueDate)) && t.status !== 'done').length} due today`, dot: 'bg-primary',  num: 'text-primary',   icon: Target },
            { label: 'Completed',  value: doneTasks,           hint: 'all time',                                                                                              dot: 'bg-emerald-500', num: 'text-foreground', icon: CheckCircle2 },
            { label: 'Overdue',    value: overdueTasks.length, hint: overdueTasks.length === 0 ? 'all clear' : 'fix today',                                                   dot: 'bg-red-500',  num: overdueTasks.length === 0 ? 'text-foreground' : 'text-red-500',     icon: AlertTriangle },
            { label: 'Stuck',      value: stuckTasks,          hint: stuckTasks === 0 ? 'nothing stuck' : 'in-progress + overdue',                                            dot: 'bg-amber-500', num: stuckTasks === 0 ? 'text-foreground' : 'text-amber-500', icon: Zap },
          ].map(k => (
            <div key={k.label} className="group rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
                  {k.label}
                </span>
                <k.icon className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
              <p className={`mt-2 text-4xl font-black tabular-nums leading-none ${k.num}`}>{k.value}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{k.hint}</p>
            </div>
          ))}
        </div>

        {/* Today's clients — mirrors the login reminder, lets the user mark
            slots done without opening the full schedule page. Hidden on
            days with nothing scheduled so it doesn't clutter the dashboard. */}
        <TodayClientsCard />

        {/* Your active client services — links straight into the pipeline
            detail page so the employee can tick checklist items. Hidden
            if they don't own any services. */}
        <MyAssignedServicesCard />

        {/* Active sections — 2-column layout instead of stacked full-width cards.
            Left column = AI Morning Brief (if it has content). Right column =
            live status (huddle + today's meetings + active client meetings).
            Cards that only render conditionally (Meta Ads, Team Role) sit
            below in their own row so they don't push the layout around. */}
        <div className="grid lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <AIMorningBrief />
          </div>
          <div className="space-y-3">
            <HuddleDashboardCard />
            <TodayMeetingsStrip />
            <ActiveClientMeetingsCard />
          </div>
        </div>

        {/* Conditional: Meta Ads (only renders for ads/admin) */}
        <MetaAdsCard />

        {/* Conditional: team-specific role widget */}
        {user?.team && <TeamRoleWidget team={user.team} tasks={tasks} />}

        {/* Notifications — slim if any, hidden otherwise */}
        {notifications.filter(n => !n.isRead).length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 flex items-start gap-2">
            <Bell className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-primary">
                {notifications.filter(n => !n.isRead).length} unread
              </p>
              <div className="space-y-0.5 mt-1">
                {notifications.filter(n => !n.isRead).slice(0, 3).map(n => (
                  <p key={n._id} className="text-xs">
                    <span className="font-medium">{n.title}</span>
                    {n.message && <span className="text-muted-foreground"> · {n.message}</span>}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

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
                      {/* Server enum is dev/ads/content/admin_task/personal — sending design/pixel/seo would 400. */}
                      {TASK_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
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
                                    onChange={e => {
                                      // Wrap in try/catch — server only accepts pending|ongoing|done.
                                      // The dropdown is now bound to TASK_STATUSES so invalid values
                                      // can't reach this handler, but defensive catch keeps an
                                      // unhandled rejection from bubbling up if something else fails.
                                      updateTask(task._id, { status: e.target.value as TaskStatus })
                                        .catch(() => {/* axios interceptor handles the toast */});
                                    }}
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

          {/* ─── Right rail — Meetings, weekly planner, reminders, quick links ─── */}
          <aside className="space-y-3">
            {/* Meetings — sits beside tasks so the dashboard balances out
                even when there are only a handful of tasks. */}
            <ScheduleMeetingsSection />

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
