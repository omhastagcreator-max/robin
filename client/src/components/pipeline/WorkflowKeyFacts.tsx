import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, ShieldCheck, CalendarClock, AlertTriangle, ChevronDown,
  UserSquare, MessageSquare, Send, Loader2, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRobinCopilot } from '@/components/ai/RobinCopilot';

/**
 * WorkflowKeyFacts — the new top-of-page "what do I need to know about
 * this project in 2 seconds" strip on ClientWorkflowDetailPage.
 *
 * Renders a single row of facts (health, priority, risk, ETA, owner-team,
 * predicted completion) followed by a quick-action toolbar:
 *
 *   [Priority ▼]  [Post note]  [Ask Robin]
 *
 * The priority dropdown does an inline change via `onPriority(value)` so
 * the rep doesn't have to open a modal to bump a project to "urgent".
 * The note input is the same inline pattern as the activity log — Enter
 * sends, posts on the activity feed AND fires a notification to assignees.
 */

interface Props {
  wf: {
    _id: string;
    priority?: 'low'|'medium'|'high'|'urgent';
    riskScore?: number;
    eta?: string | null;
    predictedCompletionAt?: string | null;
    currentOwnerTeam?: '' | 'sales' | 'development' | 'meta' | 'influencer' | 'qa';
    blockerType?: string;
  };
  onPriority: (p: 'low'|'medium'|'high'|'urgent') => Promise<void>;
  onPostNote: (text: string) => Promise<void>;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  urgent: { bg: 'bg-rose-500/15',   text: 'text-rose-700',   ring: 'ring-rose-400/60',   label: 'Urgent' },
  high:   { bg: 'bg-orange-500/15', text: 'text-orange-700', ring: 'ring-orange-400/60', label: 'High'   },
  medium: { bg: 'bg-muted',         text: 'text-muted-foreground', ring: 'ring-border',  label: 'Medium' },
  low:    { bg: 'bg-muted/60',      text: 'text-muted-foreground', ring: 'ring-border',  label: 'Low'    },
};

const TEAM_LABEL: Record<string, string> = {
  sales: 'Sales', development: 'Dev', meta: 'Meta', influencer: 'Influencer', qa: 'QA',
};

function fmtDaysFromNow(iso: string | null | undefined): { label: string; tone: 'danger'|'warning'|'muted' } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  const d = Math.round((ms - Date.now()) / (24 * 3600 * 1000));
  if (d < 0)  return { label: `${Math.abs(d)}d overdue`, tone: 'danger' };
  if (d === 0) return { label: 'today',                  tone: 'warning' };
  if (d <= 3)  return { label: `in ${d}d`,               tone: 'warning' };
  return { label: `in ${d}d`, tone: 'muted' };
}

