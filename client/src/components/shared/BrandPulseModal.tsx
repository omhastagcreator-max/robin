import { useEffect, useState } from 'react';
import { HelpCircle, Loader2, Send, UserX, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * BrandPulseModal — the random brand-accountability question.
 *
 * Polls /brand-pulse/pending every 60s (plus on mount). When a pending
 * question exists it renders a BLOCKING, undismissable modal — same
 * owner rule as the daily check-ins: answer (≥10 chars) or redirect to
 * the teammate who actually manages the brand; then Robin continues.
 *
 * Redirect flow: "I don't manage this brand" → pick the teammate who
 * does → the same question instantly becomes THEIR pending pulse.
 * Chains are capped server-side at 2 hops.
 *
 * Staff-only (employee / sales / workroom). Admins are never asked, so
 * the poll is skipped entirely for them.
 */
const MIN_ANSWER = 10;

interface Pulse {
  _id: string;
  clientName: string;
  question: string;
  questionKind: string;
  redirectedFrom?: string | null;
  askedAt: string;
}

const KIND_LABEL: Record<string, string> = {
  sales_achieved: 'Sales',
  target_status:  'Target',
  next_plan:      'Next plan',
  ad_performance: 'Meta ads',
  blockers:       'Blockers',
  client_update:  'Client update',
  engagement:     'Engagement',
  content_script: 'Script / content',
};

export function BrandPulseModal() {
  const { role, user } = useAuth();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [redirectMode, setRedirectMode] = useState(false);
  const [teammates, setTeammates] = useState<Array<{ _id: string; name: string; role: string }>>([]);
  const [redirectTo, setRedirectTo] = useState('');

  const isStaff = !!role && ['employee', 'sales', 'workroom'].includes(role);

  // Poll for a pending question — on mount, then every 60s.
  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    const check = () => {
      api.getMyBrandPulse()
        .then((p: Pulse | null) => { if (!cancelled) setPulse(p); })
        .catch(() => { /* silent — next poll retries */ });
    };
    check();
    const i = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [isStaff]);

  // Load teammates lazily, only when the user opens the redirect picker.
  useEffect(() => {
    if (!redirectMode || teammates.length > 0) return;
    api.listUsers({ isActive: true })
      .then((users: any[]) => {
        setTeammates((users || [])
          .filter(u => ['employee', 'sales', 'workroom', 'admin'].includes(u.role))
          .filter(u => String(u._id) !== String(user?.id))
          .map(u => ({ _id: String(u._id), name: u.name || u.email, role: u.role })));
      })
      .catch(() => toast.error("Couldn't load teammates — try again"));
  }, [redirectMode, teammates.length, user]);

  // Modal lock while visible — block Escape + body scroll (owner rule:
  // popups are not removable).
  useEffect(() => {
    if (!pulse) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [pulse]);

  if (!isStaff || !pulse) return null;

  const reset = () => {
    setPulse(null); setAnswer(''); setRedirectMode(false); setRedirectTo('');
  };

  const submit = async () => {
    if (answer.trim().length < MIN_ANSWER || submitting) return;
    setSubmitting(true);
    try {
      await api.answerBrandPulse(pulse._id, answer.trim());
      toast.success('Answer recorded — back to it!');
      reset();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Couldn't submit — try again");
    } finally { setSubmitting(false); }
  };

  const redirect = async () => {
    if (!redirectTo || submitting) return;
    setSubmitting(true);
    try {
      const r = await api.redirectBrandPulse(pulse._id, redirectTo);
      toast.success(`Question sent to ${r?.redirectedTo || 'them'}.`);
      reset();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Couldn't redirect — try again");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[140] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-3xl shadow-2xl w-full max-w-lg border border-border overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-400/20 via-violet-400/15 to-fuchsia-400/15 border-b border-border/40">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30 shrink-0">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold leading-tight">Quick brand check: {pulse.clientName}</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Random pulse — answer to continue, or pass it to whoever manages this brand.
              </p>
            </div>
            <span className="hidden sm:inline-flex h-6 px-2 rounded-full bg-indigo-500/15 text-indigo-700 text-[10px] font-bold tracking-wider items-center border border-indigo-500/30 shrink-0">
              {KIND_LABEL[pulse.questionKind] || 'Pulse'}
            </span>
          </div>
        </div>

        {/* Question + answer */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm font-semibold flex items-start gap-2">
            <HelpCircle className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
            {pulse.question}
          </p>

          {!redirectMode ? (
            <>
              <textarea
                value={answer}
                onChange={e => setAnswer(e.target.value.slice(0, 2000))}
                rows={4}
                autoFocus
                placeholder="Numbers, status, next steps — whatever you actually know right now…"
                className="w-full rounded-xl bg-muted/30 border border-border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400/40 resize-none"
              />
              <p className="text-[10.5px] text-muted-foreground">
                {answer.trim().length < MIN_ANSWER
                  ? `At least ${MIN_ANSWER} characters — one-word answers don't count.`
                  : 'Looks good — submit when ready.'}
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-[12px] font-semibold">Who manages {pulse.clientName}?</p>
              <select
                value={redirectTo}
                onChange={e => setRedirectTo(e.target.value)}
                className="w-full h-9 px-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
              >
                <option value="">Pick a teammate…</option>
                {teammates.map(t => (
                  <option key={t._id} value={t._id}>{t.name} ({t.role})</option>
                ))}
              </select>
              <p className="text-[10.5px] text-muted-foreground">
                The same question will pop up for them — and the report shows you passed it on.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3.5 flex items-center justify-between gap-3 bg-card/80">
          {!redirectMode ? (
            <>
              <button
                onClick={() => setRedirectMode(true)}
                className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <UserX className="h-3.5 w-3.5" /> I don't manage this brand
              </button>
              <button
                onClick={submit}
                disabled={answer.trim().length < MIN_ANSWER || submitting}
                className="h-9 px-4 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-md shadow-indigo-500/30 disabled:opacity-50 disabled:shadow-none transition-all"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit answer
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setRedirectMode(false); setRedirectTo(''); }}
                className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Actually, I'll answer
              </button>
              <button
                onClick={redirect}
                disabled={!redirectTo || submitting}
                className="h-9 px-4 rounded-xl bg-foreground text-background text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-all"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send to them
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default BrandPulseModal;
