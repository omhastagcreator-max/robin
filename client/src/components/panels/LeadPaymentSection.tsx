import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IndianRupee, Plus, X, Loader2, CheckCircle2, CircleDot, Undo2,
  ListChecks, Send,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * LeadPaymentSection — the payment ledger surface for one lead.
 *
 * Renders:
 *   1. A status chip at the top (none / part_paid / full_paid / refunded)
 *      with the running paid-vs-total numbers and a progress bar.
 *   2. The latest "next condition" note ("client will pay 50% after store
 *      goes live") — always visible above history so the next person who
 *      opens the lead knows what triggers the next payment.
 *   3. A "Record payment" button that expands an inline form. Form takes
 *      status, amount, optional total, and the next-condition note.
 *   4. A compact event log of every prior payment / refund.
 *
 * One POST per record — server appends to paymentEvents[] and refreshes
 * the denormalised fields. UI optimistically applies the patch so the
 * chip + progress feel instant.
 */

interface PaymentEvent {
  status: 'part_paid' | 'full_paid' | 'refunded';
  amount: number;
  note?:  string;
  by?:    string;
  at?:    string;
}

interface LeadPaymentLike {
  _id: string;
  estimatedValue?: number;
  paymentStatus?: 'none' | 'part_paid' | 'full_paid' | 'refunded';
  paymentPaid?:   number;
  paymentTotal?:  number;
  paymentNote?:   string;
  paymentEvents?: PaymentEvent[];
}

interface Props {
  lead: LeadPaymentLike;
  onUpdated: (next: any) => void;
}

const STATUS_LABEL: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  none:      { label: 'No payment yet', bg: 'bg-muted',             text: 'text-muted-foreground', icon: CircleDot },
  part_paid: { label: 'Part paid',      bg: 'bg-amber-500/15',      text: 'text-amber-700',        icon: CircleDot },
  full_paid: { label: 'Fully paid',     bg: 'bg-emerald-500/15',    text: 'text-emerald-700',      icon: CheckCircle2 },
  refunded:  { label: 'Refunded',       bg: 'bg-rose-500/15',       text: 'text-rose-700',         icon: Undo2 },
};

