import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { BarChart2, CreditCard, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import * as api from '@/api';

const COLORS = ['hsl(265 85% 65%)', 'hsl(215 100% 60%)', 'hsl(142 70% 45%)', 'hsl(38 95% 55%)', 'hsl(0 63% 55%)'];

export default function AdminReports() {
  const [stats, setStats]     = useState<any>(null);
  const [txns, setTxns]       = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getAdminStats().catch(() => null),
      api.listTransactions().catch(() => []),
      api.getSessionHistory({ limit: 100 }).catch(() => []),
    ]).then(([s, t, ss]) => {
      setStats(s);
      setTxns(Array.isArray(t) ? t : []);
      setSessions(Array.isArray(ss) ? ss : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const revenue = txns.reduce((s, t) => t.status === 'paid' ? s + t.amount : s, 0);
  const pending  = txns.reduce((s, t) => t.status === 'pending' ? s + t.amount : s, 0);
  const overdue  = txns.reduce((s, t) => t.status === 'overdue' ? s + t.amount : s, 0);

  const txnStatus = [
    { name: 'Paid',    value: txns.filter(t => t.status === 'paid').length },
    { name: 'Pending', value: txns.filter(t => t.status === 'pending').length },
    { name: 'Overdue', value: txns.filter(t => t.status === 'overdue').length },
  ].filter(d => d.value > 0);

  const avgSession = sessions.length > 0
    ? Math.round(sessions.reduce((sum: number, s: any) => {
        const dur = s.endTime && s.startTime ? (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000 : 0;
        return sum + dur;
      }, 0) / sessions.length * 10) / 10
    : 0;

  const KPI = ({ label, value, sub, icon: Icon, color }: any) => (
    <div className="bg-card border border-border rounded-2xl p-5 flex items-start gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        <h1 className="text-2xl font-bold">Reports &amp; Analytics</h1>

        {/* Revenue KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPI label="Revenue Collected" value={`₹${revenue.toLocaleString('en-IN')}`} icon={CreditCard} color="bg-green-500/15" sub="Paid invoices" />
          <KPI label="Pending Amount" value={`₹${pending.toLocaleString('en-IN')}`} icon={TrendingUp} color="bg-amber-500/15" sub="Awaiting payment" />
          <KPI label="Overdue Amount" value={`₹${overdue.toLocaleString('en-IN')}`} icon={AlertCircle} color="bg-red-500/15" sub="Past due" />
          <KPI label="Avg Session" value={`${avgSession}h`} icon={BarChart2} color="bg-blue-500/15" sub="per employee/day" />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Task completion trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-sm mb-4">Task Completion (14 days)</h2>
            {stats?.taskTrend?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.taskTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 13%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} />
                  <Tooltip contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="done" fill="hsl(265 85% 65%)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>}
          </div>

          {/* Invoice status pie */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-sm mb-4">Invoice Status</h2>
            {txnStatus.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={txnStatus} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={4}>
                      {txnStatus.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {txnStatus.map((s, i) => (
                    <div key={s.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />{s.name}</div>
                      <span className="font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No invoices</div>}
          </div>
        </div>

        {/* Task summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Tasks', value: stats?.totalTasks || 0, color: 'text-foreground' },
            { label: 'Completed', value: stats?.completedTasks || 0, color: 'text-green-400' },
            { label: 'Overdue', value: stats?.overdueTasks || 0, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-5 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
