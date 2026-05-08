import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  Calendar, Plus, Loader2, X, Clock, Users as UsersIcon, Lock, Globe,
  AlertCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { format, addDays, isToday } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * TeamCalendar — shared busy/free grid for the whole agency.
 *
 * Default visibility is "public": every teammate sees a coloured block
 * on someone's row when that person has a meeting, but only the host +
 * invitees see the title. So Sakshi can spot that Om has a 3pm slot
 * blocked, pick a different time, and not interrupt him.
 */

interface Member {
  _id: string;
  name?: string;
  email?: string;
  role?: string;
  team?: string;
}

interface Meeting {
  _id: string;
  hostUserId: string;
  title?: string;
  description?: string;
  type: 'client' | 'internal' | 'focus' | 'personal';
  startTime: string;
  endTime: string;
  attendees?: string[];
  visibility: 'public' | 'private';
  busy?: boolean;          // marker that this meeting was redacted to busy-only
  link?: string;
}

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  client:   { bg: 'bg-orange-500/30',  border: 'border-orange-500/50',  text: 'text-orange-700',  label: 'Client' },
  internal: { bg: 'bg-blue-500/30',    border: 'border-blue-500/50',    text: 'text-blue-700',    label: 'Internal' },
  focus:    { bg: 'bg-green-500/30',   border: 'border-green-500/50',   text: 'text-green-700',   label: 'Focus' },
  personal: { bg: 'bg-gray-500/30',    border: 'border-gray-500/50',    text: 'text-gray-700',    label: 'Personal' },
};

const HOUR_START = 9;
const HOUR_END   = 19;
const SLOT_MIN   = 30;
const SLOTS_PER_HOUR = 60 / SLOT_MIN;
const TOTAL_SLOTS = (HOUR_END - HOUR_START) * SLOTS_PER_HOUR;
const SLOT_WIDTH  = 36; // px

