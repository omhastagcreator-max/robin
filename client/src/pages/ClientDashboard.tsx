import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  BarChart2, TrendingUp, Users, DollarSign, MessageSquare,
  Plus, Send, CheckCircle2, Clock, AlertTriangle, Eye, Loader2, X, ChevronDown
} from 'lucide-react';
import { format } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as api from '@/api';
import { toast } from 'sonner';

const METRIC_CARDS = [
  { key: 'reach',       label: 'Total Reach',   icon: Eye,        color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
  { key: 'leads',       label: 'Leads',         icon: Users,      color: 'text-green-400',  bg: 'bg-green-500/10'  },
  { key: 'spend',       label: 'Ad Spend',      icon: DollarSign, color: 'text-amber-400',  bg: 'bg-amber-500/10', prefix: '₹' },
  { key: 'roas',        label: 'Avg ROAS',      icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-500/10', suffix: 'x' },
];

export default function ClientDashboard() {
  const [projects,      setProjects]      = useState<any[]>([]);
  const [reports,       setReports]       = useState<any[]>([]);
  const [queries,       setQueries]       = useState<any[]>([]);
  const [transactions,  setTransactions]  = useState<any[]>([]);
  const [summary,       setSummary]       = useState<any>(null);
  const [loading,       setLoading]       = useState(true);
  const [activeProject, setActiveProject] = useState<string>('all');
  const [showQuery,     setShowQuery]     = useState(false);
  const [queryForm,     setQueryForm]     = useState({ title: '', description: '', priority: 'medium', projectId: '' });

  const load = async () => {
    const [p, r, q, t, s] = await Promise.all([
      api.getDashboardClient(),
      api.listAdReports({ limit: 30 }),
      api.listQueries(),
      api.myTransactions(),
      api.getAdReportSummary({}),
    ]);
    setProjects((p as any)?.projects || []);
    setReports(Array.isArray(r) ? r : []);
    setQueries(Array.isArray(q) ? q : []);
    setTransactions(Array.isArray(t) ? t : []);
    setSummary(s);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryForm.title) return;
    await api.createQuery({ ...queryForm });
    toast.success('Query submitted! Our team will respond shortly.');
    setShowQuery(false); setQueryForm({ title: '', description: '', priority: 'medium', projectId: '' });
    load();
  };

  const filteredReports = activeProject === 'all' ? reports : reports.filter(r => r.projectId === activeProject);

  // Build chart data from reports
  const chartData = [...filteredReports].reverse().slice(-14).map(r => ({
    date: format(new Date(r.date), 'dd MMM'),
    Leads: r.leads || 0,
    Reach: Math.round((r.reach || 0) / 1000),
    Spend: r.spend || 0,
  }));

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold">Your Dashboard</h1>
          <p className="text-sm text-muted-foreground">Project progress, daily reports & account overview</p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {METRIC_CARDS.map(m => {
            const val = summary?.[m.key === 'roas' ? 'avgRoas' : `total${m.key.charAt(0).toUpperCase() + m.key.slice(1)}`] || 0;
            return (
              <div key={m.key} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${m.bg}`}>
                  <m.icon className={`h-4 w-4 ${m.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className={`text-lg font-bold ${m.color}`}>
                    {m.prefix || ''}{typeof val === 'number' ? (val > 1000 ? `${(val/1000).toFixed(1)}k` : val.toLocaleString('en-IN')) : val}{m.suffix || ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Projects + Progress */}
          <div className="space-y-3">
            <h2 className="font-semibold text-sm">Active Projects</h2>
            {projects.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center text-sm text-muted-foreground">No active projects</div>
            ) : (
              projects.map((p: any) => {
                const pct = p.totalTasks ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
                return (
                  <div key={p._id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm">{p.name}</p>
                        <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded capitalize">{p.projectType}</span>
                      </div>
                      <span className="text-sm font-bold text-primary">{pct}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-400" />{p.completedTasks}/{p.totalTasks} tasks</span>
                      {p.deadline && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(new Date(p.deadline), 'MMM d')}</span>}
                    </div>
                    {p.overdueTasks > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-2 py-1">
                        <AlertTriangle className="h-3 w-3" /> {p.overdueTasks} overdue tasks
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Invoices */}
            <h2 className="font-semibold text-sm pt-2">Invoices</h2>
            <div className="bg-card border border-border rounded-2xl divide-y divide-border/50">
              {transactions.length === 0 && <p className="text-xs text-muted-foreground p-4">No transactions</p>}
              {transactions.map((t: any) => (
                <div key={t._id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">{t.description || 'Invoice'}</p>
                    <p className="text-[10px] text-muted-foreground">{t.date ? format(new Date(t.date), 'MMM d, yyyy') : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold">₹{t.amount?.toLocaleString('en-IN')}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.status === 'paid' ? 'bg-green-500/15 text-green-400' : t.status === 'overdue' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ad Reports + Chart */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-semibold text-sm">Daily Ad Reports</h2>
              <select value={activeProject} onChange={e => setActiveProject(e.target.value)}
                className="ml-auto text-xs px-2 py-1.5 bg-card border border-input rounded-lg">
                <option value="all">All Projects</option>
                {projects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground mb-3">Leads & Reach over last 14 days</p>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(265 85% 65%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(265 85% 65%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 13%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 20% 55%)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(215 20% 55%)' }} />
                    <Tooltip contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 11 }} />
                    <Area type="monotone" dataKey="Leads" stroke="hsl(265 85% 65%)" fill="url(#gLeads)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Report cards */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {filteredReports.map((r: any) => (
                <div key={r._id} className="bg-card border border-border rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <p className="text-xs font-semibold">{format(new Date(r.date), 'dd MMM yyyy')}</p>
                    <span className="text-[10px] bg-muted px-2 py-0.5 rounded capitalize">{r.platform}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Reach',    val: r.reach?.toLocaleString('en-IN')  || '0' },
                      { label: 'Leads',    val: r.leads || 0 },
                      { label: 'Spend',    val: `₹${(r.spend||0).toLocaleString('en-IN')}` },
                      { label: 'ROAS',     val: `${r.roas || 0}x` },
                    ].map(m => (
                      <div key={m.label} className="text-center">
                        <p className="text-xs font-bold">{m.val}</p>
                        <p className="text-[9px] text-muted-foreground">{m.label}</p>
                      </div>
                    ))}
                  </div>
                  {r.notes && <p className="text-[10px] text-muted-foreground mt-2 italic">{r.notes}</p>}
                </div>
              ))}
              {filteredReports.length === 0 && (
                <div className="bg-card border border-border rounded-2xl py-8 text-center text-sm text-muted-foreground">
                  No ad reports yet — your project lead will post daily updates here.
                </div>
              )}
            </div>

            {/* Support Queries */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" /> Support Queries
                </h2>
                <button onClick={() => setShowQuery(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80">
                  <Plus className="h-3.5 w-3.5" /> Raise Query
                </button>
              </div>

              {showQuery && (
                <motion.form initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  onSubmit={submitQuery} className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">New Support Query</p>
                    <button type="button" onClick={() => setShowQuery(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </div>
                  <input value={queryForm.title} onChange={e => setQueryForm(p => ({ ...p, title: e.target.value }))} required
                    placeholder="Query subject…" className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <textarea value={queryForm.description} onChange={e => setQueryForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Describe your query or concern…"
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" rows={3} />
                  <div className="flex gap-2">
                    <select value={queryForm.priority} onChange={e => setQueryForm(p => ({ ...p, priority: e.target.value }))}
                      className="flex-1 px-2 py-2 bg-background border border-input rounded-xl text-xs">
                      {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={queryForm.projectId} onChange={e => setQueryForm(p => ({ ...p, projectId: e.target.value }))}
                      className="flex-1 px-2 py-2 bg-background border border-input rounded-xl text-xs">
                      <option value="">General</option>
                      {projects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90">
                    <Send className="h-3 w-3" /> Submit Query
                  </button>
                </motion.form>
              )}

              <div className="space-y-2">
                {queries.map((q: any) => (
                  <div key={q._id} className="bg-card border border-border rounded-xl px-4 py-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold">{q.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${q.status === 'resolved' ? 'bg-green-500/15 text-green-400' : q.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'}`}>
                        {q.status}
                      </span>
                    </div>
                    {q.description && <p className="text-[10px] text-muted-foreground line-clamp-1">{q.description}</p>}
                    {q.replies?.length > 0 && (
                      <div className="bg-muted/40 rounded-lg px-2 py-1.5 mt-1">
                        <p className="text-[10px] text-muted-foreground">{q.replies[q.replies.length-1].authorName}: {q.replies[q.replies.length-1].content}</p>
                      </div>
                    )}
                  </div>
                ))}
                {queries.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No queries raised yet</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
