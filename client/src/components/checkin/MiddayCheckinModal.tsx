import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CloudSun, CheckCircle2, Clock, AlertTriangle, Circle, Loader2, Calendar } from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type MorningTask } from '@/contexts/CheckinContext';

/**
 * MiddayCheckinModal — 1pm-2pm pulse.
 *
 * One-tap status cards (Done / In progress / Blocked / Not started) per
 * morning task, plus optional blockers line. Meetings render with a
 * calendar icon + time badge so the user can grade them the same way
 * (the "Done" pill means "happened on time"; "Blocked" = postponed
 * etc.). Total fill time: ~15 seconds.
 *
 * Polished header to match Morning modal — orb glow, gradient pill,
 * progress meter that fills as the user grades each task.
 */
export function MiddayCheckinModal() {
  const { status, openKind, close, refresh } = useCheckin();
  const visible = openKind === 'midday';

  const [updates, setUpdates] = useState<Record<string, { status: string; note: string }>>({});
  const [blockers, setBlockers] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible || !status) return;
    const seed: Record<string, { status: string; note: string }> = {};
    for (const t of status.morning.tasks) {
      if (!t.taskId) continue;
      seed[t.taskId] = {
        status: t.middayStatus || 'in_progress',
        note:   t.middayNote   || '',
      };
    }
    setUpdates(seed);
    setBlockers(status.midday.blockers || '');
  }, [visible, status]);

  const tasks = useMemo(
    () => (status?.morning?.tasks || []).filter((t: MorningTask) => !!t.taskId),
    [status],
  );

  // Modal lock — block Escape + lock body scroll. Same pattern as morning
  // modal; see those comments for why. Owner rule: no popup is removable.
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

  const gradedCount = useMemo(
    () => tasks.filter(t => updates[t.taskId!]?.status && updates[t.taskId!].status !== '').length,
    [tasks, updates],
  );
  const pct = tasks.length === 0 ? 100 : Math.round((gradedCount / tasks.length) * 100);

  if (!visible || !status) return null;

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
    <div className="fixed inset-0 z-[150] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-3xl shadow-2xl w-full max-w-2xl border border-border max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-sky-400/20 via-cyan-400/15 to-emerald-400/15 border-b border-border/40 overflow-hidden">
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-sky-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-sky-500/30">
              <CloudSun className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold leading-tight">Halfway check-in</h2>
              <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">
                Tap a status per task. ~15 seconds.
              </p>
            </div>
            <span className="hidden sm:inline-flex h-7 px-2.5 rounded-full bg-sky-500/15 text-sky-800 text-[10.5px] font-bold tracking-wider items-center gap-1 border border-sky-500/30">
              {gradedCount} / {tasks.length} graded
            </span>
          </div>
          <div className="mt-4 relative h-1.5 rounded-full bg-sky-100/60 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 to-cyan-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {tasks.length === 0 && (
            <div className="rounded-2xl bg-muted/30 border border-dashed border-border p-6 text-center">
              <p className="text-sm font-semibold">No morning tasks to update.</p>
              <p className="text-[12px] text-muted-foreground mt-1">Drop a blocker below if anything's in your way, then continue.</p>
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
              className="mt-1.5 w-full min-h-[64px] px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/40 resize-y"
            />
          </div>
        </div>

        <div className="border-t border-border px-6 py-3.5 flex items-center justify-between gap-3 bg-card/80 backdrop-blur-sm">
          <p className="text-[11.5px] text-muted-foreground">Quick pulse — keep working straight after.</p>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-9 px-4 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-md shadow-sky-500/30 hover:shadow-lg hover:shadow-sky-500/40 transition-all disabled:opacity-50 disabled:shadow-none"
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
  const isMeeting = task.kind === 'meeting';
  const time = task.meetingAt ? new Date(task.meetingAt) : null;
  const timeStr = time ? time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = isMeeting
    ? [
        { k: 'done',         label: 'Happened',     cls: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white', Icon: CheckCircle2 },
        { k: 'in_progress',  label: 'On now',       cls: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',  Icon: Clock },
        { k: 'blocked',      label: 'Postponed',    cls: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',     Icon: AlertTriangle },
        { k: 'not_started',  label: 'Not yet',      cls: 'bg-muted text-foreground',                                    Icon: Circle },
      ]
    : [
        { k: 'done',         label: 'Done',         cls: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white', Icon: CheckCircle2 },
        { k: 'in_progress',  label: 'In progress',  cls: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',  Icon: Clock },
        { k: 'blocked',      label: 'Blocked',      cls: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',     Icon: AlertTriangle },
        { k: 'not_started',  label: 'Not started',  cls: 'bg-muted text-foreground',                                    Icon: Circle },
      ];
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
    </div>
  );
}

export default MiddayCheckinModal;
