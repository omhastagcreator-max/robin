import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import {
  CalendarOff, CalendarPlus, Loader2, Send, X, AlertTriangle,
  CheckCircle2, Clock, XCircle, Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import * as api from '@/api';
import { toast } from 'sonner';

interface LeaveDay {
  date: string;   // ISO
  reason: string;
}

interface LeaveApp {
  _id: string;
  days: LeaveDay[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
}

const STATUS_META: Record<LeaveApp['status'], { label: string; color: string; icon: any }> = {
  pending:   { label: 'Pending review', color: 'bg-amber-500/15 text-amber-600 border-amber-500/30',  icon: Clock },
  approved:  { label: 'Approved',       color: 'bg-green-500/15 text-green-600 border-green-500/30',  icon: CheckCircle2 },
  rejected:  { label: 'Rejected',       color: 'bg-red-500/15 text-red-600 border-red-500/30',         icon: XCircle },
  cancelled: { label: 'Cancelled',      color: 'bg-muted text-muted-foreground border-border',         icon: X },
};

/**
 * Build a YYYY-MM-DD string from a Date's LOCAL components.
 *
 * Why we don't use toISOString(): that converts to UTC. A user picking
 * "May 12" in IST gets a Date whose local time is May 12 00:00 IST. As
 * UTC, that's May 11 18:30. .toISOString() returns "2026-05-11T...",
 * which then makes the server save the leave as May 11. Classic
 * off-by-one.
 *
 * By taking the local year/month/day components instead, "May 12" stays
 * May 12 regardless of the user's timezone.
 */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function LeavesPage() {
  const [selected, setSelected]   = useState<Date[]>([]);
  const [reasons,  setReasons]    = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory] = useState<LeaveApp[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.listMyLeaves();
      setHistory(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, []);

  // Sat + Sun together check (client-side mirror of server validation)
  const hasWeekendBoth = useMemo(() => {
    const dows = new Set(selected.map(d => d.getDay()));
    return dows.has(0) && dows.has(6);
  }, [selected]);

  const sortedSelected = useMemo(
    () => [...selected].sort((a, b) => a.getTime() - b.getTime()),
    [selected]
  );

  const handleSubmit = async () => {
    if (selected.length === 0) { toast.error('Pick at least one day'); return; }
    if (hasWeekendBoth)        { toast.error('Cannot apply for leave on Saturday and Sunday together'); return; }
    for (const d of selected) {
      if (!reasons[dateKey(d)]?.trim()) {
        toast.error(`Add a reason for ${format(d, 'dd MMM')}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.createLeave({
        days: sortedSelected.map(d => ({
          date: dateKey(d),                       // "2026-05-12" — timezone-safe
          reason: reasons[dateKey(d)].trim(),
        })),
      });
      toast.success('Leave application submitted — admin will review');
      setSelected([]); setReasons({});
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not submit');
    } finally { setSubmitting(false); }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this leave request?')) return;
    try { await api.cancelLeave(id); toast.success('Cancelled'); reload(); }
    catch { toast.error('Could not cancel'); }
  };

  const removeDay = (d: Date) => {
    setSelected(prev => prev.filter(x => dateKey(x) !== dateKey(d)));
    setReasons(prev => {
      const next = { ...prev };
      delete next[dateKey(d)];
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarOff className="h-6 w-6 text-primary" /> Leave Applications
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick the specific days you need off, give a reason for each, and submit.
            Your applications stay private to you and the admins.
          </p>
        </div>

        {/* Apply form */}
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Calendar */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarPlus className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Pick days (click to add / remove)</h2>
            </div>
            <DayPicker
              mode="multiple"
              selected={selected}
              onSelect={(d) => setSelected(d || [])}
              fromDate={new Date()}
              showOutsideDays
              className="rdp-robin"
            />
            <p className="text-[11px] text-muted-foreground mt-2">
              You can pick any future date. Saturday + Sunday cannot appear in the same application.
            </p>
          </div>

          {/* Reasons + submit */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm">
                Selected days {selected.length > 0 && <span className="text-muted-foreground font-normal">({selected.length})</span>}
              </h2>
            </div>

            {selected.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">
                No days picked yet — choose them on the calendar.
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {sortedSelected.map(d => {
                  const k = dateKey(d);
                  return (
                    <div key={k} className="flex items-start gap-2 p-2 rounded-xl border border-border bg-muted/20">
                      <div className="h-9 w-9 rounded-lg bg-primary/15 flex flex-col items-center justify-center text-primary shrink-0 leading-none">
                        <span className="text-[9px] uppercase font-bold">{format(d, 'MMM')}</span>
                        <span className="text-sm font-bold">{format(d, 'dd')}</span>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-xs text-muted-foreground">{format(d, 'EEEE, dd MMM yyyy')}</p>
                        <input
                          value={reasons[k] || ''}
                          onChange={e => setReasons(prev => ({ ...prev, [k]: e.target.value }))}
                          placeholder="Reason for this day…"
                          className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <button
                        onClick={() => removeDay(d)}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {hasWeekendBoth && (
              <div className="flex items-start gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-xs text-red-500">
                  Saturday and Sunday cannot appear in the same application. Remove one of them.
                </p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || selected.length === 0 || hasWeekendBoth}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit {selected.length > 0 ? `(${selected.length} day${selected.length > 1 ? 's' : ''})` : ''}
            </button>
          </div>
        </div>

        {/* History */}
        <section className="space-y-2">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" /> Your leave history
          </h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center bg-card border border-border rounded-xl">
              You haven't applied for any leave yet.
            </p>
          ) : (
            <div className="bg-card border border-border rounded-2xl divide-y divide-border/40 overflow-hidden">
              <AnimatePresence initial={false}>
                {history.map(h => {
                  const Meta = STATUS_META[h.status];
                  const Icon = Meta.icon;
                  return (
                    <motion.div
                      key={h._id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${Meta.color}`}>
                              <Icon className="h-3 w-3" /> {Meta.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              applied {format(new Date(h.createdAt), 'dd MMM yyyy, h:mm a')}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {h.days.map((d, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 text-xs">
                                <span className="font-medium">{format(new Date(d.date), 'dd MMM')}</span>
                                <span className="text-muted-foreground">· {d.reason}</span>
                              </span>
                            ))}
                          </div>
                          {h.reviewNote && (
                            <p className="text-[11px] italic text-muted-foreground">Admin note: {h.reviewNote}</p>
                          )}
                        </div>
                        {h.status === 'pending' && (
                          <button
                            onClick={() => handleCancel(h._id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                            title="Cancel"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
