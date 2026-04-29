import { Link } from 'react-router-dom';
import { Clock, Coffee, Pause, Play, StopCircle, AlertTriangle } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/contexts/AuthContext';

// Soft / hard limits used to cue the user when their break is running long.
// These are advisory — they don't block anything server-side.
const SINGLE_BREAK_WARN_MS  = 30 * 60 * 1000;  // 30 min warning per break
const TOTAL_BREAK_WARN_MS   = 60 * 60 * 1000;  // 1 hour cumulative warning

/**
 * Compact persistent clock widget rendered in AppLayout's sidebar.
 *
 * - Clocked out → "Not clocked in" link to dashboard
 * - Active      → live HH:MM:SS + Break / End controls
 * - On break    → live break MM:SS counter + total today + Resume.
 *                 Turns red once the soft limits trip so the user
 *                 self-regulates and doesn't lose working hours.
 */
export function SessionMiniWidget() {
  const { role } = useAuth();
  const {
    session, startBreak, endBreak, endSession,
    workedMs, currentBreakMs, totalBreakMs,
  } = useSession();

  // Only employees & sales clock in/out
  const visibleRoles = ['employee', 'sales'];
  const visible = visibleRoles.includes(role);
  if (!visible) return null;

  const fmtHMS = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtMS = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const isActive  = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';
  const breakOverLimit = currentBreakMs > SINGLE_BREAK_WARN_MS || totalBreakMs > TOTAL_BREAK_WARN_MS;

  // Not clocked in yet
  if (!session) {
    const dashHref = role === 'sales' ? '/sales' : '/dashboard';
    return (
      <Link
        to={dashHref}
        className="flex items-center gap-2 px-3 py-2 mb-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
      >
        <Clock className="h-3.5 w-3.5" />
        <span>Not clocked in</span>
      </Link>
    );
  }

  return (
    <div className={`mb-2 rounded-xl border p-2.5 transition-colors ${
      isOnBreak
        ? (breakOverLimit ? 'bg-red-500/10 border-red-500/40' : 'bg-amber-500/10 border-amber-500/30')
        : 'bg-green-500/10 border-green-500/30'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${
          isActive ? 'bg-green-500 animate-pulse' :
          breakOverLimit ? 'bg-red-500 animate-pulse' :
          'bg-amber-500'
        }`} />
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${
          isActive ? 'text-green-500' :
          breakOverLimit ? 'text-red-500' :
          'text-amber-500'
        }`}>
          {isActive ? 'On the clock' : 'On break'}
        </span>
      </div>

      {isActive && (
        <p className="text-base font-mono font-bold tabular-nums leading-none mb-2.5">{fmtHMS(workedMs)}</p>
      )}

      {isOnBreak && (
        <div className="space-y-1 mb-2.5">
          <div className="flex items-center gap-1.5">
            <Coffee className="h-3 w-3" />
            <p className={`text-base font-mono font-bold tabular-nums leading-none ${breakOverLimit ? 'text-red-500' : ''}`}>
              {fmtMS(currentBreakMs)}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            today total: <span className="font-mono">{fmtMS(totalBreakMs)}</span>
          </p>
          {breakOverLimit && (
            <p className="text-[10px] text-red-500 flex items-center gap-1 leading-tight">
              <AlertTriangle className="h-3 w-3" /> long break — finish your hours
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        {isActive ? (
          <>
            <button
              onClick={startBreak}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-lg text-[10px] font-medium hover:bg-amber-500/30 transition-colors"
              title="Take a break"
            >
              <Pause className="h-3 w-3" /> Break
            </button>
            <button
              onClick={endSession}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg text-[10px] font-medium hover:bg-red-500/30 transition-colors"
              title="End your day"
            >
              <StopCircle className="h-3 w-3" /> End
            </button>
          </>
        ) : (
          <button
            onClick={endBreak}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-green-500/20 text-green-500 border border-green-500/30 rounded-lg text-[10px] font-medium hover:bg-green-500/30 transition-colors"
            title="Resume work"
          >
            <Play className="h-3 w-3" /> Resume
          </button>
        )}
      </div>
    </div>
  );
}

export default SessionMiniWidget;
