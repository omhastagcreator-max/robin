import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Loader2, X, Building2,
  Edit2, Trash2, Check, Sparkles, Megaphone, FileText, Code2, Palette, BarChart3, Phone, Calendar as CalIcon,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, addDays, addWeeks, isSameDay, isToday } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { SCHEDULE_COLORS, tokensFor, type ScheduleColor } from '@/lib/scheduleColors';

/**
 * ClientSchedulePage — week-view calendar of clients you're scheduled to
 * serve. Add / edit / delete entries from the same screen.
 *
 *   Mon                Tue                Wed         …
 *   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 *   │ + Add slot  │   │ Acme Corp   │   │ + Add slot  │
 *   │             │   │ Meta · 11am │   │             │
 *   │             │   │ TechBros    │   │             │
 *   │             │   │ Content     │   │             │
 *   └─────────────┘   └─────────────┘   └─────────────┘
 *
 * On login (handled separately in AppLayout via the today endpoint), a
 * toast lists today's clients so reps don't forget what's on their plate.
 */

const TASK_TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  meta:       { label: 'Meta Ads',     icon: Megaphone,  tone: 'bg-blue-500/15    text-blue-700    border-blue-500/30'    },
  google_ads: { label: 'Google Ads',   icon: BarChart3,  tone: 'bg-pink-500/15    text-pink-700    border-pink-500/30'    },
  content:    { label: 'Content',      icon: FileText,   tone: 'bg-purple-500/15  text-purple-700  border-purple-500/30'  },
  design:     { label: 'Design',       icon: Palette,    tone: 'bg-teal-500/15    text-teal-700    border-teal-500/30'    },
  dev:        { label: 'Development',  icon: Code2,      tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  strategy:   { label: 'Strategy',     icon: Sparkles,   tone: 'bg-amber-500/15   text-amber-700   border-amber-500/30'   },
  review:     { label: 'Review',       icon: Check,      tone: 'bg-slate-500/15   text-slate-700   border-slate-500/30'   },
  meeting:    { label: 'Meeting',      icon: Phone,      tone: 'bg-orange-500/15  text-orange-700  border-orange-500/30'  },
  other:      { label: 'Other',        icon: CalIcon,    tone: 'bg-muted          text-foreground  border-border'         },
};

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', done: 'Done', skipped: 'Skipped',
};

interface Entry {
  _id: string;
  clientId: string;
  userId: string;
  serviceDate: string;
  taskType: string;
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
  notes?: string;
  color?: ScheduleColor;
  client?: { name: string; email?: string; company?: string } | null;
  assignee?: { name: string; email?: string } | null;
}

interface ClientOption { _id: string; name?: string; email: string; company?: string; }

