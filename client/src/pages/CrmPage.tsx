import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import {
  FolderOpen, Search, Plus, FileText, Folder, CheckCircle2, AlertTriangle,
  UserSearch, Clock, ArrowRightLeft, Table2, Unlock, X, Loader2,
  ListChecks, Layers,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * CrmPage — the "Robin OS" executive CRM view (Sep 2026 redesign).
 *
 * Modeled 1:1 on the approved robin_os_desktop_dashboard mockup, but
 * powered entirely by REAL data from /api/client-workflows:
 *   - overall agency progress ring   = checklist steps done / total
 *   - metric cards                   = health / blocker / status rollups
 *   - "Awaiting Client" modal        = workflows blocked on client input
 *   - client accounts table          = the live workflow directory
 *   - "Select & Unlock DT"           = stores the selection that gates
 *                                      the Decision Tree workspace
 *
 * The Decision Tree page refuses to render its workspace until a client
 * is selected here (or fetched on its own gated screen) — that selection
 * is the single source of DT unlocking, stored in localStorage under
 * DT_SELECTED_KEY so it survives reloads.
 */

export { DT_SELECTED_KEY } from '@/lib/dtSelection';
import { DT_SELECTED_KEY } from '@/lib/dtSelection';

interface Svc {
  _id?: string;
  serviceType: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: Array<{ text?: string; title?: string; done: boolean }>;
  assignedTo?: string;
}
interface Wf {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: Svc[];
  updatedAt: string;
  health?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  currentOwnerTeam?: string;
  blockerType?: string;
  blockerReason?: string;
  blockedSince?: string | null;
  operationalStatus?: string;
  totalAmount?: number;
  lastActivitySummary?: string;
  lastActivityAt?: string | null;
  lastUpdate?: { at?: string; action?: string; detail?: string } | null;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const TEAM_LABEL: Record<string, string> = {
  sales: 'Sales', development: 'Development', meta: 'Meta Ads',
  influencer: 'UGC / Influencer', qa: 'QA',
};

const AVATAR_TONES = [
  'bg-blue-600/20 text-blue-400',
  'bg-purple-600/20 text-purple-400',
  'bg-emerald-600/20 text-emerald-400',
  'bg-amber-600/20 text-amber-400',
  'bg-rose-600/20 text-rose-400',
  'bg-cyan-600/20 text-cyan-400',
];

const isAwaitingClient = (w: Wf) =>
  w.blockerType === 'waiting_client_input' || w.health === 'waiting_client';

/** Current stage = first service still moving (blocked > in_progress > pending). */
function currentStage(w: Wf): { label: string; status: string } {
  const svcs = w.services || [];
  const blocked = svcs.find(s => s.status === 'blocked');
  if (blocked) return { label: blocked.label, status: 'Blocked' };
  const active = svcs.find(s => s.status === 'in_progress');
  if (active) return { label: active.label, status: 'In progress' };
  const pending = svcs.find(s => s.status === 'pending');
  if (pending) return { label: pending.label, status: 'Up next' };
  return { label: svcs.length ? 'All stages complete' : 'No services yet', status: '' };
}

function stepStats(list: Wf[]) {
  let total = 0, done = 0;
  list.forEach(w => (w.services || []).forEach(s => (s.checklist || []).forEach(c => {
    total++; if (c.done) done++;
  })));
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export default function CrmPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // AuthContext has shipped both `id` and `_id` shapes over time — accept either.
  const uid = (user as any)?._id || (user as any)?.id || '';
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const [loading, setLoading]     = useState(true);
  const [q, setQ]                 = useState('');
  const [sortBy, setSortBy]       = useState<'priority' | 'recent'>('priority');
  const [mineOnly, setMineOnly]   = useState(false);
  const [showAwaiting, setShowAwaiting] = useState(false);

  useEffect(() => {
    let alive = true;
    api.cwListWorkflows({})
      .then((data: any) => { if (alive) setWorkflows(Array.isArray(data) ? data : data?.workflows || []); })
      .catch(() => toast.error('Could not load the client pipeline'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = workflows;
    if (needle) {
      list = list.filter(w =>
        (w.clientName || '').toLowerCase().includes(needle) ||
        (w.clientPhone || '').toLowerCase().includes(needle) ||
        (w.clientEmail || '').toLowerCase().includes(needle));
    }
    if (mineOnly && uid) {
      list = list.filter(w => (w.services || []).some(s => s.assignedTo === uid));
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'priority') {
        const d = (PRIORITY_RANK[a.priority || 'medium'] ?? 2) - (PRIORITY_RANK[b.priority || 'medium'] ?? 2);
        if (d !== 0) return d;
      }
      return new Date(b.lastActivityAt || b.updatedAt).getTime() - new Date(a.lastActivityAt || a.updatedAt).getTime();
    });
  }, [workflows, q, mineOnly, sortBy, uid]);

  const steps    = useMemo(() => stepStats(workflows), [workflows]);
  const awaiting = useMemo(() => workflows.filter(isAwaitingClient), [workflows]);

  const metrics = useMemo(() => {
    const active    = workflows.filter(w => !w.operationalStatus || w.operationalStatus === 'in_progress').length;
    const onTrack   = workflows.filter(w => (w.health || 'healthy') === 'healthy').length;
    const atRisk    = workflows.filter(w => w.health === 'at_risk').length;
    const delayed   = workflows.filter(w => w.health === 'delayed' || w.health === 'blocked').length;
    const completed = workflows.filter(w => w.operationalStatus === 'completed').length;
    return { active, onTrack, atRisk, delayed, completed };
  }, [workflows]);

  // Ring colour coding: <50 red · 50–80 amber · >80 green (per mock spec).
  const ringTone = steps.pct < 50
    ? { border: 'rgba(239, 68, 68, 0.4)' }
    : steps.pct <= 80
      ? { border: 'rgba(245, 158, 11, 0.4)' }
      : { border: 'rgba(74, 222, 128, 0.4)' };

  const selectAndUnlockDT = (w: Wf) => {
    try { localStorage.setItem(DT_SELECTED_KEY, w._id); } catch { /* private mode */ }
    toast.success(`"${w.clientName || 'Client'}" loaded — Decision Tree unlocked`);
    navigate('/decision-tree');
  };

  const timeAgo = (d?: string | null) => {
    if (!d) return '';
    try { return formatDistanceToNowStrict(new Date(d), { addSuffix: true }); } catch { return ''; }
  };

  return (
    <AppLayout>
      <div className="space-y-6 page-transition-enter">

        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-border/80">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" /> Client project pipeline
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live overview of active projects, current stage, and the latest audit log per account.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/clients/pipeline"
              className="bg-card hover:bg-muted text-foreground px-3.5 py-2 rounded-lg text-xs font-semibold transition border border-border flex items-center gap-2"
            >
              <FileText className="h-3.5 w-3.5 text-primary" /> Full pipeline view
            </Link>
            <Link
              to="/clients/pipeline"
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-600/20 flex items-center gap-2"
            >
              <Plus className="h-3.5 w-3.5" /> Add client
            </Link>
          </div>
        </div>

        {/* ── Search + toolbar ────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-muted-foreground">
              <Search className="h-4 w-4" />
            </span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by phone, brand name or email — then select a client to unlock the Decision Tree"
              className="w-full bg-card border border-border rounded-xl pl-11 pr-4 py-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition shadow-inner"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-card/60 p-2.5 rounded-xl border border-border">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground shadow inline-flex items-center gap-1.5">
                <Table2 className="h-3.5 w-3.5" /> Focused pipeline
              </span>
              <div className="h-4 w-px bg-border mx-1" />
              <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-lg border border-border text-xs text-foreground/80">
                <span className="text-muted-foreground font-semibold uppercase text-[10px]">Sort</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'priority' | 'recent')}
                  className="bg-transparent text-foreground font-medium focus:outline-none"
                >
                  <option value="priority">Priority · High to Low</option>
                  <option value="recent">Recently updated</option>
                </select>
              </div>
              <label className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-lg border border-border text-xs text-foreground/80 cursor-pointer hover:bg-muted">
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={e => setMineOnly(e.target.checked)}
                  className="rounded bg-card border-border text-primary focus:ring-0"
                />
                <span>Assigned to me</span>
              </label>
            </div>
            <span className="text-xs text-muted-foreground font-mono">{filtered.length} active accounts</span>
          </div>
        </div>

        {/* ── Progress overview ───────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div
              className="relative w-16 h-16 flex items-center justify-center rounded-full bg-background border-4 shadow-inner transition-all duration-500 shrink-0"
              style={{ borderColor: ringTone.border }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
                {steps.pct}%
              </span>
            </div>
            <div>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Overall agency progress
              </span>
              <h3 className="text-base font-bold text-foreground">
                {steps.done} of {steps.total} steps completed
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full md:w-auto border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6 text-center">
            <div className="bg-background/60 p-3 rounded-lg border border-border/80">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Steps done</p>
              <p className="text-base font-bold text-emerald-400 mt-1 inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> {steps.done}</p>
            </div>
            <div className="bg-background/60 p-3 rounded-lg border border-border/80">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Steps open</p>
              <p className="text-base font-bold text-blue-400 mt-1 inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> {steps.total - steps.done}</p>
            </div>
            <div className="bg-background/60 p-3 rounded-lg border border-border/80">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Accounts</p>
              <p className="text-base font-bold text-cyan-400 mt-1 inline-flex items-center gap-1"><Folder className="h-3.5 w-3.5" /> {workflows.length}</p>
            </div>
          </div>
        </div>

        {/* ── Metric cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Active projects', value: metrics.active,  icon: Folder,        tone: 'text-blue-400' },
            { label: 'On track',        value: metrics.onTrack, icon: CheckCircle2,  tone: 'text-emerald-400' },
            { label: 'At risk',         value: metrics.atRisk,  icon: AlertTriangle, tone: 'text-amber-400' },
          ].map(m => (
            <div key={m.label} className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">{m.label}</span>
                <m.icon className={`h-3.5 w-3.5 ${m.tone}`} />
              </div>
              <h4 className={`text-2xl font-bold ${m.tone === 'text-blue-400' ? 'text-foreground' : m.tone}`}>{m.value}</h4>
            </div>
          ))}

          {/* Awaiting Client — interactive, opens the blockers modal */}
          <button
            onClick={() => setShowAwaiting(true)}
            className="bg-card border border-purple-500/30 hover:border-purple-500/70 cursor-pointer rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all group text-left"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-purple-400 uppercase group-hover:underline">Awaiting client</span>
              <UserSearch className="h-3.5 w-3.5 text-purple-400 animate-pulse" />
            </div>
            <div className="flex items-baseline justify-between">
              <h4 className="text-2xl font-bold text-purple-400">{awaiting.length}</h4>
              <span className="text-[10px] text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">View blockers</span>
            </div>
          </button>

          {[
            { label: 'Delayed',   value: metrics.delayed,   icon: Clock,          tone: 'text-rose-400' },
            { label: 'Completed', value: metrics.completed, icon: ArrowRightLeft, tone: 'text-cyan-400' },
          ].map(m => (
            <div key={m.label} className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">{m.label}</span>
                <m.icon className={`h-3.5 w-3.5 ${m.tone}`} />
              </div>
              <h4 className={`text-2xl font-bold ${m.tone}`}>{m.value}</h4>
            </div>
          ))}
        </div>

        {/* ── Client accounts table ───────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Table2 className="h-4 w-4 text-primary" /> Active client accounts & pipeline directory
            </h3>
            <span className="text-xs text-muted-foreground">Click "Select & Unlock DT" to load a client into the Decision Tree</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-background/80 text-muted-foreground border-b border-border uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3.5">Brand / Client</th>
                  <th className="p-3.5">Owner team</th>
                  <th className="p-3.5">Current stage / module</th>
                  <th className="p-3.5">Deal value</th>
                  <th className="p-3.5">Last CRM audit log</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-foreground/80">
                {loading && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No client accounts match — clear the search or add a client.
                  </td></tr>
                )}
                {!loading && filtered.map((w, i) => {
                  const stage = currentStage(w);
                  const last  = w.lastUpdate?.detail || w.lastActivitySummary || '—';
                  const when  = timeAgo(w.lastUpdate?.at || w.lastActivityAt || w.updatedAt);
                  return (
                    <tr key={w._id} className="hover:bg-muted/50 transition">
                      <td className="p-3.5 font-medium text-foreground">
                        <Link to={`/clients/pipeline/${w._id}`} className="flex items-center gap-2 hover:underline">
                          <span className={`w-7 h-7 rounded flex items-center justify-center font-bold text-xs shrink-0 ${AVATAR_TONES[i % AVATAR_TONES.length]}`}>
                            {(w.clientName || '?').charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate max-w-[180px]">{w.clientName || 'Unnamed client'}</span>
                        </Link>
                      </td>
                      <td className="p-3.5">
                        {w.currentOwnerTeam
                          ? <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400">{TEAM_LABEL[w.currentOwnerTeam] || w.currentOwnerTeam}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-3.5">
                        {stage.label}
                        {stage.status && <span className="text-muted-foreground"> · {stage.status}</span>}
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-400">
                        {w.totalAmount ? `₹${w.totalAmount.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="p-3.5 text-muted-foreground font-mono text-[11px] max-w-[260px]">
                        <span className="line-clamp-2">{last}</span>
                        {when && <span className="opacity-70"> · {when}</span>}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => selectAndUnlockDT(w)}
                          className="bg-primary hover:bg-primary/85 text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow inline-flex items-center gap-1.5"
                        >
                          Select & Unlock DT <Unlock className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Awaiting Client modal ───────────────────────────────────── */}
        {showAwaiting && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-purple-500/40 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                    <UserSearch className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground text-sm">Awaiting client — blockers breakdown</h4>
                    <p className="text-xs text-muted-foreground">Accounts currently waiting on the client to move</p>
                  </div>
                </div>
                <button onClick={() => setShowAwaiting(false)} className="text-muted-foreground hover:text-foreground p-2">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {awaiting.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Nothing is waiting on a client right now. 🎉
                  </p>
                )}
                {awaiting.map(w => (
                  <div key={w._id} className="bg-background p-3.5 rounded-xl border border-border space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <Link to={`/clients/pipeline/${w._id}`} className="font-bold text-foreground hover:underline">
                        {w.clientName || 'Unnamed client'}
                      </Link>
                      {w.currentOwnerTeam && (
                        <span className="text-purple-400 font-medium">{TEAM_LABEL[w.currentOwnerTeam] || w.currentOwnerTeam}</span>
                      )}
                    </div>
                    <p className="text-xs text-foreground/80">{w.blockerReason || 'Waiting on client input.'}</p>
                    {w.blockedSince && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Blocked since {timeAgo(w.blockedSince)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <button
                  onClick={() => setShowAwaiting(false)}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow"
                >
                  Close & return
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
