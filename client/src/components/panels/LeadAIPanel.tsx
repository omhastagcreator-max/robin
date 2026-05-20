import { useEffect, useState } from 'react';
import {
  Phone, Mail, IndianRupee, Loader2, Copy, Check, RefreshCw,
  MessageSquare, ExternalLink, TrendingUp, Flame, Snowflake, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button }     from '@/components/ui/Button';
import { Stat }       from '@/components/ui/Stat';
import { StatusPill } from '@/components/ui/StatusPill';
import { AIInsight }  from '@/components/ai/AIInsight';
import * as api from '@/api';

/**
 * <LeadAIPanel /> — drawer content for a single lead.
 *
 * Sections (top-to-bottom):
 *   • Identity strip — name, company, contact, stage pill
 *   • AI score chip + reason + nextAction (from the existing scoreLead call)
 *   • Heuristic insight strip — closing probability, ghosting risk, suggested
 *     next move. Heuristic, no LLM call.
 *   • Drafted follow-up — paste-ready message. WhatsApp/Email toggle.
 *     Calls Gemini once, cached for 5 min server-side.
 *   • Footer — links out to call/email + jump-to full lead page.
 *
 * Operational ethos: every signal the salesperson needs to decide the next
 * action is inline. The drafted message has a one-click Copy button so
 * "open WhatsApp Web → paste → send" is the only manual step.
 */

interface LeadLite {
  _id:            string;
  name?:          string;
  company?:       string;
  contact?:       string;
  email?:         string;
  stage?:         string;
  estimatedValue?: number;
  aiScore?:       '' | 'hot' | 'warm' | 'cold';
  aiReason?:      string;
  aiNextAction?:  string;
}

interface Insights {
  closingProbability: number;
  ghostingRisk:       number;
  nextMove:           string;
  aiScore?:           '' | 'hot' | 'warm' | 'cold';
  aiReason?:          string;
  aiNextAction?:      string;
}

interface Followup {
  message:              string;
  aiUsed:               boolean;
  channel:              'whatsapp' | 'email';
  daysSinceLastContact: number;
}

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New lead', dialed: 'Dialed', connected: 'Connected',
  demo_booked: 'Demo booked', demo_done: 'Demo done',
  demo2_conversion: 'Demo 2 / conversion', follow_up: 'Follow up',
  hot_follow_up: 'Hot follow up', cooking: 'Cooking', won: 'Won', lost: 'Lost',
};

