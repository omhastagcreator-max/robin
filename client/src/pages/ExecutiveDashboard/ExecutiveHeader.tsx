import React from 'react';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/contexts/AuthContext';
import { useHuddle } from '@/contexts/HuddleContext';
import { toast } from 'sonner';

const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
};

export function ExecutiveHeader() {
  const { user } = useAuth();
  const { session, loading, startSession, startBreak, endBreak, endSession, workedMs, currentBreakMs } = useSession();
  const huddle = useHuddle();

  if (!user || loading) return <header className="h-16 bg-slate-900/95 border-b border-slate-800 z-10 shrink-0"></header>;

  const isActive = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';
  const isLogged = !!session;

  const handleToggleLogin = async () => {
    if (isLogged) {
      if (!confirm('Log out for the day?')) return;
      try { huddle.leave(); } catch {}
      try { await endSession(); toast.success("Logged out for the day."); } catch (e: any) { toast.error(e?.response?.data?.error || "Error"); }
    } else {
      try { huddle.join(); } catch {}
      try { await startSession(); toast.success("You're on the clock!"); } catch (e: any) { toast.error(e?.response?.data?.error || "Error"); }
    }
  };

  const handleToggleBreak = async () => {
    if (isOnBreak) {
      try { await endBreak(); toast.success("Back to work."); } catch (e: any) { toast.error("Error"); }
    } else {
      try { await startBreak(); toast("On break."); } catch (e: any) { toast.error("Error"); }
    }
  };

  return (
    <header className="h-16 bg-slate-900/95 border-b border-slate-800 px-6 flex items-center justify-between z-10 shrink-0 backdrop-blur">
      <div className="flex items-center gap-4">
        {isLogged ? (
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <i className="fa-solid fa-clock text-emerald-400"></i>
            <span>LOGGED IN</span>
            <span className="text-slate-400 font-normal hidden sm:inline">— Tracking active work hours.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <i className="fa-solid fa-clock text-amber-400"></i>
            <span>LOGGED OUT</span>
            <span className="text-slate-400 font-normal hidden sm:inline">— Log in to start tracking your day.</span>
          </div>
        )}

        {/* Active Time & Break Counters */}
        {isLogged && (
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 text-emerald-400 hidden md:flex">
              <i className="fa-solid fa-business-time"></i>
              <span>Active: <strong className="text-white">{formatTime(workedMs)}</strong></span>
            </div>
            <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 text-amber-400 hidden md:flex">
              <i className="fa-solid fa-mug-hot"></i>
              <span>Break: <strong className="text-white">{formatTime(currentBreakMs)}</strong></span>
            </div>
            <button 
              onClick={handleToggleBreak} 
              className={isOnBreak 
                ? "bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-amber-500 shadow-md"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-slate-700"
              }
            >
              {isOnBreak ? "Resume Work" : "Take Break"}
            </button>
          </div>
        )}
      </div>

      {/* Log In / Log Out Toggle Button */}
      <div className="flex items-center gap-3">
        <button 
          onClick={handleToggleLogin} 
          className={isLogged 
            ? "px-4 py-2 rounded-lg text-xs font-bold transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 flex items-center gap-2"
            : "px-4 py-2 rounded-lg text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 flex items-center gap-2"
          }
        >
          {isLogged ? (
            <><i className="fa-solid fa-right-from-bracket"></i> Log out</>
          ) : (
            <><i className="fa-solid fa-right-to-bracket"></i> Log in</>
          )}
        </button>
      </div>
    </header>
  );
}
