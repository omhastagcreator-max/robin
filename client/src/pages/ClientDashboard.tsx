import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, Users, DollarSign, MessageSquare,
  Plus, Send, CheckCircle2, Clock, AlertTriangle, Eye, Loader2, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

import { AppLayout }  from '@/components/AppLayout';
import { Button }     from '@/components/ui/Button';
import { Row }        from '@/components/ui/Row';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { useAuth }    from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * ClientDashboard v2 — rebuilt on design-system primitives.
 *
 * The client-facing surface — clients log in here to see their projects,
 * daily ad reports, invoices, and raise support queries. v2 changes:
 *   • Bespoke 4 KPI cards (blue/green/amber/purple-400 weights — washed
 *     out on light BG) replaced with consistent semantic cards.
 *   • Project cards + transaction list use Row primitive.
 *   • Hero panel uses the Rani Pink → Saffron gradient (same as Login)
 *     so the client immediately reads "this is Robin".
 *   • Daily ad report cards repaletted to neutral chrome.
 */

const METRIC_KEYS = [
  { key: 'reach', label: 'Reach',    icon: Eye,        tone: 'primary' as const },
  { key: 'leads', label: 'Leads',    icon: Users,      tone: 'success' as const },
  { key: 'spend', label: 'Ad spend', icon: DollarSign, tone: 'warning' as const, prefix: '₹' },
  { key: 'roas',  label: 'Avg ROAS', icon: TrendingUp, tone: 'primary' as const, suffix: 'x' },
];

