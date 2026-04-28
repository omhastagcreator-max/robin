import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Pause, Play, StopCircle } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Compact persistent clock widget rendered in AppLayout's sidebar.
 * Visible across every page for `employee` and `sales` roles so they
 * never lose track of their session no matter where they navigate.
 *
 * - When clocked out: shows "Start Day" CTA linked to dashboard
 * - When active:      shows live HH:MM:SS + Break/End controls
 * - When on break:    shows paused state + Resume button
 */
export function SessionMiniWidget() {
  const { role } = useAuth();
  const { session, startBreak, endBreak, endSession } = useSession();
  const [elapsed, setElapsed] = useState(0);

  // Only employees & sales clock in/out
  const visibleRoles = ['employee', 'sales'];
  const visible = visibleRoles.includes(role);

  useEffect(() => {
    if (!session || session.status === 'ended') { setElapsed(0); return; }
    const start = new Date(session.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [session]);

  if (!visible) return null;

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const isActive  = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';

  // Not clocked in yet — gentle nudge to dashboard
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
    <div className={`mb-2 rounded-xl border p-2.5 ${
      isActive  ? 'bg-green-500/10 border-green-500/30' :
                  'bg-amber-500/10 border-amber-500/30'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${isActive ? 'text-green-500' : 'text-amber-500'}`}>
          {isActive ? 'On the clock' : 'On break'}
        </span>
      </div>
      <p className="text-base font-mono font-bold tabular-nums leading-none mb-2.5">{fmt(elapsed)}</p>
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
