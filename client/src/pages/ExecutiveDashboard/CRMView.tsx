import React, { useEffect, useState, useMemo } from 'react';
import * as api from '@/api';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
// Reusing Robin's existing, real, tested onboarding modal and AI-brief
// button — both already wired to the live API (cwCreateWorkflow /
// aiBriefAllProjects) — instead of re-implementing them as fake buttons.
import { CreateWorkflowModal, AllProjectsBriefButton } from '@/pages/ClientPipelinePage';

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
}

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
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [awaitingOpen, setAwaitingOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Real server-backed "just mine" filter — cwListWorkflows({mine:'1'})
  // restricts to workflows the signed-in user created or is assigned a
  // service on (see clientWorkflowController.listWorkflows).
  const [focusedOnly, setFocusedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'priority'>('recent');

  const load = (mine = focusedOnly) => {
    setLoading(true);
    api.cwListWorkflows(mine ? { mine: '1' } : {})
      .then((rows: ClientRow[]) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => toast.error('Failed to load clients'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(focusedOnly); }, [focusedOnly]);

  const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const filteredClients = clients
    .filter(c =>
      (c.clientName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.clientPhone || '').includes(searchQuery)
    )
    .sort((a: any, b: any) => {
      if (sortBy === 'priority') {
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      }
      // 'recent' — server already sorts by updatedAt desc, but re-sort
      // client-side too so it stays correct after local search/filter.
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
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

  const awaitingClients = useMemo(() => clients.filter(c => c.health === 'waiting_client'), [clients]);

  const percent = clients.length
    ? Math.round((clients.filter(c => c.health === 'healthy' || c.health === 'ready_to_deliver').length / clients.length) * 100)
    : 0;
  let ringColor = '#4ade80';
  if (percent < 50) ringColor = '#ef4444';
  else if (percent <= 80) ringColor = '#f59e0b';

  const openDT = (client: ClientRow) => {
    navigate('/command-center', { state: { clientId: client._id, clientName: client.clientName } });
    toast.success(`Client "${client.clientName}" loaded into CRM context. Decision Tree unlocked.`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-6 overflow-y-auto w-full animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <i className="fa-solid fa-folder-open text-blue-500"></i> Client project pipeline
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Live overview of active agency projects, current stage, and verified audit logs.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Real Gemini-backed brief covering every active project — same
              component the old Client Pipeline page used. */}
          <AllProjectsBriefButton />
          <button onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-600/20 flex items-center gap-2">
            <i className="fa-solid fa-plus"></i> Add client
          </button>
        </div>
      </div>

      {/* Toolbar & Search Bar */}
      <div className="space-y-3">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-slate-400">
            <i className="fa-solid fa-magnifying-glass"></i>
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by phone, brand name or email — selects client instantly for Decision Tree unlocking"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition shadow-inner"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFocusedOnly(v => !v)}
              title="Show only clients you created or are assigned a service on"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition ${focusedOnly ? 'bg-blue-600 text-white' : 'bg-slate-950 border border-slate-800 text-slate-300 hover:text-white'}`}
            >
              <i className="fa-solid fa-crosshairs mr-1.5"></i> {focusedOnly ? 'Focused Pipeline · Mine' : 'Focused Pipeline'}
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300">
              <span className="text-slate-500 font-semibold uppercase text-[10px]">SORT</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'recent' | 'priority')}
                className="bg-transparent text-white font-medium focus:outline-none [&>option]:bg-slate-900 [&>option]:text-white"
              >
                <option value="recent">Recently Updated</option>
                <option value="priority">Priority · High to Low</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">{filteredClients.length} active accounts</span>
          </div>
        </div>
      </div>

      {/* Progress Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative w-16 h-16 flex items-center justify-center rounded-full bg-slate-950 border-4 shadow-inner transition-all duration-500" style={{ borderColor: ringColor + '66' }}>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">{percent}%</span>
          </div>
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">OVERALL AGENCY PROGRESS</span>
            <h3 className="text-base font-bold text-white">{metrics.onTrack} of {clients.length} accounts on track</h3>
          </div>
        </div>
      </div>

      {/* 6 Metric Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Active Projects</span>
            <i className="fa-solid fa-folder text-blue-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-white">{clients.length}</h4>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">On Track</span>
            <i className="fa-solid fa-circle-check text-emerald-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-emerald-400">{metrics.onTrack}</h4>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">At Risk</span>
            <i className="fa-solid fa-triangle-exclamation text-amber-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-amber-400">{metrics.atRisk}</h4>
        </div>

        <div onClick={() => awaitingClients.length && setAwaitingOpen(true)} className="bg-slate-900 border border-purple-500/30 hover:border-purple-500/70 cursor-pointer rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-purple-400 uppercase group-hover:underline">Awaiting Client</span>
            <i className="fa-solid fa-user-clock text-purple-400 text-xs animate-pulse"></i>
          </div>
          <div className="flex items-baseline justify-between">
            <h4 className="text-2xl font-bold text-purple-400">{metrics.awaiting}</h4>
            <span className="text-[10px] text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">View Blockers</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Delayed</span>
            <i className="fa-solid fa-clock text-rose-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-rose-400">{metrics.delayed}</h4>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Stage Moved Today</span>
            <i className="fa-solid fa-arrow-progress text-cyan-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-cyan-400">{metrics.stageMovedToday}</h4>
        </div>
      </div>

      {/* Client Table Feed */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-table-list text-blue-400"></i> Active Client Accounts & Pipeline Directory
          </h3>
          <span className="text-xs text-slate-400">Click 'Select & Unlock DT' to load into Decision Tree</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="p-3.5">Brand / Client</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Current Stage / Module</th>
                <th className="p-3.5">Deal Value</th>
                <th className="p-3.5">Last CRM Audit Log</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading clients...</td></tr>
              ) : filteredClients.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">No clients found.</td></tr>
              ) : filteredClients.map((client) => {
                const meta = HEALTH_META[client.health || ''] || { label: 'Active', badge: 'bg-slate-800 text-slate-300' };
                return (
                  <tr key={client._id} className="hover:bg-slate-850/50 transition">
                    <td className="p-3.5 font-medium text-white flex items-center gap-2">
                      <div className="w-7 h-7 rounded flex items-center justify-center font-bold text-xs bg-blue-600/20 text-blue-400">
                        {(client.clientName || '?').charAt(0).toUpperCase()}
                      </div>
                      {client.clientName}
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="p-3.5">{currentStageLabel(client)}</td>
                    <td className="p-3.5 font-semibold text-emerald-400">
                      {client.totalAmount ? `₹${client.totalAmount.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                      {client.lastUpdate?.detail || client.lastUpdate?.action || 'No activity logged yet'}
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => navigate(`/clients/pipeline/${client._id}`)}
                        title="Open full client workspace"
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition mr-2"
                      >
                        <i className="fa-solid fa-folder-open"></i>
                      </button>
                      <button onClick={() => openDT(client)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow">
                        Select & Unlock DT <i className="fa-solid fa-unlock ml-1"></i>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Awaiting Client Modal */}
      {awaitingOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-purple-500/40 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-lg">
                  <i className="fa-solid fa-user-clock"></i>
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Awaiting Client & Blockers Breakdown</h4>
                  <p className="text-xs text-slate-400">Live operational review of pending client approvals</p>
                </div>
              </div>
              <button onClick={() => setAwaitingOpen(false)} className="text-slate-400 hover:text-white p-2">
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {awaitingClients.map(c => (
                <div key={c._id} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">{c.clientName}</span>
                    <span className="text-purple-400 font-medium">{currentStageLabel(c)}</span>
                  </div>
                  <p className="text-xs text-slate-300">{c.lastUpdate?.detail || 'Waiting on client input to proceed.'}</p>
                  <span className="text-[10px] font-mono text-slate-500">
                    Last Follow-up: {c.lastUpdate?.at || c.updatedAt ? new Date(c.lastUpdate?.at || c.updatedAt!).toLocaleString() : '—'}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button onClick={() => setAwaitingOpen(false)} className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow">
                Close & Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real "onboard a client" flow — picks/creates the client, assigns
          services, and creates the actual ClientWorkflow via the live API.
          Refreshes the table on success. */}
      {addOpen && (
        <CreateWorkflowModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); load(); }}
        />
      )}
    </div>
  );
}
