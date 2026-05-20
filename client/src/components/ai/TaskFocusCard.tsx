import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, Circle,
  Flame, Clock, Loader2, ArrowRight,
} from 'lucide-react';
import { format, isBefore, startOfDay } from 'date-fns';
import { toast } from 'sonner';

import { AIInsight } from '@/components/ai/AIInsight';
import * as api from '@/api';
import { nextTaskStatus, type TaskStatus, TASK_STATUSES } from '@/lib/enums';

/**
 * TaskFocusCard — Robin's "what should I do RIGHT NOW?" surface.
 *
 * Lives at the top of /tasks (or anywhere else). One round-trip to
 * /api/ai-automation/focus returns the top-N tasks ranked by a pure
 * heuristic (priority × overdue × age × ongoing-nudge). NO LLM call,
 * always-fresh, no quota burn.
 *
 * UX:
 *   • Collapsed: one-line "5 tasks recommend — start with: <title>"
 *   • Expanded:  the ranked list with focusScore + reason + a one-click
 *                "Mark done" / "Cycle status" button per row
 *
 * Persistence: collapse state remembered per-user in localStorage. A user
 * who hates the card can collapse it once and never see it expanded again;
 * but the one-line nudge stays so the AI surface isn't completely gone.
 *
 * Reduces the question "what next?" to zero clicks and zero thinking —
 * the system already ranked and explained.
 */

interface FocusItem {
  _id:        string;
  title:      string;
  priority:   'low' | 'medium' | 'high' | 'urgent';
  dueDate?:   string;
  status:     'pending' | 'ongoing' | 'done';
  taskType?:  string;
  projectName?: string;
  focusScore: number;
  reason:     string;
  bucket:     'overdue' | 'today' | 'next' | 'unblock';
}

const PIN_KEY = 'robin.focus.collapsed';
const PRIORITY_TONE: Record<FocusItem['priority'], string> = {
  urgent: 'bg-rose-500/12   text-rose-700    border-rose-500/25',
  high:   'bg-orange-500/12 text-orange-700  border-orange-500/25',
  medium: 'bg-amber-500/12  text-amber-700   border-amber-500/25',
  low:    'bg-muted         text-muted-foreground border-border',
};
const BUCKET_LABEL: Record<FocusItem['bucket'], string> = {
  overdue: 'Overdue',
  today:   'Today',
  unblock: 'In progress',
  next:    'Up next',
};

export function TaskFocusCard({
  /** Called after any task status change so the parent can refetch its list. */
  onTaskChanged,
  /** Max items to show (server respects this too, hard cap 20). */
  limit = 5,
}: {
  onTaskChanged?: () => void;
  limit?: number;
}) {
  const [items, setItems]       = useState<FocusItem[]>([]);
  const [totalOpen, setTotalOpen] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
  });

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.aiFocus(limit);
      setItems(d.items);
      setTotalOpen(d.totalOpen);
    } catch { /* axios interceptor toasts */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [limit]);

  const cycle = async (t: FocusItem) => {
    if (busyId) return;
    const current = (TASK_STATUSES as readonly string[]).includes(t.status) ? t.status as TaskStatus : 'pending';
    const next = nextTaskStatus(current);
    setBusyId(t._id);
    try {
      await api.updateTask(t._id, { status: next });
      // Optimistic local update — also refresh so re-ranked list reflects reality.
      load();
      onTaskChanged?.();
      if (next === 'done') toast.success('Done ✓');
    } catch { /* interceptor */ }
    finally { setBusyId(null); }
  };

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const v = !c;
      try { localStorage.setItem(PIN_KEY, v ? '1' : '0'); } catch {}
      return v;
    });
  };

  // Hide entirely when there's no open work — no point showing an empty AI card.
  if (!loading && items.length === 0) return null;

  const top = items[0];

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/[0.04] overflow-hidden">
      {/* Always-visible header */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-primary/[0.06] transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-primary">Focus mode</span>
        <AIInsight.Badge aiUsed={false} />
        <span className="text-[11.5px] text-muted-foreground truncate">
          {loading
            ? 'Ranking your tasks…'
            : items.length === 1
              ? '1 task to do next'
              : `${items.length} of ${totalOpen} open · start with “${top?.title || ''}”`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); load(); }}
            disabled={loading}
            className="h-6 w-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center disabled:opacity-50"
            title="Re-rank"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-primary/15"
          >
            {loading && items.length === 0 ? (
              <div className="px-3 py-3 space-y-1.5">
                <div className="h-9 rounded bg-muted/30 animate-pulse" />
                <div className="h-9 rounded bg-muted/30 animate-pulse" />
                <div className="h-9 rounded bg-muted/30 animate-pulse" />
              </div>
            ) : (
              <div className="divide-y divide-primary/10">
                {items.map((t, i) => {
                  const overdue = t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date())) && t.status !== 'done';
                  return (
                    <div
                      key={t._id}
                      className="px-3 py-2 flex items-start gap-2.5 hover:bg-primary/[0.06] transition-colors group"
                    >
                      <button
                        onClick={() => cycle(t)}
                        disabled={busyId === t._id}
                        className="mt-0.5 shrink-0"
                        title="Cycle status"
                      >
                        {busyId === t._id ? (
                          <Loader2 className="h-[18px] w-[18px] animate-spin text-muted-foreground" />
                        ) : t.status === 'ongoing' ? (
                          <CheckCircle2 className="h-[18px] w-[18px] text-blue-600/60 hover:text-blue-600" />
                        ) : (
                          <Circle className="h-[18px] w-[18px] text-muted-foreground/40 hover:text-emerald-600" />
                        )}
                      </button>

                      {/* Rank badge */}
                      <span className="mt-0.5 shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-md bg-primary/15 text-primary text-[10px] font-black tabular-nums">
                        {i + 1}
                      </span>

                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold leading-snug line-clamp-1">{t.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-1.5 h-[16px] rounded border ${PRIORITY_TONE[t.priority]}`}>
                            {t.priority === 'urgent' && <Flame className="h-2 w-2 mr-0.5" />}
                            {t.priority}
                          </span>
                          <span className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground bg-muted px-1.5 h-[16px] inline-flex items-center rounded">
                            {BUCKET_LABEL[t.bucket]}
                          </span>
                          {t.dueDate && (
                            <span className={`text-[10.5px] inline-flex items-center gap-1 ${
                              overdue ? 'text-rose-600 font-semibold' : 'text-muted-foreground'
                            }`}>
                              <Clock className="h-2.5 w-2.5" />
                              {format(new Date(t.dueDate), 'MMM d')}
                            </span>
                          )}
                          {t.projectName && (
                            <span className="text-[10.5px] text-muted-foreground inline-flex items-center gap-1">
                              · {t.projectName}
                            </span>
                          )}
                        </div>
                        <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">
                          <ArrowRight className="h-2.5 w-2.5 inline-block -mt-0.5 mr-1 text-primary/70" />
                          {t.reason}
                        </p>
                      </div>

                      {/* Focus score, right-aligned */}
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className={`text-[11px] font-black tabular-nums ${
                          t.focusScore >= 70 ? 'text-rose-700'   :
                          t.focusScore >= 40 ? 'text-amber-700'  :
                                                'text-muted-foreground'
                        }`}>
                          {t.focusScore}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">focus</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
