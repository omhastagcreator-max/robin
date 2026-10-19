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
  sop?: { progress?: any; runId: string; dayNumber: number; doneCount: number; total: number; health: string; step: string; stepState: string; owner: string; updatedToday: boolean; lastUpdate: { at: string; text: string; blocker: string } | null } | null;
  lastUpdate?: { at: string; who: string; what: string } | null;
  daysSinceUpdate?: number | null;
  why?: string;
}
type ClientOption = OverviewRow;

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
  // DT reopens the brand you were last on (or the one sent from the CRM).
  const [selectedClientId, setSelectedClientIdRaw] = useState<string | null>(location.state?.clientId || readLast());
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

  // Enter in the brand box jumps straight into the first matching client.
  const onFetchClient = () => {
    const q = fetchQuery.trim().toLowerCase();
    if (!q) return;
    const match = clientOptions.find(c => (c.clientName || '').toLowerCase().includes(q));
    if (!match) { toast.error(`No client matching "${fetchQuery}".`); return; }
    setSelectedClientId(match._id);
  };

  // ── No brand picked — Oct 19 2026 (owner: "DT was supposed to be clean,
  // still there is a list of brands"): DT never lists brands. You open a
  // brand from the CRM (its DT button) or type its name here.
  if (!selectedClientId) {
    const q = fetchQuery.trim().toLowerCase();
    const matches = q ? clientOptions.filter(c => (c.clientName || '').toLowerCase().includes(q)).slice(0, 6) : [];
    return (
      <div className="flex-1 flex items-center justify-center p-6 animate-in fade-in duration-300">
        <div className="w-full max-w-md text-center">
          <i className="fa-solid fa-diagram-project text-3xl text-blue-500"></i>
          <h2 className="mt-3 text-lg font-bold text-white">Decision Tree</h2>
          <p className="mt-1 text-xs text-slate-400">Open a brand from the CRM with its <b className="text-slate-200">DT</b> button, or type its name.</p>
          <div className="relative mt-5 text-left">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-500"><i className="fa-solid fa-magnifying-glass text-xs"></i></span>
            <input
              type="text" autoFocus aria-label="Brand name"
              value={fetchQuery}
              onChange={(e) => setFetchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onFetchClient(); }}
              placeholder="Brand name…"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-xl">
                {matches.map(m => (
                  <li key={m._id}>
                    <button onClick={() => setSelectedClientId(m._id)} className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">{m.clientName}</button>
                  </li>
                ))}
              </ul>
            )}
            {q && !overviewLoading && matches.length === 0 && <p className="mt-2 text-xs text-slate-500">No brand matching "{fetchQuery}".</p>}
          </div>
          <button onClick={() => navigate('/clients/pipeline')} className="mt-5 text-xs text-blue-400 hover:text-blue-300"><i className="fa-solid fa-arrow-left mr-1.5"></i>Go to CRM</button>
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
          <button onClick={() => navigate('/clients/pipeline')} className="text-xs text-blue-400 hover:text-blue-300">
            <i className="fa-solid fa-arrow-left mr-1.5"></i> Clients
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
          <button onClick={() => { setSelectedClientId(null); setWorkflow(null); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs">Pick another brand</button>
        </div>
      </div>
    );
  }

  return (
    <ClientDesk
      workflow={workflow as any}
      onBack={() => navigate('/clients/pipeline')}
      onChanged={() => { loadWorkflow(workflow._id); loadOverview(); }}
    />
  );
}
