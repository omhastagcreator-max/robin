import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  ArrowLeft, CheckCircle2, Circle, Clock,
  Loader2, MessageSquare, Send, RotateCcw, Phone, Mail,
  Lock, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * ClientWorkflowDetailPage — the full pipeline for one client.
 *
 *   ┌── Acme Corp ── 60% done · now: Meta Ads ─────────────────────┐
 *   │ [Web Edits ✓] [Influencer 80%] [Meta Ads (you, 3/7)]         │
 *   │                                                                │
 *   │ Active: Meta Ads                                              │
 *   │   ☑ Ad account access verified                                │
 *   │   ☑ Pixel set up                                              │
 *   │   ☐ Campaign structure approved                               │
 *   │   ☐ Creatives received                                        │
 *   │   …                                                            │
 *   │   [Mark service done — unlocks Reporting]                     │
 *   │   [Return to Web Dev with a reason]                           │
 *   │                                                                │
 *   │ Activity log: every action, every note                        │
 *   └────────────────────────────────────────────────────────────────┘
 */

interface ChecklistItem { text: string; done: boolean; doneAt?: string; doneBy?: string; }
interface Service {
  _id: string;
  serviceType: string;
  label: string;
  assignedTo?: string;
  assignee?: { name?: string; email?: string };
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  startedAt?: string;
  completedAt?: string;
  returnedReason?: string;
}
interface Activity { at: string; actorId: string; actorName?: string; action: string; serviceType?: string; detail?: string; }
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: Service[];
  activity: Activity[];
  updatedAt: string;
}

const STATUS_TONE: Record<string, string> = {
  done:        'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  in_progress: 'bg-blue-500/15    text-blue-700    border-blue-500/30',
  blocked:     'bg-slate-500/15   text-slate-700   border-slate-500/30',
  pending:     'bg-muted          text-muted-foreground border-border',
};
const STATUS_ICON: Record<string, any> = {
  done: CheckCircle2, in_progress: Clock, blocked: Lock, pending: Circle,
};
const STATUS_LABEL: Record<string, string> = {
  done: 'Done', in_progress: 'In progress', blocked: 'Waiting', pending: 'Not started',
};

