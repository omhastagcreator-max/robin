import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';
import { ClientDesk } from '@/components/pipeline/ClientDesk';

// Oct 2026 (Rahul's voice note): DT remembers the brand you were on — leave
// to the CRM and come back, and the same brand is still open.
const LAST_KEY = 'robin:dt:lastClient';
const readLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const writeLast = (id: string | null) => { try { id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY); } catch { /* storage blocked */ } };

interface ChecklistItem { text: string; done: boolean; doneAt?: string; doneBy?: string; }
interface Service {
  _id: string;
  serviceType: string;
  label: string;
  status: 'blocked' | 'pending' | 'in_progress' | 'done';
  checklist: ChecklistItem[];
  assignedTo?: string;
  assignee?: { name?: string; email?: string } | null;
  returnedReason?: string;
}
interface ActivityRow {
  action: string;
  detail?: string;
  serviceType?: string;
  actorId?: string;
  actorName?: string;
  at?: string;
  createdAt?: string;
}
interface Workflow {
  _id: string;
  clientName: string;
  clientPhone?: string;
  services: Service[];
  activity: ActivityRow[];
  health?: string;
  totalAmount?: number;
  remaining?: number;
}
interface OverviewService {
  _id: string; label: string; serviceType: string;
  status: 'blocked' | 'pending' | 'in_progress' | 'done';
  assigneeName: string; done: number; total: number; nextItem: string;
  returnedReason: string; eta: string | null; overdue: boolean;
  nextTask?: string; nextTaskDue?: string | null;
}
interface OverviewRow {
  _id: string; clientName: string; healthLevel: string; ownerFlag: string;
  priority: string; daysInactive: number; updatedAt?: string;
  services: OverviewService[];
  stuckAt: { stage: string; owner: string; reason: string; severity: 'blocked' | 'waiting' | 'active' | 'done' };
  sop?: { runId: string; dayNumber: number; doneCount: number; total: number; health: string; step: string; stepState: string; owner: string; updatedToday: boolean; lastUpdate: { at: string; text: string; blocker: string } | null } | null;
  lastUpdate?: { at: string; who: string; what: string } | null;
  daysSinceUpdate?: number | null;
  why?: string;
}
const ago = (iso?: string) => {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};
type ClientOption = OverviewRow;

const SEVERITY_RANK: Record<string, number> = { blocked: 0, waiting: 1, active: 2, done: 3 };
const SEVERITY_STYLE: Record<string, string> = {
  blocked: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  active:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
  done:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};
