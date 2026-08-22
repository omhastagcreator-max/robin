import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, ExternalLink, Send } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * ClientQuickUpdateModal — update a client without leaving the page.
 *
 * Owner ask (Aug 2026): "when clicked open a popup for all type of update
 * being on that same page only." Clicking a pill in ClientPillsBar used to
 * navigate to /clients/pipeline/:id, which yanks you out of whatever you
 * were doing. This keeps you put: the pill opens this modal over the
 * current page, you log the update, you close it, you're still where you
 * were.
 *
 * Scope decision — this is the QUICK lane, not a replacement for the full
 * client workspace. It covers the updates people actually make many times
 * a day (status / priority / payment / "here's what happened today"), and
 * links out to the full workspace for the deep work (per-service SOP
 * checklists, reassignment, financials, performance calendar). Duplicating
 * those here would mean two divergent copies of the same UI.
 *
 * Everything saves through the SAME endpoints the workspace page uses
 * (cwUpdateDetails / cwAddNote), so the server-side permission gates
 * (financials are sales/admin-only, etc.) and the activity log apply
 * identically — no privilege side-door via this modal.
 */

interface Service {
  _id?: string;
  label: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
}

interface Workflow {
  _id: string;
  clientName?: string;
  services?: Service[];
  priority?: string;
  operationalStatus?: string;
  paymentStatus?: string;
  healthLevel?: string;
  ownerFlag?: string;
  lastUpdate?: { detail?: string; at?: string } | null;
}

/**
 * The owner's three-way flag. Saved on click (no separate Save press) —
 * flagging a client is the single most time-sensitive action here, so it
 * shouldn't wait behind a form submit. Clicking the active flag clears it.
 */
const FLAGS = [
  { v: 'smooth',          label: 'Smooth',          active: 'bg-emerald-500 text-white border-emerald-500', idle: 'text-emerald-700 border-emerald-500/40 hover:bg-emerald-500/10' },
  { v: 'needs_attention', label: 'Needs attention', active: 'bg-amber-500 text-white border-amber-500',     idle: 'text-amber-700 border-amber-500/40 hover:bg-amber-500/10' },
  { v: 'critical',        label: 'Critical',        active: 'bg-red-600 text-white border-red-600',         idle: 'text-red-700 border-red-500/40 hover:bg-red-500/10' },
];

