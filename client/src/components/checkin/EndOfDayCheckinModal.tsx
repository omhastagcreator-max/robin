import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Moon, CheckCircle2, RefreshCw, Circle, XCircle, Loader2, Calendar } from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type MorningTask } from '@/contexts/CheckinContext';
import { celebrate } from '@/lib/celebrate';

/**
 * EndOfDayCheckinModal — mandatory before logout.
 *
 * Done / Still on it / Carry over / Dropped per task. If NOT done a
 * one-line reason is required (red ring until filled). Optional
 * tomorrow-plan textarea pre-fills next morning's popup.
 *
 * Polished header + progress meter + meeting badges + gradient CTA.
 */
export function EndOfDayCheckinModal() {
  const { status, openKind, close, refresh } = useCheckin();
  const visible = openKind === 'evening';

  const [updates, setUpdates] = useState<Record<string, { status: string; reason: string }>>({});
  const [tomorrowPlan, setTomorrowPlan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible || !status) return;
    const seed: Record<string, { status: string; reason: string }> = {};
    for (const t of status.morning.tasks) {
      if (!t.taskId) continue;
      const def =
        t.eveningStatus ||
        (t.middayStatus === 'done' ? 'done' : 'in_progress');
      seed[t.taskId] = {
        status: def,
        reason: t.eveningReason || '',
      };
    }
    setUpdates(seed);
    setTomorrowPlan(status.evening.tomorrowPlan || '');
  }, [visible, status]);

  const tasks = useMemo(
    () => (status?.morning?.tasks || []).filter((t: MorningTask) => !!t.taskId),
    [status],
  );

  // Modal lock — block Escape + lock body scroll. Same pattern as the
  // other two check-in modals. Owner rule (June 2026): no popup is
  // removable, exit only via successful submit.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [visible]);

  const allHaveReasons = tasks.every(t => {
    const u = updates[t.taskId!];
    if (!u) return false;
    if (u.status === 'done') return true;
    return u.reason.trim().length > 0;
  });

  const counts = useMemo(() => {
    const c = { done: 0, in_progress: 0, rolled_over: 0, dropped: 0 };
    for (const t of tasks) {
      const s = updates[t.taskId!]?.status || 'in_progress';
      if (s in c) (c as any)[s] += 1;
    }
    return c;
  }, [tasks, updates]);

  const pct = tasks.length === 0
    ? 100
    : Math.round(((counts.done + counts.in_progress + counts.rolled_over + counts.dropped) / tasks.length) * 100);

  if (!visible || !status) return null;

  const submit = async () => {
    if (submitting) return;
    if (!allHaveReasons) {
      toast.error('Add a one-line reason for every task not marked Done.');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitEndCheckin({
        taskUpdates: Object.entries(updates).map(([taskId, v]) => ({
          taskId,
          status: v.status,
          reason: v.reason,
        })),
        tomorrowPlan,
      });
      await refresh();
      celebrate();
      toast.success('Day wrapped. Have a good evening!', { duration: 4000 });
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-3xl shadow-2xl w-full max-w-2xl border border-border max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-500/20 via-violet-500/15 to-rose-500/15 border-b border-border/40 overflow-hidden">
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-violet-400/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Moon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold leading-tight">Wrap the day</h2>
              <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">
                Where each task landed + why. ~20 seconds.
              </p>
            </div>
            {tasks.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold">
                {counts.done > 0 && <Pill cls="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">{counts.done} done</Pill>}
                {(counts.in_progress + counts.rolled_over) > 0 && (
                  <Pill cls="bg-blue-500/15 text-blue-700 border-blue-500/30">{counts.in_progress + counts.rolled_over} carry</Pill>
                )}
                {counts.dropped > 0 && (
                  <Pill cls="bg-rose-500/15 text-rose-700 border-rose-500/30">{counts.dropped} dropped</Pill>
                )}
              </div>
            )}
          </div>
          <div className="mt-4 relative h-1.5 rounded-full bg-indigo-100/60 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {tasks.length === 0 && (
            <div className="rounded-2xl bg-muted/30 border border-dashed border-border p-6 text-center">
              <p className="text-sm font-semibold">Nothing on your plate today.</p>
              <p className="text-[12px] text-muted-foreground mt-1">Drop a tomorrow-plan note below and you're done.</p>
            </div>
          )}

          {tasks.map(t => (
            <TaskRow
              key={t.taskId}
              task={t}
              value={updates[t.taskId!] || { status: 'in_progress', reason: '' }}
              onChange={(v) => setUpdates(p => ({ ...p, [t.taskId!]: v }))}
            />
          ))}

          <div className="pt-2">
            <label className="text-[12px] font-semibold text-muted-foreground">
              Tomorrow's plan (auto-fills your morning popup tomorrow)
            </label>
            <textarea
              value={tomorrowPlan}
              onChange={e => setTomorrowPlan(e.target.value.slice(0, 600))}
              placeholder="One line per task. Use bullets, commas or new lines."
              className="mt-1.5 w-full min-h-[72px] px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400/40 resize-y"
            />
          </div>
        </div>

        <div className="border-t border-border px-6 py-3.5 flex items-center justify-between gap-3 bg-card/80 backdrop-blur-sm">
          <p className={'text-[11.5px] ' + (allHaveReasons ? 'text-emerald-700' : 'text-rose-600')}>
            {allHaveReasons ? 'Looks good — ready to wrap.' : 'Add a reason for every task not marked Done.'}
          </p>
          <button
            onClick={submit}
            disabled={submitting || !allHaveReasons}
            className="h-9 px-4 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {submitting ? 'Saving…' : 'Wrap & log out'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({ cls, children }: { cls: string; children: any }) {
  return <span className={'h-5 px-2 rounded-full border text-[10px] inline-flex items-center font-semibold ' + cls}>{children}</span>;
}

