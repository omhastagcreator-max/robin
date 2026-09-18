import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export function DecisionTreeView() {
  const navigate = useNavigate();
  const [isClientSelected, setIsClientSelected] = useState(false);
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [fetchQuery, setFetchQuery] = useState('');
  const [logs, setLogs] = useState<string[]>([
    '[02:18 AM] SYSTEM INIT: Robin OS Decision Tree router loaded successfully.',
    '[02:19 AM] STAGE UPDATE: Woodsify transitioned to Meta Ads Management Module. Owner: Om.',
    '[02:20 AM] AUDIT LOG: Pixel check verified. Daily budget set to ₹50,000. Ready for deployment.'
  ]);

  const onFetchClient = (query: string) => {
    // Dummy fetch logic
    const k = query.toLowerCase().includes('wood') ? 'woodsify' : query.toLowerCase().includes('pro') ? 'prolicious' : 'stoxkart';
    setSelectedClientKey(k);
    setIsClientSelected(true);
    toast.success("Client data fetched and DT unlocked.");
  };

  const onReturnToCRM = () => {
    navigate('/clients/pipeline');
  };

  const onUpdateClient = (key: string) => {
    setSelectedClientKey(key);
  };

  const onAlertBox = (msg: string) => {
    toast(msg);
  };

  if (!isClientSelected) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 animate-in fade-in duration-300">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center text-2xl mx-auto shadow-inner">
            <i className="fa-solid fa-lock"></i>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Input and fetch client details from CRM first</h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Decision Tree (DT) workflows require a verified active client context to enforce mandatory stage gates and compliance rules.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-slate-400">
                <i className="fa-solid fa-magnifying-glass"></i>
              </span>
              <input 
                type="text" 
                value={fetchQuery}
                onChange={(e) => setFetchQuery(e.target.value)}
                placeholder="Enter registered brand name or mobile number (e.g. Woodsify)..." 
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => {
                  if (!fetchQuery.trim()) onAlertBox("Please enter a valid brand name or mobile number to fetch from CRM.");
                  else onFetchClient(fetchQuery);
                }} 
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-semibold transition shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-bolt"></i> Fetch & Unlock DT
              </button>
              <button onClick={onReturnToCRM} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-xs font-semibold transition border border-slate-700">
                Return to CRM
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Configuration for the selected client
  let deptBadge = '';
  let taskTitle = '';
  let taskDesc = '';
  let taskId = '';
  let stages: any[] = [];
  let dynamicInputs = null;

  if (selectedClientKey === 'woodsify') {
    deptBadge = 'Om: Website & Meta Services';
    taskTitle = 'Current Rule: Verify Meta Pixel & Ad Scaling Goals';
    taskDesc = 'System enforcement requires verifying that Facebook pixel and conversion events are firing properly before launching sales conversion campaigns.';
    taskId = 'TASK #META-03';
    stages = [
      { name: '1. Kickoff & Scope Agreement', status: 'completed' },
      { name: '2. Shopify Store Build & Variant Upload', status: 'completed' },
      { name: '3. Meta Ads Management Module', status: 'active', sub: ['Step 1: Business Manager Check', 'Step 2: Tracking Pixel Audit', 'Step 3: Conversion Campaign Launch'] },
      { name: '4. Weekly Milestone Check-in', status: 'pending' }
    ];
    dynamicInputs = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Daily Ad Budget Limit (INR)*</label>
          <input type="text" defaultValue="₹50,000 / day" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Target CPA Threshold (INR)*</label>
          <input type="text" defaultValue="₹450.00 Max" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    );
  } else if (selectedClientKey === 'prolicious') {
    deptBadge = 'Priyanka: UGC & Influencer';
    taskTitle = 'Current Rule: Scripting & Hook Architecture (SKU <= 2 Rule)';
    taskDesc = 'Mandatory structure: Hook (3-4 secs with Meta AI-compliant keywords + verified reference URL) → Body (Offer/USP) → CTA (Last 4 secs).';
    taskId = 'TASK #UGC-02';
    stages = [
      { name: '1. Brand Intelligence & COGS Analysis', status: 'completed' },
      { name: '2. Scripting & Hook Architecture', status: 'active', sub: ['Step 1: SKU Scoping Count', 'Step 2: Hook Copywriting', 'Step 3: Writer Assignment (Amit)'] },
      { name: '3. Creator Sourcing & Database Selection', status: 'pending' },
      { name: '4. TAT & Final Hand-off Review', status: 'pending' }
    ];
    dynamicInputs = (
      <div className="grid grid-cols-1 mb-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Script Draft URL*</label>
          <input type="text" placeholder="https://docs.google.com/..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    );
  } else {
    deptBadge = 'Rishi: Sales Department';
    taskTitle = 'Current Rule: GST-Verified Cash Collection Gate';
    taskDesc = 'Hard block on Closed (Won) status unless rep inputs verified GSTIN, exact amount received, transaction ID, and timestamp.';
    taskId = 'TASK #SALES-08';
    stages = [
      { name: '1. New Lead Qualification (15-min timer)', status: 'completed' },
      { name: '2. Demo Done & Proposal Dispatch', status: 'completed' },
      { name: '3. GST-Verified Cash Collection Gate', status: 'active', sub: ['Step 1: Input Transaction ID', 'Step 2: Verify GSTIN Database', 'Step 3: Mark Closed (Won)'] }
    ];
    dynamicInputs = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Transaction ID*</label>
          <input type="text" placeholder="e.g. HDFC123456" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">GSTIN Number*</label>
          <input type="text" placeholder="27XXXXX..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    );
  }

  const handleCopyWhatsApp = () => {
    const text = "Hi [Client Name], update from Hashtag Creator desk: Your current milestone has been successfully verified and executed as per Robin OS standards. Let's scale!";
    navigator.clipboard.writeText(text);
    onAlertBox("Client WhatsApp update template copied to clipboard successfully!");
  };

  const handleExecuteTask = () => {
    const now = new Date().toLocaleTimeString();
    const clientName = selectedClientKey === 'woodsify' ? 'Woodsify' : selectedClientKey === 'prolicious' ? 'Prolicious' : 'Stoxkart';
    setLogs([`[${now}] CRM AUDIT LOG: Task executed for ${clientName}. Stage pointer advanced. Immutable audit record appended.`, ...logs]);
    onAlertBox("Task successfully marked complete! The automated CRM log has been updated and synchronized across all departmental views.");
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 min-h-0 overflow-hidden animate-in fade-in duration-300">
      {/* Top Sub-Bar for Client Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase font-semibold">Active Client Workspace:</span>
          <select 
            value={selectedClientKey || 'woodsify'} 
            onChange={(e) => onUpdateClient(e.target.value)} 
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-blue-500 [&>option]:bg-slate-900 [&>option]:text-white"
          >
            <option value="woodsify">Woodsify D2C (Department: Om - Website & Meta Services)</option>
            <option value="prolicious">Prolicious Foods (Department: Priyanka - UGC & Influencer)</option>
            <option value="stoxkart">Stoxkart Capital (Department: Rishi - Sales Pipeline)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <i className="fa-solid fa-shield-halved mr-1"></i> System-Enforced Decision Tree Active
          </span>
        </div>
      </div>

      {/* Main Split Workspace Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">
        
        {/* LEFT PANEL: Stage Pointers & Sub-Stages */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Decision Tree Stage Pointers</h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold">{deptBadge}</span>
          </div>

          <div className="space-y-2">
            {stages.map((st, i) => {
              const isActive = st.status === 'active';
              const isCompleted = st.status === 'completed';
              
              let baseClass = 'p-3 rounded-lg border text-xs transition ';
              if (isActive && selectedClientKey === 'woodsify') baseClass += 'bg-blue-600/10 border-blue-500/40 text-white font-semibold';
              else if (isActive && selectedClientKey === 'prolicious') baseClass += 'bg-purple-600/10 border-purple-500/40 text-white font-semibold';
              else if (isActive && selectedClientKey === 'stoxkart') baseClass += 'bg-emerald-600/10 border-emerald-500/40 text-white font-semibold';
              else if (isCompleted) baseClass += 'bg-slate-950 border-slate-800 text-slate-300';
              else baseClass += 'bg-slate-950/40 border-slate-850 text-slate-500';

              let iconColorClass = 'text-slate-600';
              if (isActive && selectedClientKey === 'woodsify') iconColorClass = 'text-blue-400';
              if (isActive && selectedClientKey === 'prolicious') iconColorClass = 'text-purple-400';
              if (isActive && selectedClientKey === 'stoxkart') iconColorClass = 'text-emerald-400';

              return (
                <div key={i} className={baseClass}>
                  <div className="flex items-center justify-between">
                    <span>{st.name}</span>
                    <span>
                      {isCompleted ? <i className="fa-solid fa-check text-emerald-400"></i> : 
                       isActive ? <i className={`fa-solid fa-spinner fa-spin ${iconColorClass}`}></i> : 
                       <i className="fa-solid fa-lock text-slate-600"></i>}
                    </span>
                  </div>
                  {isActive && st.sub && (
                    <div className={`mt-2 pl-3 border-l-2 space-y-1 text-[11px] text-slate-300 ${selectedClientKey === 'woodsify' ? 'border-blue-500' : selectedClientKey === 'prolicious' ? 'border-purple-500' : 'border-emerald-500'}`}>
                      {st.sub.map((sub: string, sIdx: number) => (
                        <div key={sIdx} className={
                          (selectedClientKey === 'woodsify' && sIdx === 2) ? 'text-blue-400 font-bold' :
                          (selectedClientKey === 'prolicious' && sIdx === 0) ? 'text-purple-400 font-bold' : ''
                        }>
                          • {sub}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: Task Execution Card & Live CRM Log */}
        <div className="lg:col-span-8 flex flex-col space-y-4 min-h-0 overflow-hidden">
          
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between shrink-0 shadow-sm">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">{taskTitle}</h3>
                </div>
                <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">{taskId}</span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-4">{taskDesc}</p>

              {/* Interactive Execution Input Fields */}
              {dynamicInputs}

              {/* Status Selectors & WhatsApp Copy Helper */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 font-medium">Task Status:</span>
                  <select className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-semibold focus:outline-none [&>option]:bg-slate-900 [&>option]:text-white">
                    <option>In Progress (Active Gate)</option>
                    <option>Ready to Verify & Complete</option>
                    <option>Blocked / Pending Client</option>
                  </select>
                </div>

                <button onClick={handleCopyWhatsApp} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-slate-700 flex items-center gap-2">
                  <i className="fa-brands fa-whatsapp text-emerald-400"></i> Copy Client WhatsApp Update
                </button>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => onAlertBox('Task saved as draft successfully.')} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-xs font-semibold transition">
                Save Draft
              </button>
              <button onClick={handleExecuteTask} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-xs font-semibold transition shadow-lg shadow-blue-600/20 flex items-center gap-2">
                <i className="fa-solid fa-check-circle"></i> Complete Task & Auto-Log to CRM
              </button>
            </div>
          </div>

          {/* Live Automated CRM Log Generator (Bottom Section) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col min-h-0 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <i className="fa-solid fa-terminal text-emerald-400"></i> Live Automated CRM Feed & Audit Trail
              </h4>
              <span className="text-[10px] text-slate-500">Immutable Audit Log Active</span>
            </div>
            <div className="bg-slate-950 rounded-lg p-3 font-mono text-[11px] text-slate-300 overflow-y-auto space-y-2 flex-1 border border-slate-800/80">
              {logs.map((log, i) => (
                <div key={i} className={i === 0 && log.includes('CRM AUDIT LOG') ? 'text-emerald-400 animate-pulse' : 
                   log.includes('SYSTEM INIT') ? 'text-emerald-400' :
                   log.includes('STAGE UPDATE') ? 'text-blue-400' : 'text-slate-300'
                }>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
