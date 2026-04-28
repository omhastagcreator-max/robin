import { useEffect, useState } from 'react';
import { Clock, Play, Pause, StopCircle } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { toast } from 'sonner';

interface Props {
  /**
   * If true, the user must satisfy `dayLockReason` before clocking in.
   * Used by EmployeeDashboard which requires planning ≥ 3 tasks first.
   */
  dayLocked?: boolean;
  dayLockReason?: string;
  /** Optional callback when the user attempts to start while locked */
  onLockedAttempt?: () => void;
}

/**
 * Shared clock-in / break / end-day card.
 * Used by employees and sales reps; visible across role dashboards
 * so anyone with a session can manage it from the same UI.
 */
export function SessionClockCard({ dayLocked = false, dayLockReason, onLockedAttempt }: Props) {
  const { session, loading, startSession, startBreak, endBreak, endSession } = useSession();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!session || session.status === 'ended') { setElapsed(0); return; }
    const start = new Date(session.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [session]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleStart = async () => {
    if (dayLocked) {
      onLockedAttempt?.();
      toast.error(dayLockReason || 'Add at least 3 tasks for today before starting your day');
      return;
    }
    try { await startSession(); }
    catch { toast.error('Failed to start session'); }
  };

  const isActive  = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${
      isActive  ? 'border-green-500/30 bg-green-500/5' :
      isOnBreak ? 'border-amber-500/30 bg-amber-500/5' :
                  'border-border bg-card'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
          isActive  ? 'bg-green-500/20' :
          isOnBreak ? 'bg-amber-500/20' :
                      'bg-muted'
        }`}>
          <Clock className={`h-5 w-5 ${
            isActive  ? 'text-green-400' :
            isOnBreak ? 'text-amber-400' :
                        'text-muted-foreground'
          }`} />
        </div>
        <div>
          <p className="font-semibold text-sm">
            {isActive  ? 'Work session active' :
             isOnBreak ? 'On break' :
                         'Not clocked in'}
          </p>
          {session
            ? <p className="text-2xl font-mono font-bold tabular-nums">{fmt(elapsed)}</p>
            : <p className="text-xs text-muted-foreground">Start your day to begin tracking time</p>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {!session && (
          <button
            onClick={handleStart}
            disabled={dayLocked || loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="h-3.5 w-3.5" /> Start Day
          </button>
        )}
        {isActive && (
          <>
            <button onClick={startBreak}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl text-xs font-medium hover:bg-amber-500/25">
              <Pause className="h-3.5 w-3.5" /> Take Break
            </button>
            <button onClick={endSession}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl text-xs font-medium hover:bg-red-500/25">
              <StopCircle className="h-3.5 w-3.5" /> End Day
            </button>
          </>
        )}
        {isOnBreak && (
          <button onClick={endBreak}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl text-xs font-medium hover:bg-green-500/25">
            <Play className="h-3.5 w-3.5" /> Resume
          </button>
        )}
      </div>
    </div>
  );
}

export default SessionClockCard;
