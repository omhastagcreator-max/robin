import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart2, Users, Briefcase, CheckCircle2, AlertTriangle, Clock, TrendingUp, ArrowRight, Activity, Monitor, MonitorOff, Video, Loader2, X, Coffee, CalendarOff, ClipboardCheck, KeyRound, ListTodo, Pin, MoreVertical, Trash2, VolumeX } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { useHuddle } from '@/contexts/HuddleContext';
import { HuddleQuickPill } from '@/components/shared/HuddleQuickPill';
import { HuddleDashboardCard } from '@/components/shared/HuddleDashboardCard';
import { MetaAdsCard } from '@/components/dashboard/MetaAdsCard';
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

/** Compact live-screen tile used inside team-status cards. */
function LiveTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // Default-muted: even before the global Deafen pass mutes us, a
  // freshly-mounted <video> that auto-plays a peer stream would briefly
  // emit audio. Starting muted prevents that flash. Admin still SEES the
  // screen — they just don't hear the audio embedded in the screen-share
  // (which would normally be system audio anyway).
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.muted = true;
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />;
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
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const socket = useSocket();
  const presence = useTeamPresence();

  const { user } = useAuth();
  // Live screens come from LiveKit huddle peers — admin must be in the huddle
  // to subscribe. Each peer's `stream` already contains their screen-share
  // track when they're presenting (see useMeetingRoom.buildPeerView).
  const huddle = useHuddle();
  const peerByUserId = useMemo(() => {
    const m: Record<string, typeof huddle.peers[number]> = {};
    for (const p of huddle.peers) m[p.userId] = p;
    return m;
  }, [huddle.peers]);

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
    loadStats();
  }, [loadStats]);

  // Esc closes the view-all overlay.
  useEffect(() => {
    if (!viewAllOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewAllOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewAllOpen]);

  useEffect(() => {
    if (!socket) return;
    socket.on('presence:update', loadStats);
    return () => { socket.off('presence:update', loadStats); };
  }, [socket, loadStats]);

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


  // Pinned screen reference — uses the LiveKit peer's stream.
  const pinnedRef = (el: HTMLVideoElement | null) => {
    const p = pinnedScreenUser ? peerByUserId[pinnedScreenUser] : null;
    if (el && p?.screenOn) el.srcObject = p.stream;
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

        {/* Huddle quick join — admin sees who's in and can drop in instantly */}
        <HuddleDashboardCard />

        {/* Meta Ads daily snapshot for admin */}
        <MetaAdsCard />

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
            <Link to="/admin/attendance" className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Clock className="h-4 w-4 text-cyan-500" />
              <p className="text-xs font-semibold">Attendance</p>
              <p className="text-[10px] text-muted-foreground">clock in/out</p>
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
                <div className="ml-auto flex items-center gap-2">
                  {/* "View all" — opens a fullscreen overlay grid so admin
                      can spot-check everyone in one glance. */}
                  <button
                    onClick={() => setViewAllOpen(true)}
                    className="h-6 px-2 flex items-center gap-1 rounded-md bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors"
                    title="Expand all live screens"
                  >
                    <Monitor className="h-3 w-3" /> View all
                  </button>
                  <Link to="/admin/employees" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                    Manage <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {pinnedScreenUser && peerByUserId[pinnedScreenUser]?.screenOn ? (
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
              <div className="p-3 grid grid-cols-2 gap-2.5 max-h-[520px] overflow-y-auto">
                {!huddle.joined && (
                  <div className="col-span-full mb-1 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 flex items-center gap-2">
                    <Video className="h-3.5 w-3.5" />
                    Join the huddle to see live screens. Tap the headphones in the corner.
                  </div>
                )}
                {employees.slice(0, 12).map(e => {
                  const status = presence.statusOf(e._id);
                  const peer = peerByUserId[e._id];
                  const liveStream = peer?.screenOn ? peer.stream : null;
                  const isBroadcasting = !!liveStream;
                  const onCall = presence.isOnCall(e._id);
                  const muted = presence.isDeafened(e._id);
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
                      {isBroadcasting && liveStream ? (
                        <LiveTile stream={liveStream} />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card gap-1">
                          <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                            {(e.name || e.email || '?')[0].toUpperCase()}
                          </div>
                          <p className="text-[11px] font-semibold truncate max-w-full px-2">{e.name?.split(' ')[0] || e.email}</p>
                        </div>
                      )}

                      {/* Bottom strip — name + presence (+ on-call + muted) */}
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 flex items-center gap-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                        <p className="text-[11px] font-semibold text-white truncate flex-1">
                          {e.name?.split(' ')[0] || e.email}
                        </p>
                        {muted && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/85 text-white"
                            title="Has muted team audio — won't hear pings"
                          >
                            <VolumeX className="h-2.5 w-2.5" /> Muted
                          </span>
                        )}
                        {onCall && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-violet-500/85 text-white">
                            <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                            On call
                          </span>
                        )}
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

      {/* ── View-all-screens fullscreen overlay ─────────────────────────── */}
      {viewAllOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 text-white">
            <Monitor className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Live employee screens</h3>
            {!huddle.joined && (
              <span className="text-[11px] text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md">
                Join the huddle to subscribe to live screens
              </span>
            )}
            <span className="ml-auto text-[11px] text-white/60">
              {Object.values(peerByUserId).filter(p => p?.screenOn).length} broadcasting · press Esc to close
            </span>
            <button
              onClick={() => setViewAllOpen(false)}
              className="h-8 px-3 flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-semibold"
            >
              <X className="h-3.5 w-3.5" /> Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {employees.map(e => {
                const peer = peerByUserId[e._id];
                const isLive = !!peer?.screenOn;
                return (
                  <div
                    key={e._id}
                    className={`relative rounded-xl overflow-hidden aspect-video border ${
                      isLive ? 'border-green-500/40' : 'border-white/10'
                    } bg-black`}
                  >
                    {isLive ? (
                      <LiveTile stream={peer.stream} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-2">
                        <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold">
                          {(e.name || e.email || '?')[0].toUpperCase()}
                        </div>
                        <p className="text-xs">{e.name || e.email}</p>
                        <p className="text-[10px] uppercase tracking-wide">Not sharing</p>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/90 to-transparent flex items-center gap-2">
                      <p className="text-xs font-semibold text-white truncate flex-1">{e.name?.split(' ')[0] || e.email}</p>
                      {isLive && (
                        <span className="text-[10px] font-bold text-white bg-red-500/90 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <span className="h-1 w-1 rounded-full bg-white animate-pulse" /> LIVE
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {employees.length === 0 && (
              <p className="text-white/50 text-sm text-center py-12">No employees to monitor.</p>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
