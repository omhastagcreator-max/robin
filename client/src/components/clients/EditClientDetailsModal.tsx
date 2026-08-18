import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * EditClientDetailsModal — full edit of a client's CRM details, open to
 * every staff role (Aug 2026 owner ask). Saves via PUT
 * /client-workflows/:id/details, which keeps the underlying client User
 * record's name/phone in sync too — see clientWorkflowController.ts.
 */

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const PAYMENT_STATUSES = ['na', 'pending', 'partial', 'paid', 'overdue'] as const;
// Aug 2026 CRM upgrade — operational status, deliberately separate from
// paymentStatus above and from the auto-computed health/health level
// shown elsewhere on the workspace page.
const OPERATIONAL_STATUSES = ['in_progress', 'paused', 'completed', 'cancelled', 'on_hold'] as const;
const FEE_TYPES = ['', 'fixed', 'percentage', 'hybrid', 'custom'] as const;

interface Props {
  workflowId: string;
  initial: {
    clientName?: string;
    clientPhone?: string;
    clientEmail?: string;
    priority?: string;
    paymentStatus?: string;
    tags?: string[];
    operationalStatus?: string;
    totalAmount?: number;
    advanceReceived?: number;
    nextPaymentAmount?: number;
    nextPaymentDate?: string | null;
    nextPaymentCondition?: string;
    metaAdsFeeModel?: { type?: string; fixedMonthlyFee?: number | null; percentageOfSpend?: number | null; customDescription?: string };
  };
  // Shows the Meta Ads fee-model section only when the workflow actually
  // has a meta_ads service line — the caller already has `services` loaded.
  hasMetaAds?: boolean;
  onClose: () => void;
  onSaved: (wf: any) => void;
}

export function EditClientDetailsModal({ workflowId, initial, hasMetaAds, onClose, onSaved }: Props) {
  const [clientName, setClientName]   = useState(initial.clientName || '');
  const [clientPhone, setClientPhone] = useState(initial.clientPhone || '');
  const [clientEmail, setClientEmail] = useState(initial.clientEmail || '');
  const [priority, setPriority]       = useState(initial.priority || 'medium');
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus || 'na');
  const [tagsText, setTagsText]       = useState((initial.tags || []).join(', '));
  const [operationalStatus, setOperationalStatus] = useState(initial.operationalStatus || 'in_progress');
  const [totalAmount, setTotalAmount]         = useState(initial.totalAmount ? String(initial.totalAmount) : '');
  const [advanceReceived, setAdvanceReceived] = useState(initial.advanceReceived ? String(initial.advanceReceived) : '');
  const [nextPaymentAmount, setNextPaymentAmount] = useState(initial.nextPaymentAmount ? String(initial.nextPaymentAmount) : '');
  const [nextPaymentDate, setNextPaymentDate] = useState(initial.nextPaymentDate ? String(initial.nextPaymentDate).slice(0, 10) : '');
  const [nextPaymentCondition, setNextPaymentCondition] = useState(initial.nextPaymentCondition || '');
  const [feeType, setFeeType]           = useState(initial.metaAdsFeeModel?.type || '');
  const [fixedFee, setFixedFee]         = useState(initial.metaAdsFeeModel?.fixedMonthlyFee != null ? String(initial.metaAdsFeeModel.fixedMonthlyFee) : '');
  const [percentFee, setPercentFee]     = useState(initial.metaAdsFeeModel?.percentageOfSpend != null ? String(initial.metaAdsFeeModel.percentageOfSpend) : '');
  const [customFeeDesc, setCustomFeeDesc] = useState(initial.metaAdsFeeModel?.customDescription || '');
  const [saving, setSaving]           = useState(false);

  const remaining = Math.max(0, (Number(totalAmount) || 0) - (Number(advanceReceived) || 0));

  const save = async () => {
    if (!clientName.trim()) { toast.error('Brand / client name is required'); return; }
    setSaving(true);
    try {
      const wf = await api.cwUpdateDetails(workflowId, {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim(),
        priority: priority as any,
        paymentStatus: paymentStatus as any,
        tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
        operationalStatus: operationalStatus as any,
        totalAmount: totalAmount ? Number(totalAmount) : 0,
        advanceReceived: advanceReceived ? Number(advanceReceived) : 0,
        nextPaymentAmount: nextPaymentAmount ? Number(nextPaymentAmount) : 0,
        nextPaymentDate: nextPaymentDate || null,
        nextPaymentCondition,
        ...(hasMetaAds ? {
          metaAdsFeeModel: {
            type: feeType,
            fixedMonthlyFee: fixedFee ? Number(fixedFee) : null,
            percentageOfSpend: percentFee ? Number(percentFee) : null,
            customDescription: customFeeDesc,
          },
        } : {}),
      });
      toast.success('Client details updated');
      onSaved(wf);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save changes');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-3 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="font-bold text-base">Edit client details</h2>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Brand / client name</span>
          <input value={clientName} onChange={e => setClientName(e.target.value)}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Phone</span>
            <input value={clientPhone} onChange={e => setClientPhone(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Email</span>
            <input value={clientEmail} onChange={e => setClientEmail(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Priority</span>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring">
              {PRIORITIES.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Payment status</span>
            <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring">
              {PAYMENT_STATUSES.map(p => <option key={p} value={p} className="capitalize">{p === 'na' ? 'N/A' : p}</option>)}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Tags (comma separated)</span>
          <input value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="e.g. shopify, high-value, D2C"
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Client status</span>
          <select value={operationalStatus} onChange={e => setOperationalStatus(e.target.value)}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring">
            {OPERATIONAL_STATUSES.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
          </select>
        </label>

        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Financials</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} placeholder="Total Amount (₹)"
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="number" value={advanceReceived} onChange={e => setAdvanceReceived(e.target.value)} placeholder="Advance Received (₹)"
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          {totalAmount && <p className="text-xs text-muted-foreground">Remaining: ₹{remaining.toLocaleString('en-IN')}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={nextPaymentAmount} onChange={e => setNextPaymentAmount(e.target.value)} placeholder="Next Payment (₹)"
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="date" value={nextPaymentDate} onChange={e => setNextPaymentDate(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <input value={nextPaymentCondition} onChange={e => setNextPaymentCondition(e.target.value)} placeholder="What triggers next payment?"
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>

        {hasMetaAds && (
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Meta Ads fee model</p>
            <select value={feeType} onChange={e => setFeeType(e.target.value)}
              className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {FEE_TYPES.map(t => <option key={t} value={t}>{t === '' ? 'Select…' : t === 'fixed' ? 'Fixed Monthly Fee' : t === 'percentage' ? 'Percentage of Ad Spend' : t === 'hybrid' ? 'Hybrid (fixed + %)' : 'Custom'}</option>)}
            </select>
            {(feeType === 'fixed' || feeType === 'hybrid') && (
              <input type="number" value={fixedFee} onChange={e => setFixedFee(e.target.value)} placeholder="Fixed monthly fee (₹)"
                className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            )}
            {(feeType === 'percentage' || feeType === 'hybrid') && (
              <input type="number" value={percentFee} onChange={e => setPercentFee(e.target.value)} placeholder="% of ad spend"
                className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            )}
            {feeType === 'custom' && (
              <textarea value={customFeeDesc} onChange={e => setCustomFeeDesc(e.target.value)} placeholder="Describe the custom fee arrangement…"
                className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring" />
            )}
          </div>
        )}

        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