const OPERATIONAL = [
  { v: 'in_progress', label: 'In progress' },
  { v: 'paused',      label: 'Paused' },
  { v: 'on_hold',     label: 'On hold' },
  { v: 'completed',   label: 'Completed' },
  { v: 'cancelled',   label: 'Cancelled' },
];
const PRIORITIES = [
  { v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' },
  { v: 'high', label: 'High' }, { v: 'urgent', label: 'Urgent' },
];
const PAYMENTS = [
  { v: 'na', label: 'N/A' }, { v: 'pending', label: 'Pending' },
  { v: 'partial', label: 'Partial' }, { v: 'paid', label: 'Paid' },
  { v: 'overdue', label: 'Overdue' },
];

const SVC_STATUS_STYLE: Record<string, string> = {
  done:        'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  in_progress: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  blocked:     'bg-red-500/15 text-red-700 border-red-500/30',
  pending:     'bg-muted text-muted-foreground border-border',
};

export function ClientQuickUpdateModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  // Local form state — seeded from the workflow once it loads.
  const [operationalStatus, setOperationalStatus] = useState('in_progress');
  const [priority, setPriority] = useState('medium');
  const [paymentStatus, setPaymentStatus] = useState('na');
  const [ownerFlag, setOwnerFlag] = useState('');
  const [flagSaving, setFlagSaving] = useState(false);

  // Load the full workflow when the modal opens.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.cwGetWorkflow(clientId)
      .then((data: Workflow) => {
        if (cancelled) return;
        setWf(data);
        setOperationalStatus(data.operationalStatus || 'in_progress');
        setPriority(data.priority || 'medium');
        setPaymentStatus(data.paymentStatus || 'na');
        setOwnerFlag(data.ownerFlag || '');
      })
      .catch(() => { if (!cancelled) toast.error("Couldn't load this client"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  // Esc closes — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveStatus = async () => {
    setSaving(true);
    try {
      await api.cwUpdateDetails(clientId, {
        operationalStatus: operationalStatus as any,
        priority: priority as any,
        paymentStatus: paymentStatus as any,
      });
      toast.success('Client updated');
    } catch {
      toast.error("Couldn't save — try again");
    } finally {
      setSaving(false);
    }
  };

  // Flag saves immediately on click (and toggles off if you click the one
  // that's already set) — optimistic, reverted if the request fails.
  const setFlag = async (next: string) => {
    const prev = ownerFlag;
    const value = prev === next ? '' : next;
    setOwnerFlag(value);
    setFlagSaving(true);
    try {
      await api.cwUpdateDetails(clientId, { ownerFlag: value as any });
    } catch {
      setOwnerFlag(prev);
      toast.error("Couldn't save the flag");
    } finally {
      setFlagSaving(false);
    }
  };

  const saveNote = async () => {
    const text = note.trim();
    if (!text) return;
    setNoteSaving(true);
    try {
      await api.cwAddNote(clientId, { detail: text });
      setNote('');
      toast.success('Update logged');
    } catch {
      toast.error("Couldn't save the update");
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate">
              {loading ? 'Loading…' : (wf?.clientName || 'Client')}
            </div>
            <div className="text-[11px] text-muted-foreground">Quick update</div>
          </div>
          <Link
            to={`/clients/pipeline/${clientId}`}
            onClick={onClose}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-semibold text-primary hover:bg-primary/10 transition-colors"
            title="Open the full client workspace"
          >
            Full view <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={onClose}
            className="shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Owner flag — saves on click, no Save button. */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
                Flag
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FLAGS.map(f => {
                  const on = ownerFlag === f.v;
                  return (
                    <button
                      key={f.v}
                      onClick={() => setFlag(f.v)}
                      disabled={flagSaving}
                      className={`h-7 px-3 rounded-full border text-[12px] font-semibold transition-colors disabled:opacity-60 ${on ? f.active : f.idle}`}
                      title={on ? 'Click again to clear this flag' : `Flag as ${f.label.toLowerCase()}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status / priority / payment */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
                Status
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Engagement</span>
                  <select
                    value={operationalStatus}
                    onChange={e => setOperationalStatus(e.target.value)}
                    className="mt-1 w-full h-8 px-2 rounded-md border border-border bg-background text-[12.5px]"
                  >
                    {OPERATIONAL.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Priority</span>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="mt-1 w-full h-8 px-2 rounded-md border border-border bg-background text-[12.5px]"
                  >
                    {PRIORITIES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Payment</span>
                  <select
                    value={paymentStatus}
                    onChange={e => setPaymentStatus(e.target.value)}
                    className="mt-1 w-full h-8 px-2 rounded-md border border-border bg-background text-[12.5px]"
                  >
                    {PAYMENTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              <button
                onClick={saveStatus}
                disabled={saving}
                className="mt-2 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save status
              </button>
            </div>

            {/* Services — at-a-glance; deep edits live in the full workspace */}
            {!!wf?.services?.length && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
                  Services
                </div>
                <div className="space-y-1.5">
                  {wf.services.map(s => (
                    <div key={s._id || s.serviceType} className="flex items-center gap-2 text-[12.5px]">
                      <span className="flex-1 truncate">{s.label || s.serviceType}</span>
                      <span className={`shrink-0 px-1.5 h-5 inline-flex items-center rounded border text-[10.5px] font-semibold ${SVC_STATUS_STYLE[s.status] || SVC_STATUS_STYLE.pending}`}>
                        {s.status.replace(/_/g, ' ')}
                      </span>
                      <Link
                        to={`/clients/pipeline/${clientId}/stage/${s.serviceType}`}
                        onClick={onClose}
                        className="shrink-0 text-[11px] text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Log an update */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
                Add an update
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="What happened with this client today?"
                className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-[12.5px] resize-y"
              />
              <button
                onClick={saveNote}
                disabled={noteSaving || !note.trim()}
                className="mt-2 h-8 px-3 rounded-md bg-primary/12 text-primary text-[12px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 hover:bg-primary/20 transition-colors"
              >
                {noteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Log update
              </button>
              {wf?.lastUpdate?.detail && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Last: {wf.lastUpdate.detail}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
