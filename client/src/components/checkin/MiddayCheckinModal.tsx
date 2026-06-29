import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CloudSun, CheckCircle2, Clock, AlertTriangle, Circle, Loader2 } from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type MorningTask } from '@/contexts/CheckinContext';

/**
 * MiddayCheckinModal — 1pm-2pm pulse.
 *
 * Shows the morning's tasks as one-tap status cards. Done / In-progress
 * / Blocked / Not started. Plus one optional "blockers" line if anything
 * external is in the way. Total time to fill: ~15 seconds.
 *
 * Dismissible (not as hard a gate as morning/evening) but a banner
 * keeps surfacing until done, so it's still effectively required.
 */
export function MiddayCheckinModal() {
  const { status, openKind, close, refresh } = useCheckin();
  const visible = openKind === 'midday';

  const [updates, setUpdates] = useState<Record<string, { status: string; note: string }>>({});
  const [blockers, setBlockers] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Seed from any midday data already saved (allows partial re-edits if
  // the modal re-opens after submit — though usually it doesn't).
  useEffect(() => {
    if (!visible || !status) return;
    const seed: Record<string, { status: string; note: string }> = {};
    for (const t of status.morning.tasks) {
      if (!t.taskId) continue;
      seed[t.taskId] = {
        status: t.middayStatus || (status.morning.tasks.length ? 'in_progress' : 'in_progress'),
        note:   t.middayNote   || '',
      };
    }
    setUpdates(seed);
    setBlockers(status.midday.blockers || '');
  }, [visible, status]);

  if (!visible || !status) return null;
  const tasks = status.morning.tasks.filter((t: MorningTask) => !!t.taskId);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.submitMiddayCheckin({
        taskUpdates: Object.entries(updates).map(([taskId, v]) => ({
          taskId,
          status: v.status || 'in_progress',
          note: v.note,
        })),
        blockers,
      });
      await refresh();
      toast.success('Midday checkin saved. Back to it!', { duration: 3500 });
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
        <div className="px-6 pt-5 pb-4 bg-gradient-to-br from-sky-400/15 via-cyan-400/10 to-emerald-400/15 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
              <CloudSun className="h-5 w-5 text-sky-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base sm:text-lg font-bold leading-tight">Halfway check-in</h2>
              <p className="text-[12px] text-muted-foreground">
                Tap a status for each task. ~15 seconds.
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {tasks.length === 0 && (
            <div className="rounded-xl bg-muted/40 border border-border p-5 text-center">
              <p className="text-sm font-semibold">No morning tasks to update.</p>
              <p className="text-[12px] text-muted-foreground mt-1">Add a blocker below if anything's in your way, then continue.</p>
            </div>
          )}

          {tasks.map(t => (
            <TaskRow
              key={t.taskId}
              task={t}
              value={updates[t.taskId!] || { status: 'in_progress', note: '' }}
              onChange={(v) => setUpdates(p => ({ ...p, [t.taskId!]: v }))}
            />
          ))}

          <div className="pt-2">
            <label className="text-[12px] font-semibold text-muted-foreground">
              Anything blocking you?
            </label>
            <textarea
              value={blockers}
              onChange={e => setBlockers(e.target.value.slice(0, 600))}
              placeholder="(Optional) e.g. waiting on creatives from client"
              className="mt-1 w-full min-h-[60px] px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 resize-y"
            />
          </div>
        </div>

        <div className="border-t border-border px-6 py-3 flex items-center justify-between gap-3 bg-card/60">
          <p className="text-[11px] text-muted-foreground">Quick pulse — you can keep working straight after.</p>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-9 px-4 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {submitting ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({
  task, value, onChange,
}: {
  task: MorningTask;
  value: { status: string; note: string };
  onChange: (v: { status: string; note: string }) => void;
}) {
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = [
    { k: 'done',         label: 'Done',        cls: 'bg-emerald-500 text-white', Icon: CheckCircle2 },
    { k: 'in_progress',  label: 'In progress', cls: 'bg-blue-500 text-white',     Icon: Clock },
    { k: 'blocked',      label: 'Blocked',     cls: 'bg-rose-500 text-white',     Icon: AlertTriangle },
    { k: 'not_started',  label: 'Not started', cls: 'bg-muted text-foreground',   Icon: Circle },
  ];
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
    </div>
  );
}

export default MiddayCheckinModal;
