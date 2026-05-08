import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight, Plus, Video, UserPlus, Users as UsersIcon } from 'lucide-react';
import * as api from '@/api';
import { ScheduleMeetingButton } from '@/components/shared/ScheduleMeetingButton';
import { StartClientMeetingButton } from '@/components/shared/StartClientMeetingButton';

/**
 * ScheduleMeetingsSection — sits under the daily tasks block on every
 * employee's dashboard. Two jobs:
 *   1. One-click access to scheduling: "Schedule team meeting" + "Start
 *      client meeting" buttons, always present.
 *   2. Glanceable list of the user's next few meetings (next 7 days, max 6
 *      rows) so they don't have to open the calendar to remember what's
 *      coming up.
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
        setMeetings(upcoming.slice(0, 6));
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
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <Calendar className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Schedule your meetings</h3>
            <p className="text-[11px] text-muted-foreground">Team huddle, client call, or block focus time — one click.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ScheduleMeetingButton />
          <StartClientMeetingButton />
        </div>
      </div>

      {/* Upcoming list */}
      {loading ? null : meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
          <Calendar className="h-6 w-6 text-muted-foreground/40 mx-auto" />
          <p className="text-xs font-semibold mt-2">No meetings in the next 7 days</p>
          <p className="text-[11px] text-muted-foreground">Schedule a team meeting or start an instant client call from the buttons above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {days.map(day => (
            <div key={day} className="space-y-1">
              <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-1">{day}</p>
              {byDay[day].map(m => {
                const now = Date.now();
                const isLive = new Date(m.startTime).getTime() <= now && new Date(m.endTime).getTime() > now;
                return (
                  <div
                    key={m._id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors"
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${TYPE_DOT[m.type] || 'bg-blue-500'} ${isLive ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{m.title}</p>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-2.5 w-2.5" />
                        {fmtTime(m.startTime)} – {fmtTime(m.endTime)}
                        <span className="text-muted-foreground/60">·</span>
                        <span>{TYPE_LABEL[m.type] || m.type}</span>
                        {isLive && <span className="text-red-500 font-bold ml-1">LIVE</span>}
                      </p>
                    </div>
                    {m.link && (
                      <a
                        href={m.link}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 h-7 px-2 flex items-center gap-1 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 text-[11px] font-semibold"
                      >
                        <Video className="h-3 w-3" /> Join
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <Link
            to="/team/calendar"
            className="flex items-center justify-center gap-1.5 mt-1 text-[11px] text-primary hover:underline"
          >
            Open team calendar <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

export default ScheduleMeetingsSection;
