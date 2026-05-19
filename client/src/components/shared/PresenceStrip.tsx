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

  // Workroom users clock in and take breaks like the rest of internal
  // staff, so they should see the same "X teammates on break" banner.
  const internal = role === 'admin' || role === 'employee' || role === 'sales' || role === 'workroom';
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
          // Color matches StatusPill's `on_break` tone — keeps the strip
          // visually consistent with every break badge elsewhere in the app.
          <span className="inline-flex items-center gap-1.5 text-amber-700">
            <Coffee className="h-3 w-3" />
            <span className="font-semibold">{breakCount} on break</span>
            <span className="text-muted-foreground truncate max-w-[40vw]">— {breakNames}</span>
          </span>
        )}
        {breakCount > 0 && leaveCount > 0 && (
          <span className="text-muted-foreground/40">·</span>
        )}
        {leaveCount > 0 && (
          // Was `text-purple-500` — drifted from StatusPill's `on_leave`
          // tone (`text-blue-700`). Aligning so the strip and the StatusPill
          // badges aren't telling the same story in two different colors.
          <span className="inline-flex items-center gap-1.5 text-blue-700">
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
