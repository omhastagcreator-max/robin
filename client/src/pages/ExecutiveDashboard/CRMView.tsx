import React, { useEffect, useState, useMemo } from 'react';
import * as api from '@/api';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
// Reusing Robin's existing, real, tested onboarding modal and AI-brief
// button — both already wired to the live API (cwCreateWorkflow /
// aiBriefAllProjects) — instead of re-implementing them as fake buttons.
import { CreateWorkflowModal, AllProjectsBriefButton } from '@/components/shared/CrmSharedModals';
import { AssignTaskModal } from '@/components/shared/AssignTaskModal';

interface ActivityStub {
  at?: string;
  action?: string;
  detail?: string;
  serviceType?: string;
}
interface ClientRow {
  _id: string;
  clientName: string;
  clientPhone?: string;
  currentOwnerTeam?: string;
  health?: string;
  healthLevel?: string;
  services?: { label: string; status: string }[];
  totalAmount?: number;
  remaining?: number;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  lastUpdate?: ActivityStub | null;
  updatedAt?: string;
  // Oct 2026 — server-computed "where is it stuck / why" (same logic as
  // the Decision Tree overview) + per-stage breakdown.
  stuckAt?: { stage: string; owner: string; reason: string; severity: 'blocked' | 'waiting' | 'active' | 'done'; serviceId?: string };
  pipeline?: Array<{
    _id: string; label: string; status: string; assignedTo: string; assigneeName: string;
    done: number; total: number; nextItem: string; returnedReason: string; eta: string | null; overdue: boolean;
  }>;
}

const SEV_STYLE: Record<string, string> = {
  blocked: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  active:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
  done:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};
const SEV_LABEL: Record<string, string> = { blocked: 'Stuck', waiting: 'Waiting', active: 'Moving', done: 'Done' };
const STAGE_STATUS: Record<string, string> = { done: 'Done', in_progress: 'In progress', pending: 'Not started', blocked: 'Blocked' };
const toDateInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '';

const HEALTH_META: Record<string, { label: string; badge: string }> = {
  healthy:           { label: 'On Track',        badge: 'bg-emerald-500/10 text-emerald-400' },
  at_risk:           { label: 'At Risk',          badge: 'bg-amber-500/10 text-amber-400' },
  delayed:           { label: 'Delayed',          badge: 'bg-rose-500/10 text-rose-400' },
  blocked:           { label: 'Blocked',          badge: 'bg-rose-500/10 text-rose-400' },
  waiting_client:    { label: 'Awaiting Client',  badge: 'bg-purple-500/10 text-purple-400' },
  waiting_internal:  { label: 'Waiting Internal', badge: 'bg-cyan-500/10 text-cyan-400' },
  revision:          { label: 'In Revision',      badge: 'bg-cyan-500/10 text-cyan-400' },
  final_qa:          { label: 'Final QA',         badge: 'bg-blue-500/10 text-blue-400' },
  ready_to_deliver:  { label: 'Ready to Deliver', badge: 'bg-emerald-500/10 text-emerald-400' },
};

function currentStageLabel(c: ClientRow): string {
  const services = c.services || [];
  const active = services.find(s => s.status === 'in_progress') || services.find(s => s.status === 'pending');
  if (active) return active.label;
  if (services.length && services.every(s => s.status === 'done')) return 'All services complete';
  return 'Not started';
}

