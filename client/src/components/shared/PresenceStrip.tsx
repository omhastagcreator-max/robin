import { Link } from 'react-router-dom';
import { Coffee, CalendarOff } from 'lucide-react';
import { useTeamPresence } from '@/hooks/useTeamPresence';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Tiny persistent strip that surfaces "who's on break / on leave right now"
 * across every page. Visible to internal staff. Click to jump to the
 * Work Room (where full team status lives).
 */
export function PresenceStrip() {
  const { role } = useAuth();
  const { onBreak, onLeave } = useTeamPresence();

  const internal = role === 'admin' || role === 'employee' || role === 'sales';
  if (!internal) return null;

  const breakCount = onBreak?.length || 0;
  const leaveCount = onLeave?.length || 0;
  if (breakCount === 0 && leaveCount === 0) return null;

  const breakNames = onBreak.map(m => m.name).filter(Boolean).join(', ');
  const leaveNames = onLeave?.map(m => m.name).filter(Boolean).join(', ') || '';

  return (
    <Link
      to="/workroom"
      className="block bg-card/80 backdrop-blur border-b border-border px-4 py-1.5 text-xs hover:bg-muted/30 transition-colors"
      title="Open Work Room for the full team status"
    >
      <div className="flex items-center gap-3 flex-wrap max-w-6xl mx-auto">
        {breakCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-amber-600">
            <Coffee className="h-3 w-3" />
            <span className="font-semibold">{breakCount} on break</span>
            <span className="text-muted-foreground truncate max-w-[40vw]">— {breakNames}</span>
          </span>
        )}
        {breakCount > 0 && leaveCount > 0 && (
          <span className="text-muted-foreground/40">·</span>
        )}
        {leaveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-purple-500">
            <CalendarOff className="h-3 w-3" />
            <span className="font-semibold">{leaveCount} on leave</span>
            <span className="text-muted-foreground truncate max-w-[40vw]">— {leaveNames}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground hidden sm:inline">
          please don't ping them
        </span>
      </div>
    </Link>
  );
}

export default PresenceStrip;
