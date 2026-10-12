import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';

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
}
interface OverviewRow {
  _id: string; clientName: string; healthLevel: string; ownerFlag: string;
  priority: string; daysInactive: number; updatedAt?: string;
  services: OverviewService[];
  stuckAt: { stage: string; owner: string; reason: string; severity: 'blocked' | 'waiting' | 'active' | 'done' };
}
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(location.state?.clientId || null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchQuery, setFetchQuery] = useState('');

  // Load the lightweight client directory once — powers both the gated
  // search box and the "Active Client Workspace" switcher.
  // Oct 2026 — the directory is now the org-wide pipeline overview (every
  // staff role sees every client's stages + where it's stuck), since the
  // CRM list itself is role-scoped.
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [boardFilter, setBoardFilter] = useState<'all' | 'blocked' | 'waiting' | 'active' | 'done'>('all');
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
  const loadWorkflow = useCallback((id: string) => {
    setLoading(true);
    api.cwGetWorkflow(id)
      .then((wf: Workflow) => { setWorkflow(wf); setReadOnly(false); setSelectedClientId(id); })
      .catch((err: any) => {
        if (err?.response?.status === 403) { setWorkflow(null); setReadOnly(true); return; }
        toast.error(err?.response?.data?.error || 'Failed to load client from CRM.');
      })
      .finally(() => setLoading(false));
  }, []);

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
      .filter(r => boardFilter === 'all' || r.stuckAt.severity === boardFilter)
      .filter(r => !q || r.clientName.toLowerCase().includes(q) || r.stuckAt.owner.toLowerCase().includes(q) || r.stuckAt.stage.toLowerCase().includes(q))
      .sort((a, b) => (SEVERITY_RANK[a.stuckAt.severity] - SEVERITY_RANK[b.stuckAt.severity]) || a.clientName.localeCompare(b.clientName));
    const FILTERS: Array<{ k: typeof boardFilter; label: string }> = [
      { k: 'all', label: `All · ${clientOptions.length}` },
      { k: 'blocked', label: `Stuck · ${counts.blocked || 0}` },
      { k: 'waiting', label: `Waiting · ${counts.waiting || 0}` },
      { k: 'active', label: `Moving · ${counts.active || 0}` },
      { k: 'done', label: `Complete · ${counts.done || 0}` },
    ];
    return (
      <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4 overflow-y-auto animate-in fade-in duration-300">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <i className="fa-solid fa-diagram-project text-blue-500"></i> Whole client pipeline
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Every active client, every stage — and exactly where each one is stuck. Click a client for its full decision tree.</p>
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
                  <th className="p-3">Stuck at</th>
                  <th className="p-3">Why</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3 min-w-[280px]">Pipeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {overviewLoading ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">Loading pipeline…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">No clients match.</td></tr>
                ) : rows.map(r => (
                  <tr key={r._id} onClick={() => setSelectedClientId(r._id)} className="hover:bg-slate-800/40 cursor-pointer transition">
                    <td className="p-3 font-semibold text-white whitespace-nowrap">
                      {r.ownerFlag === 'critical' && <i className="fa-solid fa-circle text-[7px] text-rose-500 mr-1.5 align-middle"></i>}
                      {r.clientName}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold whitespace-nowrap ${SEVERITY_STYLE[r.stuckAt.severity]}`}>
                        {SEVERITY_LABEL[r.stuckAt.severity]}
                      </span>
                      <span className="ml-2 text-white">{r.stuckAt.stage}</span>
                    </td>
                    <td className="p-3 text-slate-400">{r.stuckAt.reason || '—'}{r.daysInactive >= 5 ? ` · idle ${r.daysInactive}d` : ''}</td>
                    <td className="p-3 whitespace-nowrap">{r.stuckAt.owner || <span className="text-slate-600">Unassigned</span>}</td>
                    <td className="p-3"><StageStrip services={r.services} /></td>
                  </tr>
                ))}
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
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Client not found.</div>;
  }

  const services = workflow.services || [];
  const activeService = services.find(s => s.status === 'in_progress')
    || services.find(s => s.status === 'pending')
    || services.find(s => s.status === 'blocked');
  const allDone = services.length > 0 && !activeService;

  const ticked = activeService ? (activeService.checklist || []).filter(c => c.done).length : 0;
  const total = activeService ? (activeService.checklist || []).length : 0;

  const refresh = () => loadWorkflow(workflow._id);

  const handleToggleItem = (svc: Service, index: number, item: ChecklistItem) => {
    if (svc.status !== 'in_progress' && svc.status !== 'pending') {
      toast.error('This stage is blocked by an earlier dependency.');
      return;
    }
    const comment = window.prompt(
      `${item.done ? 'Un-tick' : 'Tick'} "${item.text}" — add a short note for the audit log:`,
      item.done ? 'Reverted for rework' : 'Verified and completed'
    );
    if (comment === null) return;
    api.cwToggleCheck(workflow._id, svc._id, { index, done: !item.done, comment: comment || 'Updated via Decision Tree' })
      .then((wf: Workflow) => { setWorkflow(wf); toast.success('Checklist updated and logged to CRM.'); })
      .catch((err: any) => toast.error(err?.response?.data?.error || 'Could not update checklist item.'));
  };

  const handleCompleteStage = () => {
    if (!activeService) return;
    if (ticked < total) { toast.error('Tick every checklist item before completing this stage.'); return; }
    const comment = window.prompt('Confirm stage completion — add a short note for the client-facing audit log:', 'Stage verified and marked complete.');
    if (comment === null) return;
    api.cwCompleteService(workflow._id, activeService._id, { comment: comment || 'Stage completed.' })
      .then((wf: Workflow) => {
        setWorkflow(wf);
        toast.success('Task successfully marked complete! CRM log updated and synchronized across all departmental views.');
      })
      .catch((err: any) => toast.error(err?.response?.data?.error || 'Could not complete this stage.'));
  };

  const handleSaveNote = () => {
    const detail = window.prompt('Save a draft note against this client (visible to the whole team):', '');
    if (!detail) return;
    api.cwAddNote(workflow._id, { detail, serviceType: activeService?.serviceType })
      .then(() => { toast.success('Note saved to CRM.'); refresh(); })
      .catch(() => toast.error('Could not save note.'));
  };

  const handleCopyWhatsApp = () => {
    const text = `Hi ${workflow.clientName}, update from Hashtag Creator desk: ${activeService ? `Your "${activeService.label}" stage` : 'Your engagement'} has been reviewed as per Robin OS standards. Let's scale!`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Client WhatsApp update template copied to clipboard successfully!');
    }).catch(() => toast.error('Could not copy to clipboard.'));
  };

  const colorFor = (svc: Service) => {
    if (svc.status === 'done') return { box: 'bg-slate-950 border-slate-800 text-slate-300', icon: 'text-emerald-400', bar: 'border-slate-700' };
    if (svc._id === activeService?._id) return { box: 'bg-blue-600/10 border-blue-500/40 text-white font-semibold', icon: 'text-blue-400', bar: 'border-blue-500' };
    return { box: 'bg-slate-950/40 border-slate-800/60 text-slate-500', icon: 'text-slate-600', bar: 'border-slate-700' };
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 min-h-0 overflow-hidden animate-in fade-in duration-300">
      {/* Top Sub-Bar for Client Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase font-semibold">Active Client Workspace:</span>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-blue-500 [&>option]:bg-slate-900 [&>option]:text-white max-w-[280px]"
          >
            {clientOptions.map(c => (
              <option key={c._id} value={c._id}>{c.clientName}</option>
            ))}
          </select>
          <button onClick={() => { setSelectedClientId(null); setWorkflow(null); }} className="text-xs text-slate-300 hover:text-white">
            <i className="fa-solid fa-arrow-left mr-1"></i> Whole pipeline
          </button>
          <button onClick={() => navigate(`/clients/pipeline/${workflow._id}`)} className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2">
            Open full client workspace
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <i className="fa-solid fa-shield-halved mr-1"></i> System-Enforced Decision Tree Active
          </span>
        </div>
      </div>

      {/* Main Split Workspace Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">

        {/* LEFT PANEL: Stage Pointers */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Decision Tree Stage Pointers</h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold">{workflow.clientName}</span>
          </div>

          {services.length === 0 ? (
            <p className="text-xs text-slate-500">No services on this client's pipeline yet.</p>
          ) : (
            <div className="space-y-2">
              {services.map((svc) => {
                const c = colorFor(svc);
                const isActive = svc._id === activeService?._id;
                return (
                  <div key={svc._id} className={`p-3 rounded-lg border text-xs transition ${c.box}`}>
                    <div className="flex items-center justify-between">
                      <span>{svc.label}</span>
                      <span>
                        {svc.status === 'done' ? <i className="fa-solid fa-check text-emerald-400"></i> :
                         isActive ? <i className={`fa-solid fa-spinner fa-spin ${c.icon}`}></i> :
                         <i className="fa-solid fa-lock text-slate-600"></i>}
                      </span>
                    </div>
                    {isActive && (svc.checklist || []).length > 0 && (
                      <div className={`mt-2 pl-3 border-l-2 ${c.bar} space-y-1 text-[11px] text-slate-300`}>
                        {svc.checklist.map((item, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => handleToggleItem(svc, sIdx, item)}
                            className={`flex items-center gap-1.5 text-left w-full hover:text-white transition ${item.done ? 'text-emerald-400 line-through decoration-emerald-500/50' : ''}`}
                          >
                            <i className={item.done ? 'fa-solid fa-square-check' : 'fa-regular fa-square'}></i>
                            {item.text}
                          </button>
                        ))}
                      </div>
                    )}
                    {svc.status === 'blocked' && (
                      <p className="mt-1.5 text-[10px] text-amber-400">Waiting on an earlier stage to complete.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: Task Execution Card & Live CRM Log */}
        <div className="lg:col-span-8 flex flex-col space-y-4 min-h-0 overflow-hidden">

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between shrink-0 shadow-sm">
            {allDone ? (
              <div className="text-center py-4">
                <i className="fa-solid fa-circle-check text-emerald-400 text-3xl mb-3"></i>
                <h3 className="text-sm font-bold text-white">All stages complete for {workflow.clientName}</h3>
                <p className="text-xs text-slate-400 mt-1">Every service on this pipeline has been verified and closed out.</p>
              </div>
            ) : activeService ? (
              <>
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Current Stage: {activeService.label}</h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                      TASK #{activeService.serviceType.toUpperCase().slice(0, 10)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed mb-4">
                    {activeService.assignee?.name ? `Assigned to ${activeService.assignee.name}. ` : ''}
                    {total > 0
                      ? `${ticked} of ${total} checklist items verified. Tick every item in the left panel to unlock stage completion.`
                      : 'No checklist items configured for this stage yet.'}
                    {activeService.returnedReason ? ` Returned for rework: "${activeService.returnedReason}"` : ''}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-medium">Task Status:</span>
                      <span className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-semibold">
                        {STATUS_LABEL[activeService.status] || activeService.status}
                      </span>
                    </div>

                    <button onClick={handleCopyWhatsApp} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-slate-700 flex items-center gap-2">
                      <i className="fa-brands fa-whatsapp text-emerald-400"></i> Copy Client WhatsApp Update
                    </button>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end gap-3">
                  <button onClick={handleSaveNote} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-xs font-semibold transition">
                    Save Note
                  </button>
                  <button
                    onClick={handleCompleteStage}
                    disabled={ticked < total || total === 0}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-xs font-semibold transition shadow-lg shadow-blue-600/20 flex items-center gap-2"
                  >
                    <i className="fa-solid fa-check-circle"></i> Complete Task & Auto-Log to CRM
                  </button>
                </div>
              </>
            ) : null}
          </div>

          {/* Live Automated CRM Log Generator */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col min-h-0 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <i className="fa-solid fa-terminal text-emerald-400"></i> Live Automated CRM Feed & Audit Trail
              </h4>
              <span className="text-[10px] text-slate-500">Immutable Audit Log Active</span>
            </div>
            <div className="bg-slate-950 rounded-lg p-3 font-mono text-[11px] text-slate-300 overflow-y-auto space-y-2 flex-1 border border-slate-800/80">
              {(workflow.activity || []).length === 0 ? (
                <div className="text-slate-600">No audit log entries for this client yet.</div>
              ) : (
                [...workflow.activity].reverse().slice(0, 100).map((log, i) => {
                  const when = log.at || log.createdAt;
                  const ts = when ? new Date(when).toLocaleTimeString() : '';
                  const color = log.action === 'created' ? 'text-emerald-400'
                    : log.action?.includes('complete') ? 'text-blue-400'
                    : i === 0 ? 'text-emerald-400 animate-pulse'
                    : 'text-slate-300';
                  return (
                    <div key={i} className={color}>
                      [{ts}] {(log.actorName || 'System')} — {log.action}{log.detail ? `: ${log.detail}` : ''}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
