import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CalendarDays, Building2, ArrowRight, Loader2, Check, Clock, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { tokensFor, type ScheduleColor } from '@/lib/scheduleColors';

/**
 * TodayClientsCard — dashboard widget that mirrors the login reminder.
 * Lists every client the user is scheduled to serve TODAY, with a quick
 * "Mark done" button per row and a deep-link to the full schedule page.
 *
 *   ┌── Today's clients · 3 ─────────────────── view all → ───┐
 *   │ • Acme Corp     · Meta Ads                  [Mark done]│
 *   │ • TechBros      · Content Strategy          [Mark done]│
 *   │ • MakeYourCart  · Review                          ✓ done│
 *   └──────────────────────────────────────────────────────────┘
 *
 * Hidden on days with nothing scheduled — keeps the dashboard quiet.
 * Polls every 2 minutes (visible-only) so adding a slot from another
 * tab shows up here without a manual refresh.
 */

interface TodayItem {
  _id: string;
  clientId: string;
  clientName: string;
  clientCompany?: string;
  taskType: string;
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
  notes?: string;
  color?: ScheduleColor;
  serviceDate: string;
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', done: 'Done', skipped: 'Skipped',
};

export function TodayClientsCard() {
  const [items, setItems]     = useState<TodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.todaysClientSchedule();
      setItems(Array.isArray(data) ? data : []);
    } catch { /* silent — interceptor toasts real errors */ }
    finally { setLoading(false); }
  };
  useVisiblePoll(load, 120_000);

  const markDone = async (id: string) => {
    setBusy(id);
    try {
      await api.updateClientScheduleEntry(id, { status: 'done' });
      setItems(prev => prev.map(i => i._id === id ? { ...i, status: 'done' } : i));
      toast.success('Marked done');
    } catch { /* interceptor toasts */ }
    finally { setBusy(null); }
  };

  // Hide entirely if loading hasn't finished AND we have nothing yet, so
  // the card doesn't flash on the dashboard for users with no schedule.
  if (loading && items.length === 0) return null;

  // Filter out skipped — those aren't actionable and clutter the card.
  const visible = items.filter(i => i.status !== 'skipped');
  if (visible.length === 0) return null;

  const remaining = visible.filter(i => i.status !== 'done').length;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <CalendarDays className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Today's clients
            <span className="text-muted-foreground font-normal ml-1.5">·  {remaining} of {visible.length} remaining</span>
          </p>
        </div>
        <Link to="/client-schedule"
          className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-0.5 shrink-0">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {visible.map(item => {
          const tokens = tokensFor(item.color, item.taskType);
          const done = item.status === 'done';
          return (
            <div key={item._id}
              className={`px-4 py-2.5 flex items-center gap-3 hover:bg-muted/20 transition-colors ${done ? 'opacity-60' : ''}`}>
              {/* Color swatch */}
              <span className={`h-7 w-1 rounded-full shrink-0 ${tokens.swatch}`} />
              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${done ? 'line-through' : ''}`}>{item.clientName}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${tokens.tone}`}>
                    {item.taskType.replace(/_/g, ' ')}
                  </span>
                  {item.clientCompany && (
                    <span className="flex items-center gap-1 truncate">
                      <Building2 className="h-3 w-3 shrink-0" />{item.clientCompany}
                    </span>
                  )}
                  {item.notes && <span className="truncate hidden sm:inline">· {item.notes}</span>}
                </div>
              </div>
              {/* Action */}
              {done ? (
                <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 shrink-0">
                  <Check className="h-3 w-3" /> Done
                </span>
              ) : (
                <button onClick={() => markDone(item._id)} disabled={busy === item._id}
                  className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 flex items-center gap-1 shrink-0">
                  {busy === item._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Mark done
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Encouraging footer when everything's done */}
      {remaining === 0 && (
        <div className="px-4 py-2 bg-emerald-500/5 border-t border-emerald-500/20 text-[11px] text-emerald-700 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> All today's clients handled — nice work.
        </div>
      )}
    </motion.div>
  );
}

export default TodayClientsCard;