export default function ClientWorkflowDetailPage() {
  const { id }     = useParams();
  const { user, role } = useAuth();
  const isAdmin = role === 'admin';
  const [wf, setWf]       = useState<Workflow | null>(null);
  const [loading, setL]   = useState(true);
  const [activeSvc, setActiveSvc] = useState<string>(''); // service _id
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  // Admin reassign dropdown — list of teammates loaded once on mount.
  const [teammates, setTeammates] = useState<Array<{ _id: string; name?: string; email: string }>>([]);
  useEffect(() => {
    if (!isAdmin) return;
    api.listUsers({}).then((d: any[]) => {
      setTeammates(Array.isArray(d) ? d.filter(u => ['admin', 'employee', 'sales'].includes(u.role)) : []);
    }).catch(() => {});
  }, [isAdmin]);

  const reassign = async (svcId: string, userId: string) => {
    if (!wf) return;
    setBusy(true);
    try {
      const updated = await api.cwReassignService(wf._id, svcId, { userId });
      setWf(updated);
      toast.success('Reassigned');
    } catch { /* interceptor toasts */ }
    finally { setBusy(false); }
  };

  const load = async () => {
    if (!id) return;
    try {
      const data = await api.cwGetWorkflow(id);
      setWf(data);
      if (!activeSvc && data?.services?.length) {
        // Default to the first not-done service
        const first = data.services.find((s: Service) => s.status !== 'done') || data.services[0];
        setActiveSvc(first._id);
      }
    } catch { /* axios toast */ }
    finally { setL(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (loading && !wf) return <AppLayout><div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppLayout>;
  if (!wf) return <AppLayout><div className="py-16 text-center text-sm text-muted-foreground">Pipeline not found.</div></AppLayout>;

  const active = wf.services.find(s => s._id === activeSvc);
  const totalItems = wf.services.reduce((n, s) => n + s.checklist.length, 0);
  const doneItems  = wf.services.reduce((n, s) => n + s.checklist.filter(c => c.done).length, 0);
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  // ── Checklist actions ────────────────────────────────────────────────
  // Every action requires a short comment that lands in the activity log
  // for admin audit. We use window.prompt for minimum-friction capture;
  // the comment is part of the request body and is validated server-side.
  const toggleItem = async (svcId: string, index: number, done: boolean) => {
    if (!wf) return;
    const verb = done ? 'tick' : 'untick';
    const note = window.prompt(`Add a quick note for this ${verb}:`, '');
    if (note === null) return;
    if (note.trim().length < 3) { toast.error('Please write a few words.'); return; }
    setBusy(true);
    try {
      const updated = await api.cwToggleCheck(wf._id, svcId, { index, done, comment: note.trim() });
      setWf(updated);
    } catch { /* interceptor toasts */ }
    finally { setBusy(false); }
  };
  const completeService = async (svcId: string) => {
    if (!wf) return;
    const note = window.prompt('Add a comment explaining what was completed (visible to admin):', '');
    if (note === null) return;
    if (note.trim().length < 3) { toast.error('Please write a few words.'); return; }
    setBusy(true);
    try {
      const updated = await api.cwCompleteService(wf._id, svcId, { comment: note.trim() });
      setWf(updated);
      toast.success('Service completed');
    } catch { /* interceptor */ }
    finally { setBusy(false); }
  };

  // ── AI: "Where is this client?" summary ─────────────────────────────
  const [aiSummary, setAiSummary] = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const generateAiSummary = async () => {
    if (!wf || aiLoading) return;
    setAiLoading(true);
    try {
      const r = await api.aiSummarizeWorkflow(wf._id);
      setAiSummary(r);
    } catch { /* interceptor */ }
    finally { setAiLoading(false); }
  };
  const returnTo = async (targetServiceType: string) => {
    const reason = window.prompt('Why are you returning this? (the other team will see this note)');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const updated = await api.cwReturnService(wf._id, { targetServiceType, reason: reason.trim() });
      setWf(updated);
      toast.success('Returned with a note');
    } catch { /* interceptor */ }
    finally { setBusy(false); }
  };
  const sendNote = async () => {
    if (!note.trim() || !wf) return;
    setBusy(true);
    try {
      const updated = await api.cwAddNote(wf._id, { detail: note.trim(), serviceType: active?.serviceType });
      setWf(updated); setNote('');
    } catch { /* interceptor */ }
    finally { setBusy(false); }
  };

  // Multi-role aware — primary role admin OR roles[] contains admin OR
  // they're the assignee. Matches the server-side requireRole check.
  const isAdminEffective = role === 'admin' || ((user as any)?.roles || []).includes('admin');
  const canEditActive = active && (active.assignedTo === user?.id || isAdminEffective);
  const allItemsDone  = active && active.checklist.length > 0 && active.checklist.every(c => c.done);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Back + header */}
        <Link to="/clients/pipeline" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to pipeline
        </Link>

        {/* Client header — no card chrome, lives in page flow. The slim
            progress bar sits inline with the name + meta. */}
        <div className="flex items-start justify-between gap-4 flex-wrap pt-1">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{wf.clientName || 'Client'}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
              {wf.clientPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{wf.clientPhone}</span>}
              {wf.clientEmail && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" />{wf.clientEmail}</span>}
            </div>
          </div>
          <div className="min-w-[180px]">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Overall</span>
              <span className="text-sm font-bold tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{doneItems} of {totalItems} steps done</p>
          </div>
        </div>

        {/* AI "Where is this client?" card — one-click status paragraph
            that the team can paste verbatim to the client. Generated by
            Gemini from the services + activity log. */}
        <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-3 flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">AI status snapshot</p>
            {aiSummary ? (
              <p className="text-sm mt-1 leading-relaxed">{aiSummary.text}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Get a 1-paragraph "where is this client?" summary you can read or paste to them.</p>
            )}
          </div>
          <button
            onClick={generateAiSummary}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiSummary ? 'Regenerate' : 'Generate'}
          </button>
        </div>

        {/* Service tabs — single muted strip with simple text labels.
            Was 3 large coloured cards each with their own border + ring +
            status icon + count + 'you' badge stacking up. Now: just the
            label + count, active tab gets a subtle bottom underline. */}
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 border-b border-border">
          {wf.services.map(s => {
            const isActive = activeSvc === s._id;
            const isMine = s.assignedTo === user?.id;
            const ticked = s.checklist.filter(c => c.done).length;
            const dot =
              s.status === 'done'        ? 'bg-emerald-500' :
              s.status === 'in_progress' ? 'bg-blue-500'    :
              s.status === 'blocked'     ? 'bg-slate-400'   :
                                            'bg-muted-foreground/40';
            return (
              <button key={s._id} onClick={() => setActiveSvc(s._id)}
                className={`shrink-0 px-3 py-2.5 text-left transition-colors -mb-px border-b-2 ${
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  <span className="text-sm font-semibold">{s.label}</span>
                  {isMine && <span className="text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1 rounded">you</span>}
                  <span className="text-[11px] text-muted-foreground tabular-nums">{ticked}/{s.checklist.length}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Active service detail — no card chrome, lives in page flow.
            The owner + complete-button row separates from the checklist
            by spacing alone, no border. */}
        {active && (
          <motion.div key={active._id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-3">
            {/* Header row */}
            <div className="flex items-center gap-3 flex-wrap pt-2">
              <div className="flex-1">
                <p className="text-sm font-bold">{active.label}</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <span>
                    {active.assignee?.name ? <>Owner: <strong className="text-foreground">{active.assignee.name}</strong></> : 'Unassigned'}
                  </span>
                  {/* Admin-only inline reassign — was the missing UI flagged in the audit. */}
                  {isAdmin && (
                    <select
                      value={active.assignedTo || ''}
                      onChange={e => reassign(active._id, e.target.value)}
                      disabled={busy}
                      className="text-[10px] px-1.5 py-0.5 bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                      title="Reassign this service"
                    >
                      <option value="">— change owner —</option>
                      {teammates.map(t => <option key={t._id} value={t._id}>{t.name || t.email}</option>)}
                    </select>
                  )}
                  {active.status === 'blocked' && <span>· waiting on an earlier service</span>}
                </p>
                {active.returnedReason && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    ⚠️ Returned: "{active.returnedReason}"
                  </p>
                )}
              </div>
              {canEditActive && allItemsDone && active.status !== 'done' && (
                <button onClick={() => completeService(active._id)} disabled={busy}
                  className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" /> Mark service done
                </button>
              )}
            </div>

            {/* Checklist — bare items, hover-only background, no per-item
                container chrome. Reads as a clean list. */}
            <div className="space-y-0.5">
              {active.checklist.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No SOP items for this service.</p>
              ) : (
                active.checklist.map((c, i) => (
                  <label key={i}
                    className={`flex items-start gap-3 px-2 py-2 rounded-lg transition-colors ${
                      canEditActive && active.status !== 'blocked' ? 'hover:bg-muted/40 cursor-pointer' : 'opacity-80'
                    }`}>
                    <input type="checkbox" checked={c.done}
                      disabled={!canEditActive || active.status === 'blocked' || busy}
                      onChange={e => toggleItem(active._id, i, e.target.checked)}
                      className="mt-0.5 h-[18px] w-[18px] accent-primary shrink-0 cursor-pointer" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${c.done ? 'line-through text-muted-foreground' : ''}`}>{c.text}</p>
                      {c.done && c.doneAt && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Ticked {formatDistanceToNow(new Date(c.doneAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            {/* Return to a previous service — single quiet text row */}
            {canEditActive && active.status !== 'done' && active.status !== 'blocked' && (
              <div className="pt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Needs rework? Return to:</span>
                {wf.services
                  .filter(s => s.status === 'done' || s.status === 'in_progress')
                  .filter(s => s._id !== active._id)
                  .map(s => (
                    <button key={s._id} onClick={() => returnTo(s.serviceType)}
                      className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 border border-amber-500/30 text-[11px] font-semibold hover:bg-amber-500/20">
                      ↺ {s.label}
                    </button>
                  ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Notes + activity log */}
        <div className="rounded-2xl border border-border bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Activity log</h3>
            <span className="text-[11px] text-muted-foreground">— everyone on this client can see this</span>
          </div>
          {/* Quick note */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <input value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendNote(); }}
              placeholder="Add a note (visible to the whole team on this client)…"
              className="flex-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <button onClick={sendNote} disabled={busy || !note.trim()}
              className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </div>
          {/* Log */}
          <div className="px-4 py-3 max-h-96 overflow-y-auto space-y-2 text-xs">
            {wf.activity.length === 0 ? (
              <p className="text-muted-foreground text-center py-3">No activity yet.</p>
            ) : (
              [...wf.activity].reverse().map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0"
                    title={a.actorName || ''}>
                    {(a.actorName || 'Someone').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="leading-tight">
                      {a.actorName && <span className="font-semibold">{a.actorName} </span>}
                      <span>{actionLabel(a.action).toLowerCase()}</span>
                      {a.serviceType && <span className="text-muted-foreground"> · {a.serviceType.replace(/_/g, ' ')}</span>}
                      {a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(a.at), { addSuffix: true })} · {format(new Date(a.at), 'd MMM, h:mm a')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function actionLabel(a: string): string {
  switch (a) {
    case 'created':           return 'Pipeline created';
    case 'services_added':    return 'Services added';
    case 'item_checked':      return 'Checked';
    case 'item_unchecked':    return 'Unchecked';
    case 'service_completed': return 'Service completed';
    case 'service_returned':  return 'Service returned';
    case 'reassigned':        return 'Reassigned';
    case 'note':              return 'Note';
    default:                  return a;
  }
}