function todayKey(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

// Convert a Date → which slot index (0..TOTAL_SLOTS) inside a given IST date
function slotIndex(d: Date, dateStr: string): number {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  if (ist.getUTCFullYear() !== yy || ist.getUTCMonth() !== mm - 1 || ist.getUTCDate() !== dd) {
    // Date is outside this calendar day — clamp
    return ist.getTime() < new Date(Date.UTC(yy, mm - 1, dd)).getTime() ? 0 : TOTAL_SLOTS;
  }
  const min = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const startMin = HOUR_START * 60;
  return Math.max(0, Math.min(TOTAL_SLOTS, (min - startMin) / SLOT_MIN));
}

// Build an IST datetime ISO string from a date + slot index
function slotToIso(dateStr: string, slot: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const minOffset = HOUR_START * 60 + slot * SLOT_MIN;
  // IST midnight in UTC → add minutes → UTC date
  const istMidnightUtc = Date.UTC(y, m - 1, d, 0, 0, 0) - 330 * 60_000;
  return new Date(istMidnightUtc + minOffset * 60_000).toISOString();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

export default function TeamCalendar() {
  const { user } = useAuth();
  const socket = useSocket();
  const [date, setDate] = useState<string>(todayKey());
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleSlot, setScheduleSlot] = useState<{ userId: string; slot: number } | null>(null);

  const reload = async (forDate: string) => {
    setLoading(true);
    try {
      const [staff, day] = await Promise.all([
        api.listUsers({ role: ['admin', 'employee', 'sales'].join(',') }).catch(() => api.listUsers()),
        api.meetingsDay(forDate),
      ]);
      const internals = (Array.isArray(staff) ? staff : []).filter((u: any) =>
        ['admin', 'employee', 'sales'].includes(u.role) && u.isActive !== false
      );
      setMembers(internals);
      setMeetings(day.meetings || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(date); }, [date]);

  // Live refresh on any meeting change
  useEffect(() => {
    if (!socket) return;
    const onChange = () => reload(date);
    socket.on('meetings:changed', onChange);
    return () => { socket.off('meetings:changed', onChange); };
  }, [socket, date]);

  // Index meetings by host so we render one row per member
  const byHost = useMemo(() => {
    const m: Record<string, Meeting[]> = {};
    for (const meet of meetings) {
      // A meeting shows on the host's row AND on each attendee's row
      const ids = [meet.hostUserId, ...(meet.attendees || [])];
      for (const uid of ids) {
        if (!m[uid]) m[uid] = [];
        m[uid].push(meet);
      }
    }
    return m;
  }, [meetings]);

  // "Right now" line position
  const nowSlot = useMemo(() => {
    if (date !== todayKey()) return -1;
    return slotIndex(new Date(), date);
  }, [date]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4 page-transition-enter">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-6 w-6 text-primary" /> Team Calendar
            </h1>
            <p className="text-sm text-muted-foreground">
              See who's busy when. Click any empty slot to schedule a meeting.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDate(d => format(addDays(new Date(d), -1), 'yyyy-MM-dd'))}
              className="h-9 w-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center"
              title="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-background border border-input rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => setDate(d => format(addDays(new Date(d), 1), 'yyyy-MM-dd'))}
              className="h-9 w-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center"
              title="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {date !== todayKey() && (
              <button onClick={() => setDate(todayKey())} className="h-9 px-3 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25">
                Today
              </button>
            )}
            <button
              onClick={() => setScheduleSlot({ userId: user?.id || '', slot: Math.max(0, nowSlot >= 0 ? nowSlot : 4) })}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" /> Schedule meeting
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          {Object.entries(TYPE_COLORS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${v.bg} border ${v.border}`} />
              {v.label}
            </span>
          ))}
          <span className="ml-auto">
            {isToday(new Date(date)) ? "Today's view" : format(new Date(date), 'EEE, dd MMM yyyy')}
          </span>
        </div>

        {/* Grid */}
        {loading && meetings.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              {/* Time header */}
              <div className="flex border-b border-border bg-muted/30 sticky top-0 z-10">
                <div className="w-44 shrink-0 px-3 py-2 text-[10px] uppercase font-semibold text-muted-foreground border-r border-border">Teammate</div>
                <div className="flex relative">
                  {Array.from({ length: HOUR_END - HOUR_START }).map((_, i) => (
                    <div
                      key={i}
                      className="text-[10px] text-muted-foreground font-semibold flex items-center justify-start px-1 border-r border-border/50"
                      style={{ width: SLOT_WIDTH * SLOTS_PER_HOUR }}
                    >
                      {((HOUR_START + i) % 12) || 12}:00 {HOUR_START + i >= 12 ? 'pm' : 'am'}
                    </div>
                  ))}
                </div>
              </div>

              {/* Rows */}
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No teammates to display.</p>
              ) : members.map(m => (
                <Row
                  key={m._id}
                  member={m}
                  meetings={byHost[String(m._id)] || []}
                  date={date}
                  nowSlot={nowSlot}
                  meId={user?.id || ''}
                  onClickSlot={(slot) => setScheduleSlot({ userId: m._id, slot })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {scheduleSlot && (
        <ScheduleModal
          date={date}
          initialSlot={scheduleSlot.slot}
          inviteUserId={scheduleSlot.userId !== user?.id ? scheduleSlot.userId : undefined}
          members={members}
          onClose={() => setScheduleSlot(null)}
          onCreated={() => { setScheduleSlot(null); reload(date); }}
        />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Row({
  member, meetings, date, nowSlot, meId, onClickSlot,
}: {
  member: Member; meetings: Meeting[]; date: string;
  nowSlot: number; meId: string; onClickSlot: (slot: number) => void;
}) {
  return (
    <div className="flex items-center border-b border-border/40 hover:bg-muted/10">
      <div className="w-44 shrink-0 px-3 py-2 border-r border-border flex items-center gap-2 min-w-0">
        <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {(member.name || member.email || '?')[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{member.name || member.email}</p>
          <p className="text-[10px] text-muted-foreground capitalize truncate">{member.role}{member.team ? ` · ${member.team}` : ''}</p>
        </div>
      </div>

      <div className="relative" style={{ width: SLOT_WIDTH * TOTAL_SLOTS, height: 36 }}>
        {/* 30-min slot grid lines */}
        {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
          <button
            key={i}
            onClick={() => onClickSlot(i)}
            className={`absolute top-0 bottom-0 hover:bg-primary/10 border-r border-border/30 transition-colors ${
              i % SLOTS_PER_HOUR === SLOTS_PER_HOUR - 1 ? 'border-r-border/60' : ''
            }`}
            style={{ left: i * SLOT_WIDTH, width: SLOT_WIDTH }}
            title={`Click to schedule at ${slotLabel(i)}`}
          />
        ))}

        {/* Meeting blocks */}
        {meetings.map(m => {
          const startSlot = slotIndex(new Date(m.startTime), date);
          const endSlot   = slotIndex(new Date(m.endTime),   date);
          const left = startSlot * SLOT_WIDTH;
          const width = Math.max(SLOT_WIDTH * 0.5, (endSlot - startSlot) * SLOT_WIDTH - 2);
          const colors = TYPE_COLORS[m.type] || TYPE_COLORS.internal;
          const isMine = String(m.hostUserId) === meId || (m.attendees || []).includes(meId);
          const showFull = !m.busy && isMine;
          return (
            <div
              key={m._id}
              className={`absolute top-1 bottom-1 rounded ${colors.bg} ${colors.text} border ${colors.border} px-1.5 text-[10px] font-semibold flex items-center gap-1 overflow-hidden`}
              style={{ left, width }}
              title={`${showFull ? (m.title || 'Meeting') : 'Busy'} · ${fmtTime(m.startTime)}–${fmtTime(m.endTime)}`}
            >
              {m.visibility === 'private' && <Lock className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">{showFull ? m.title : 'Busy'}</span>
            </div>
          );
        })}

        {/* Now line */}
        {nowSlot >= 0 && nowSlot <= TOTAL_SLOTS && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/70 z-10 pointer-events-none"
            style={{ left: nowSlot * SLOT_WIDTH }}
          />
        )}
      </div>
    </div>
  );
}

function slotLabel(slot: number): string {
  const totalMin = HOUR_START * 60 + slot * SLOT_MIN;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ── Schedule modal ──────────────────────────────────────────────────────────

function ScheduleModal({
  date, initialSlot, inviteUserId, members, onClose, onCreated,
}: {
  date: string;
  initialSlot: number;
  inviteUserId?: string;
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType]   = useState<'client' | 'internal' | 'focus' | 'personal'>('internal');
  const [startSlot, setStartSlot] = useState(initialSlot);
  const [duration, setDuration] = useState(30); // min
  const [attendees, setAttendees] = useState<string[]>(inviteUserId ? [inviteUserId] : []);
  const [link, setLink] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const startIso = useMemo(() => slotToIso(date, startSlot), [date, startSlot]);
  const endIso   = useMemo(() => slotToIso(date, startSlot + duration / SLOT_MIN), [date, startSlot, duration]);

  const toggleAttendee = (uid: string) =>
    setAttendees(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);

  const submit = async () => {
    if (!title.trim()) { toast.error('Add a title'); return; }
    setSaving(true);
    try {
      const res = await api.meetingsCreate({
        title: title.trim(),
        type,
        link,
        startTime: startIso,
        endTime: endIso,
        attendees,
        visibility,
      });
      if (res?.conflicts?.length > 0) {
        const names = res.conflicts.map((id: string) => members.find(m => m._id === id)?.name || id).join(', ');
        toast(`Created — heads up: ${names} had a conflicting meeting at this time`, { icon: '⚠️', duration: 6000 });
      } else {
        toast.success('Meeting scheduled');
      }
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create meeting');
    } finally {
      setSaving(false);
    }
  };

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">Schedule meeting</h3>
            <p className="text-[11px] text-muted-foreground">{format(new Date(date), 'EEE, dd MMM yyyy')} · {slotLabel(startSlot)} → {slotLabel(startSlot + duration / SLOT_MIN)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What's the meeting about?"
          className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Start time</label>
            <select
              value={startSlot}
              onChange={e => setStartSlot(Number(e.target.value))}
              className="w-full mt-1 px-2.5 py-1.5 bg-background border border-input rounded-lg text-sm"
            >
              {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
                <option key={i} value={i}>{slotLabel(i)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Duration</label>
            <select
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="w-full mt-1 px-2.5 py-1.5 bg-background border border-input rounded-lg text-sm"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase font-semibold text-muted-foreground">Type</label>
          <div className="mt-1 flex gap-1 bg-muted/40 rounded-lg p-1">
            {(['client', 'internal', 'focus', 'personal'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 px-2 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                  type === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase font-semibold text-muted-foreground">Invite teammates</label>
          <div className="mt-1 flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 bg-muted/20 rounded-lg">
            {members.map(m => (
              <button
                key={m._id}
                type="button"
                onClick={() => toggleAttendee(m._id)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                  attendees.includes(m._id)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {m.name?.split(' ')[0] || m.email}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Meeting link (optional)</label>
            <input
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="Zoom / Meet / Robin"
              className="w-full mt-1 px-2.5 py-1.5 bg-background border border-input rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Visibility</label>
            <button
              type="button"
              onClick={() => setVisibility(v => v === 'public' ? 'private' : 'public')}
              className="w-full mt-1 px-2.5 py-1.5 bg-background border border-input rounded-lg text-xs flex items-center gap-1.5"
            >
              {visibility === 'public' ? <Globe className="h-3 w-3 text-primary" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
              <span className="capitalize">{visibility}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {visibility === 'public' ? 'Team sees busy' : 'Hidden'}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !title.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