export function LeadAIPanel({ lead, onChanged }: { lead: LeadLite; onChanged?: () => void }) {
  const [insights, setInsights]   = useState<Insights | null>(null);
  const [loading, setLoading]     = useState(true);
  const [channel, setChannel]     = useState<'whatsapp' | 'email'>('whatsapp');
  const [followup, setFollowup]   = useState<Followup | null>(null);
  const [drafting, setDrafting]   = useState(false);
  const [copied, setCopied]       = useState(false);
  const [rescoring, setRescoring] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.aiLeadInsights(lead._id)
      .then(d => { if (alive) setInsights(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lead._id]);

  const draftFollowup = async () => {
    setDrafting(true);
    try {
      const r = await api.aiLeadFollowup(lead._id, { channel });
      setFollowup(r);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 429) toast.error('AI rate limit — try again in a moment.');
      else toast.error(e?.response?.data?.error || 'Could not draft follow-up.');
    } finally { setDrafting(false); }
  };

  // Re-fetch when channel toggles (different cache key on server).
  useEffect(() => { if (followup) draftFollowup(); /* eslint-disable-next-line */ }, [channel]);

  const rescoreLead = async () => {
    setRescoring(true);
    try {
      await api.aiRescoreLead(lead._id);
      // Re-pull insights so the new aiScore + nextAction is reflected.
      const fresh = await api.aiLeadInsights(lead._id);
      setInsights(fresh);
      onChanged?.();
      toast.success('Re-scored');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Rescore failed');
    } finally { setRescoring(false); }
  };

  const copy = async () => {
    if (!followup?.message) return;
    try {
      await navigator.clipboard.writeText(followup.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Could not copy'); }
  };

  const openOnPhone = () => {
    if (!lead.contact) return;
    const text = encodeURIComponent(followup?.message || '');
    const phone = lead.contact.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}${text ? `?text=${text}` : ''}`, '_blank', 'noopener');
  };

  const scoreIcon = insights?.aiScore === 'hot' ? Flame : insights?.aiScore === 'cold' ? Snowflake : TrendingUp;
  const scoreTone: 'danger' | 'warning' | 'success' | 'muted' =
    insights?.aiScore === 'hot'  ? 'danger'  :
    insights?.aiScore === 'cold' ? 'muted'   :
                                   'success';

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <section className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-bold tracking-tight truncate">{lead.name || 'Unnamed lead'}</h2>
          {lead.stage && (
            <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground bg-muted px-1.5 h-[18px] inline-flex items-center rounded">
              {STAGE_LABEL[lead.stage] || lead.stage}
            </span>
          )}
          {lead.aiScore === 'hot' && (
            <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-bold px-1.5 h-[18px] rounded bg-rose-500/12 text-rose-700 border border-rose-500/25">
              <Flame className="h-2.5 w-2.5" /> hot
            </span>
          )}
        </div>
        {lead.company && <p className="text-[12px] text-muted-foreground truncate">{lead.company}</p>}
        <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground flex-wrap pt-1">
          {lead.contact && (
            <a href={`tel:${lead.contact}`} className="flex items-center gap-1 text-primary hover:underline tabular-nums">
              <Phone className="h-3 w-3" /> {lead.contact}
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-foreground">
              <Mail className="h-3 w-3" /> {lead.email}
            </a>
          )}
          {(lead.estimatedValue || 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold tabular-nums">
              <IndianRupee className="h-3 w-3" />{lead.estimatedValue!.toLocaleString('en-IN')}
            </span>
          )}
        </div>
      </section>

      {/* AI score block */}
      <section className="p-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">AI score</p>
          <AIInsight.Badge aiUsed={!!insights?.aiScore} />
          <button
            onClick={rescoreLead}
            disabled={rescoring}
            className="ml-auto h-6 w-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center disabled:opacity-50"
            title="Re-score with Gemini"
          >
            {rescoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        </div>
        {loading ? (
          <AIInsight.Skeleton lines={2} />
        ) : !insights?.aiScore ? (
          <p className="text-[11.5px] text-muted-foreground">Not scored yet. Click the refresh icon to ask Gemini.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 h-[22px] rounded font-bold uppercase text-[11px] ${
                scoreTone === 'danger'  ? 'bg-rose-500/12 text-rose-700' :
                scoreTone === 'success' ? 'bg-emerald-500/12 text-emerald-700' :
                                          'bg-muted text-muted-foreground'
              }`}>
                {(() => { const Icon = scoreIcon; return <Icon className="h-3 w-3" />; })()}
                {insights.aiScore}
              </span>
              {insights.aiReason && (
                <span className="text-[12px] text-foreground/80 leading-snug">{insights.aiReason}</span>
              )}
            </div>
            {insights.aiNextAction && (
              <p className="text-[12px] text-foreground bg-primary/[0.06] border border-primary/20 rounded-md px-2.5 py-1.5 leading-snug">
                <span className="font-semibold">Next:</span> {insights.aiNextAction}
              </p>
            )}
          </>
        )}
      </section>

      {/* Heuristic insights — closing probability, ghosting risk */}
      <section className="p-4 space-y-2">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Operational signals</p>
          <AIInsight.Badge aiUsed={false} />
        </div>
        {loading || !insights ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat
                block
                value={`${insights.closingProbability}%`}
                label="closing prob."
                tone={insights.closingProbability >= 60 ? 'success' : insights.closingProbability >= 30 ? 'warning' : 'muted'}
              />
              <Stat
                block
                value={`${insights.ghostingRisk}%`}
                label="ghosting risk"
                tone={insights.ghostingRisk >= 70 ? 'danger' : insights.ghostingRisk >= 40 ? 'warning' : 'muted'}
              />
            </div>
            {insights.ghostingRisk >= 50 && (
              <AIInsight.Warning
                tone={insights.ghostingRisk >= 70 ? 'danger' : 'warning'}
                title={insights.ghostingRisk >= 70 ? 'High ghosting risk' : 'Going quiet'}
                detail={insights.nextMove}
                aiUsed={false}
              />
            )}
            {insights.ghostingRisk < 50 && insights.nextMove && (
              <p className="text-[11.5px] text-muted-foreground inline-flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {insights.nextMove}
              </p>
            )}
          </>
        )}
      </section>

      {/* Drafted follow-up */}
      <section className="p-4 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Drafted follow-up</p>
          <AIInsight.Badge aiUsed={!!followup?.aiUsed} />
        </div>

        {/* Channel toggle */}
        <div className="inline-flex bg-muted rounded-md p-0.5 text-[11.5px] font-semibold">
          {(['whatsapp', 'email'] as const).map(c => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`px-2.5 h-6 rounded transition-colors ${
                channel === c ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c === 'whatsapp' ? 'WhatsApp' : 'Email'}
            </button>
          ))}
        </div>

        {!followup ? (
          <Button
            size="sm"
            intent="primary"
            loading={drafting}
            onClick={draftFollowup}
            iconLeft={<MessageSquare className="h-3 w-3" />}
            full
          >
            Draft {channel === 'whatsapp' ? 'WhatsApp' : 'email'} follow-up
          </Button>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap">
              {followup.message}
            </div>
            <p className="text-[10.5px] text-muted-foreground">
              {followup.daysSinceLastContact === 0
                ? 'No prior contact recorded'
                : `${followup.daysSinceLastContact}d since last contact`}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                size="xs"
                intent="primary"
                onClick={copy}
                iconLeft={copied ? <Check className="h-3 w-3 text-white" /> : <Copy className="h-3 w-3" />}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {channel === 'whatsapp' && lead.contact && (
                <Button size="xs" intent="secondary" onClick={openOnPhone} iconLeft={<ExternalLink className="h-3 w-3" />}>
                  Open WhatsApp
                </Button>
              )}
              <Button
                size="xs"
                intent="ghost"
                onClick={draftFollowup}
                loading={drafting}
                iconLeft={<RefreshCw className="h-3 w-3" />}
              >
                Regenerate
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export { StatusPill as _StatusPill };
