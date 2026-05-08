import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Loader2, X, Lock, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * ScheduleMeetingButton — drop-anywhere CTA that opens a quick "schedule
 * a meeting" modal. Same model + endpoint as the TeamCalendar page;
 * we extract it here so any dashboard can host the entry point without
 * navigating away.
 *
 * Default values prioritise speed: today + next half-hour boundary,
 * 30 min duration, type internal, public visibility.
 */

const HOUR_START = 9;
const HOUR_END   = 19;
const SLOT_MIN   = 30;
const SLOTS_PER_HOUR = 60 / SLOT_MIN;
const TOTAL_SLOTS = (HOUR_END - HOUR_START) * SLOTS_PER_HOUR;

interface Member { _id: string; name?: string; email?: string; role?: string; team?: string; }

function todayKey(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

function nextSlotIndex(): number {
  const ist = new Date(Date.now() + 330 * 60_000);
  const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const baseStartMin = HOUR_START * 60;
  const slot = Math.ceil((minOfDay - baseStartMin) / SLOT_MIN);
  return Math.max(0, Math.min(TOTAL_SLOTS - 1, slot));
}

function slotToIso(dateStr: string, slot: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const minOffset = HOUR_START * 60 + slot * SLOT_MIN;
  const istMidnightUtc = Date.UTC(y, m - 1, d, 0, 0, 0) - 330 * 60_000;
  return new Date(istMidnightUtc + minOffset * 60_000).toISOString();
}

function slotLabel(slot: number): string {
  const totalMin = HOUR_START * 60 + slot * SLOT_MIN;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function ScheduleMeetingButton({ compact }: { compact?: boolean } = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-xs font-semibold transition-colors ${
          compact ? 'h-9 w-9 justify-center' : 'h-9 px-3'
        }`}
        title="Schedule a team meeting"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        {!compact && <span>Schedule meeting</span>}
      </button>
      {open && <ScheduleModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [title, setTitle] = useState('');
  const [date, setDate]   = useState<string>(todayKey());
  const [type, setType]   = useState<'client' | 'internal' | 'focus' | 'personal'>('internal');
  const [startSlot, setStartSlot] = useState<number>(nextSlotIndex());
  const [duration, setDuration]   = useState<number>(30);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [link, setLink]           = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    api.listUsers()
      .then((data: any) => {
        const internals = (Array.isArray(data) ? data : []).filter((u: any) =>
          ['admin', 'employee', 'sales'].includes(u.role) && u.isActive !== false
        );
        setMembers(internals);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingMembers(false));
  }, []);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        endTime:   endIso,
        attendees,
        visibility,
      });
      if (res?.conflicts?.length > 0) {
        const names = res.conflicts.map((id: string) => members.find(m => m._id === id)?.name || id).join(', ');
        toast(`Created — heads up: ${names} had a conflict at this time`, { icon: '⚠️', duration: 6000 });
      } else {
        toast.success('Meeting scheduled');
      }
      // Tell any dashboard widgets to refresh themselves immediately
      window.dispatchEvent(new Event('meetings:changed'));
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create meeting');
    } finally {
      setSaving(false);
    }
  };

  // Render via portal at document.body so the modal escapes the
  // sidebar's stacking context and covers the whole viewport.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <CalendarPlus className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">Schedule a meeting</h3>
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

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              min={todayKey()}
              onChange={e => setDate(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Start</label>
            <select
              value={startSlot}
              onChange={e => setStartSlot(Number(e.target.value))}
              className="w-full mt-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs"
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
              className="w-full mt-1 px-2 py-1.5 bg-background border border-input rounded-lg text-xs"
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

        {!loadingMembers && members.length > 0 && (
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Invite teammates (optional)</label>
            <div className="mt-1 flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-muted/20 rounded-lg">
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
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Link (optional)</label>
            <input
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="Zoom / Meet"
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
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
            Schedule
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ScheduleMeetingButton;
