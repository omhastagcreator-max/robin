import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Briefcase, Plus, CheckCircle2, Clock, AlertTriangle, Loader2, X,
  ChevronDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { Row }         from '@/components/ui/Row';
import { EmptyState }  from '@/components/ui/EmptyState';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import * as api from '@/api';

/**
 * AdminProjects v2 — rebuilt on design-system primitives.
 *
 * What changed vs v1:
 *   • 3-column grid of project cards → dense Row list.
 *   • Bespoke `typeColors` map (violet-400 / orange-400 / blue-400 / pink-400
 *     — text-400 weights that were unreadable on a light background).
 *     Replaced with a single neutral type chip.
 *   • Bespoke `statusColors` border-pill on a select element — replaced
 *     with v2 StatusPill + an inline status select sitting next to it.
 *   • Inline progress bar moved into the Row meta line so the entire row
 *     fits in ~44px.
 *
 * What stayed:
 *   • New-project form with name / type / client / lead / deadline.
 *   • Status change (active/completed/paused) inline per row.
 *   • Overdue + completed task counters.
 *
 * Density: ~12 projects visible per fold vs. ~4 in v1.
 */

// Map project.status → presentational StatusPill state.
function statusToPill(s: string): Status {
  return s === 'completed' ? 'ready_to_deliver'
       : s === 'paused'    ? 'on_break'
       :                     'working';
}

export default function AdminProjects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [users, setUsers]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    name:           '',
    projectType:    'website',
    clientId:       '',
    projectLeadId:  '',
    deadline:       '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([api.listProjects(), api.listUsers()]);
      const [p, u] = results;
      setProjects(p.status === 'fulfilled' && Array.isArray(p.value) ? p.value : []);
      setUsers   (u.status === 'fulfilled' && Array.isArray(u.value) ? u.value : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const clients   = users.filter((u: any) => u.role === 'client');
  const employees = users.filter((u: any) => ['employee', 'admin', 'sales'].includes(u.role));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || creating) return;
    setCreating(true);
    try {
      await api.createProject(form);
      toast.success('Project created');
      setShowForm(false);
      setForm({ name: '', projectType: 'website', clientId: '', projectLeadId: '', deadline: '' });
      load();
    } catch { /* axios interceptor toasts the server message */ }
    finally { setCreating(false); }
  };

  const changeStatus = async (id: string, status: string) => {
    const before = projects;
    setProjects(prev => prev.map(p => p._id === id ? { ...p, status } : p));
    try { await api.updateProject(id, { status }); }
    catch { setProjects(before); }
  };

  const activeCount = projects.filter(p => p.status === 'active').length;

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">Projects</h1>
            <p className="text-[12px] text-muted-foreground">
              {projects.length} total · {activeCount} active
            </p>
          </div>
          <Button size="sm" intent="primary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowForm(v => !v)}>
            New project
          </Button>
        </div>

        {/* New project form */}
        {showForm && (
          <motion.form
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            onSubmit={handleCreate}
            className="border border-border rounded-xl bg-card p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold">New project</p>
              <button type="button" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Name *" span="lg:col-span-2">
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. TechCorp Website"
                  required
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Type">
                <SelectChev>
                  <select
                    value={form.projectType}
                    onChange={e => setForm(p => ({ ...p, projectType: e.target.value }))}
                    className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {['website', 'ads', 'combined', 'social'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </SelectChev>
              </Field>
              <Field label="Client">
                <SelectChev>
                  <select
                    value={form.clientId}
                    onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                    className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select client</option>
                    {clients.map((c: any) => <option key={c._id} value={c._id}>{c.name || c.email}</option>)}
                  </select>
                </SelectChev>
              </Field>
              <Field label="Project lead">
                <SelectChev>
                  <select
                    value={form.projectLeadId}
                    onChange={e => setForm(p => ({ ...p, projectLeadId: e.target.value }))}
                    className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select lead</option>
                    {employees.map((e: any) => <option key={e._id} value={e._id}>{e.name || e.email}</option>)}
                  </select>
                </SelectChev>
              </Field>
              <Field label="Deadline">
                <input
                  type="date"
                  value={form.deadline}
                  onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))}
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>

            <Button type="submit" size="sm" intent="primary" loading={creating} iconLeft={<Plus className="h-3.5 w-3.5" />}>
              Create project
            </Button>
          </motion.form>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : projects.length === 0 ? (
          <EmptyState
            size="lg"
            icon={<Briefcase className="h-7 w-7" />}
            title="No projects yet"
            hint="Create your first project with the button above."
          />
        ) : (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            {projects.map(p => {
              const pct  = p.totalTasks ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
              const lead = users.find((u: any) => u._id === p.projectLeadId);
              const client = users.find((u: any) => u._id === p.clientId);
              return (
                <Row
                  key={p._id}
                  density="comfy"
                  accent={
                    p.status === 'completed' ? 'success' :
                    p.status === 'paused'    ? 'warning' :
                    p.overdueTasks > 0       ? 'danger'  :
                                                'primary'
                  }
                >
                  <Row.Main>
                    <div className="flex items-center gap-2">
                      <Row.Title>{p.name}</Row.Title>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-bold">
                        {p.projectType}
                      </span>
                    </div>
                    <Row.Meta>
                      {client && <>{client.name || client.email} · </>}
                      {lead && <>Lead: {lead.name || lead.email} · </>}
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {p.completedTasks ?? 0}/{p.totalTasks ?? 0}
                      </span>
                      {p.overdueTasks > 0 && (
                        <> · <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                          <AlertTriangle className="h-2.5 w-2.5" /> {p.overdueTasks} late
                        </span></>
                      )}
                      {p.deadline && (
                        <> · <span className="inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" /> {format(new Date(p.deadline), 'MMM d')}
                        </span></>
                      )}
                    </Row.Meta>
                    {/* Slim inline progress bar */}
                    <div className="mt-1.5 h-1 w-full max-w-[200px] bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          p.status === 'completed' ? 'bg-emerald-500' :
                          p.status === 'paused'    ? 'bg-amber-500'   :
                                                      'bg-primary'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Row.Main>
                  <Row.Trail>
                    <span className="text-[11.5px] font-bold tabular-nums">{pct}%</span>
                    <StatusPill state={statusToPill(p.status)} size="xs" label={p.status} />
                    <div className="relative">
                      <select
                        value={p.status}
                        onChange={e => changeStatus(p._id, e.target.value)}
                        className="appearance-none pl-2 pr-5 h-7 bg-muted/50 hover:bg-muted text-foreground border-0 rounded-md text-[11.5px] font-medium focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                        title="Change status"
                      >
                        {['active', 'completed', 'paused'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Row.Trail>
                </Row>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────────────
function Field({ label, span = '', children }: { label: string; span?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${span}`}>
      <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function SelectChev({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}
