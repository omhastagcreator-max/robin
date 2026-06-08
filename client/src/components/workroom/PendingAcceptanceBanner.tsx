import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Check, X, Sparkles, Clock } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * PendingAcceptanceBanner — surfaces tasks that someone assigned to
 * the current user but require an explicit Accept (with an ETA) before
 * they become active work.
 *
 * Owner ask (June 2026): "make sure they get notification to accept
 * that tasks and enter the expected completion date". This is the
 * in-app side of that flow — the bell notification points here, the
 * card shows the task + an Accept dialog with a date picker.
 *
 * Auto-hides when the queue is empty so users with nothing to accept
 * don't see clutter.
 */

interface PendingTask {
  _id: string;
  title: string;
  description?: string;
  priority?: string;
  clientName?: string;
  clientWorkflowId?: string;
  dueDate?: string;
  assignedBy?: string;
  createdAt?: string;
}

const PR_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/12 text-rose-700',
  high:   'bg-amber-500/15 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};

export function PendingAcceptanceBanner({ onAfterAct }: { onAfterAct?: () => void } = {}) {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [declining,   setDeclining]   = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    api.taskInbox()
      .then((d: any) => setTasks(Array.isArray(d?.pendingAcceptance) ? d.pendingAcceptance : []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  // Hide entirely on empty / loading so quiet days stay clean.
  if (loading) return null;
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-2xl border border-violet-500/40 bg-gradient-to-r from-violet-500/8 to-transparent overflow-hidden">
      <div className="px-4 py-2 border-b border-violet-500/20 flex items-center gap-2">
        <Inbox className="h-3.5 w-3.5 text-violet-700" />
        <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-violet-800">
          Awaiting your acceptance
        </p>
        <span className="text-[10.5px] tabular-nums text-violet-700/80">{tasks.length}</span>
      </div>
      <ul className="divide-y divide-violet-500/15">
        {tasks.slice(0, 5).map(t => (
          <PendingRow
            key={t._id}
            task={t}
            opening={acceptingId === t._id}
            onOpen={() => setAcceptingId(t._id)}
            onClose={() => setAcceptingId(null)}
            decliningState={declining === t._id}
            onDecline={async () => {
              setDeclining(t._id);
              try {
                await api.declineTask(t._id);
                toast.success('Task declined — bounced back to the sender.');
                refresh();
                onAfterAct?.();
              } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Could not decline.');
              } finally { setDeclining(null); }
            }}
            onAccepted={() => { setAcceptingId(null); refresh(); onAfterAct?.(); }}
          />
        ))}
      </ul>
    </div>
  );
}

function PendingRow({ task, opening, onOpen, onClose, decliningState, onDecline, onAccepted }: {
  task: PendingTask;
  opening: boolean;
  onOpen: () => void;
  onClose: () => void;
  decliningState: boolean;
  onDecline: () => void;
  onAccepted: () => void;
}) {
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold truncate">{task.title}</p>
          <p className="text-[10.5px] text-muted-foreground truncate">
            {task.clientName && <span>{task.clientName}</span>}
            {task.clientName && task.dueDate && <span className="mx-1">·</span>}
            {task.dueDate && <span>creator's deadline: {new Date(task.dueDate).toLocaleDateString()}</span>}
          </p>
        </div>
        {task.priority && (
          <span className={`text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PR_CLS[task.priority] || PR_CLS.medium}`}>
            {task.priority}
          </span>
        )}
        <button
          type="button"
          onClick={onDecline}
          disabled={decliningState}
          className="h-7 px-2 rounded-md text-[10.5px] font-semibold text-muted-foreground hover:text-rose-700 hover:bg-rose-500/10 inline-flex items-center gap-1 disabled:opacity-50"
          title="Bounce back to sender"
        >
          <X className="h-3 w-3" /> Decline
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="h-7 px-2.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[10.5px] font-semibold inline-flex items-center gap-1"
        >
          <Check className="h-3 w-3" /> Accept
        </button>
      </div>
      {opening && <AcceptDialog task={task} onClose={onClose} onAccepted={onAccepted} />}
    </li>
  );
}

function AcceptDialog({ task, onClose, onAccepted }: { task: PendingTask; onClose: () => void; onAccepted: () => void }) {
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!date) {
      toast.error('Please pick an expected completion date.');
      return;
    }
    setSubmitting(true);
    try {
      await api.acceptTask(task._id, {
        estimatedCompletionAt: new Date(date).toISOString(),
        estimatedHours: hours ? Math.max(0, Number(hours)) : undefined,
      });
      toast.success('Task accepted — the sender has been notified.');
      onAccepted();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not accept.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-violet-700">Accept task</p>
          <h2 className="text-[15px] font-bold mt-1 leading-tight truncate">{task.title}</h2>
          {task.clientName && <p className="text-[11px] text-muted-foreground mt-1">for {task.clientName}</p>}
          {task.description && <p className="text-[11.5px] text-muted-foreground mt-2 leading-relaxed">{task.description}</p>}
        </div>
        <div className="px-5 py-3 space-y-2.5">
          <div>
            <label className="block text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
              I'll finish by
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
              Estimated hours <span className="text-muted-foreground/60 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="e.g. 4"
              className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[12.5px] tabular-nums focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          {task.clientWorkflowId ? (
            <Link
              to={`/clients/pipeline/${task.clientWorkflowId}`}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={onClose}
            >
              <Sparkles className="h-3 w-3" /> See brand context
            </Link>
          ) : <span />}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 px-3 rounded-md text-[12px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !date}
              className="h-8 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Clock className="h-3 w-3" />
              {submitting ? 'Accepting…' : 'Accept'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