export function CRMView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Oct 2026 — role-scoped CRM: employee/workroom users (except Om, who
  // has canEditAllClients) only get their own assigned services back from
  // the server. Hide the org-wide extras (all-projects AI brief, deal
  // value, "mine" toggle) so nothing beyond their own tasks shows here.
  const roleScoped = ['employee', 'workroom'].includes(user?.role || '') && !user?.canEditAllClients;
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  // Real server-backed "just mine" filter — cwListWorkflows({mine:'1'})
  // restricts to workflows the signed-in user created or is assigned a
  // service on (see clientWorkflowController.listWorkflows).
  const [focusedOnly, setFocusedOnly] = useState(false);
  // Oct 2026 (Rahul's voice note): "Focused / Sort — remove". Stuck-first is
  // the only order that matters; the count cards below now filter instead.
  const [statusFilter, setStatusFilter] = useState<'all' | 'onTrack' | 'atRisk' | 'awaiting' | 'delayed' | 'movedToday'>('all');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [taskFor, setTaskFor] = useState<string | null>(null);
  const [savingEta, setSavingEta] = useState<string | null>(null);
  const canEditAny = user?.role === 'admin' || !!user?.canEditAllClients;

  // Set/clear a stage ETA right from the CRM row. Server enforces
  // "your own stage, or admin/Om" — we only show the input when allowed.
  const saveEta = async (wid: string, sid: string, value: string) => {
    setSavingEta(sid);
    try {
      // Store as end-of-day IST so "due 14 Oct" doesn't flip to overdue at 05:30.
      const eta = value ? new Date(`${value}T23:59:00+05:30`).toISOString() : null;
      await api.cwSetServiceEta(wid, sid, { eta, comment: value ? `ETA set to ${value} from CRM` : 'ETA cleared from CRM' });
      toast.success(value ? 'ETA saved.' : 'ETA cleared.');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save ETA.');
    } finally { setSavingEta(null); }
  };

  const load = (mine = focusedOnly) => {
    setLoading(true);
    api.cwListWorkflows(mine ? { mine: '1' } : {})
      .then((rows: ClientRow[]) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => toast.error('Failed to load clients'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(focusedOnly); }, [focusedOnly]);


  const isToday = (iso?: string) => {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const STATUS_TEST: Record<typeof statusFilter, (c: ClientRow) => boolean> = {
    all:        () => true,
    onTrack:    c => c.health === 'healthy' || c.health === 'ready_to_deliver',
    atRisk:     c => c.health === 'at_risk',
    awaiting:   c => c.health === 'waiting_client',
    delayed:    c => c.health === 'delayed' || c.health === 'blocked',
    movedToday: c => isToday(c.lastUpdate?.at || c.updatedAt),
  };
  const filteredClients = clients
    .filter(STATUS_TEST[statusFilter])
    .filter(c =>
      (c.clientName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.clientPhone || '').includes(searchQuery) ||
      ((c as any).clientEmail || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a: any, b: any) => {
      // Most stuck first, then most recently updated.
      const R: Record<string, number> = { blocked: 0, waiting: 1, active: 2, done: 3 };
      return ((R[a.stuckAt?.severity] ?? 9) - (R[b.stuckAt?.severity] ?? 9))
        || (new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    });

  const metrics = useMemo(() => {
    const onTrack  = clients.filter(c => c.health === 'healthy' || c.health === 'ready_to_deliver').length;
    const atRisk   = clients.filter(c => c.health === 'at_risk').length;
    const delayed  = clients.filter(c => c.health === 'delayed' || c.health === 'blocked').length;
    const awaiting = clients.filter(c => c.health === 'waiting_client').length;
    const stageMovedToday = clients.filter(c => {
      const at = c.lastUpdate?.at || c.updatedAt;
      if (!at) return false;
      const d = new Date(at);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }).length;
    return { onTrack, atRisk, delayed, awaiting, stageMovedToday };
  }, [clients]);


  const percent = clients.length
    ? Math.round((clients.filter(c => c.health === 'healthy' || c.health === 'ready_to_deliver').length / clients.length) * 100)
    : 0;

  // Opens the Decision Tree for THIS brand only. DT remembers it, so coming
  // back to DT from the sidebar reopens the same brand (Rahul's voice note).
  const openDT = (client: ClientRow) => {
    try { localStorage.setItem('robin:dt:lastClient', client._id); } catch { /* storage blocked — state still carries it */ }
    navigate('/command-center', { state: { clientId: client._id, clientName: client.clientName } });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-6 overflow-y-auto w-full animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <i className="fa-solid fa-address-book text-blue-500"></i> {roleScoped ? 'My clients' : 'Clients'}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {/* Real Gemini-backed brief covering every active project — same
              component the old Client Pipeline page used. */}
          {!roleScoped && <AllProjectsBriefButton />}
          <button onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-600/20 flex items-center gap-2">
            <i className="fa-solid fa-plus"></i> Add client
          </button>
        </div>
      </div>

      {/* Search — centred and larger (Rahul's voice note). */}
      <div className="w-full max-w-2xl mx-auto relative">
        <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-slate-500">
          <i className="fa-solid fa-magnifying-glass text-sm"></i>
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search brand, phone or email"
          aria-label="Search clients"
          className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
        />
        {!roleScoped && (
          <div className="flex justify-center mt-2">
            <button
              onClick={() => setFocusedOnly(v => !v)}
              aria-pressed={focusedOnly}
              title="Show only clients you created or are assigned a service on"
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${focusedOnly ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white'}`}
            >
              {focusedOnly ? '✓ Only my clients' : 'Only my clients'}
            </button>
          </div>
        )}
      </div>

      {/* Count cards — click a number to filter the list to those clients. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {([
          { k: 'all',        label: 'All clients',     value: clients.length,          icon: 'fa-folder',               tone: 'text-white',       sub: `${percent}% on track` },
          { k: 'onTrack',    label: 'On track',        value: metrics.onTrack,         icon: 'fa-circle-check',         tone: 'text-emerald-400' },
          { k: 'atRisk',     label: 'At risk',         value: metrics.atRisk,          icon: 'fa-triangle-exclamation', tone: 'text-amber-400' },
          { k: 'awaiting',   label: 'Awaiting client', value: metrics.awaiting,        icon: 'fa-user-clock',           tone: 'text-purple-400' },
          { k: 'delayed',    label: 'Delayed',         value: metrics.delayed,         icon: 'fa-clock',                tone: 'text-rose-400' },
          { k: 'movedToday', label: 'Moved today',     value: metrics.stageMovedToday, icon: 'fa-arrow-right',          tone: 'text-cyan-400' },
        ] as const).map(card => {
          const active = statusFilter === card.k;
          return (
            <button
              key={card.k}
              onClick={() => setStatusFilter(active && card.k !== 'all' ? 'all' : card.k)}
              aria-pressed={active}
              className={`text-left bg-slate-900 border rounded-xl p-4 shadow-sm transition ${active ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-800 hover:border-slate-600'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">{card.label}</span>
                <i className={`fa-solid ${card.icon} ${card.tone} text-xs`}></i>
              </div>
              <h4 className={`text-2xl font-bold ${card.tone}`}>{card.value}</h4>
              {'sub' in card && card.sub && <p className="text-[10.5px] text-slate-500 mt-0.5">{card.sub}</p>}
            </button>
          );
        })}
      </div>

      {/* Client Table Feed */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-table-list text-blue-400"></i> {statusFilter === 'all' ? 'All clients' : `Filtered: ${({ onTrack: 'On track', atRisk: 'At risk', awaiting: 'Awaiting client', delayed: 'Delayed', movedToday: 'Moved today' } as Record<string, string>)[statusFilter]}`}
            <span className="text-xs text-slate-500 font-normal">· {filteredClients.length}</span>
            {statusFilter !== 'all' && <button onClick={() => setStatusFilter('all')} className="text-[11px] text-blue-400 hover:text-blue-300 font-normal">clear</button>}
          </h3>
          <span className="text-xs text-slate-400 hidden md:inline">Click a row for every stage, owner and ETA</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="p-3.5">Brand / Client</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Stuck at</th>
                <th className="p-3.5">Why it's not moving</th>
                {!roleScoped && <th className="p-3.5">Deal Value</th>}
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr><td colSpan={roleScoped ? 5 : 6} className="p-6 text-center text-slate-500">Loading clients...</td></tr>
              ) : filteredClients.length === 0 ? (
                <tr><td colSpan={roleScoped ? 5 : 6} className="p-6 text-center text-slate-500">No clients found.</td></tr>
              ) : filteredClients.map((client) => {
                const meta = HEALTH_META[client.health || ''] || { label: 'Active', badge: 'bg-slate-800 text-slate-300' };
                return (
                  <React.Fragment key={client._id}>
                  <tr onClick={() => setOpenRow(r => r === client._id ? null : client._id)} className="hover:bg-slate-800/40 transition cursor-pointer">
                    <td className="p-3.5 font-medium text-white flex items-center gap-2">
                      <i className={`fa-solid fa-chevron-right text-[9px] text-slate-500 transition-transform ${openRow === client._id ? 'rotate-90' : ''}`}></i>
                      <div className="w-7 h-7 rounded flex items-center justify-center font-bold text-xs bg-blue-600/20 text-blue-400">
                        {(client.clientName || '?').charAt(0).toUpperCase()}
                      </div>
                      {client.clientName}
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="p-3.5">
                      {client.stuckAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${SEV_STYLE[client.stuckAt.severity]}`}>{SEV_LABEL[client.stuckAt.severity]}</span>
                          <span className="text-white">{client.stuckAt.stage}</span>
                        </span>
                      ) : currentStageLabel(client)}
                      {client.stuckAt?.owner && <div className="text-[10.5px] text-slate-500 mt-0.5">Owner: {client.stuckAt.owner}</div>}
                    </td>
                    <td className="p-3.5 text-slate-400 max-w-[280px]">{client.stuckAt?.reason || '—'}</td>
                    {!roleScoped && <td className="p-3.5 font-semibold text-emerald-400">
                      {client.totalAmount ? `₹${client.totalAmount.toLocaleString('en-IN')}` : '—'}
                    </td>}
                    <td className="p-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setTaskFor(client._id)}
                        title="Raise a task on this client"
                        className="bg-emerald-600/90 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold transition mr-2"
                      >
                        <i className="fa-solid fa-plus mr-1"></i> Task
                      </button>
                      <button
                        onClick={() => navigate(`/clients/pipeline/${client._id}`)}
                        title="Open full client workspace"
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition mr-2"
                      >
                        <i className="fa-solid fa-folder-open"></i>
                      </button>
                      <button onClick={() => openDT(client)} title="Open this brand in the Decision Tree" className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow">
                        <i className="fa-solid fa-diagram-project mr-1"></i> DT
                      </button>
                    </td>
                  </tr>
                  {openRow === client._id && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={roleScoped ? 5 : 6} className="px-6 py-4">
                        <div className="space-y-2">
                          {(client.pipeline || []).length === 0 && <p className="text-slate-500">No stages on this client yet.</p>}
                          {(client.pipeline || []).map(st => {
                            const mine = st.assignedTo && st.assignedTo === user?.id;
                            const canEta = st.status !== 'done' && (mine || canEditAny);
                            const isStuckHere = client.stuckAt?.serviceId === st._id;
                            return (
                              <div key={st._id} className={`grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-2 md:gap-4 items-center p-2.5 rounded-lg border ${isStuckHere ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-800'}`}>
                                <div className="text-white font-medium">
                                  {st.status === 'done' ? <i className="fa-solid fa-check text-emerald-400 mr-1.5"></i> : isStuckHere ? <i className="fa-solid fa-hand text-rose-400 mr-1.5"></i> : <i className="fa-regular fa-circle text-slate-600 mr-1.5"></i>}
                                  {st.label}
                                  <span className="ml-2 text-[10.5px] text-slate-500">{STAGE_STATUS[st.status] || st.status}</span>
                                </div>
                                <div className="text-slate-400">{st.assigneeName || <span className="text-amber-400">No owner</span>}{st.total ? ` · ${st.done}/${st.total}` : ''}</div>
                                <div className="text-slate-400 truncate">
                                  {st.returnedReason ? <span className="text-rose-400">Returned: {st.returnedReason}</span>
                                    : st.status !== 'done' && st.nextItem ? <>Next: {st.nextItem}</> : st.status === 'done' ? '—' : ''}
                                </div>
                                <div className="flex items-center gap-2 justify-start md:justify-end">
                                  {canEta ? (
                                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                      ETA
                                      <input
                                        type="date"
                                        defaultValue={toDateInput(st.eta)}
                                        disabled={savingEta === st._id}
                                        onChange={(e) => saveEta(client._id, st._id, e.target.value)}
                                        className={`bg-slate-900 border rounded px-1.5 py-0.5 text-[11px] text-white [color-scheme:dark] ${st.overdue ? 'border-rose-500/60' : !st.eta ? 'border-amber-500/50' : 'border-slate-700'}`}
                                      />
                                    </label>
                                  ) : (
                                    <span className={`text-[11px] ${st.overdue ? 'text-rose-400' : 'text-slate-500'}`}>
                                      {st.eta ? `ETA ${new Date(st.eta).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${st.overdue ? ' · overdue' : ''}` : st.status === 'done' ? '' : 'No ETA'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <p className="text-[10.5px] text-slate-500 pt-1 font-mono">
                            Last update: {client.lastUpdate?.detail || client.lastUpdate?.action || 'No activity logged yet'}
                            {client.lastUpdate?.at ? ` · ${new Date(client.lastUpdate.at).toLocaleString('en-IN')}` : ''}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real "onboard a client" flow — picks/creates the client, assigns
          services, and creates the actual ClientWorkflow via the live API.
          Refreshes the table on success. */}
      <AssignTaskModal open={!!taskFor} onClose={() => { setTaskFor(null); load(); }} defaultBrandId={taskFor || undefined} />

      {addOpen && (
        <CreateWorkflowModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); load(); }}
        />
      )}
    </div>
  );
}
