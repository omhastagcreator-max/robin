import { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BarChart2, Users, Briefcase, CheckCircle2, AlertTriangle, Clock, TrendingUp, ArrowRight, Activity, Monitor, MonitorOff, Video, Loader2, X, Coffee, CalendarOff, ClipboardCheck, KeyRound, ListTodo } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useWebRTCReceiver } from '@/hooks/useWebRTC';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { HuddleQuickPill } from '@/components/shared/HuddleQuickPill';
import { VaultAuditPanel } from '@/components/admin/VaultAuditPanel';
import * as api from '@/api';
import { FullPageSpinner } from '@/components/shared/Spinner';

interface Stats {
  totalTasks: number; completedTasks: number; overdueTasks: number;
  totalProjects: number; activeProjects: number;
  activeEmployees: number; totalRevenue?: number;
  taskTrend?: { date: string; done: number }[];
  atRiskProjects?: { _id: string; name: string; overdueTasks: number }[];
}

function KPICard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon?: React.ElementType; color?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4">
      {Icon && (
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color || 'bg-primary/15'}`}>
          <Icon className={`h-5 w-5 ${color ? '' : 'text-primary'}`} />
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  );
}

function RemoteVideo({ stream, isPinned, onPin, name, onDisconnect }: { stream: MediaStream, isPinned: boolean, onPin: () => void, name: string, onDisconnect: () => void }) {
  const ref = useCallback((el: HTMLVideoElement | null) => {
    if (el && stream) el.srcObject = stream;
  }, [stream]);

  return (
    <div className={`relative bg-black/95 rounded-2xl overflow-hidden border transition-all ${isPinned ? 'border-primary/50 shadow-2xl col-span-full h-[60vh] xl:h-[70vh]' : 'border-border/50 h-48 sm:h-56'}`}>
      <video ref={ref} autoPlay playsInline className="w-full h-full object-contain" />
      <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        {name}
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 hover:opacity-100 transition-opacity absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent flex justify-end items-start p-3">
        <button onClick={onPin} className="bg-black/60 hover:bg-primary/80 backdrop-blur-md p-2 rounded-lg text-white transition-all shadow-sm">
          {isPinned ? <MonitorOff className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </button>
        <button onClick={onDisconnect} className="bg-black/60 hover:bg-red-500/80 backdrop-blur-md p-2 rounded-lg text-white transition-all shadow-sm">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PresenceBadge({ status }: { status: PresenceStatus }) {
  if (status === 'on_leave')  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-purple-500/15 text-purple-500 border border-purple-500/30"><CalendarOff className="h-2.5 w-2.5" />Leave</span>;
  if (status === 'on_break')  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30"><Coffee className="h-2.5 w-2.5" />Break</span>;
  if (status === 'active')    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-green-500/15 text-green-600 border border-green-500/30"><span className="h-1 w-1 rounded-full bg-green-500" />Working</span>;
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground">Off</span>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const socket = useSocket();
  const presence = useTeamPresence();

  // WebRTC Screen Monitor additions
  const { user } = useAuth();
  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [pinnedUser, setPinnedUser] = useState<string | null>(null);
  const { remoteStreams, connectingTo, viewScreen, stopViewing } = useWebRTCReceiver(user?.id || '');

  // Auto-connect to new screens
  useEffect(() => {
    screenSessions.forEach(s => {
      if (s.status === 'active' && !remoteStreams[s.userId] && !connectingTo[s.userId]) {
        viewScreen(s.userId);
      }
    });
  }, [screenSessions, remoteStreams, connectingTo, viewScreen]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.listScreenSessions();
      setScreenSessions(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [s, e, leaves] = await Promise.all([
        api.getAdminStats().catch(() => null),
        api.adminEmployees().catch(() => []),
        api.adminListLeaves({ status: 'pending' }).catch(() => []),
      ]);
      setStats(s);
      setEmployees(Array.isArray(e) ? e : []);
      setPendingLeaveCount(Array.isArray(leaves) ? leaves.length : 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadStats();
    const i = setInterval(loadSessions, 10000);
    return () => clearInterval(i);
  }, [loadSessions, loadStats]);

  useEffect(() => {
    if (!socket) return;
    socket.on('screen:started', loadSessions);
    socket.on('screen:stopped', loadSessions);
    socket.on('presence:update', loadStats);

    return () => {
      socket.off('screen:started', loadSessions);
      socket.off('screen:stopped', loadSessions);
      socket.off('presence:update', loadStats);
    };
  }, [socket, loadSessions, loadStats]);

  const handleView = (targetId: string) => {
    viewScreen(targetId);
  };

  if (loading) return <FullPageSpinner />;

  const pct = stats ? Math.round(((stats.completedTasks || 0) / Math.max(1, stats.totalTasks)) * 100) : 0;

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        {/* Manager hero — greeting + quick context */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Hi {user?.name?.split(' ')[0] || 'Manager'} 👋
            </h1>
            <p className="text-sm text-muted-foreground">
              {presence.active.length} working
              {presence.onBreak.length > 0 ? ` · ${presence.onBreak.length} on break` : ''}
              {(presence.onLeave?.length || 0) > 0 ? ` · ${presence.onLeave?.length} on leave` : ''}
              {pendingLeaveCount > 0 ? ` · ${pendingLeaveCount} approval${pendingLeaveCount === 1 ? '' : 's'} waiting on you` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <HuddleQuickPill />
            <Link to="/admin/reports" className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
              Full report <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Manager KPI strip — emphasises decisions waiting on the manager */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            to="/admin/leaves"
            className={`rounded-2xl border p-4 flex items-center gap-3 transition-all ${
              pendingLeaveCount > 0
                ? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15'
                : 'border-border bg-card hover:bg-muted/30'
            }`}
          >
            <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${pendingLeaveCount > 0 ? 'bg-amber-500/20 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <p className={`text-2xl font-black tabular-nums leading-none ${pendingLeaveCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                {pendingLeaveCount}
              </p>
              <p className="text-xs font-semibold mt-1">Approvals waiting</p>
              <p className="text-[10px] text-muted-foreground">leave requests · click to review</p>
            </div>
          </Link>

          <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-green-500/20 text-green-600 flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-black text-green-600 tabular-nums leading-none">{presence.active.length}</p>
              <p className="text-xs font-semibold mt-1">Working now</p>
              <p className="text-[10px] text-muted-foreground">
                {presence.onBreak.length} break · {presence.onLeave?.length || 0} leave
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-red-500/20 text-red-500 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-black text-red-500 tabular-nums leading-none">{stats?.overdueTasks ?? 0}</p>
              <p className="text-xs font-semibold mt-1">Overdue tasks</p>
              <p className="text-[10px] text-muted-foreground">across the agency</p>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-violet-500/20 text-violet-600 flex items-center justify-center">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-black text-violet-600 tabular-nums leading-none">{stats?.activeProjects ?? 0}</p>
              <p className="text-xs font-semibold mt-1">Active projects</p>
              <p className="text-[10px] text-muted-foreground">{stats?.atRiskProjects?.length || 0} at risk · {pct}% tasks done</p>
            </div>
          </div>
        </div>

        {/* Manager toolkit — one-click into each oversight area */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Manager toolkit</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Link to="/admin/employees" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Users className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold">Team</p>
              <p className="text-[10px] text-muted-foreground">{employees.length} members</p>
            </Link>
            <Link to="/admin/projects" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Briefcase className="h-4 w-4 text-violet-500" />
              <p className="text-xs font-semibold">Projects</p>
              <p className="text-[10px] text-muted-foreground">{stats?.activeProjects ?? 0} active</p>
            </Link>
            <Link to="/admin/clients" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <ListTodo className="h-4 w-4 text-blue-500" />
              <p className="text-xs font-semibold">Clients</p>
              <p className="text-[10px] text-muted-foreground">manage</p>
            </Link>
            <Link to="/admin/leaves" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <CalendarOff className="h-4 w-4 text-amber-500" />
              <p className="text-xs font-semibold">Leaves</p>
              <p className="text-[10px] text-muted-foreground">{pendingLeaveCount} waiting</p>
            </Link>
            <Link to="/vault" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <KeyRound className="h-4 w-4 text-green-500" />
              <p className="text-xs font-semibold">Vault</p>
              <p className="text-[10px] text-muted-foreground">audit log</p>
            </Link>
            <Link to="/admin/reports" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <BarChart2 className="h-4 w-4 text-pink-500" />
              <p className="text-xs font-semibold">Reports</p>
              <p className="text-[10px] text-muted-foreground">org analytics</p>
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Task Completion Trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-sm mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Task completion trend</h2>
            {stats?.taskTrend && stats.taskTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={stats.taskTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 13%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} />
                  <Tooltip contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="done" stroke="hsl(265 85% 65%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No trend data yet</div>
            )}
          </div>

          {/* Team status — card grid (manager view, not the row list employees see) */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Team status</h2>
              <Link to="/admin/employees" className="ml-auto text-[11px] text-primary hover:underline flex items-center gap-0.5">
                Manage <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {employees.slice(0, 8).map(e => {
                const status = presence.statusOf(e._id);
                const accent =
                  status === 'active'    ? 'border-green-500/30 bg-green-500/5' :
                  status === 'on_break'  ? 'border-amber-500/30 bg-amber-500/5' :
                  status === 'on_leave'  ? 'border-purple-500/30 bg-purple-500/5' :
                                            'border-border';
                return (
                  <div key={e._id} className={`rounded-xl border ${accent} p-2 flex flex-col items-center text-center gap-1`}>
                    <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {(e.name || e.email || '?')[0].toUpperCase()}
                    </div>
                    <p className="text-[11px] font-semibold truncate w-full">{e.name?.split(' ')[0] || e.email}</p>
                    <PresenceBadge status={status} />
                  </div>
                );
              })}
              {employees.length === 0 && (
                <p className="col-span-full text-xs text-muted-foreground text-center py-8">No employees yet</p>
              )}
            </div>
          </div>
        </div>

        {/* At-Risk Projects */}
        {stats?.atRiskProjects && stats.atRiskProjects.length > 0 && (
          <div className="bg-card border border-red-500/20 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-red-500/20 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h2 className="font-semibold text-sm">At-Risk Projects</h2>
            </div>
            <div className="divide-y divide-border/50">
              {stats.atRiskProjects.map(p => (
                <div key={p._id} className="px-5 py-3 flex items-center justify-between">
                  <p className="text-sm font-medium">{p.name}</p>
                  <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">{p.overdueTasks} overdue</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vault Audit Log — admin-only feed of who saw which credentials */}
        <VaultAuditPanel limit={15} />

        {/* Admin Live Screen Monitor */}
        <div className="space-y-4 pt-4 border-t border-border mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Monitor className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Live Employee Screens</h2>
            <span className="ml-auto text-xs text-muted-foreground bg-green-500/10 text-green-500 border border-green-500/20 px-3 py-1 rounded-full font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              {screenSessions.filter(s => s.status === 'active').length} broadcasting
            </span>
          </div>

          {screenSessions.filter(s => s.status === 'active').length === 0 ? (
            <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-4">
              <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
                <MonitorOff className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">No active screen sessions</p>
                <p className="text-xs text-muted-foreground mt-1">When employees start sharing their screen, they will appear here automatically.</p>
              </div>
            </div>
          ) : (
            <div className={`grid gap-4 ${pinnedUser ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
              {/* Force pinned user to render first if pinned */}
              {pinnedUser && remoteStreams[pinnedUser] && (
                <RemoteVideo 
                  key={`pinned-${pinnedUser}`}
                  stream={remoteStreams[pinnedUser]}
                  isPinned={true} 
                  onPin={() => setPinnedUser(null)}
                  name={screenSessions.find(s => s.userId === pinnedUser)?.profile?.name || pinnedUser}
                  onDisconnect={() => { stopViewing(pinnedUser); setPinnedUser(null); }}
                />
              )}

              {/* Render the rest */}
              {Object.entries(remoteStreams).filter(([id]) => id !== pinnedUser).map(([userId, stream]) => (
                <RemoteVideo 
                  key={userId}
                  stream={stream}
                  isPinned={false} 
                  onPin={() => setPinnedUser(userId)}
                  name={screenSessions.find(s => s.userId === userId)?.profile?.name || userId}
                  onDisconnect={() => stopViewing(userId)}
                />
              ))}

              {/* Connecting Indicators */}
              {Object.entries(connectingTo).filter(([id, connecting]) => connecting).map(([userId]) => (
                <div key={`connecting-${userId}`} className="bg-muted/10 border border-dashed border-border/50 rounded-2xl h-48 sm:h-56 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    Connecting to {screenSessions.find(s => s.userId === userId)?.profile?.name || 'User'}…
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