function TaskRow({
  task, value, onChange,
}: {
  task: MorningTask;
  value: { status: string; reason: string };
  onChange: (v: { status: string; reason: string }) => void;
}) {
  const isMeeting = task.kind === 'meeting';
  const time = task.meetingAt ? new Date(task.meetingAt) : null;
  const timeStr = time ? time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = isMeeting
    ? [
        { k: 'done',         label: 'Happened',  cls: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white', Icon: CheckCircle2 },
        { k: 'in_progress',  label: 'Ran late',  cls: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',  Icon: Circle },
        { k: 'rolled_over',  label: 'Reschedule',cls: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white', Icon: RefreshCw },
        { k: 'dropped',      label: 'Cancelled', cls: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',     Icon: XCircle },
      ]
    : [
        { k: 'done',         label: 'Done',         cls: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white', Icon: CheckCircle2 },
        { k: 'in_progress',  label: 'Still on it',  cls: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',  Icon: Circle },
        { k: 'rolled_over',  label: 'Carry over',   cls: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white', Icon: RefreshCw },
        { k: 'dropped',      label: 'Dropped',      cls: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',     Icon: XCircle },
      ];
  const needsReason = value.status !== 'done';
  return (
    <div className={
      'rounded-2xl border p-3 transition-all ' +
      (isMeeting ? 'bg-indigo-500/5 border-indigo-500/25' : 'bg-background border-border hover:shadow-sm')
    }>
      <div className="flex items-center gap-2 mb-2">
        {isMeeting && <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
        <p className="text-sm font-semibold truncate">{task.title}</p>
        {isMeeting && timeStr && (
          <span className="text-[10.5px] font-bold bg-indigo-500/15 text-indigo-700 px-1.5 py-0.5 rounded">
            {timeStr}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {opts.map(o => {
          const active = value.status === o.k;
          return (
            <button
              key={o.k}
              type="button"
              onClick={() => onChange({ ...value, status: o.k })}
              className={
                'h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 transition-all ' +
                (active ? `${o.cls} scale-105 shadow-md` : 'bg-muted/60 text-muted-foreground hover:bg-muted')
              }
            >
              <o.Icon className="h-3 w-3" /> {o.label}
            </button>
          );
        })}
      </div>
      {needsReason && (
        <input
          value={value.reason}
          onChange={e => onChange({ ...value, reason: e.target.value.slice(0, 280) })}
          placeholder={isMeeting ? 'Why? (required) e.g. client moved to tomorrow' : 'Why? (required) e.g. waiting on client creatives'}
          className={
            'mt-2 w-full h-8 px-2.5 rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition-all ' +
            (value.reason.trim() ? 'bg-muted/30 border border-border' : 'bg-rose-500/10 border border-rose-500/40 focus:ring-rose-400/30')
          }
        />
      )}
    </div>
  );
}

export default EndOfDayCheckinModal;
