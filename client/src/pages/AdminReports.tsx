import { useEffect, useState } from 'react';
import { BarChart2, CreditCard, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

import { AppLayout }  from '@/components/AppLayout';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import * as api from '@/api';

/**
 * AdminReports v2 — rebuilt on design-system primitives.
 *
 * v1 used bespoke KPI cards with custom-colored icon tiles + hardcoded
 * `text-green-400` / `text-red-400` weights. v2 uses v2 Stat blocks tied
 * to semantic tones (primary/success/warning/danger).
 *
 * Charts (recharts) kept — the chart colors now read from the token
 * palette via CSS variables so they match the rest of the app.
 */

const CHART_PALETTE = [
  'hsl(var(--primary))',
  'hsl(217 91% 60%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(351 83% 61%)',
];

export default function AdminReports() {
  const [stats, setStats]       = useState<any>(null);
  const [txns, setTxns]         = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

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

  if (loading) {
    return (
      <AppLayout requiredRole="admin">
        <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }

  const revenue = txns.reduce((s, t) => t.status === 'paid'    ? s + t.amount : s, 0);
  const pending = txns.reduce((s, t) => t.status === 'pending' ? s + t.amount : s, 0);
  const overdue = txns.reduce((s, t) => t.status === 'overdue' ? s + t.amount : s, 0);

  const txnStatus = [
    { name: 'Paid',    value: txns.filter(t => t.status === 'paid').length    },
    { name: 'Pending', value: txns.filter(t => t.status === 'pending').length },
    { name: 'Overdue', value: txns.filter(t => t.status === 'overdue').length },
  ].filter(d => d.value > 0);

  const avgSession = sessions.length > 0
    ? Math.round(sessions.reduce((sum: number, s: any) => {
        const dur = s.endTime && s.startTime ? (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000 : 0;
        return sum + dur;
      }, 0) / sessions.length * 10) / 10
    : 0;

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Reports &amp; Analytics</h1>
          <p className="text-[12px] text-muted-foreground">Revenue, sessions, and task throughput.</p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiBlock icon={<CreditCard className="h-3.5 w-3.5" />} label="Revenue"       value={`₹${revenue.toLocaleString('en-IN')}`} sub="Paid invoices"   tone="success" />
          <KpiBlock icon={<TrendingUp className="h-3.5 w-3.5" />} label="Pending"       value={`₹${pending.toLocaleString('en-IN')}`} sub="Awaiting payment" tone="warning" />
          <KpiBlock icon={<AlertCircle className="h-3.5 w-3.5" />} label="Overdue"       value={`₹${overdue.toLocaleString('en-IN')}`} sub="Past due"        tone="danger"  />
          <KpiBlock icon={<BarChart2 className="h-3.5 w-3.5" />}  label="Avg session"   value={`${avgSession}h`} sub="per employee/day" tone="primary" />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 border border-border rounded-xl bg-card overflow-hidden">
            <header className="px-4 h-10 border-b border-border flex items-center">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Tasks done · last 14 days</p>
            </header>
            <div className="p-4">
              {stats?.taskTrend?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.taskTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="done" fill={CHART_PALETTE[0]} radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48"><EmptyState size="sm" title="No task data yet" /></div>
              )}
            </div>
          </section>

          <section className="border border-border rounded-xl bg-card overflow-hidden">
            <header className="px-4 h-10 border-b border-border flex items-center">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Invoice mix</p>
            </header>
            <div className="p-4">
              {txnStatus.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={txnStatus} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={4}>
                        {txnStatus.map((_, idx) => <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {txnStatus.map((s, i) => (
                      <div key={s.name} className="flex items-center justify-between text-[11.5px]">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: CHART_PALETTE[i] }} />
                          {s.name}
                        </div>
                        <span className="font-bold tabular-nums">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-40"><EmptyState size="sm" title="No invoices yet" /></div>
              )}
            </div>
          </section>
        </div>

        {/* Task summary */}
        <div className="grid grid-cols-3 gap-3">
          <Stat block value={stats?.totalTasks ?? 0}      label="Total tasks" />
          <Stat block value={stats?.completedTasks ?? 0}  label="Completed"   tone="success" />
          <Stat block value={stats?.overdueTasks ?? 0}    label="Overdue"     tone="danger"  />
        </div>
      </div>
    </AppLayout>
  );
}

// Small KPI block with icon + sub-label.
function KpiBlock({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'success' | 'warning' | 'danger' | 'primary';
}) {
  const toneCls =
    tone === 'success' ? 'text-emerald-700 bg-emerald-500/12' :
    tone === 'warning' ? 'text-amber-700   bg-amber-500/12'   :
    tone === 'danger'  ? 'text-rose-700    bg-rose-500/12'    :
                         'text-primary     bg-primary/12';
  return (
    <div className="border border-border rounded-xl bg-card p-4 flex items-start gap-3">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</p>
        <p className="text-[18px] font-bold tabular-nums leading-tight">{value}</p>
        <p className="text-[10.5px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
