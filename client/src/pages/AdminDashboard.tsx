import { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BarChart2, Users, Briefcase, CheckCircle2, AlertTriangle, Clock, TrendingUp, ArrowRight, Activity, Monitor, MonitorOff, Video, Loader2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useWebRTCReceiver } from '@/hooks/useWebRTC';
import { useAuth } from '@/contexts/AuthContext';
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

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // WebRTC Screen Monitor additions
  const { user } = useAuth();
  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [viewingUser, setViewingUser] = useState<string | null>(null);
  const { remoteStream, isConnecting, viewScreen, stopViewing } = useWebRTCReceiver(user?.id || '');

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && remoteStream) el.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const data = await api.listScreenSessions();
        setScreenSessions(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    };
    loadSessions();
    const i = setInterval(loadSessions, 10000);
    return () => clearInterval(i);
  }, []);

  const handleView = (targetId: string) => {
    if (viewingUser === targetId) { stopViewing(); setViewingUser(null); return; }
    setViewingUser(targetId);
    viewScreen(targetId);
  };

  useEffect(() => {
    Promise.all([
      api.getAdminStats().catch(() => null),
      api.adminEmployees().catch(() => []),
    ]).then(([s, e]) => {
      setStats(s);
      setEmployees(Array.isArray(e) ? e : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <FullPageSpinner />;

  const pct = stats ? Math.round(((stats.completedTasks || 0) / Math.max(1, stats.totalTasks)) * 100) : 0;

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Agency overview &amp; insights</p>
          </div>
          <Link to="/admin/reports" className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
            Full report <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Total Tasks" value={stats?.totalTasks ?? 0} icon={CheckCircle2} color="bg-blue-500/15" sub={`${pct}% completed`} />
          <KPICard label="Overdue" value={stats?.overdueTasks ?? 0} icon={AlertTriangle} color="bg-red-500/15" sub="Need attention" />
          <KPICard label="Active Projects" value={stats?.activeProjects ?? 0} icon={Briefcase} color="bg-violet-500/15" sub={`of ${stats?.totalProjects ?? 0} total`} />
          <KPICard label="Active Now" value={employees.filter(e => e.sessionStatus === 'active').length} icon={Activity} color="bg-green-500/15" sub={`of ${employees.length} employees`} />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Task Completion Trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-sm mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Task Completion Trend</h2>
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

          {/* Employee Status */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Team Status</h2>
            </div>
            <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
              {employees.slice(0, 8).map(e => (
                <div key={e._id} className="px-5 py-3 flex items-center gap-3">
                  <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {(e.name || e.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{e.name || e.email}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{e.team || 'No team'}</p>
                  </div>
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    e.sessionStatus === 'active' ? 'bg-green-400' :
                    e.sessionStatus === 'on_break' ? 'bg-amber-400' : 'bg-muted-foreground/30'
                  }`} />
                </div>
              ))}
              {employees.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No employees yet</p>}
            </div>
            <Link to="/admin/employees" className="flex items-center justify-center gap-1 py-3 text-xs text-primary hover:text-primary/80 border-t border-border">
              Manage all <ArrowRight className="h-3 w-3" />
            </Link>
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

        {/* Admin Live Screen Monitor */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-lg">Live Employee Screens</h2>
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {screenSessions.filter(s => s.status === 'active').length} active
            </span>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-3">
              {screenSessions.length === 0 ? (
                <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-8 gap-3">
                  <MonitorOff className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No active screen sessions</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                  {screenSessions.map(session => (
                    <motion.div key={session._id || session.userId} layout
                      className={`bg-card border rounded-2xl p-4 space-y-3 transition-all ${session.status === 'active' ? 'border-primary/40' : 'border-border'}`}>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                          {(session.profile?.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{session.profile?.name || session.userId}</p>
                          <p className={`text-[10px] ${session.status === 'active' ? 'text-green-500 font-semibold' : 'text-muted-foreground'}`}>
                            {session.status === 'active' ? 'Broadcasting live' : 'Offline'}
                          </p>
                        </div>
                        <span className={`h-2.5 w-2.5 rounded-full ${session.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                      </div>
                      
                      {session.status === 'active' && (
                        <button onClick={() => handleView(session.userId)}
                          className={`w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                            viewingUser === session.userId
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90'
                          }`}>
                          {isConnecting && viewingUser === session.userId ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                          ) : viewingUser === session.userId ? (
                            <><MonitorOff className="h-4 w-4" /> Stop Viewing</>
                          ) : (
                            <><Video className="h-4 w-4" /> View Screen</>
                          )}
                        </button>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Remote Viewer Panel */}
            <div className="lg:col-span-2">
              {remoteStream ? (
                <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                  className="bg-black/95 rounded-2xl overflow-hidden border border-primary/30 shadow-2xl shadow-primary/10 h-full min-h-[400px] flex flex-col">
                  <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-primary/20">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                      <p className="text-sm font-semibold">Live Feed: {screenSessions.find(s => s.userId === viewingUser)?.profile?.name}</p>
                    </div>
                    <button onClick={() => { stopViewing(); setViewingUser(null); }} className="text-xs font-semibold text-red-400 bg-red-400/10 px-3 py-1.5 rounded-lg hover:bg-red-400/20">
                      Close Viewer
                    </button>
                  </div>
                  <video ref={videoRef} autoPlay playsInline className="w-full flex-1 max-h-[600px] object-contain bg-black/50" />
                </motion.div>
              ) : (
                <div className="bg-muted/10 border border-dashed border-border/50 rounded-2xl h-full min-h-[400px] flex flex-col items-center justify-center gap-3">
                  <Monitor className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">Select an active session to view the live screen</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
