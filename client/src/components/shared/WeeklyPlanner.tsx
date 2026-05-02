import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Plus, Check, X, ChevronLeft, ChevronRight, Loader2, ListTodo, Sparkles,
} from 'lucide-react';
import {
  startOfWeek, endOfWeek, addDays, isSameDay, isToday as isTodayFn, format, addWeeks, subWeeks,
} from 'date-fns';
import * as api from '@/api';
import { toast } from 'sonner';

interface Reminder {
  _id: string;
  title: string;
  scheduledFor: string;
  notes?: string;
  status: 'pending' | 'done';
}

interface Props {
  /** Tasks the user already has — surfaced in the planner alongside reminders. */
  tasks?: Array<{ _id: string; title: string; dueDate?: string; status: string }>;
  /** Optional: lets the planner delete a task. If not provided, no × is shown
   *  on task rows (read-only). */
  onDeleteTask?: (taskId: string) => Promise<void> | void;
}

/**
 * Compact weekly planner for the dashboard right-rail.
 *
 * Shows Mon–Sun of the current week (navigable forward/back). Each day
 * lists the user's reminders + any tasks dueToday — single-click to mark
 * done, single-click to add a quick reminder for that day.
 */
export function WeeklyPlanner({ tasks = [], onDeleteTask }: Props) {
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingFor, setAddingFor] = useState<string | null>(null); // ISO date key of the day being added to
  const [draftTitle, setDraftTitle] = useState('');
  const [saving, setSaving] = useState(false);

  // Mon-Sun of the anchor week
  const weekStart = useMemo(() => startOfWeek(weekAnchor, { weekStartsOn: 1 }), [weekAnchor]);
  const weekEnd   = useMemo(() => endOfWeek(weekAnchor, { weekStartsOn: 1 }), [weekAnchor]);
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const loadReminders = async () => {
    setLoading(true);
    try {
      const data = await api.listMyReminders({
        from: weekStart.toISOString(),
        to:   weekEnd.toISOString(),
      });
      setReminders(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadReminders(); /* eslint-disable-next-line */ }, [weekStart.toISOString()]);

  const handleAdd = async (dayIso: string) => {
    if (!draftTitle.trim()) return;
    setSaving(true);
    try {
      const created = await api.createReminder({
        title: draftTitle.trim(),
        scheduledFor: dayIso,
      });
      setReminders(prev => [...prev, created].sort((a, b) =>
        new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
      ));
      setDraftTitle('');
      setAddingFor(null);
      toast.success('Reminder added');
    } catch { toast.error('Could not save'); }
    finally { setSaving(false); }
  };

  const toggleDone = async (r: Reminder) => {
    const next = r.status === 'done' ? 'pending' : 'done';
    setReminders(prev => prev.map(x => x._id === r._id ? { ...x, status: next } : x));
    try { await api.updateReminder(r._id, { status: next }); }
    catch {
      setReminders(prev => prev.map(x => x._id === r._id ? { ...x, status: r.status } : x));
      toast.error('Could not update');
    }
  };

  const handleDelete = async (id: string) => {
    setReminders(prev => prev.filter(r => r._id !== id));
    try { await api.deleteReminder(id); }
    catch {
      // Re-fetch on failure to restore truth
      loadReminders();
      toast.error('Could not delete');
    }
  };

  const itemsForDay = (day: Date) => {
    const remindersDay = reminders.filter(r => isSameDay(new Date(r.scheduledFor), day));
    const tasksDay = tasks.filter(t => t.dueDate && isSameDay(new Date(t.dueDate), day));
    return { remindersDay, tasksDay };
  };

  const isCurrentWeek = isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm flex-1">
          {isCurrentWeek ? 'This week' : format(weekStart, 'MMM d') + '–' + format(weekEnd, 'd, yyyy')}
        </h3>
        <button
          onClick={() => setWeekAnchor(d => subWeeks(d, 1))}
          className="h-6 w-6 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground"
          title="Previous week"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setWeekAnchor(new Date())}
          disabled={isCurrentWeek}
          className="px-2 h-6 rounded-md text-[10px] font-medium hover:bg-muted text-muted-foreground disabled:opacity-40"
          title="Jump to this week"
        >
          Today
        </button>
        <button
          onClick={() => setWeekAnchor(d => addWeeks(d, 1))}
          className="h-6 w-6 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground"
          title="Next week"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Days */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-1.5">
          {days.map(day => {
            const dayIso = day.toISOString();
            const { remindersDay, tasksDay } = itemsForDay(day);
            const isDayToday = isTodayFn(day);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const hasItems = remindersDay.length > 0 || tasksDay.length > 0;

            return (
              <div
                key={dayIso}
                className={`rounded-lg border ${
                  isDayToday ? 'border-primary/40 bg-primary/5' :
                  isWeekend  ? 'border-border bg-muted/20' :
                               'border-border'
                } p-2`}
              >
                {/* Day header */}
                <div className="flex items-center gap-2 mb-1">
                  <p className={`text-[10px] uppercase tracking-wide font-bold ${isDayToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {format(day, 'EEE')}
                  </p>
                  <p className={`text-xs font-semibold ${isDayToday ? 'text-primary' : ''}`}>
                    {format(day, 'd MMM')}
                  </p>
                  {isDayToday && (
                    <span className="text-[9px] uppercase tracking-wide font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                  <button
                    onClick={() => { setAddingFor(addingFor === dayIso ? null : dayIso); setDraftTitle(''); }}
                    className="ml-auto h-5 w-5 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground"
                    title="Add reminder for this day"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {/* Items */}
                {hasItems && (
                  <div className="space-y-0.5">
                    {tasksDay.map(t => (
                      <div key={'t-' + t._id} className="group flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors text-xs">
                        <ListTodo className="h-3 w-3 text-blue-500 shrink-0" />
                        <p className={`flex-1 min-w-0 truncate ${t.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>{t.title}</p>
                        {onDeleteTask && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Delete task "${t.title}"?`)) return;
                              try { await onDeleteTask(t._id); }
                              catch { /* parent surfaces toast */ }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                            title="Delete task"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {remindersDay.map(r => (
                      <div key={r._id} className="group flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted/40 text-xs">
                        <button
                          onClick={() => toggleDone(r)}
                          className="shrink-0"
                          title={r.status === 'done' ? 'Mark pending' : 'Mark done'}
                        >
                          <span className={`h-3 w-3 rounded-full border-2 flex items-center justify-center transition-colors ${
                            r.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-muted-foreground/40 hover:border-green-500'
                          }`}>
                            {r.status === 'done' && <Check className="h-2 w-2" />}
                          </span>
                        </button>
                        <p className={`flex-1 min-w-0 truncate ${r.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                          {r.title}
                        </p>
                        <button
                          onClick={() => handleDelete(r._id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                          title="Delete"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline add */}
                <AnimatePresence>
                  {addingFor === dayIso && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden mt-1"
                    >
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleAdd(dayIso); }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={e => setDraftTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') { setAddingFor(null); setDraftTitle(''); } }}
                          placeholder="e.g. Client meet at 3pm"
                          className="flex-1 px-2 py-1 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          type="submit"
                          disabled={saving || !draftTitle.trim()}
                          className="h-6 w-6 rounded-md flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-50"
                          title="Save"
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!hasItems && addingFor !== dayIso && (
                  <p className="text-[10px] text-muted-foreground/60 px-1.5 py-0.5">Nothing planned</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tip */}
      <p className="text-[10px] text-muted-foreground/70 mt-3 flex items-center gap-1">
        <Sparkles className="h-2.5 w-2.5" />
        Click the + on any day to add a reminder, check-in, or client meet
      </p>
    </div>
  );
}

export default WeeklyPlanner;
