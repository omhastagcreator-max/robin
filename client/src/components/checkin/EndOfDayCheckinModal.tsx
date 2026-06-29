import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Moon, CheckCircle2, RefreshCw, Circle, XCircle, Loader2 } from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type MorningTask } from '@/contexts/CheckinContext';
import { celebrate } from '@/lib/celebrate';

/**
 * EndOfDayCheckinModal — mandatory before logout.
 *
 * For every morning task: pick Done / Still in progress / Rolled over /
 * Dropped. If it's NOT Done, a one-line reason is required — that's the
 * "why" the owner explicitly asked for. (Done = no reason needed.)
 *
 * One additional field: tomorrow's plan (optional, pre-fills tomorrow's
 * morning popup so recurring items don't need re-typing).
 *
 * Modal is non-dismissible — only close = submit success. The orchestrator
 * also gates logout on its completion.
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
      // Smart default: if midday said done, evening = done. Else
      // in_progress so the user only has to flip the changed ones.
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
    <div className="fixed inset-0 z-[150] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-2xl border border-border max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 pt-5 pb-4 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-rose-500/15 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
              <Moon className="h-5 w-5 text-indigo-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base sm:text-lg font-bold leading-tight">Wrap the day</h2>
              <p className="text-[12px] text-muted-foreground">
                Where each task landed + why. ~20 seconds. Then you can log out.
              </p>
            </div>
            {tasks.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <Pill cls="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">{counts.done} done</Pill>
                {counts.in_progress + counts.rolled_over > 0 && (
                  <Pill cls="bg-blue-500/15 text-blue-700 border-blue-500/30">{counts.in_progress + counts.rolled_over} carry-over</Pill>
                )}
                {counts.dropped > 0 && (
                  <Pill cls="bg-rose-500/15 text-rose-700 border-rose-500/30">{counts.dropped} dropped</Pill>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {tasks.length === 0 && (
            <div className="rounded-xl bg-muted/40 border border-border p-5 text-center">
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
              className="mt-1 w-full min-h-[70px] px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 resize-y"
            />
          </div>
        </div>

        <div className="border-t border-border px-6 py-3 flex items-center justify-between gap-3 bg-card/60">
          <p className={'text-[11px] ' + (allHaveReasons ? 'text-emerald-700' : 'text-rose-600')}>
            {allHaveReasons ? 'Looks good — ready to wrap.' : 'Add a reason for every task not marked Done.'}
          </p>
          <button
            onClick={submit}
            disabled={submitting || !allHaveReasons}
            className="h-9 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
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
  return <span className={'h-5 px-2 rounded-full border text-[10px] inline-flex items-center ' + cls}>{children}</span>;
}

function TaskRow({
  task, value, onChange,
}: {
  task: MorningTask;
  value: { status: string; reason: string };
  onChange: (v: { status: string; reason: string }) => void;
}) {
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = [
    { k: 'done',         label: 'Done',           cls: 'bg-emerald-500 text-white', Icon: CheckCircle2 },
    { k: 'in_progress',  label: 'Still on it',    cls: 'bg-blue-500 text-white',     Icon: Circle },
    { k: 'rolled_over',  label: 'Carry over',     cls: 'bg-amber-500 text-white',    Icon: RefreshCw },
    { k: 'dropped',      label: 'Dropped',        cls: 'bg-rose-500 text-white',     Icon: XCircle },
  ];
  const needsReason = value.status !== 'done';
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-sm font-semibold mb-2 truncate">{task.title}</p>
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
                (active ? `${o.cls} scale-105 shadow-sm` : 'bg-muted/60 text-muted-foreground hover:bg-muted')
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
          placeholder="Why? (required) e.g. waiting on client creatives"
          className={
            'mt-2 w-full h-8 px-2.5 rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-400/30 ' +
            (value.reason.trim() ? 'bg-muted/30 border border-border' : 'bg-rose-500/10 border border-rose-500/40')
          }
        />
      )}
    </div>
  );
}

export default EndOfDayCheckinModal;
