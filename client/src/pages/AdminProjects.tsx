import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Briefcase, Plus, CheckCircle2, Clock, AlertTriangle, Users, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import * as api from '@/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';

const statusColors: Record<string, string> = {
  active:    'bg-green-500/15 text-green-400 border-green-500/30',
  completed: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  paused:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
};
const typeColors: Record<string, string> = {
  website:  'bg-violet-500/15 text-violet-400',
  ads:      'bg-orange-500/15 text-orange-400',
  combined: 'bg-blue-500/15 text-blue-400',
  social:   'bg-pink-500/15 text-pink-400',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', projectType: 'website', clientId: '', projectLeadId: '', deadline: '' });

  const load = async () => {
    const [p, u] = await Promise.all([api.listProjects(), api.listUsers()]);
    setProjects(Array.isArray(p) ? p : []);
    setUsers(Array.isArray(u) ? u : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const clients   = users.filter((u: any) => u.role === 'client');
  const employees = users.filter((u: any) => ['employee', 'admin'].includes(u.role));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;
    await api.createProject(form);
    toast.success('Project created!');
    setShowForm(false);
    setForm({ name: '', projectType: 'website', clientId: '', projectLeadId: '', deadline: '' });
    load();
  };

  const changeStatus = async (id: string, status: string) => {
    await api.updateProject(id, { status });
    setProjects(prev => prev.map(p => p._id === id ? { ...p, status } : p));
  };

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5 page-transition-enter">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Projects</h1>
            <p className="text-sm text-muted-foreground">{projects.length} total · {projects.filter(p => p.status === 'active').length} active</p>
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New Project
          </button>
        </div>

        {showForm && (
          <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            onSubmit={handleCreate} className="bg-card border border-primary/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">New Project</p>
              <button type="button" onClick={() => setShowForm(false)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1 lg:col-span-2">
                <label className="text-xs text-muted-foreground">Project Name</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. TechCorp Website"
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <select value={form.projectType} onChange={e => setForm(p => ({ ...p, projectType: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm">
                  {['website', 'ads', 'combined', 'social'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Client</label>
                <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm">
                  <option value="">Select client</option>
                  {clients.map((c: any) => <option key={c._id} value={c._id}>{c.name || c.email}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Project Lead</label>
                <select value={form.projectLeadId} onChange={e => setForm(p => ({ ...p, projectLeadId: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm">
                  <option value="">Select lead</option>
                  {employees.map((e: any) => <option key={e._id} value={e._id}>{e.name || e.email}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Deadline</label>
                <input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm" />
              </div>
            </div>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Create Project
            </button>
          </motion.form>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : projects.length === 0 ? (
          <EmptyState icon={Briefcase} title="No projects yet" description="Create your first project above." />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((p, i) => {
              const pct = p.totalTasks ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
              return (
                <motion.div key={p._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-card border border-border rounded-2xl p-5 space-y-4 hover:border-primary/30 transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 font-medium ${typeColors[p.projectType] || 'bg-muted text-muted-foreground'}`}>{p.projectType}</span>
                    </div>
                    <select value={p.status} onChange={e => changeStatus(p._id, e.target.value)}
                      className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase bg-transparent cursor-pointer ${statusColors[p.status] || 'border-border text-muted-foreground'}`}>
                      {['active', 'completed', 'paused'].map(s => <option key={s} value={s} className="bg-background text-foreground">{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {p.completedTasks}/{p.totalTasks} done</span>
                      {p.overdueTasks > 0 && <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="h-3 w-3" /> {p.overdueTasks} late</span>}
                      <span className="font-semibold text-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {p.deadline && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> Due {format(new Date(p.deadline), 'MMM d, yyyy')}
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
