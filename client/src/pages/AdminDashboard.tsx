import { useEffect, useRef, useState, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart2, Users, Briefcase, CheckCircle2, AlertTriangle, Clock, TrendingUp, ArrowRight, Activity, Monitor, MonitorOff, Video, Loader2, X, Coffee, CalendarOff, ClipboardCheck, KeyRound, ListTodo, Pin, MoreVertical, Trash2 } from 'lucide-react';
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

/** Compact live-screen tile used inside team-status cards. */
function LiveTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />;
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
  const [pinnedScreenUser, setPinnedScreenUser] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
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

  const handleRemoveEmployee = async (emp: any) => {
    if (!confirm(`Remove ${emp.name || emp.email}? Their history is preserved but they won't be able to log in.`)) return;
    try {
      await api.adminRemoveUser(emp._id);
      setEmployees(prev => prev.filter(e => e._id !== emp._id));
      toast.success(`${emp.name || emp.email} removed`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not remove user');
    }
    setOpenMenuFor(null);
  };

  // Pinned screen reference — used to render the live stream big.
  const pinnedRef = (el: HTMLVideoElement | null) => {
    if (el && pinnedScreenUser && remoteStreams[pinnedScreenUser]) {
      el.srcObject = remoteStreams[pinnedScreenUser];
    }
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

          {/* Team status — live screens when broadcasting, avatar otherwise */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Team status</h2>
              {pinnedScreenUser ? (
                <button
                  onClick={() => setPinnedScreenUser(null)}
                  className="ml-auto h-6 px-2 flex items-center gap-1 rounded-md bg-card hover:bg-muted text-xs"
                  title="Back to grid"
                >
                  <X className="h-3 w-3" /> Close
                </button>
              ) : (
                <Link to="/admin/employees" className="ml-auto text-[11px] text-primary hover:underline flex items-center gap-0.5">
                  Manage <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            {pinnedScreenUser && remoteStreams[pinnedScreenUser] ? (
              /* Pinned single-employee view — inline 16:9 expand */
              <div className="p-3">
                <div className="relative bg-black rounded-xl overflow-hidden border border-primary/30 aspect-video w-full">
                  <video ref={pinnedRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] text-white bg-black/60 backdrop-blur flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    {employees.find(e => e._id === pinnedScreenUser)?.name || 'Teammate'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                {employees.slice(0, 12).map(e => {
                  const status = presence.statusOf(e._id);
                  const liveStream = remoteStreams[e._id];
                  const isBroadcasting = !!liveStream;
                  const accent =
                    isBroadcasting          ? 'border-green-500/40' :
                    status === 'active'     ? 'border-green-500/30' :
                    status === 'on_break'   ? 'border-amber-500/30' :
                    status === 'on_leave'   ? 'border-purple-500/30' :
                                               'border-border';

                  return (
                    <div
                      key={e._id}
                      className={`relative rounded-xl border ${accent} overflow-hidden aspect-video group bg-black`}
                    >
                      {/* Live screen, otherwise avatar */}
                      {isBroadcasting ? (
                        <LiveTile stream={liveStream} />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card gap-1">
                          <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                            {(e.name || e.email || '?')[0].toUpperCase()}
                          </div>
                          <p className="text-[11px] font-semibold truncate max-w-full px-2">{e.name?.split(' ')[0] || e.email}</p>
                        </div>
                      )}

                      {/* Bottom strip — name + presence */}
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 flex items-center gap-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                        <p className="text-[11px] font-semibold text-white truncate flex-1">
                          {e.name?.split(' ')[0] || e.email}
                        </p>
                        <PresenceBadge status={status} />
                      </div>

                      {/* Top-right actions */}
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                        {isBroadcasting && (
                          <button
                            onClick={() => setPinnedScreenUser(e._id)}
                            className="h-6 w-6 flex items-center justify-center rounded-md bg-black/60 hover:bg-primary text-white backdrop-blur transition-colors"
                            title="Pin to fullscreen"
                          >
                            <Pin className="h-3 w-3" />
                          </button>
                        )}
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenuFor(openMenuFor === e._id ? null : e._id)}
                            className="h-6 w-6 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 text-white backdrop-blur transition-colors"
                            title="More"
                          >
                            <MoreVertical className="h-3 w-3" />
                          </button>
                          {openMenuFor === e._id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenMenuFor(null)} />
                              <div className="absolute right-0 top-7 z-40 w-44 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                                <Link
                                  to="/admin/employees"
                                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted"
                                  onClick={() => setOpenMenuFor(null)}
                                >
                                  <Users className="h-3 w-3" /> View profile
                                </Link>
                                <button
                                  onClick={() => handleRemoveEmployee(e)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 border-t border-border"
                                >
                                  <Trash2 className="h-3 w-3" /> Remove employee
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Live indicator dot top-left when broadcasting */}
                      {isBroadcasting && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white bg-red-500/90 flex items-center gap-1 backdrop-blur">
                          <span className="h-1 w-1 rounded-full bg-white animate-pulse" /> LIVE
                        </div>
                      )}
                    </div>
                  );
                })}
                {employees.length === 0 && (
                  <p className="col-span-full text-xs text-muted-foreground text-center py-8">No employees yet</p>
                )}
              </div>
            )}
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
      </div>
    </AppLayout>
  );
}
