import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Video, AlertCircle } from 'lucide-react';
import { differenceInMinutes, formatDistanceToNowStrict, isToday, isTomorrow, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import * as api from '@/api';

/**
 * MeetingReminderBanner — top-of-Workroom prompt for upcoming meetings.
 *
 * Two layers of prominence so the user can't miss a meeting they have
 * an active role in:
 *
 *   1. "STARTING SOON" — within next 15 min. Red gradient pulse. Has
 *      a Join button that navigates straight to the calendar / huddle.
 *   2. "TODAY" — anywhere later today. Amber tint, scannable.
 *   3. "TOMORROW" — full preview of tomorrow's slate so the user can
 *      plan ahead. Blue tint, lower visual weight.
 *
 * The banner only renders when there's at least one meeting in the
 * next 48h. Otherwise nothing — keeps the page clean on quiet days.
 *
 * Reads /api/meetings/upcoming (which combines one-off Meeting rows
 * + recurring brand meetings derived from each ClientWorkflow's
 * recurringMeeting). The meetingReminderCron fires bell notifications
 * at the same milestones; this is the visual layer.
 */

interface Upcoming {
  id?: string;
  startTime: string;
  title: string;
  kind: 'one_off' | 'recurring';
  workflowId?: string;
  clientName?: string;
}

export function MeetingReminderBanner() {
  const [rows, setRows] = useState<Upcoming[]>([]);
  const [loading, setLoading] = useState(true);

  // Refresh every 60s so "starts in 12 min" stays current without a
  // websocket. Cheap — the endpoint is fast.
  useEffect(() => {
    const load = () =>
      api.upcomingMeetings()
        .then((d: Upcoming[]) => setRows(Array.isArray(d) ? d : []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const { starting, today, tomorrow } = useMemo(() => {
    const now = new Date();
    const starting: Upcoming[] = [];
    const today:    Upcoming[] = [];
    const tomorrow: Upcoming[] = [];
    for (const m of rows) {
      const t = parseISO(m.startTime);
      const minsAway = differenceInMinutes(t, now);
      if (minsAway < -10) continue;                 // already over
      if (minsAway <= 15 && minsAway > -10)         starting.push(m);
      else if (isToday(t))                          today.push(m);
      else if (isTomorrow(t))                       tomorrow.push(m);
    }
    return { starting, today, tomorrow };
  }, [rows]);

  if (loading) return null;
  if (starting.length === 0 && today.length === 0 && tomorrow.length === 0) return null;

  return (
    <div className="space-y-2">
      {starting.length > 0 && <StartingRow rows={starting} />}
      {(today.length > 0 || tomorrow.length > 0) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {today.length > 0    && <TimeSliceRow label="Today"    rows={today}    tone="amber" />}
          {tomorrow.length > 0 && <TimeSliceRow label="Tomorrow" rows={tomorrow} tone="blue"  />}
        </div>
      )}
    </div>
  );
}

function StartingRow({ rows }: { rows: Upcoming[] }) {
  // Show the most-imminent one prominently. If there are more, list
  // the next 2 as small chips on the right.
  const next = rows[0];
  const nextTime = parseISO(next.startTime);
  return (
    <div className="relative rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-500/15 via-rose-500/10 to-amber-500/10 px-4 py-3 overflow-hidden">
      {/* Subtle pulse halo */}
      <div className="absolute inset-0 bg-rose-500/5 animate-pulse pointer-events-none" />
      <div className="relative flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-sm">
          <AlertCircle className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-rose-700">Starting soon</p>
          <p className="text-[14px] font-bold truncate text-rose-900">
            {next.title}
            {next.clientName && <span className="text-rose-700/80 font-semibold"> · {next.clientName}</span>}
          </p>
          <p className="text-[11.5px] text-rose-800 tabular-nums">
            in {formatDistanceToNowStrict(nextTime)}
            <span className="text-rose-700/60 mx-1.5">·</span>
            {nextTime.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })} IST
          </p>
        </div>
        <Link
          to={next.workflowId ? `/clients/pipeline/${next.workflowId}` : '/team/calendar'}
          className="hidden sm:inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12px] font-semibold transition-colors"
        >
          <Video className="h-3.5 w-3.5" /> Open
        </Link>
      </div>
      {rows.length > 1 && (
        <p className="relative text-[10.5px] text-rose-700/80 mt-1.5">
          + {rows.length - 1} more in the next 15 minutes
        </p>
      )}
    </div>
  );
}

function TimeSliceRow({ label, rows, tone }: { label: string; rows: Upcoming[]; tone: 'amber' | 'blue' }) {
  const toneCls = tone === 'amber'
    ? { dot: 'bg-amber-500', label: 'text-amber-700', accent: 'bg-amber-500/8' }
    : { dot: 'bg-blue-500',  label: 'text-blue-700',  accent: 'bg-blue-500/6' };
  return (
    <div className={`px-4 py-2.5 flex items-center gap-3 ${toneCls.accent}`}>
      <div className="flex items-center gap-1.5 shrink-0 min-w-[78px]">
        <span className={`h-2 w-2 rounded-full ${toneCls.dot}`} />
        <span className={`text-[10.5px] uppercase tracking-[0.14em] font-bold ${toneCls.label}`}>{label}</span>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">({rows.length})</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
        {rows.slice(0, 4).map((m, i) => {
          const when = parseISO(m.startTime);
          const time = when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
          return (
            <Link
              key={m.id || `${m.title}-${i}`}
              to={m.workflowId ? `/clients/pipeline/${m.workflowId}` : '/team/calendar'}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background border border-border text-[11.5px] hover:border-foreground/30 hover:translate-y-[-1px] transition-all"
            >
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="font-semibold truncate max-w-[180px]">{m.title}</span>
              <span className="text-muted-foreground tabular-nums">· {time}</span>
            </Link>
          );
        })}
        {rows.length > 4 && (
          <Link to="/team/calendar" className="shrink-0 text-[10.5px] text-muted-foreground hover:underline inline-flex items-center gap-0.5">
            <Calendar className="h-3 w-3" />+ {rows.length - 4} more
          </Link>
        )}
      </div>
    </div>
  );
}
