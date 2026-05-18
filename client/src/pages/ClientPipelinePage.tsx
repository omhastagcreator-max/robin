import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  Search, Plus, Loader2, Phone, Mail, Building2, CheckCircle2, Clock,
  AlertCircle, ChevronRight, X, Sparkles, Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';

/**
 * ClientPipelinePage — universal "where is X at?" view.
 *
 * Sales + admin can:
 *   - Search any client by phone, name or email in the big search bar
 *   - See every client's progress at a glance (overall % + current stage)
 *   - Click "+ New pipeline" to onboard a client + pick their services
 *     (system auto-assigns the right teammates and creates SOP checklists)
 *
 * Employees see only the workflows that include a service assigned to them.
 *
 * One screen, no jargon, role-aware. Click any row → workflow detail.
 */

interface ServiceSummary {
  serviceType: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: Array<{ done: boolean }>;
  assignedTo?: string;
}
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: ServiceSummary[];
  updatedAt: string;
}

export default function ClientPipelinePage() {
  const { role } = useAuth();
  const isAdminOrSales = ['admin', 'sales'].includes(role);

  const [query, setQuery]       = useState('');
  const [mineOnly, setMineOnly] = useState(role === 'employee'); // employees default to their own
  const [list, setList]         = useState<Workflow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const data = await api.cwListWorkflows({ q: query || undefined, mine: mineOnly ? '1' : undefined });
      setList(Array.isArray(data) ? data : []);
    } catch { /* axios toast handles it */ }
    finally { setLoading(false); }
  };

  // Debounce search
  useEffect(() => {
    const t = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mineOnly]);

  // Refresh in the background so progress updates show up live.
  useVisiblePoll(load, 60_000, [query, mineOnly]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" /> Client Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every client's work, every stage — searchable by phone.
            </p>
          </div>
          {isAdminOrSales && (
            <button onClick={() => setShowCreate(true)}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold shadow-sm">
              <Plus className="h-4 w-4" /> New pipeline
            </button>
          )}
        </div>

        {/* Search — no card chrome, lives in the page flow. The "Only mine"
            toggle moves alongside it for sales/employee, hidden for admin. */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by phone, name or email…"
              className="w-full pl-10 pr-9 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary" />
            Only mine
          </label>
        </div>

        {/* List */}
        {loading && list.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <EmptyState query={query} isAdminOrSales={isAdminOrSales} onCreate={() => setShowCreate(true)} />
        ) : (
          // Grouped list: single bordered shell, dividers between rows.
          // Reads as one cohesive list instead of dozens of competing cards.
          <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border/60">
            {list.map(wf => <WorkflowRow key={wf._id} wf={wf} />)}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateWorkflowModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Row — one client per row with progress + service chips
// ─────────────────────────────────────────────────────────────────────────
function WorkflowRow({ wf }: { wf: Workflow }) {
  const totalItems = wf.services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const doneItems  = wf.services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct        = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  const currentStage =
    wf.services.find(s => s.status === 'in_progress')?.label ||
    wf.services.find(s => s.status === 'pending')?.label ||
    (wf.services.every(s => s.status === 'done') ? 'All done' : '—');

  // Calmer row — single-line layout where possible, no competing card chrome.
  // Border is now bottom-only inside a flat list (set on the parent map's
  // first-child rule via Tailwind), no hover shadow, single accent on hover.
  return (
    <Link to={`/clients/pipeline/${wf._id}`}
      className="block bg-card rounded-xl px-4 py-3 hover:bg-muted/40 transition-colors group">
      <div className="flex items-center gap-4">
        {/* LEFT — name + the big number side-by-side */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="text-base font-bold truncate">{wf.clientName || 'Unnamed client'}</p>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{pct}%</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {wf.clientPhone && <>{wf.clientPhone} · </>}Now: <span className="text-foreground/80">{currentStage}</span>
          </p>
        </div>

        {/* MIDDLE — slim progress bar */}
        <div className="hidden sm:block w-32 shrink-0">
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* RIGHT — service chips (more compact) */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {wf.services.map(s => <ServiceChip key={s.serviceType} svc={s} />)}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
      </div>
    </Link>
  );
}

function ServiceChip({ svc }: { svc: ServiceSummary }) {
  // Calmer chips — solid dot + label, no border. Status is conveyed by the
  // dot colour alone; reading the row is fast because nothing competes for
  // attention with the client name.
  const dot =
    svc.status === 'done'        ? 'bg-emerald-500' :
    svc.status === 'in_progress' ? 'bg-blue-500'    :
    svc.status === 'blocked'     ? 'bg-slate-400'   :
                                    'bg-muted-foreground/40';
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-muted-foreground bg-muted/30">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {svc.label}
    </span>
  );
}

function EmptyState({ query, isAdminOrSales, onCreate }: { query: string; isAdminOrSales: boolean; onCreate: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const seed = async () => {
    setSeeding(true);
    try {
      const res = await api.seedDemoClients();
      toast.success(res.message || 'Demo clients seeded', { duration: 6000 });
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Seed failed');
    } finally { setSeeding(false); }
  };
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
      <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
      <p className="font-semibold">{query ? 'No clients match that search' : 'No client pipelines yet'}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {query ? 'Try the phone number, full name, or email.' : 'When sales onboards a client and picks their services, the pipeline shows up here.'}
      </p>
      {!query && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {isAdminOrSales && (
            <button onClick={onCreate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Onboard a client
            </button>
          )}
          {/* Demo seeder — visible to ALL internal staff so any teammate
              can populate test data without needing admin access. */}
          <button onClick={seed} disabled={seeding}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm font-semibold hover:bg-muted disabled:opacity-50">
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {seeding ? 'Seeding…' : 'Seed 3 demo clients'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Create modal — pick a client + pick services
// ─────────────────────────────────────────────────────────────────────────
function CreateWorkflowModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [templates, setTemplates] = useState<Record<string, any>>({});
  const [clientId, setClientId] = useState('');
  const [chosen, setChosen]     = useState<Set<string>>(new Set());
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    api.listUsers({ role: 'client' }).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
    api.cwGetTemplates().then(setTemplates).catch(() => {});
  }, []);

  const toggleSvc = (key: string) => setChosen(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const save = async () => {
    if (!clientId) { toast.error('Pick a client'); return; }
    if (chosen.size === 0) { toast.error('Pick at least one service'); return; }
    setSaving(true);
    try {
      await api.cwCreateWorkflow({ clientId, services: Array.from(chosen) });
      toast.success('Pipeline created — teammates have been auto-assigned');
      onCreated();
    } catch { /* interceptor toasts */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold">Onboard a client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Client */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
              <option value="">— pick a client —</option>
              {clients.map(c => (
                <option key={c._id} value={c._id}>
                  {c.name || c.email}{(c as any).phone ? ` · ${(c as any).phone}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Don't see them? Add them in Admin → Clients first.</p>
          </div>

          {/* Services */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Services for this client</label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(templates).map(([key, tpl]: any) => {
                const active = chosen.has(key);
                return (
                  <button key={key} type="button" onClick={() => toggleSvc(key)}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/30'
                    }`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{tpl.label}</p>
                      <span className={`h-4 w-4 rounded border ${active ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {tpl.checklist.length} step{tpl.checklist.length === 1 ? '' : 's'} · auto-assigned to <strong>{tpl.team}</strong> team
                    </p>
                    {tpl.dependsOn?.length > 0 && (
                      <p className="text-[10px] text-amber-700 mt-0.5">starts after {tpl.dependsOn.join(', ')}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={save} disabled={saving || !clientId || chosen.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create pipeline
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