export default function ClientSchedulePage() {
  const { user, role } = useAuth();
  const [weekAnchor, setWeekAnchor] = useState(new Date());

  const weekStart = useMemo(() => startOfWeek(weekAnchor, { weekStartsOn: 1 /* Monday */ }), [weekAnchor]);
  const weekEnd   = useMemo(() => endOfWeek  (weekAnchor, { weekStartsOn: 1 }), [weekAnchor]);
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const [entries,  setEntries]  = useState<Entry[]>([]);
  const [clients,  setClients]  = useState<ClientOption[]>([]);
  const [teammates,setTeammates]= useState<ClientOption[]>([]); // admin-only dropdown
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // Add / edit form state
  const [addOpen,   setAddOpen]   = useState<{ date: Date } | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);

  // ── Load schedule for the visible week + clients dropdown ────────────
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [scheduleRes, clientsRes] = await Promise.all([
        api.listClientSchedule({ from: weekStart.toISOString(), to: weekEnd.toISOString() }),
        api.listUsers({ role: 'client' }),
      ]);
      setEntries(Array.isArray(scheduleRes) ? scheduleRes : []);
      setClients(Array.isArray(clientsRes) ? clientsRes : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load schedule');
    } finally { setLoading(false); }
  };

  // Load teammates list once for admins (so they can assign to others).
  useEffect(() => {
    if (role !== 'admin') return;
    api.listUsers({}).then(d => {
      setTeammates(Array.isArray(d) ? d.filter((u: any) => ['employee', 'sales', 'admin'].includes(u.role)) : []);
    }).catch(() => {});
  }, [role]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [weekStart.toISOString()]);

  // ── Group entries by day for the week-view rendering ─────────────────
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = format(new Date(e.serviceDate), 'yyyy-MM-dd');
      const arr = map.get(k) || [];
      arr.push(e);
      map.set(k, arr);
    }
    return map;
  }, [entries]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" /> Client Schedule
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {role === 'admin' ? "Plan who serves which client on which day — your view shows everyone's slots."
                                : "Your week — every client you're scheduled to serve, in one place."}
            </p>
          </div>
          {/* Week navigator */}
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekAnchor(d => addWeeks(d, -1))}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="px-3 py-2 rounded-lg border border-border bg-card text-xs">
              <span className="font-semibold">{format(weekStart, 'd MMM')}</span>
              <span className="text-muted-foreground mx-1.5">→</span>
              <span className="font-semibold">{format(weekEnd, 'd MMM yyyy')}</span>
            </div>
            <button onClick={() => setWeekAnchor(d => addWeeks(d, 1))}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setWeekAnchor(new Date())}
              className="h-9 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
              Today
            </button>
          </div>
        </div>

        {/* Error / Loading */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700">{error}</div>
        )}

        {/* Week grid — 7 columns on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {days.map(day => {
            const k = format(day, 'yyyy-MM-dd');
            const dayEntries = byDay.get(k) || [];
            const todayCol = isToday(day);
            return (
              <div key={k}
                className={`rounded-2xl border bg-card overflow-hidden flex flex-col min-h-[180px] ${
                  todayCol ? 'border-primary/40 shadow-md ring-1 ring-primary/20' : 'border-border'
                }`}>
                {/* Day header */}
                <div className={`px-3 py-2 border-b border-border flex items-center justify-between ${todayCol ? 'bg-primary/5' : 'bg-muted/20'}`}>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{format(day, 'EEE')}</p>
                    <p className={`text-base font-bold tabular-nums ${todayCol ? 'text-primary' : ''}`}>{format(day, 'd MMM')}</p>
                  </div>
                  <button onClick={() => setAddOpen({ date: day })}
                    title="Add a client to this day"
                    className="h-7 w-7 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Entries */}
                <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : dayEntries.length === 0 ? (
                    <button onClick={() => setAddOpen({ date: day })}
                      className="w-full py-4 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg border border-dashed border-border transition-colors">
                      No clients yet
                    </button>
                  ) : (
                    dayEntries.map(e => {
                      const meta = TASK_TYPE_META[e.taskType] || TASK_TYPE_META.other;
                      const Icon = meta.icon;
                      // Use the entry's explicit color if set; otherwise fall
                      // back to the auto-color derived from taskType.
                      const tokens = tokensFor(e.color, e.taskType);
                      const isMine = e.userId === user?.id;
                      const canEdit = isMine || role === 'admin';
                      return (
                        <div key={e._id}
                          className={`group rounded-xl border p-2.5 ${tokens.tone} ${e.status === 'done' ? 'opacity-60' : ''}`}>
                          <div className="flex items-start gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate">{e.client?.name || 'Client'}</p>
                              {e.client?.company && (
                                <p className="text-[10px] opacity-70 flex items-center gap-1 truncate">
                                  <Building2 className="h-2.5 w-2.5 shrink-0" />{e.client.company}
                                </p>
                              )}
                              <p className="text-[10px] mt-0.5 font-semibold">{meta.label}</p>
                              {e.notes && <p className="text-[10px] opacity-80 mt-1 line-clamp-2">{e.notes}</p>}
                              {role === 'admin' && e.assignee && !isMine && (
                                <p className="text-[10px] opacity-70 mt-1 italic truncate">→ {e.assignee.name}</p>
                              )}
                              {e.status !== 'planned' && (
                                <span className="inline-block mt-1 text-[9px] uppercase tracking-wider font-bold">{STATUS_LABEL[e.status]}</span>
                              )}
                            </div>
                            {canEdit && (
                              <div className="opacity-0 group-hover:opacity-100 flex flex-col gap-1 transition-opacity">
                                <button onClick={() => setEditEntry(e)} className="h-5 w-5 rounded hover:bg-white/30 flex items-center justify-center" title="Edit">
                                  <Edit2 className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Remove this client from this day?')) return;
                                    try {
                                      await api.deleteClientScheduleEntry(e._id);
                                      toast.success('Removed');
                                      load();
                                    } catch { /* interceptor handles toast */ }
                                  }}
                                  className="h-5 w-5 rounded hover:bg-white/30 flex items-center justify-center" title="Delete">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add modal */}
        <AnimatePresence>
          {addOpen && (
            <ScheduleEntryModal
              mode="create"
              defaultDate={addOpen.date}
              clients={clients}
              teammates={teammates}
              isAdmin={role === 'admin'}
              onClose={() => setAddOpen(null)}
              onSaved={() => { setAddOpen(null); load(); }}
            />
          )}
          {editEntry && (
            <ScheduleEntryModal
              mode="edit"
              entry={editEntry}
              defaultDate={new Date(editEntry.serviceDate)}
              clients={clients}
              teammates={teammates}
              isAdmin={role === 'admin'}
              onClose={() => setEditEntry(null)}
              onSaved={() => { setEditEntry(null); load(); }}
            />
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Add / Edit modal
// ─────────────────────────────────────────────────────────────────────────
interface ModalProps {
  mode: 'create' | 'edit';
  entry?: Entry;
  defaultDate: Date;
  clients: ClientOption[];
  teammates: ClientOption[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function ScheduleEntryModal({ mode, entry, defaultDate, clients, teammates, isAdmin, onClose, onSaved }: ModalProps) {
  const [clientId, setClientId] = useState(entry?.clientId || '');
  const [date, setDate] = useState(format(defaultDate, 'yyyy-MM-dd'));
  const [taskType, setTaskType] = useState(entry?.taskType || 'other');
  const [status, setStatus] = useState<Entry['status']>(entry?.status || 'planned');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [assignToId, setAssignToId] = useState<string>(entry?.userId || '');
  const [color, setColor] = useState<ScheduleColor>(entry?.color || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) { toast.error('Pick a client'); return; }
    if (!date)     { toast.error('Pick a date');   return; }
    setBusy(true);
    try {
      if (mode === 'create') {
        await api.createClientScheduleEntry({
          clientId, serviceDate: date, taskType, notes: notes || undefined,
          ...(color ? { color } : {}),
          ...(isAdmin && assignToId ? { userId: assignToId } : {}),
        });
        toast.success('Added to schedule');
      } else if (entry) {
        await api.updateClientScheduleEntry(entry._id, {
          clientId, serviceDate: date, taskType, status, notes: notes || undefined,
          color, // send explicit (incl. '' to clear)
          ...(isAdmin && assignToId ? { userId: assignToId } : {}),
        });
        toast.success('Schedule updated');
      }
      onSaved();
    } catch (e: any) {
      // Most errors get surfaced by axios interceptor. Conflict (same client
      // already on the day) returns 409 — interceptor toasts it.
    } finally { setBusy(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{mode === 'create' ? 'Add client to schedule' : 'Edit schedule entry'}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Client picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Client</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)} required
            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">— pick a client —</option>
            {clients.map(c => (
              <option key={c._id} value={c._id}>
                {c.name || c.email}{c.company ? ` (${c.company})` : ''}
              </option>
            ))}
          </select>
          {clients.length === 0 && (
            <p className="text-[11px] text-amber-700">No clients yet — add one in Admin → Clients first.</p>
          )}
        </div>

        {/* Date */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Service date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required
            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm" />
        </div>

        {/* Task type */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">What kind of work</label>
          <select value={taskType} onChange={e => setTaskType(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
            {Object.entries(TASK_TYPE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
            placeholder="e.g. Send the Diwali campaign creatives, review last week's ROAS"
            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm resize-none" />
        </div>

        {/* Color picker — palette of 10 + an "Auto" reset that clears the
            override and lets the entry use the auto-color from taskType. */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">
            Color <span className="text-muted-foreground font-normal">(overrides the work-type tint)</span>
          </label>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Auto / clear button */}
            <button
              type="button"
              onClick={() => setColor('')}
              title="Auto — use color of the work type"
              className={`h-7 px-2.5 rounded-md text-[10px] font-semibold border transition-colors ${
                color === ''
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              Auto
            </button>
            {(Object.keys(SCHEDULE_COLORS) as Array<keyof typeof SCHEDULE_COLORS>).map(c => {
              const tok = SCHEDULE_COLORS[c];
              const active = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={tok.label}
                  className={`h-7 w-7 rounded-md border-2 flex items-center justify-center transition-transform ${
                    active ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                  }`}
                >
                  <span className={`h-4 w-4 rounded-sm ${tok.swatch}`} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Admin-only: assign to teammate */}
        {isAdmin && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Assign to <span className="text-muted-foreground font-normal">(optional — defaults to you)</span></label>
            <select value={assignToId} onChange={e => setAssignToId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
              <option value="">— me —</option>
              {teammates.map(u => (
                <option key={u._id} value={u._id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
        )}

        {/* Status (edit only) */}
        {mode === 'edit' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as any)}
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancel</button>
          <button type="submit" disabled={busy || !clientId}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {mode === 'create' ? 'Add to schedule' : 'Save changes'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