const SEVERITY_LABEL: Record<string, string> = { blocked: 'Stuck', waiting: 'Waiting', active: 'Moving', done: 'Complete' };
const STAGE_CHIP: Record<string, string> = {
  done:        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  in_progress: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  pending:     'bg-slate-800 text-slate-400 border-slate-700',
  blocked:     'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

/** Read-only stage strip — one chip per service, coloured by status. */
function StageStrip({ services }: { services: OverviewService[] }) {
  if (!services.length) return <span className="text-slate-600">No stages</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {services.map((s, i) => (
        <React.Fragment key={s._id}>
          {i > 0 && <i className="fa-solid fa-chevron-right text-[8px] text-slate-600"></i>}
          <span
            title={`${s.label} — ${STATUS_LABEL[s.status] || s.status}${s.assigneeName ? ` · ${s.assigneeName}` : ''}${s.total ? ` · ${s.done}/${s.total}` : ''}`}
            className={`px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${s.returnedReason || s.overdue ? STAGE_CHIP.blocked : STAGE_CHIP[s.status] || STAGE_CHIP.pending}`}
          >
            {s.status === 'done' && <i className="fa-solid fa-check mr-1"></i>}
            {s.label}{s.total && s.status !== 'done' ? ` ${s.done}/${s.total}` : ''}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  blocked: 'Blocked / Pending Dependency',
  pending: 'Pending — Not Started',
  in_progress: 'In Progress (Active Gate)',
  done: 'Done — Verified & Complete',
};

export function DecisionTreeView() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { clientId?: string; clientName?: string } };

  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  // ?view=board (the admin landing page) always opens on the whole board;
  // otherwise DT reopens the brand you were last on.
  const boardFirst = new URLSearchParams((location as any).search || '').get('view') === 'board';
  const [selectedClientId, setSelectedClientIdRaw] = useState<string | null>(location.state?.clientId || (boardFirst ? null : readLast()));
  const setSelectedClientId = useCallback((id: string | null) => { writeLast(id); setSelectedClientIdRaw(id); }, []);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchQuery, setFetchQuery] = useState('');

  // Load the lightweight client directory once — powers both the gated
  // search box and the "Active Client Workspace" switcher.
  // Oct 2026 — the directory is now the org-wide pipeline overview (every
  // staff role sees every client's stages + where it's stuck), since the
  // CRM list itself is role-scoped.
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [boardFilter, setBoardFilter] = useState<'all' | 'blocked' | 'waiting' | 'active' | 'done' | 'stale'>('all');
  const loadOverview = useCallback(() => {
    api.cwPipelineOverview()
      .then((rows: ClientOption[]) => setClientOptions(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setOverviewLoading(false));
  }, []);
  useEffect(() => {
    loadOverview();
    const onChanged = () => loadOverview();
    window.addEventListener('robin:data-changed', onChanged);
    return () => window.removeEventListener('robin:data-changed', onChanged);
  }, [loadOverview]);

  // Full workflow (checklists, audit log) only loads for clients the user
  // is allowed to work on. For anyone else the server answers 403 and we
  // fall back to the read-only overview row — they still see exactly
  // where the client is stuck, just can't tick another team's checklist.
  const [readOnly, setReadOnly] = useState(false);
  // Oct 2026 — a temporary failure (rate limit, Render cold start, network
  // blip) used to drop straight to "Client not found". Now: keep the brand,
  // retry a few times with backoff, then offer a Retry button.
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadWorkflow = useCallback((id: string, attempt = 0) => {
    setLoading(true);
    setLoadError(null);
    api.cwGetWorkflow(id)
      .then((wf: Workflow) => { setWorkflow(wf); setReadOnly(false); setSelectedClientId(id); setLoading(false); })
      .catch((err: any) => {
        const st = err?.response?.status;
        if (st === 403) { setWorkflow(null); setReadOnly(true); api.cwRecordOpen(id); setLoading(false); return; }
        if (st === 404) { setSelectedClientId(null); setLoading(false); return; }  // brand was deleted
        if (attempt < 3) { setTimeout(() => loadWorkflow(id, attempt + 1), 1500 * (attempt + 1)); return; }
        setLoading(false);
        setLoadError(st === 429 ? 'Robin is busy right now.' : (err?.response?.data?.error || 'Could not reach the server.'));
      });
  }, [setSelectedClientId]);

  useEffect(() => {
    if (selectedClientId) loadWorkflow(selectedClientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  // Enter in the board filter jumps straight into the first matching client.
  const onFetchClient = () => {
    const q = fetchQuery.trim().toLowerCase();
    if (!q) return;
    const match = clientOptions.find(c => (c.clientName || '').toLowerCase().includes(q));
    if (!match) { toast.error(`No client matching "${fetchQuery}".`); return; }
    setSelectedClientId(match._id);
  };

  // ── Whole-pipeline board — no client picked yet ───────────────────────
  if (!selectedClientId) {
    const counts = clientOptions.reduce((m, r) => { m[r.stuckAt.severity] = (m[r.stuckAt.severity] || 0) + 1; return m; }, {} as Record<string, number>);
    const q = fetchQuery.trim().toLowerCase();
    const rows = clientOptions
      .filter(r => boardFilter === 'all' || (boardFilter === 'stale' ? (r.daysSinceUpdate ?? 0) >= 3 && r.stuckAt.severity !== 'done' : r.stuckAt.severity === boardFilter))
      .filter(r => !q || r.clientName.toLowerCase().includes(q) || r.stuckAt.owner.toLowerCase().includes(q) || r.stuckAt.stage.toLowerCase().includes(q))
      .sort((a, b) => (SEVERITY_RANK[a.stuckAt.severity] - SEVERITY_RANK[b.stuckAt.severity]) || a.clientName.localeCompare(b.clientName));
    const FILTERS: Array<{ k: typeof boardFilter; label: string }> = [
      { k: 'all', label: `All · ${clientOptions.length}` },
      { k: 'blocked', label: `Stuck · ${counts.blocked || 0}` },
      { k: 'waiting', label: `Waiting · ${counts.waiting || 0}` },
      { k: 'active', label: `Moving · ${counts.active || 0}` },
      { k: 'done', label: `Complete · ${counts.done || 0}` },
      { k: 'stale', label: `No update 3+ days · ${clientOptions.filter(r => (r.daysSinceUpdate ?? 0) >= 3 && r.stuckAt.severity !== 'done').length}` },
    ];
    return (
      <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4 overflow-y-auto animate-in fade-in duration-300">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <i className="fa-solid fa-diagram-project text-blue-500"></i> Where every client is
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Each client's stage right now, why it isn't moving, what happens next and who last touched it. Click a client to open it.</p>
          </div>
          <div className="relative w-full md:w-80">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-500"><i className="fa-solid fa-magnifying-glass text-xs"></i></span>
            <input
              type="text"
              value={fetchQuery}
              onChange={(e) => setFetchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onFetchClient(); }}
              placeholder="Filter by client, stage or owner…"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f.k}
              onClick={() => setBoardFilter(f.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${boardFilter === f.k ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'}`}
            >{f.label}</button>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Client</th>
                  <th className="p-3">Stage now</th>
                  <th className="p-3 min-w-[240px]">Why it's halted</th>
                  <th className="p-3">Next step</th>
                  <th className="p-3">Last update</th>
                  <th className="p-3">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {overviewLoading ? (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading pipeline…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-500">No clients match.</td></tr>
                ) : rows.map(r => {
                  const active = r.services.find(s => s.status === 'in_progress') || r.services.find(s => s.status === 'pending') || r.services.find(s => s.status === 'blocked');
                  const next = active?.nextTask ? `${active.nextTask}${active.nextTaskDue ? ` · by ${new Date(active.nextTaskDue).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}` : active?.nextItem || '—';
                  const nextLate = !!(active?.nextTaskDue && new Date(active.nextTaskDue).getTime() < Date.now());
                  const stale = (r.daysSinceUpdate ?? 0) >= 3 && r.stuckAt.severity !== 'done';
                  return (
                  <tr key={r._id} onClick={() => setSelectedClientId(r._id)} className="hover:bg-slate-800/40 cursor-pointer transition align-top">
                    <td className="p-3 font-semibold text-white whitespace-nowrap">
                      {r.ownerFlag === 'critical' && <i className="fa-solid fa-circle text-[7px] text-rose-500 mr-1.5 align-middle"></i>}
                      {r.clientName}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${SEVERITY_STYLE[r.stuckAt.severity]}`}>{SEVERITY_LABEL[r.stuckAt.severity]}</span>
                        <span className="text-white">{r.stuckAt.stage}</span>
                        {active?.total ? <span className="text-slate-500 text-[10.5px]">{active.done}/{active.total}</span> : null}
                      </div>
                      {r.sop && (
                        <div className={`mt-1 text-[10.5px] ${r.sop.stepState === 'missed' ? 'text-rose-400' : r.sop.stepState === 'overdue' ? 'text-orange-400' : 'text-slate-400'}`}>
                          <i className="fa-solid fa-clapperboard mr-1"></i>Video SOP Day {r.sop.dayNumber} · {r.sop.step || 'complete'}{r.sop.stepState === 'missed' ? ' · MISSED' : r.sop.stepState === 'overdue' ? ' · overdue' : ''}
                        </div>
                      )}
                      <div className="mt-1.5"><StageStrip services={r.services} /></div>
                    </td>
                    <td className="p-3 text-slate-300">
                      {(r.why ?? r.stuckAt.reason) || (r.stuckAt.severity === 'done' ? 'All done' : 'In progress — nothing blocking')}
                      {stale && <div className="mt-1 text-[10.5px] font-semibold text-rose-400">No update for {r.daysSinceUpdate} days</div>}
                      {r.sop?.lastUpdate?.blocker && <div className="mt-1 text-[10.5px] text-rose-300">Video team: {r.sop.lastUpdate.blocker}</div>}
                    </td>
                    <td className={`p-3 ${nextLate ? 'text-rose-400' : 'text-slate-300'}`}>{next}{nextLate ? ' · LATE' : ''}</td>
                    <td className="p-3 text-[11.5px]">
                      {r.lastUpdate ? (
                        <>
                          <div className="text-slate-200">{r.lastUpdate.who ? `${r.lastUpdate.who} · ` : 'Updated '}<span className={stale ? 'text-rose-400' : 'text-slate-400'}>{ago(r.lastUpdate.at)}</span></div>
                          {r.lastUpdate.what && <div className="text-slate-500 line-clamp-2 max-w-[240px]">{r.lastUpdate.what}</div>}
                        </>
                      ) : <span className="text-slate-600">Never</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap">{r.stuckAt.owner || <span className="text-amber-400">Unassigned</span>}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const overviewRow = clientOptions.find(c => c._id === selectedClientId) || null;

  // ── Read-only view — client the user doesn't work on ────────────────────
  if (readOnly && !workflow) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4 overflow-y-auto animate-in fade-in duration-300">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => { setSelectedClientId(null); setReadOnly(false); }} className="text-xs text-blue-400 hover:text-blue-300">
            <i className="fa-solid fa-arrow-left mr-1.5"></i> Whole pipeline
          </button>
          <span className="px-2.5 py-1 rounded-md text-[10.5px] bg-slate-800 text-slate-300 border border-slate-700">
            <i className="fa-solid fa-eye mr-1"></i> View only — not one of your stages
          </span>
        </div>
        {!overviewRow ? (
          <p className="text-sm text-slate-500">Client not found.</p>
        ) : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-lg font-bold text-white">{overviewRow.clientName}</h3>
              <p className="mt-2 text-xs text-slate-300">
                <span className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold mr-2 ${SEVERITY_STYLE[overviewRow.stuckAt.severity]}`}>{SEVERITY_LABEL[overviewRow.stuckAt.severity]}</span>
                at <b className="text-white">{overviewRow.stuckAt.stage}</b>
                {overviewRow.stuckAt.owner ? <> · owner <b className="text-white">{overviewRow.stuckAt.owner}</b></> : null}
                {overviewRow.stuckAt.reason ? <> · {overviewRow.stuckAt.reason}</> : null}
              </p>
            </div>
            <div className="space-y-2">
              {overviewRow.services.map(s => (
                <div key={s._id} className={`p-3 rounded-lg border text-xs ${s.returnedReason || s.overdue ? STAGE_CHIP.blocked : STAGE_CHIP[s.status] || STAGE_CHIP.pending}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{s.label}</span>
                    <span className="text-[10.5px] opacity-80">{STATUS_LABEL[s.status] || s.status}</span>
                  </div>
                  <div className="mt-1 text-[11px] opacity-80">
                    {s.assigneeName || 'Unassigned'}
                    {s.total ? ` · ${s.done}/${s.total} checklist items` : ''}
                    {s.status !== 'done' && s.nextItem ? ` · next: ${s.nextItem}` : ''}
                    {s.overdue ? ' · past ETA' : ''}
                    {s.returnedReason ? ` · returned: "${s.returnedReason}"` : ''}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (loading && !workflow) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2"></i> Loading client from CRM...</div>;
  }
  if (!workflow) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-slate-400">
        <p>{loadError ? `Couldn't load this client — ${loadError}` : 'Loading client…'}</p>
        <div className="flex gap-2">
          {loadError && <button onClick={() => selectedClientId && loadWorkflow(selectedClientId)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Retry</button>}
          <button onClick={() => { setSelectedClientId(null); setWorkflow(null); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs">Whole pipeline</button>
        </div>
      </div>
    );
  }

  return (
    <ClientDesk
      workflow={workflow as any}
      onBack={() => { setSelectedClientId(null); setWorkflow(null); }}
      onChanged={() => { loadWorkflow(workflow._id); loadOverview(); }}
    />
  );
}
