import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight } from 'lucide-react';
import * as api from '@/api';

/**
 * TodayMeetingsStrip — small dashboard widget showing the user's
 * meetings for today. Click to jump to the team calendar.
 *
 * Hidden if user has no meetings — keeps the dashboard clean.
 */

interface Meeting {
  _id: string;
  title: string;
  type: string;
  startTime: string;
  endTime: string;
  link?: string;
}

const TYPE_DOT: Record<string, string> = {
  client:   'bg-orange-500',
  internal: 'bg-blue-500',
  focus:    'bg-green-500',
  personal: 'bg-gray-500',
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function todayBounds() {
  const ist = new Date(Date.now() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - 330 * 60_000);
  const end   = new Date(start.getTime() + 24 * 3600_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function TodayMeetingsStrip() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.meetingsMine(todayBounds());
        const upcoming = (Array.isArray(data) ? data : []).filter((m: Meeting) => new Date(m.endTime).getTime() > Date.now());
        setMeetings(upcoming.slice(0, 5));
      } finally { setLoading(false); }
    };
    load();
    // Visible-only — skip ticks when tab is hidden so backgrounded tabs
    // don't burn CPU / API quota for a list nobody can see.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load();
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return null;
  if (meetings.length === 0) return null; // hide entirely when nothing scheduled

  // Find the next meeting (earliest start in the future or in progress)
  const now = Date.now();
  const inProgress = meetings.find(m => new Date(m.startTime).getTime() <= now && new Date(m.endTime).getTime() > now);
  const next = inProgress || meetings[0];
  const minsUntil = Math.round((new Date(next.startTime).getTime() - now) / 60000);
  const isLive = !!inProgress;

  return (
    <Link
      to="/team/calendar"
      className="block rounded-2xl border border-border bg-card p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${isLive ? 'bg-red-500/15' : 'bg-primary/15'}`}>
          {isLive
            ? <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            : <Calendar className="h-4 w-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
            {isLive ? 'Happening now' : minsUntil <= 60 ? `Starts in ${Math.max(0, minsUntil)} min` : 'Next meeting'}
          </p>
          <p className="text-sm font-semibold truncate flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${TYPE_DOT[next.type] || 'bg-blue-500'}`} />
            {next.title}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fmtTime(next.startTime)} – {fmtTime(next.endTime)}
            {meetings.length > 1 && <span> · {meetings.length - 1} more today</span>}
          </p>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </Link>
  );
}

export default TodayMeetingsStrip;