function fmtRupee(n?: number) {
  if (n === undefined || n === null) return '—';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(2)}L`;
  return `₹${(n).toLocaleString('en-IN')}`;
}

export function LeadPaymentSection({ lead, onUpdated }: Props) {
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState<'part_paid' | 'full_paid' | 'refunded'>('part_paid');
  const [amount, setAmount] = useState('');
  const [total,  setTotal]  = useState(lead.paymentTotal ? String(lead.paymentTotal) : (lead.estimatedValue ? String(lead.estimatedValue) : ''));
  const [note,   setNote]   = useState('');

  const paid = lead.paymentPaid ?? 0;
  const totalNum = lead.paymentTotal || lead.estimatedValue || 0;
  const pct = totalNum > 0 ? Math.min(100, Math.round((paid / totalNum) * 100)) : 0;
  const cfg = STATUS_LABEL[lead.paymentStatus || 'none'];
  const Icon = cfg.icon;
  const remaining = Math.max(0, totalNum - paid);

  const reset = () => {
    setStatus('part_paid'); setAmount(''); setNote('');
    setTotal(lead.paymentTotal ? String(lead.paymentTotal) : (lead.estimatedValue ? String(lead.estimatedValue) : ''));
  };

  const submit = async () => {
    const amt = Number(amount || 0);
    if (!Number.isFinite(amt) || amt < 0) { toast.error('Enter a valid amount (₹)'); return; }
    if (status === 'part_paid' && amt === 0) { toast.error('Part payment needs an amount > 0.'); return; }
    setBusy(true);
    try {
      const tot = Number(total || 0);
      const updated = await api.markLeadPayment(lead._id, {
        status,
        amount: amt,
        note:   note.trim() || undefined,
        total:  tot > 0 ? tot : undefined,
      });
      toast.success(
        status === 'full_paid' ? 'Marked fully paid.'
        : status === 'refunded' ? 'Refund recorded.'
        : 'Payment recorded.'
      );
      onUpdated(updated);
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not record payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p-4 space-y-3 border-t border-border">
      <div className="flex items-center gap-1.5">
        <IndianRupee className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Payment</span>
        <button
          onClick={() => setOpen(o => !o)}
          className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90"
        >
          {open ? <><X className="h-3 w-3" /> Close</> : <><Plus className="h-3 w-3" /> Record payment</>}
        </button>
      </div>

      {/* Status chip + paid vs total + progress */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${cfg.bg} ${cfg.text}`}>
            <Icon className="h-3 w-3" /> {cfg.label}
          </span>
          {totalNum > 0 ? (
            <span className="text-[12px] text-foreground/80 tabular-nums">
              <b className="text-foreground">{fmtRupee(paid)}</b>
              <span className="text-muted-foreground"> of {fmtRupee(totalNum)}</span>
              {remaining > 0 && lead.paymentStatus !== 'refunded' && (
                <span className="text-muted-foreground"> — <b className="text-foreground">{fmtRupee(remaining)} remaining</b></span>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">Set total to track progress</span>
          )}
        </div>
        {totalNum > 0 && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full transition-all duration-300 ${
              lead.paymentStatus === 'refunded' ? 'bg-rose-500'
              : pct >= 100 ? 'bg-emerald-500'
              :              'bg-amber-500'
            }`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {/* The "next condition" note — what triggers the next payment.
            Surfaces above the history so the next person knows it. */}
        {lead.paymentNote && (
          <p className="text-[12px] leading-snug rounded-md bg-amber-500/[0.08] border border-amber-500/25 text-amber-900 px-2 py-1.5">
            <span className="font-bold">Next payment after: </span>{lead.paymentNote}
          </p>
        )}
      </div>

      {/* Inline form */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] p-3 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-bold text-primary">
                <Plus className="h-3 w-3" /> Record a payment event
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['part_paid', 'full_paid', 'refunded'] as const).map(s => {
                  const sCfg = STATUS_LABEL[s];
                  const SIcon = sCfg.icon;
                  const active = status === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
                        active ? `${sCfg.bg} ${sCfg.text} border-transparent ring-1 ring-primary/40` : 'bg-background border-border text-foreground/70 hover:bg-muted'
                      }`}
                    >
                      <SIcon className="h-3 w-3" /> {sCfg.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Amount (₹)</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="e.g. 15000"
                    className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Total deal value (₹)</span>
                  <input
                    type="number"
                    value={total}
                    onChange={e => setTotal(e.target.value)}
                    placeholder="full amount"
                    className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  What triggers the next payment? <span className="text-muted-foreground/70 normal-case font-normal">(condition / reason)</span>
                </span>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Client will pay balance 50% after Shopify store goes live"
                  className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring resize-none leading-snug"
                />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => { setOpen(false); reset(); }}
                  className="px-3 h-7 rounded-md text-[11.5px] text-muted-foreground hover:bg-muted"
                >Cancel</button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event history */}
      {(lead.paymentEvents && lead.paymentEvents.length > 0) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
            <ListChecks className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Payment history</span>
            <span className="text-[10.5px] text-muted-foreground ml-auto">{lead.paymentEvents.length} event{lead.paymentEvents.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {[...lead.paymentEvents].reverse().map((ev, i) => {
              const c = STATUS_LABEL[ev.status];
              return (
                <li key={i} className="px-3 py-2 flex items-start gap-2.5">
                  <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.text}`}>
                    {c.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-bold tabular-nums">{fmtRupee(ev.amount)}</span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {ev.at ? formatDistanceToNow(new Date(ev.at), { addSuffix: true }) : ''}
                        {ev.at ? ` · ${format(new Date(ev.at), 'dd MMM')}` : ''}
                      </span>
                    </div>
                    {ev.note && (
                      <p className="text-[11.5px] text-foreground/85 leading-snug mt-0.5">{ev.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
