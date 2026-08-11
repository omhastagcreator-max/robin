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

interface Props {
  workflowId: string;
  initial: {
    clientName?: string;
    clientPhone?: string;
    clientEmail?: string;
    priority?: string;
    paymentStatus?: string;
    tags?: string[];
  };
  onClose: () => void;
  onSaved: (wf: any) => void;
}

export function EditClientDetailsModal({ workflowId, initial, onClose, onSaved }: Props) {
  const [clientName, setClientName]   = useState(initial.clientName || '');
  const [clientPhone, setClientPhone] = useState(initial.clientPhone || '');
  const [clientEmail, setClientEmail] = useState(initial.clientEmail || '');
  const [priority, setPriority]       = useState(initial.priority || 'medium');
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus || 'na');
  const [tagsText, setTagsText]       = useState((initial.tags || []).join(', '));
  const [saving, setSaving]           = useState(false);

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

        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
