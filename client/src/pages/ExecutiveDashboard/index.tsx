import React, { useState, useEffect, useCallback } from 'react';
import { ExecutiveSidebar } from './ExecutiveSidebar';
import { ExecutiveHeader } from './ExecutiveHeader';
import { CRMView } from './CRMView';
import { DecisionTreeView } from './DecisionTreeView';

export default function ExecutiveDashboard() {
  const [activeView, setActiveView] = useState<'crm' | 'dt'>('crm');
  const [isLogged, setIsLogged] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [breakSeconds, setBreakSeconds] = useState(0);
  
  const [isClientSelectedInCRM, setIsClientSelectedInCRM] = useState(false);
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);

  // Awaiting Client Modal
  const [isAwaitingModalOpen, setIsAwaitingModalOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isLogged) {
      interval = setInterval(() => {
        if (!isOnBreak) {
          setActiveSeconds(s => s + 1);
        } else {
          setBreakSeconds(s => s + 1);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLogged, isOnBreak]);

  const toggleLoginState = useCallback(() => {
    setIsLogged(prev => {
      const next = !prev;
      if (next) {
        setAlertMessage("Successfully logged in! Work timer started tracking active hours.");
      } else {
        setAlertMessage("Logged out successfully. Day timer paused.");
        setActiveSeconds(0);
        setBreakSeconds(0);
        setIsOnBreak(false);
      }
      return next;
    });
  }, []);

  const toggleBreakState = useCallback(() => {
    setIsOnBreak(prev => !prev);
  }, []);

  const handleSwitchView = (view: string) => {
    setActiveView(view as 'crm' | 'dt');
  };

  const handlePlaceholderClick = (name: string) => {
    setAlertMessage(`Opening module: ${name}. Loaded with live executive synchronization.`);
  };

  const handleSelectClientAndOpenDT = (clientKey: string, clientName: string) => {
    setIsClientSelectedInCRM(true);
    setSelectedClientKey(clientKey);
    setActiveView('dt');
    setAlertMessage(`Client "${clientName}" successfully loaded into CRM context. Decision Tree unlocked.`);
  };

  const handleFetchClient = (query: string) => {
    setIsClientSelectedInCRM(true);
    setSelectedClientKey('woodsify'); // Default for demo
    setActiveView('dt');
    setAlertMessage(`Client match found for "${query}". Decision Tree successfully unlocked.`);
  };

  const handleAlertBox = (msg: string) => {
    setAlertMessage(msg);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 antialiased dark">
      {/* SIDEBAR NAVIGATION */}
      <ExecutiveSidebar 
        activeView={activeView} 
        onSwitchView={handleSwitchView} 
        onPlaceholderClick={handlePlaceholderClick} 
      />

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
        {/* TOP BAR HEADER */}
        <ExecutiveHeader 
          isLogged={isLogged} 
          isOnBreak={isOnBreak} 
          activeSeconds={activeSeconds} 
          breakSeconds={breakSeconds} 
          onToggleLogin={toggleLoginState} 
          onToggleBreak={toggleBreakState} 
        />

        {/* VIEW CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          {activeView === 'crm' && (
            <CRMView 
              onSelectClientAndOpenDT={handleSelectClientAndOpenDT}
              onAlertBox={handleAlertBox}
              onOpenAwaitingClientModal={() => setIsAwaitingModalOpen(true)}
            />
          )}

          {activeView === 'dt' && (
            <DecisionTreeView 
              isClientSelected={isClientSelectedInCRM}
              selectedClientKey={selectedClientKey}
              onFetchClient={handleFetchClient}
              onReturnToCRM={() => setActiveView('crm')}
              onUpdateClient={(key) => setSelectedClientKey(key)}
              onAlertBox={handleAlertBox}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      {alertMessage && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                <i className="fa-solid fa-bell"></i>
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Robin OS Notification</h4>
                <p className="text-xs text-slate-400">System Execution Verified</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 mb-6 leading-relaxed">{alertMessage}</p>
            <div className="flex justify-end">
              <button onClick={() => setAlertMessage(null)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition">
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isAwaitingModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-purple-500/40 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-lg">
                  <i className="fa-solid fa-user-clock"></i>
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Awaiting Client Team & Blockers Breakdown</h4>
                  <p className="text-xs text-slate-400">Live operational review of pending client approvals</p>
                </div>
              </div>
              <button onClick={() => setIsAwaitingModalOpen(false)} className="text-slate-400 hover:text-white p-2">
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Woodsify D2C</span>
                  <span className="text-purple-400 font-medium">Om (Meta Services)</span>
                </div>
                <p className="text-xs text-slate-300">Waiting on client to approve billing method for Meta Pixel scaling campaign.</p>
                <span className="text-[10px] font-mono text-slate-500">Last Follow-up: 2 hours ago via WhatsApp</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Prolicious Foods</span>
                  <span className="text-purple-400 font-medium">Priyanka (UGC)</span>
                </div>
                <p className="text-xs text-slate-300">Awaiting creator product sample shipping confirmation from marketing head.</p>
                <span className="text-[10px] font-mono text-slate-500">Last Follow-up: Yesterday at 4:30 PM</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Stoxkart Capital</span>
                  <span className="text-purple-400 font-medium">Rishi (Sales)</span>
                </div>
                <p className="text-xs text-slate-300">Pending verified GSTIN document upload before closing cash collection gate.</p>
                <span className="text-[10px] font-mono text-slate-500">Last Follow-up: Today at 10:15 AM</span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button onClick={() => setIsAwaitingModalOpen(false)} className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow">
                Close & Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
