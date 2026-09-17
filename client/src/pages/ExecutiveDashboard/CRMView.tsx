import React, { useState } from 'react';

interface CRMViewProps {
  onSelectClientAndOpenDT: (clientKey: string, clientName: string) => void;
  onAlertBox: (msg: string) => void;
  onOpenAwaitingClientModal: () => void;
}

export function CRMView({ onSelectClientAndOpenDT, onAlertBox, onOpenAwaitingClientModal }: CRMViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const clients = [
    {
      key: 'woodsify',
      name: 'Woodsify D2C',
      initial: 'W',
      colorClass: 'blue',
      head: 'Om (Meta)',
      stage: 'Meta Ads: Conversion Scaling',
      revenue: '₹12,00,000',
      log: 'Pixel Status: Active & Firing (ROAS 4.1x)',
    },
    {
      key: 'prolicious',
      name: 'Prolicious Foods',
      initial: 'P',
      colorClass: 'purple',
      head: 'Priyanka (UGC)',
      stage: 'Scripting & Hook Architecture',
      revenue: '₹25,00,000',
      log: 'SKU Count: 3 | 10 UGC Videos Assigned',
    },
    {
      key: 'stoxkart',
      name: 'Stoxkart Capital',
      initial: 'S',
      colorClass: 'emerald',
      head: 'Rishi (Sales)',
      stage: 'GST-Verified Cash Gate (Won)',
      revenue: '₹1,50,000',
      log: 'Txn ID: HDFC9843 | GSTIN Verified',
    }
  ];

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Progress logic
  const percent = 87;
  let ringBorderColor = 'rgba(74, 222, 128, 0.4)';
  let ringColor = '#4ade80';
  if (percent < 50) {
    ringBorderColor = 'rgba(239, 68, 68, 0.4)'; // Red
    ringColor = '#ef4444';
  } else if (percent >= 50 && percent <= 80) {
    ringBorderColor = 'rgba(245, 158, 11, 0.4)'; // Orange
    ringColor = '#f59e0b';
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <i className="fa-solid fa-folder-open text-blue-500"></i> Client project pipeline
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Live overview of active agency projects, current stage, and verified audit logs.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => onAlertBox('Briefing all active agency projects... Summary report generated.')} className="bg-slate-900 hover:bg-slate-800 text-slate-200 px-3.5 py-2 rounded-lg text-xs font-semibold transition border border-slate-700 flex items-center gap-2">
            <i className="fa-solid fa-file-lines text-blue-400"></i> Brief all projects
          </button>
          <button onClick={() => onAlertBox('Opening Add Client modal workspace.')} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-600/20 flex items-center gap-2">
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

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow">
              <i className="fa-solid fa-crosshairs mr-1.5"></i> Focused Pipeline
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300">
              <span className="text-slate-500 font-semibold uppercase text-[10px]">SORT</span>
              <select className="bg-transparent text-white font-medium focus:outline-none [&>option]:bg-slate-900 [&>option]:text-white">
                <option>Priority · High to Low</option>
                <option>Recently Updated</option>
              </select>
            </div>
            <label className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 cursor-pointer hover:bg-slate-850">
              <input type="checkbox" className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0" />
              <span>Assigned to me</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">{filteredClients.length} active accounts</span>
          </div>
        </div>
      </div>

      {/* Progress Overview & Metrics Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div 
            className="relative w-16 h-16 flex items-center justify-center rounded-full bg-slate-950 border-4 shadow-inner transition-all duration-500" 
            style={{ borderColor: ringBorderColor, color: ringColor }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{percent}%</span>
          </div>
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">OVERALL AGENCY PROGRESS</span>
            <h3 className="text-base font-bold text-white">{Math.round((percent / 100) * 172)} of 172 steps completed</h3>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full md:w-auto border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-6 text-center">
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Active Tasks Today</p>
            <p className="text-base font-bold text-blue-400 mt-1"><i className="fa-solid fa-list-check mr-1 text-xs"></i> 8</p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Completed Today</p>
            <p className="text-base font-bold text-emerald-400 mt-1"><i className="fa-solid fa-circle-check mr-1 text-xs"></i> 14</p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Transferred Today</p>
            <p className="text-base font-bold text-purple-400 mt-1"><i className="fa-solid fa-right-left mr-1 text-xs"></i> 3</p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Total Tasks Today</p>
            <p className="text-base font-bold text-cyan-400 mt-1"><i className="fa-solid fa-layer-group mr-1 text-xs"></i> 25</p>
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
          <h4 className="text-2xl font-bold text-white">8</h4>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">On Track</span>
            <i className="fa-solid fa-circle-check text-emerald-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-emerald-400">5</h4>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">At Risk</span>
            <i className="fa-solid fa-triangle-exclamation text-amber-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-amber-400">0</h4>
        </div>
        
        {/* Interactive Awaiting Client Card */}
        <div onClick={onOpenAwaitingClientModal} className="bg-slate-900 border border-purple-500/30 hover:border-purple-500/70 cursor-pointer rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-purple-400 uppercase group-hover:underline">Awaiting Client</span>
            <i className="fa-solid fa-user-clock text-purple-400 text-xs animate-pulse"></i>
          </div>
          <div className="flex items-baseline justify-between">
            <h4 className="text-2xl font-bold text-purple-400">3</h4>
            <span className="text-[10px] text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">View Blockers</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Delayed</span>
            <i className="fa-solid fa-clock text-rose-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-rose-400">3</h4>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Stage Moved</span>
            <i className="fa-solid fa-arrow-progress text-cyan-400 text-xs"></i>
          </div>
          <h4 className="text-2xl font-bold text-cyan-400">12</h4>
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
                <th className="p-3.5">Assigned Head</th>
                <th className="p-3.5">Current Stage / Module</th>
                <th className="p-3.5">Verified Revenue</th>
                <th className="p-3.5">Last CRM Audit Log</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredClients.map((client) => {
                const colorClasses: Record<string, string> = {
                  'blue': 'bg-blue-600/20 text-blue-400',
                  'purple': 'bg-purple-600/20 text-purple-400',
                  'emerald': 'bg-emerald-600/20 text-emerald-400',
                  'cyan': 'bg-cyan-500/10 text-cyan-400'
                };
                return (
                  <tr key={client.key} className="hover:bg-slate-850/50 transition">
                    <td className="p-3.5 font-medium text-white flex items-center gap-2">
                      <div className={`w-7 h-7 rounded flex items-center justify-center font-bold text-xs ${colorClasses[client.colorClass]}`}>
                        {client.initial}
                      </div>
                      {client.name}
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded ${colorClasses[client.colorClass === 'blue' ? 'cyan' : client.colorClass]}`}>
                        {client.head}
                      </span>
                    </td>
                    <td className="p-3.5">{client.stage}</td>
                    <td className="p-3.5 font-semibold text-emerald-400">{client.revenue}</td>
                    <td className="p-3.5 text-slate-400 font-mono text-[11px]">{client.log}</td>
                    <td className="p-3.5 text-right">
                      <button 
                        onClick={() => onSelectClientAndOpenDT(client.key, client.name)} 
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
                      >
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
    </div>
  );
}
