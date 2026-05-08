import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight, Plus, Video, UserPlus, Users as UsersIcon } from 'lucide-react';
import * as api from '@/api';
import { ScheduleMeetingButton } from '@/components/shared/ScheduleMeetingButton';
import { StartClientMeetingButton } from '@/components/shared/StartClientMeetingButton';

/**
 * ScheduleMeetingsSection — sits in the right rail BESIDE the daily tasks
 * block. Designed for a narrow column (~1/3 width). Two jobs:
 *   1. One-click access to scheduling: "Schedule team meeting" + "Start
 *      client meeting" buttons, stacked.
 *   2. Glanceable list of the user's next few meetings (next 7 days, max 5
 *      rows). Most teams have a handful of meetings on the horizon — this
 *      is the "what's next" glance, not a full calendar.
 */

interface Meeting {
  _id: string;
  title: string;
  type: 'client' | 'internal' | 'focus' | 'personal';
  startTime: string;
  endTime: string;
  link?: string;
  hostUserId?: string;
}

const TYPE_DOT: Record<string, string> = {
  client:   'bg-orange-500',
  internal: 'bg-blue-500',
  focus:    'bg-green-500',
  personal: 'bg-gray-500',
};

const TYPE_LABEL: Record<string, string> = {
  client:   'Client',
  internal: 'Team',
  focus:    'Focus',
  personal: 'Personal',
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const fmtDayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);
  if (d.toDateString() === today.toDateString())    return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};

export function ScheduleMeetingsSection() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const from = new Date(); from.setHours(0, 0, 0, 0);
        const to   = new Date(from.getTime() + 7 * 24 * 3600_000);
        const data = await api.meetingsMine({ from: from.toISOString(), to: to.toISOString() });
        const upcoming = (Array.isArray(data) ? data : [])
          .filter((m: Meeting) => new Date(m.endTime).getTime() > Date.now())
          .sort((a: Meeting, b: Meeting) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        setMeetings(upcoming.slice(0, 5));
      } finally { setLoading(false); }
    };
    load();
    const i = setInterval(load, 30_000);
    // Components elsewhere can fire 'meetings:changed' to force a refresh
    const onChange = () => load();
    window.addEventListener('meetings:changed', onChange);
    return () => { clearInterval(i); window.removeEventListener('meetings:changed', onChange); };
  }, []);

  // Group meetings by day for cleaner visual scanning
  const byDay: Record<string, Meeting[]> = {};
  meetings.forEach(m => {
    const key = fmtDayLabel(m.startTime);
    (byDay[key] ||= []).push(m);
  });
  const days = Object.keys(byDay);

  return (
    <div className="bg-card border border-border rounded-2xl p-3 space-y-3">
      {/* Header — title + subtitle */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Calendar className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm leading-tight">Meetings</h3>
          <p className="text-[10px] text-muted-foreground leading-tight">Schedule, join, share</p>
        </div>
      </div>

      {/* Quick-create buttons — stacked so they fit in the narrow rail.
          We force the inner buttons to fill width via the [&>*>button] selector. */}
      <div className="grid grid-cols-1 gap-1.5 [&>*>button]:!w-full [&>*>button]:!justify-center">
        <ScheduleMeetingButton />
        <StartClientMeetingButton />
      </div>

      {/* Upcoming list */}
      {loading ? null : meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center">
          <Calendar className="h-5 w-5 text-muted-foreground/40 mx-auto" />
          <p className="text-[11px] font-semibold mt-1.5">No upcoming meetings</p>
          <p className="text-[10px] text-muted-foreground">Use the buttons above to schedule one.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-0.5">Up next</p>
          {days.map(day => (
            <div key={day} className="space-y-1">
              <p className="text-[9px] uppercase font-semibold tracking-wide text-muted-foreground/70 px-0.5">{day}</p>
              {byDay[day].map(m => {
                const now = Date.now();
                const isLive = new Date(m.startTime).getTime() <= now && new Date(m.endTime).getTime() > now;
                return (
                  <div
                    key={m._id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${TYPE_DOT[m.type] || 'bg-blue-500'} ${isLive ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold truncate leading-tight">{m.title}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {fmtTime(m.startTime)} · {TYPE_LABEL[m.type] || m.type}
                        {isLive && <span className="text-red-500 font-bold ml-1">LIVE</span>}
                      </p>
                    </div>
                    {m.link && (
                      <a
                        href={m.link}
                        target="_blank"
                        rel="noreferrer"
                        title="Open meeting link"
                        className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md bg-primary/15 text-primary hover:bg-primary/25"
                      >
                        <Video className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <Link
            to="/team/calendar"
            className="flex items-center justify-center gap-1 text-[10px] text-primary hover:underline pt-0.5"
          >
            Full calendar <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

export default ScheduleMeetingsSection;
