import { useEffect, useState } from 'react';
import {
  Loader2, Phone, Mail, Building2, Calendar, IndianRupee, Sparkles,
  ChevronRight, MessageSquare, Send,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { Button }   from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Stat }     from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { LeadPaymentSection } from '@/components/panels/LeadPaymentSection';
import * as api from '@/api';

/**
 * <LeadDetailPanel /> — drawer content for a single lead.
 *
 * Designed to live INSIDE the RightDrawer (not a full page). Reuses the
 * existing `api.getLead` / `api.addLeadNote` / `api.aiRescoreLead`
 * endpoints — no new backend.
 *
 * Anatomy:
 *   - Identity block: name + phone (tappable) + email + company.
 *   - AI score block: hot/warm/cold + next-action + Re-score button.
 *   - Money block: estimated value (₹), source, stage history count.
 *   - Notes feed: append-only thread, inline add.
 */

interface Lead {
  _id: string;
  name: string;
  contact?: string;
  email?: string;
  company?: string;
  source?: string;
  stage?: string;
  estimatedValue?: number;
  aiScore?: 'hot' | 'warm' | 'cold' | '';
  aiReason?: string;
  aiNextAction?: string;
  aiScoredAt?: string;
  notes?: Array<{ content: string; createdAt: string; authorId?: string }>;
  stageHistory?: any[];
  createdAt?: string;
  // Payment ledger — see server/models/Lead.ts.
  paymentStatus?: 'none' | 'part_paid' | 'full_paid' | 'refunded';
  paymentPaid?:   number;
  paymentTotal?:  number;
  paymentNote?:   string;
  paymentEvents?: Array<{
    status: 'part_paid' | 'full_paid' | 'refunded';
    amount: number;
    note?:  string;
    by?:    string;
    at?:    string;
  }>;
}

export function LeadDetailPanel({ leadId }: { leadId: string }) {
  const [lead, setLead]       = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);
  const [draft, setDraft]     = useState('');
  const [posting, setPosting] = useState(false);

  const load = async () => {
    try {
      const l = await api.getLead(leadId);
      setLead(l);
    } catch { /* axios toast */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);

  const rescore = async () => {
    setRescoring(true);
    try {
      await api.aiRescoreLead(leadId);
      await load();
      toast.success('Re-scored');
    } catch { /* */ }
    finally { setRescoring(false); }
  };

  const addNote = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      // Optimistic: append locally before the server confirms.
      setLead(l => l ? { ...l, notes: [{ content: text, createdAt: new Date().toISOString() }, ...(l.notes || [])] } : l);
      setDraft('');
      await api.addLeadNote(leadId, { content: text });
    } catch {
      toast.error('Could not save note');
      // Pull authoritative version on failure.
      load();
    } finally { setPosting(false); }
  };

  if (loading || !lead) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // Stage → presence-pill-mapped tone (closest analogues).
  const stagePill: Status =
    lead.stage === 'won'        ? 'ready_to_deliver' :
    lead.stage === 'lost'       ? 'blocked'          :
    lead.stage === 'follow_up' || lead.stage === 'hot_follow_up' ? 'at_risk' :
                                  'in_huddle';

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <section className="p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-bold tracking-tight">{lead.name || 'Unnamed lead'}</h2>
          {lead.aiScore && (
            <span className={`text-[10px] uppercase font-bold px-1.5 h-5 inline-flex items-center rounded ${
              lead.aiScore === 'hot'  ? 'bg-rose-500/15 text-rose-700' :
              lead.aiScore === 'warm' ? 'bg-amber-500/15 text-amber-700' :
                                        'bg-muted text-muted-foreground'
            }`}>{lead.aiScore}</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {lead.createdAt && formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
          </span>
        </div>
        <div className="space-y-1 text-[12px]">
          {lead.contact && (
            <a href={`tel:${lead.contact}`} className="flex items-center gap-1.5 text-primary hover:underline tabular-nums">
              <Phone className="h-3 w-3" /> {lead.contact}
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Mail className="h-3 w-3" /> {lead.email}
            </a>
          )}
          {lead.company && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="h-3 w-3" /> {lead.company}
            </div>
          )}
        </div>
      </section>

      {/* AI block — the highest-value-per-pixel section. */}
      <section className="p-4 space-y-2 bg-primary/[0.03]">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary/80">AI takeaway</span>
        </div>
        {lead.aiNextAction ? (
          <>
            <p className="text-[13px] leading-snug font-medium">{lead.aiNextAction}</p>
            {lead.aiReason && <p className="text-[11.5px] text-muted-foreground leading-snug">{lead.aiReason}</p>}
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground">Not scored yet — click Re-score to get a recommended next action.</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button size="xs" intent="secondary" iconLeft={<Sparkles className="h-3 w-3" />} loading={rescoring} onClick={rescore}>
            Re-score
          </Button>
          {lead.aiScoredAt && (
            <span className="text-[10px] text-muted-foreground">scored {formatDistanceToNow(new Date(lead.aiScoredAt), { addSuffix: true })}</span>
          )}
        </div>
      </section>

      {/* Money + stage */}
      <section className="p-4 grid grid-cols-3 gap-3">
        <Stat block icon={<IndianRupee className="h-3 w-3" />} value={lead.estimatedValue ? `₹${lead.estimatedValue.toLocaleString('en-IN')}` : '—'} label="Est. value" tone="success" />
        <Stat block icon={<Calendar className="h-3 w-3" />}   value={lead.source || '—'} label="Source" />
        <Stat block icon={<ChevronRight className="h-3 w-3" />} value={(lead.stageHistory?.length || 0)} label="Stage moves" />
      </section>

      <section className="p-4 flex items-center gap-2">
        <StatusPill state={stagePill} size="sm" label={lead.stage?.replace(/_/g, ' ') || 'new'} />
      </section>

      {/* Payment — status chip + ledger + inline "record payment" form */}
      <LeadPaymentSection lead={lead} onUpdated={setLead} />

      {/* Notes / comments */}
      <section className="p-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Notes</span>
        </div>
        <div className="flex gap-2 items-start">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a note — ⌘Enter to send"
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
            className="text-[12.5px]"
          />
          <Button size="sm" intent="primary" loading={posting} onClick={addNote} iconLeft={<Send className="h-3 w-3" />}>
            Send
          </Button>
        </div>

        {lead.notes && lead.notes.length > 0 ? (
          <ul className="space-y-2">
            {lead.notes.map((n, i) => (
              <li key={i} className="text-[12px] leading-snug px-3 py-2 bg-muted/40 rounded-md">
                <p className="whitespace-pre-wrap break-words">{n.content}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" title="No notes yet" hint="Track every conversation here." />
        )}
      </section>
    </div>
  );
}