export default function ClientDashboard() {
  const { user } = useAuth();
  const [projects, setProjects]           = useState<any[]>([]);
  const [reports, setReports]             = useState<any[]>([]);
  const [queries, setQueries]             = useState<any[]>([]);
  const [transactions, setTransactions]   = useState<any[]>([]);
  const [summary, setSummary]             = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [activeProject, setActiveProject] = useState<string>('all');
  const [showQuery, setShowQuery]         = useState(false);
  const [queryForm, setQueryForm]         = useState({ title: '', description: '', priority: 'medium', projectId: '' });
  const [submitting, setSubmitting]       = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        api.getDashboardClient(),
        api.listAdReports({ limit: 30 }),
        api.listQueries(),
        api.myTransactions(),
        api.getAdReportSummary({}),
      ]);
      const [p, r, q, t, s] = results;
      setProjects(p.status === 'fulfilled' ? ((p.value as any)?.projects || []) : []);
      setReports (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
      setQueries (q.status === 'fulfilled' && Array.isArray(q.value) ? q.value : []);
      setTransactions(t.status === 'fulfilled' && Array.isArray(t.value) ? t.value : []);
      setSummary (s.status === 'fulfilled' ? s.value : null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryForm.title || submitting) return;
    setSubmitting(true);
    try {
      await api.createQuery({ ...queryForm });
      toast.success('Query submitted — our team will respond shortly');
      setShowQuery(false);
      setQueryForm({ title: '', description: '', priority: 'medium', projectId: '' });
      load();
    } catch { /* interceptor toasts */ }
    finally { setSubmitting(false); }
  };

  const filteredReports = activeProject === 'all' ? reports : reports.filter(r => r.projectId === activeProject);

  const chartData = [...filteredReports].reverse().slice(-14).map(r => ({
    date:  format(new Date(r.date), 'dd MMM'),
    Leads: r.leads || 0,
    Reach: Math.round((r.reach || 0) / 1000),
    Spend: r.spend || 0,
  }));

  if (loading) {
    return (
      <AppLayout>
        <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }

  const queryStatusToPill = (s: string) =>
    s === 'resolved'    ? 'ready_to_deliver' :
    s === 'in_progress' ? 'in_huddle'         :
                          'waiting_internal';

  const txnStatusToPill = (s: string) =>
    s === 'paid'    ? 'ready_to_deliver' :
    s === 'overdue' ? 'blocked'           :
                      'at_risk';

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Hero — gradient panel matching Login + WorkroomHome */}
        <div
          className="relative overflow-hidden rounded-2xl p-5 sm:p-6 text-white"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
        >
          <div className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-white/70">
                {format(new Date(), 'EEEE · dd MMM yyyy')} · Client portal
              </p>
              <h1 className="mt-1 text-[28px] sm:text-[32px] font-black tracking-tight">
                Welcome, {user?.name?.split(' ')[0] || 'there'}.
              </h1>
              <p className="mt-1.5 text-[13px] text-white/85 max-w-xl">
                Project progress, daily reports & account overview — everything we're working on for you, in one place.
              </p>
            </div>
            <div className="text-center px-4 py-2 rounded-xl bg-white/15 backdrop-blur-md ring-1 ring-white/20">
              <p className="text-[9px] uppercase tracking-wider font-bold text-white/70 leading-none">{format(new Date(), 'MMM')}</p>
              <p className="text-[24px] font-black leading-none mt-1">{format(new Date(), 'dd')}</p>
            </div>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {METRIC_KEYS.map(m => {
            const val = summary?.[m.key === 'roas' ? 'avgRoas' : `total${m.key.charAt(0).toUpperCase() + m.key.slice(1)}`] || 0;
            const fmtVal = typeof val === 'number'
              ? (val > 1000 ? `${(val/1000).toFixed(1)}k` : val.toLocaleString('en-IN'))
              : val;
            const toneCls =
              m.tone === 'success' ? 'text-emerald-700 bg-emerald-500/12' :
              m.tone === 'warning' ? 'text-amber-700   bg-amber-500/12'   :
                                     'text-primary     bg-primary/12';
            return (
              <div key={m.key} className="border border-border rounded-xl bg-card p-4 flex items-center gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>
                  <m.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{m.label}</p>
                  <p className="text-[18px] font-bold tabular-nums leading-tight">
                    {m.prefix || ''}{fmtVal}{m.suffix || ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Left column: Projects + Invoices */}
          <div className="space-y-4">
            <section>
              <h2 className="text-[13px] font-bold mb-2">Active projects</h2>
              {projects.length === 0 ? (
                <EmptyState size="sm" title="No active projects" />
              ) : (
                <div className="border border-border rounded-xl bg-card overflow-hidden">
                  {projects.map((p: any) => {
                    const pct = p.totalTasks ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
                    return (
                      <div key={p._id} className="px-4 py-3 border-b border-border last:border-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold truncate">{p.name}</p>
                            <span className="text-[10px] uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded font-bold text-muted-foreground">
                              {p.projectType}
                            </span>
                          </div>
                          <span className="text-[14px] font-bold tabular-nums text-primary">{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                            {p.completedTasks}/{p.totalTasks}
                          </span>
                          {p.deadline && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              {format(new Date(p.deadline), 'MMM d')}
                            </span>
                          )}
                          {p.overdueTasks > 0 && (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                              <AlertTriangle className="h-2.5 w-2.5" /> {p.overdueTasks} late
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-[13px] font-bold mb-2">Invoices</h2>
              {transactions.length === 0 ? (
                <EmptyState size="sm" title="No transactions yet" />
              ) : (
                <div className="border border-border rounded-xl bg-card overflow-hidden">
                  {transactions.map((t: any) => (
                    <Row key={t._id} density="comfy">
                      <Row.Main>
                        <Row.Title>{t.description || 'Invoice'}</Row.Title>
                        <Row.Meta>{t.date ? format(new Date(t.date), 'MMM d, yyyy') : ''}</Row.Meta>
                      </Row.Main>
                      <Row.Trail>
                        <span className="text-[12.5px] font-bold tabular-nums">
                          ₹{t.amount?.toLocaleString('en-IN')}
                        </span>
                        <StatusPill state={txnStatusToPill(t.status) as any} size="xs" label={t.status} />
                      </Row.Trail>
                    </Row>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right column: Reports + Queries */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-[13px] font-bold">Daily ad reports</h2>
              <select
                value={activeProject}
                onChange={e => setActiveProject(e.target.value)}
                className="ml-auto text-[11.5px] px-2 h-7 bg-card border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All projects</option>
                {projects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="border border-border rounded-xl bg-card p-4">
                <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
                  Leads · last 14 days
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                    <Area type="monotone" dataKey="Leads" stroke="hsl(var(--primary))" fill="url(#gLeads)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Report cards */}
            {filteredReports.length === 0 ? (
              <EmptyState size="md" title="No ad reports yet" hint="Your project lead will post daily updates here." />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {filteredReports.map((r: any) => (
                  <div key={r._id} className="border border-border rounded-xl bg-card px-4 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <p className="text-[12px] font-semibold">{format(new Date(r.date), 'dd MMM yyyy')}</p>
                      <span className="text-[10px] uppercase tracking-wider bg-muted px-2 py-0.5 rounded font-bold text-muted-foreground">
                        {r.platform}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Reach', val: r.reach?.toLocaleString('en-IN') || '0' },
                        { label: 'Leads', val: r.leads || 0 },
                        { label: 'Spend', val: `₹${(r.spend||0).toLocaleString('en-IN')}` },
                        { label: 'ROAS',  val: `${r.roas || 0}x` },
                      ].map(m => (
                        <div key={m.label} className="text-center">
                          <p className="text-[13px] font-bold tabular-nums">{m.val}</p>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{m.label}</p>
                        </div>
                      ))}
                    </div>
                    {r.notes && <p className="text-[10.5px] text-muted-foreground mt-2 italic">{r.notes}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Support queries */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[13px] font-bold inline-flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" /> Support queries
                </h2>
                <Button size="xs" intent="ghost" iconLeft={<Plus className="h-3 w-3" />} onClick={() => setShowQuery(v => !v)}>
                  Raise query
                </Button>
              </div>

              {showQuery && (
                <motion.form
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  onSubmit={submitQuery}
                  className="border border-border rounded-xl bg-card p-4 space-y-2.5 mb-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold">New support query</p>
                    <button type="button" onClick={() => setShowQuery(false)} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    value={queryForm.title}
                    onChange={e => setQueryForm(p => ({ ...p, title: e.target.value }))}
                    required
                    placeholder="Query subject"
                    className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <textarea
                    value={queryForm.description}
                    onChange={e => setQueryForm(p => ({ ...p, description: e.target.value }))}
                    rows={3}
                    placeholder="Describe your query or concern…"
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  <div className="flex gap-2">
                    <select
                      value={queryForm.priority}
                      onChange={e => setQueryForm(p => ({ ...p, priority: e.target.value }))}
                      className="flex-1 px-2 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select
                      value={queryForm.projectId}
                      onChange={e => setQueryForm(p => ({ ...p, projectId: e.target.value }))}
                      className="flex-1 px-2 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">General</option>
                      {projects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Button type="submit" size="sm" intent="primary" loading={submitting} iconLeft={<Send className="h-3 w-3" />}>
                    Submit query
                  </Button>
                </motion.form>
              )}

              {queries.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground text-center py-3">No queries raised yet</p>
              ) : (
                <div className="border border-border rounded-xl bg-card overflow-hidden">
                  {queries.map((q: any) => (
                    <div key={q._id} className="px-4 py-3 border-b border-border last:border-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-semibold">{q.title}</p>
                        <StatusPill state={queryStatusToPill(q.status) as any} size="xs" label={q.status} icon="none" />
                      </div>
                      {q.description && <p className="text-[11px] text-muted-foreground line-clamp-1">{q.description}</p>}
                      {q.replies?.length > 0 && (
                        <p className="text-[10.5px] text-muted-foreground bg-muted/40 rounded px-2 py-1 mt-1">
                          {q.replies[q.replies.length-1].authorName}: {q.replies[q.replies.length-1].content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
