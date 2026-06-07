import { useEffect, useState } from 'react';
import { Calendar, Video } from 'lucide-react';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import * as api from '@/api';

/**
 * UpcomingStrip — one-row strip showing the next 3 meetings.
 *
 * Visual goal: take less vertical space than a card while still being
 * tappable. Hides itself when there's nothing on the calendar so it
 * doesn't pollute the layout for users with empty schedules.
 */

interface UpcomingRow {
  id?: string;
  startTime: string;
  title: string;
  kind: 'one_off' | 'recurring';
  clientName?: string;
}

export function UpcomingStrip() {
  const [rows, setRows] = useState<UpcomingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.upcomingMeetings()
      .then((d: any[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-2.5 flex items-center gap-3 overflow-x-auto">
      <div className="flex items-center gap-1.5 shrink-0">
        <Calendar className="h-3.5 w-3.5 text-blue-600" />
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">Next up</span>
      </div>
      <div className="flex items-center gap-3 min-w-0">
        {rows.slice(0, 3).map((m, i) => {
          const when = parseISO(m.startTime);
          const isToday = when.toDateString() === new Date().toDateString();
          return (
            <div key={m.id || `${m.title}-${i}`} className="flex items-center gap-2 min-w-0 max-w-[260px]">
              {i > 0 && <span className="text-muted-foreground/40 shrink-0">·</span>}
              <Video className="h-3 w-3 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold truncate">{m.title}</p>
                <p className="text-[10.5px] text-muted-foreground tabular-nums">
                  {isToday ? `today ${format(when, 'h:mm a')}` : format(when, 'EEE h:mm a')}
                  <span className="text-muted-foreground/60"> · </span>
                  {formatDistanceToNowStrict(when, { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