export function WorkflowKeyFacts({ wf, onPriority, onPostNote }: Props) {
  const [priOpen, setPriOpen]   = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote]         = useState('');
  const [busy, setBusy]         = useState(false);
  const openCopilot             = useRobinCopilot();

  const pri = wf.priority || 'medium';
  const priStyle = PRIORITY_STYLES[pri];
  const etaInfo  = fmtDaysFromNow(wf.eta);
  const predInfo = fmtDaysFromNow(wf.predictedCompletionAt);

  const riskTone: 'danger' | 'warning' | 'muted' =
    (wf.riskScore ?? 0) >= 70 ? 'danger'  :
    (wf.riskScore ?? 0) >= 40 ? 'warning' :
                                 'muted';

  const setPri = async (p: 'low'|'medium'|'high'|'urgent') => {
    if (p === pri) { setPriOpen(false); return; }
    setBusy(true);
    try { await onPriority(p); toast.success(`Priority set to ${p}.`); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not change priority.'); }
    finally { setBusy(false); setPriOpen(false); }
  };

  const sendNote = async () => {
    const t = note.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    try { await onPostNote(t); setNote(''); setNoteOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Key facts strip */}
      <div className="px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
        {/* Priority chip */}
        <FactChip
          icon={<Flame className="h-3 w-3" />}
          label="Priority"
          value={
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold ${priStyle.bg} ${priStyle.text}`}>
              {priStyle.label}
            </span>
          }
        />

        {/* Risk score */}
        <FactChip
          icon={<AlertTriangle className="h-3 w-3" />}
          label="Risk"
          value={
            <span className={`text-[12.5px] font-bold tabular-nums ${
              riskTone === 'danger' ? 'text-rose-700' :
              riskTone === 'warning' ? 'text-amber-700' :
                                       'text-foreground'
            }`}>
              {wf.riskScore ?? 0}
              <span className="text-muted-foreground text-[10.5px] font-normal"> /100</span>
            </span>
          }
        />

        {/* ETA */}
        <FactChip
          icon={<CalendarClock className="h-3 w-3" />}
          label="ETA"
          value={
            etaInfo
              ? <span className={`text-[12.5px] font-semibold ${
                  etaInfo.tone === 'danger'  ? 'text-rose-700' :
                  etaInfo.tone === 'warning' ? 'text-amber-700' :
                                               'text-foreground'
                }`}>{etaInfo.label}</span>
              : <span className="text-[12.5px] text-muted-foreground italic">not set</span>
          }
        />

        {/* AI predicted */}
        {predInfo && (
          <FactChip
            icon={<Sparkles className="h-3 w-3" />}
            label="AI predicts"
            value={<span className="text-[12.5px] text-muted-foreground">{predInfo.label}</span>}
          />
        )}

        {/* Owner team */}
        {wf.currentOwnerTeam && (
          <FactChip
            icon={<UserSquare className="h-3 w-3" />}
            label="On"
            value={<span className="text-[12.5px] font-semibold capitalize">{TEAM_LABEL[wf.currentOwnerTeam] || wf.currentOwnerTeam}</span>}
          />
        )}

        {/* Blocker fact (only when present) */}
        {wf.blockerType && (
          <FactChip
            icon={<ShieldCheck className="h-3 w-3 text-rose-600" />}
            label="Blocked"
            value={<span className="text-[12.5px] font-semibold text-rose-700 capitalize">{wf.blockerType.replace(/_/g, ' ')}</span>}
          />
        )}
      </div>

      {/* Quick-action toolbar */}
      <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center gap-2 flex-wrap">
        {/* Priority */}
        <div className="relative">
          <button
            onClick={() => setPriOpen(o => !o)}
            disabled={busy}
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11.5px] font-semibold transition-colors ${priStyle.bg} ${priStyle.text} border-transparent ring-1 ${priStyle.ring} disabled:opacity-50`}
          >
            <Flame className="h-3 w-3" /> Priority: {priStyle.label}
            <ChevronDown className="h-3 w-3" />
          </button>
          <AnimatePresence>
            {priOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute z-30 top-full left-0 mt-1 rounded-lg border border-border bg-card shadow-xl overflow-hidden"
              >
                {(['urgent','high','medium','low'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPri(p)}
                    className="w-28 text-left px-3 py-1.5 text-[12px] hover:bg-muted capitalize"
                  >{p}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Post note inline */}
        <button
          onClick={() => setNoteOpen(o => !o)}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-card border border-border text-[11.5px] font-semibold hover:border-primary/30"
        >
          <MessageSquare className="h-3 w-3" /> Quick note
        </button>

        {/* Ask Robin — opens the persistent thread drawer with this workflow's context */}
        <button
          onClick={openCopilot}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-card border border-border text-[11.5px] font-semibold hover:border-primary/30"
        >
          <Sparkles className="h-3 w-3 text-primary" /> Ask Robin
        </button>

        {/* Inline note row */}
        <AnimatePresence>
          {noteOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full overflow-hidden"
            >
              <div className="pt-2 flex items-center gap-2">
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Note to drop on this project's activity feed…"
                  maxLength={600}
                  className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={e => { if (e.key === 'Enter') sendNote(); }}
                />
                <button
                  onClick={sendNote}
                  disabled={busy || note.trim().length < 3}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Post
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FactChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
