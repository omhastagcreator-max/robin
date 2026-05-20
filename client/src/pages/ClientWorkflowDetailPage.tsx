import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ChevronDown, Loader2, MessageSquare, RotateCcw,
  Phone, Mail, Sparkles, ShieldX, Unlock, CheckCircle2, ExternalLink,
  X, AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Stat }        from '@/components/ui/Stat';
import { Row }         from '@/components/ui/Row';
import { EmptyState }  from '@/components/ui/EmptyState';
import { Avatar }      from '@/components/shared/Avatar';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import { AIInsight } from '@/components/ai/AIInsight';
import { Send } from 'lucide-react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * InlineNoteInput — single-line input replacing the old "Add a note" button
 * that used to open the CommentRequiredModal. Notes don't need a modal; they
 * need to land fast. Enter sends; Cmd-Enter also sends. Empty/short text is
 * ignored. Multi-paragraph notes still go through the modal via Cmd-Shift
 * (future).
 */
function InlineNoteInput({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setText('');
    } finally { setBusy(false); }
  };
  return (
    <div className="px-3 py-2 border-b border-border flex items-center gap-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); send(); }
        }}
        placeholder="Drop a note — visible to the whole team on this client…"
        maxLength={600}
        className="flex-1 min-w-0 px-3 h-9 bg-background border border-input rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        onClick={send}
        disabled={busy || text.trim().length < 3}
        className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 hover:bg-primary/90"
        title="Send (Enter)"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/**
 * ClientWorkflowDetailPage — v2 rebuild.
 *
 * Anatomy:
 *   ┌─ Back link
 *   │ Client name (h1) ............................ Overall %
 *   │ phone · email                                 progress bar
 *   │ [health pill] [Mark blocked / Unblock]
 *   │ (if blocked: red row with reason)
 *   ├─ AI snapshot strip (Rani Pink tint)
 *   ├─ Service tabs (slim, dotted status, count, "you")
 *   ├─ Active service block:
 *   │     Owner + reassign  · status + reason
 *   │     ⚠ blocked-by-deps notice (prep ticks still allowed)
 *   │     Checklist (always editable while you have access)
 *   │     Return to · [pills]    [Mark service done]
 *   ├─ Activity log:
 *   │     Add a note input → CommentRequiredModal
 *   │     Cursor-paginated /activity feed with "Load older"
 *   └─
 *
 * Key behaviour changes from v1:
 *   - Checklist ticking is enabled while status=blocked (server gates
 *     completeService anyway; blocking prep ticks was UI overreach).
 *   - Activity log reads the paginated WorkflowActivity feed, not the
 *     legacy inline wf.activity[] array.
 *   - Return-reason capture uses CommentRequiredModal, not window.prompt.
 *   - Block / Unblock buttons inline in the header, same modal pattern
 *     as the drawer ProjectDetailPanel.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
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
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: Service[];
  health?: string;
  healthReason?: string;
  blockerType?: string;
  blockerReason?: string;
  blockedSince?: string;
  // AI insights from the healthInference cron — see server/services/aiInsights.ts
  riskScore?:             number;
  delayCause?:             string;
  nextBestAction?:        string;
  predictedCompletionAt?: string | null;
}
interface ActivityRow {
  _id: string;
  action: string;
  serviceType?: string;
  checklistIndex?: number;
  actorId: string;
  actorName: string;
  actorRole?: string;
  comment?: string;
  before?: any;
  after?: any;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function healthToPill(h?: string): Status {
  return (h as Status) || 'healthy';
}

function actionLabel(a: ActivityRow): string {
  const verb: Record<string, string> = {
    service_started:     'Service started',
    service_completed:   'Service completed',
    service_returned:    'Service returned',
    service_reopened:    'Service reopened',
    service_blocked:     'Project blocked',
    service_unblocked:   'Project unblocked',
    checklist_checked:   'Step checked',
    checklist_unchecked: 'Step unchecked',
    service_reassigned:  'Service reassigned',
    note_added:          'Note added',
  };
  const head = verb[a.action] || a.action.replace(/_/g, ' ');
  return a.serviceType ? `${head} · ${a.serviceType.replace(/_/g, ' ')}` : head;
}

// Coloured dot used in the service tabs — small, clean, less noisy than full pills.
function statusDot(s: Service['status']): string {
  return (
    s === 'done'        ? 'bg-emerald-500'  :
    s === 'in_progress' ? 'bg-blue-500'     :
    s === 'blocked'     ? 'bg-rose-500'     :
                          'bg-muted-foreground/40'
  );
}

// Find which sibling services this service is waiting on (client-side mirror
// of the server's `blockingServices` rule — needed to render the "blocked by
// Shopify Store" notice with proper service labels).
function blockingLabels(
  service: Service,
  allServices: Service[],
  dependsOn: Record<string, string[]>,
): { type: string; label: string }[] {
  const deps = dependsOn[service.serviceType] || [];
  return deps
    .map(depType => allServices.find(s => s.serviceType === depType))
    .filter((s): s is Service => Boolean(s) && s!.status !== 'done')
    .map(s => ({ type: s.serviceType, label: s.label }));
}

// ─── Block project modal — same UX as drawer panel ────────────────────────────
const BLOCKER_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'waiting_client_input',      label: 'Waiting on client',            hint: 'Surfaces as waiting_client; client-relevant.' },
  { value: 'waiting_internal_approval', label: 'Waiting on internal approval', hint: 'Surfaces as waiting_internal.' },
  { value: 'dependency',                label: 'Dependency blocked',           hint: 'Another team / vendor / asset.' },
  { value: 'technical',                 label: 'Technical issue',              hint: 'Bug / API outage / data issue.' },
  { value: 'budget',                    label: 'Budget / scope hold',          hint: 'Awaiting commercial sign-off.' },
];

function BlockProjectModal({
  defaultType, onSubmit, onClose,
}: {
  defaultType?: string;
  onSubmit: (p: { blockerType: string; blockerReason: string; comment: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [blockerType, setBlockerType]     = useState(defaultType || 'waiting_client_input');
  const [blockerReason, setBlockerReason] = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

  const trimmed = blockerReason.trim();
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 600 && !submitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ blockerType, blockerReason: trimmed, comment: trimmed });
      onClose();
    } catch { /* caller toasts */ }
    finally { setSubmitting(false); }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldX className="h-4 w-4 text-rose-500 shrink-0" />
              <p className="text-sm font-semibold truncate">Mark project blocked</p>
            </div>
            <button onClick={onClose} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Blocker type</label>
              <div className="relative">
                <select
                  value={blockerType}
                  onChange={e => setBlockerType(e.target.value)}
                  disabled={submitting}
                  className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {BLOCKER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[11px] text-muted-foreground">{BLOCKER_OPTIONS.find(o => o.value === blockerType)?.hint}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Reason</label>
              <textarea
                ref={taRef}
                value={blockerReason}
                onChange={e => setBlockerReason(e.target.value)}
                maxLength={600}
                rows={4}
                placeholder="Say WHY this is blocked — e.g. waiting on Meta ad-account access from client."
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{trimmed.length < 3 ? `${3 - trimmed.length} more char${3 - trimmed.length === 1 ? '' : 's'} needed` : 'Looks good'}</span>
                <span className="tabular-nums">{blockerReason.length} / 600</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={submitting}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit}
                className="px-4 h-9 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white">
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? 'Saving…' : 'Mark blocked'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Activity timeline — cursor-paginated /activity feed ──────────────────────
function ActivityTimeline({ workflowId, refreshKey }: { workflowId: string; refreshKey: number }) {
  const [rows, setRows]           = useState<ActivityRow[]>([]);
  const [cursor, setCursor]       = useState<string | null>(null);
  const [hasMore, setHasMore]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.cwListActivity(workflowId, { limit: 40 });
      setRows(data.rows as ActivityRow[]);
      setCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadInitial(); /* eslint-disable-next-line */ }, [workflowId, refreshKey]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.cwListActivity(workflowId, { cursor, limit: 40 });
      setRows(prev => [...prev, ...(data.rows as ActivityRow[])]);
      setCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <div className="px-4 py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (error)   return <div className="px-4 py-3 text-[11.5px] text-rose-600">{error}</div>;
  if (rows.length === 0) return <EmptyState size="sm" title="No activity yet" />;

  return (
    <>
      {rows.map(a => (
        <Row key={a._id} density="comfy">
          <Row.Leading>
            <Avatar name={a.actorName} size="xs" />
          </Row.Leading>
          <Row.Main>
            <Row.Title>{actionLabel(a)}</Row.Title>
            {a.comment && <p className="text-[11.5px] text-foreground/80 line-clamp-2 mt-0.5">{a.comment}</p>}
            <Row.Meta>
              {a.actorName ? `${a.actorName} · ` : ''}
              {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </Row.Meta>
          </Row.Main>
        </Row>
      ))}
      {hasMore && (
        <div className="px-4 py-2">
          <Button size="xs" intent="ghost" loading={loadingMore} onClick={loadMore}>Load older</Button>
        </div>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientWorkflowDetailPage() {
  // CRITICAL: every hook for this component MUST be declared at the TOP,
  // above any early return. Adding hooks after early returns triggers
  // React error #310 ("Rendered more hooks than during the previous
  // render") on first vs. subsequent renders. Don't reorder this block.
  const { id }              = useParams();
  const { user, role }      = useAuth();
  const isAdmin             = role === 'admin';
  const isAdminEffective    = role === 'admin' || ((user as any)?.roles || []).includes('admin');

  const [wf, setWf]         = useState<Workflow | null>(null);
  const [loading, setL]     = useState(true);
  const [activeSvc, setActiveSvc] = useState<string>('');
  const [busy, setBusy]     = useState(false);

  // Pending-action state for the audit-comment modal.
  const [pendingAction, setPendingAction] = useState<null | {
    kind: 'tick' | 'untick' | 'complete' | 'return' | 'note';
    svcId?: string;
    serviceLabel?: string;
    targetServiceType?: string;
    index?: number;
    itemText?: string;
  }>(null);

  // AI snapshot.
  const [aiSummary, setAiSummary]   = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiLoading, setAiLoading]   = useState(false);

  // Teammates list for admin reassign dropdown.
  const [teammates, setTeammates] = useState<Array<{ _id: string; name?: string; email: string }>>([]);

  // Block / Unblock modal toggles.
  const [blockModalOpen, setBlockModalOpen]     = useState(false);
  const [unblockModalOpen, setUnblockModalOpen] = useState(false);

  // Force-refresh the activity timeline after any mutation.
  const [activityRev, setActivityRev] = useState(0);
  const bumpActivity = () => setActivityRev(r => r + 1);

  // Client-side dependency map — populated from templates endpoint so we
  // can render proper "waiting on X" service labels without round-trips.
  const [depsByType, setDepsByType] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!isAdmin) return;
    api.listUsers({}).then((d: any[]) => {
      setTeammates(Array.isArray(d) ? d.filter(u => ['admin', 'employee', 'sales'].includes(u.role)) : []);
    }).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    api.cwGetTemplates().then((tpl: any[]) => {
      const map: Record<string, string[]> = {};
      (tpl || []).forEach(t => { map[t.serviceType] = t.dependsOn || []; });
      setDepsByType(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setL(true);
    api.cwGetWorkflow(id)
      .then((data: Workflow) => {
        if (!alive) return;
        setWf(data);
        if (data?.services?.length) {
          const first = data.services.find(s => s.status !== 'done') || data.services[0];
          setActiveSvc(first._id);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setL(false); });
    return () => { alive = false; };
  }, [id]);

  // ── Early returns (no hooks below this line) ─────────────────────────────
  if (loading && !wf) {
    return <AppLayout><div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppLayout>;
  }
  if (!wf) {
    return <AppLayout><div className="py-16 text-center text-sm text-muted-foreground">Pipeline not found.</div></AppLayout>;
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const services   = wf.services || [];
  const active     = services.find(s => s._id === activeSvc) || services[0];
  const totalItems = services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const doneItems  = services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct        = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  const isBlocked  = Boolean(wf.blockerType);
  const blockingSiblings = active ? blockingLabels(active, services, depsByType) : [];
  const canEditActive = active && (active.assignedTo === user?.id || isAdminEffective);
  const allItemsDone  = active && active.checklist.length > 0 && active.checklist.every(c => c.done);
  const canMarkServiceDone = canEditActive && allItemsDone && active!.status !== 'done' && blockingSiblings.length === 0;

  // ── Action handlers ─────────────────────────────────────────────────────
  const generateAiSummary = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try { setAiSummary(await api.aiSummarizeWorkflow(wf!._id)); }
    catch { toast.error('AI summary failed'); }
    finally { setAiLoading(false); }
  };

  const reassign = async (svcId: string, userId: string) => {
    if (!userId) return;
    setBusy(true);
    try {
      const updated = await api.cwReassignService(wf!._id, svcId, { userId });
      setWf(updated);
      bumpActivity();
      toast.success('Reassigned');
    } catch { /* interceptor */ }
    finally { setBusy(false); }
  };

  // Open the audit-comment modal — actual API call runs in submitPending.
  const askToggle = (svcId: string, index: number, done: boolean, itemText: string, serviceLabel: string) => {
    setPendingAction({ kind: done ? 'tick' : 'untick', svcId, index, itemText, serviceLabel });
  };
  const askComplete = (svcId: string, serviceLabel: string) => {
    setPendingAction({ kind: 'complete', svcId, serviceLabel });
  };
  const askReturn = (targetServiceType: string, serviceLabel: string) => {
    setPendingAction({ kind: 'return', targetServiceType, serviceLabel });
  };
  const askNote = () => {
    setPendingAction({ kind: 'note' });
  };

  const submitPending = async (comment: string) => {
    if (!pendingAction) return;
    setBusy(true);
    try {
      const a = pendingAction;
      if (a.kind === 'complete') {
        const updated = await api.cwCompleteService(wf!._id, a.svcId!, { comment });
        setWf(updated);
        toast.success('Service completed');
      } else if (a.kind === 'tick' || a.kind === 'untick') {
        const updated = await api.cwToggleCheck(wf!._id, a.svcId!, {
          index: a.index!, done: a.kind === 'tick', comment,
        });
        setWf(updated);
      } else if (a.kind === 'return') {
        const updated = await api.cwReturnService(wf!._id, {
          targetServiceType: a.targetServiceType!, reason: comment,
        });
        setWf(updated);
        toast.success('Returned with a note');
      } else if (a.kind === 'note') {
        const updated = await api.cwAddNote(wf!._id, {
          detail: comment, serviceType: active?.serviceType,
        });
        setWf(updated);
      }
      bumpActivity();
    } catch { /* interceptor */ }
    finally { setBusy(false); }
  };

  const handleBlock = async (payload: { blockerType: string; blockerReason: string; comment: string }) => {
    try {
      const updated = await api.cwBlock(wf!._id, payload);
      setWf(updated as Workflow);
      bumpActivity();
      toast.success('Project marked blocked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to block');
      throw err;
    }
  };

  const handleUnblock = async (comment: string) => {
    try {
      const updated = await api.cwUnblock(wf!._id, { comment });
      setWf(updated as Workflow);
      bumpActivity();
      toast.success('Project unblocked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to unblock');
      throw err;
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Back link */}
        <Link to="/clients/pipeline" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to pipeline
        </Link>

        {/* Identity + overall progress */}
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight truncate">{wf.clientName || 'Client'}</h1>
              <StatusPill state={healthToPill(wf.health)} size="sm" label={wf.healthReason || undefined} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {wf.clientPhone && (
                <a href={`tel:${wf.clientPhone}`} className="flex items-center gap-1 text-primary hover:underline tabular-nums">
                  <Phone className="h-3 w-3" /> {wf.clientPhone}
                </a>
              )}
              {wf.clientEmail && (
                <a href={`mailto:${wf.clientEmail}`} className="flex items-center gap-1 hover:text-foreground">
                  <Mail className="h-3 w-3" /> {wf.clientEmail}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              {!isBlocked ? (
                <Button size="xs" intent="secondary" iconLeft={<ShieldX className="h-3 w-3" />}
                  onClick={() => setBlockModalOpen(true)}>
                  Mark blocked
                </Button>
              ) : (
                <>
                  <Button size="xs" intent="primary" iconLeft={<Unlock className="h-3 w-3" />}
                    onClick={() => setUnblockModalOpen(true)}>
                    Unblock
                  </Button>
                </>
              )}
            </div>
            {isBlocked && (
              <div className="flex items-start gap-2 text-[12px] text-rose-700 bg-rose-500/[0.06] border border-rose-500/20 rounded-lg px-3 py-2 max-w-xl">
                <ShieldX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="leading-snug">
                  <strong className="capitalize">{wf.blockerType?.replace(/_/g, ' ')}</strong>
                  {wf.blockerReason && <> · {wf.blockerReason}</>}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-[200px]">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Overall</span>
              <span className="text-lg font-bold tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center gap-3 mt-2">
              <Stat value={`${doneItems}/${totalItems}`} label="steps" tone="muted" />
              <Stat value={services.length} label="services" tone="muted" />
            </div>
          </div>
        </div>

        {/* ── AI operational insight strip ─ inline, no model call ──────
            Always-fresh from the healthInference cron (no Gemini bill).
            Hidden when the workflow is healthy + on track. */}
        {((wf.riskScore ?? 0) >= 40 || wf.delayCause || wf.nextBestAction || wf.predictedCompletionAt) && (
          <div className="flex items-center gap-2 text-[12px] flex-wrap rounded-lg bg-muted/40 border border-border px-3 py-2">
            <AIInsight.Badge aiUsed={false} />
            {typeof wf.riskScore === 'number' && wf.riskScore > 0 && (
              <span className={`inline-flex items-center gap-1 font-bold ${
                wf.riskScore >= 70 ? 'text-rose-700'  :
                wf.riskScore >= 40 ? 'text-amber-700' :
                                     'text-muted-foreground'
              }`}>
                Risk {wf.riskScore}
              </span>
            )}
            {wf.delayCause && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground/80">{wf.delayCause}</span>
              </>
            )}
            {wf.nextBestAction && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground/80 inline-flex items-center gap-1">
                  <ArrowLeft className="h-2.5 w-2.5 rotate-180 text-primary" />
                  Next: <span className="font-medium">{wf.nextBestAction}</span>
                </span>
              </>
            )}
            {wf.predictedCompletionAt && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">
                  Predicts {(() => {
                    const days = Math.round((new Date(wf.predictedCompletionAt).getTime() - Date.now()) / (24 * 3600 * 1000));
                    return days < 0 ? `${Math.abs(days)}d past` : days === 0 ? 'today' : `in ${days}d`;
                  })()}
                </span>
              </>
            )}
          </div>
        )}

        {/* ── AI status snapshot ─ one-line strip, expand into AIInsight.Summary
            when the model has actually produced something. No more giant
            empty placeholder card. */}
        {aiSummary ? (
          <AIInsight.Summary
            text={aiSummary.text}
            aiUsed={aiSummary.aiUsed}
            label="Client-facing summary"
            loading={aiLoading}
            onRegenerate={generateAiSummary}
            onDismiss={() => setAiSummary(null)}
          />
        ) : (
          <div className="flex items-center gap-2 text-[12px] rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">Need a paste-ready client update?</span>
            <Button
              size="xs"
              intent="primary"
              loading={aiLoading}
              onClick={generateAiSummary}
              className="ml-auto"
            >
              Generate
            </Button>
          </div>
        )}

        {/* Service tabs (slim, dotted) */}
        <div className="flex items-center gap-0 overflow-x-auto border-b border-border">
          {services.map(s => {
            const isActive = active?._id === s._id;
            const isMine   = s.assignedTo === user?.id;
            const ticked   = s.checklist.filter(c => c.done).length;
            return (
              <button key={s._id} onClick={() => setActiveSvc(s._id)}
                className={`shrink-0 px-3 h-10 text-left -mb-px border-b-2 transition-colors ${
                  isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot(s.status)}`} />
                  <span className="text-[13px] font-semibold">{s.label}</span>
                  {isMine && <span className="text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1 rounded">you</span>}
                  <span className="text-[11px] text-muted-foreground tabular-nums">{ticked}/{s.checklist.length}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Active service */}
        {active && (
          <motion.div key={active._id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-4">
            {/* Owner row */}
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[15px] font-bold">{active.label}</p>
                  <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{active.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {active.assignee?.name ? (
                    <>
                      <Avatar name={active.assignee.name} email={active.assignee.email} size="xs" />
                      <span className="text-[12px]">
                        Owner <strong className="text-foreground">{active.assignee.name}</strong>
                      </span>
                    </>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Unassigned</span>
                  )}
                  {isAdmin && (
                    <div className="relative">
                      <select
                        value={active.assignedTo || ''}
                        onChange={e => reassign(active._id, e.target.value)}
                        disabled={busy}
                        className="appearance-none text-[11px] pl-2 pr-6 h-6 bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                        title="Reassign this service"
                      >
                        <option value="">change…</option>
                        {teammates.map(t => <option key={t._id} value={t._id}>{t.name || t.email}</option>)}
                      </select>
                      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    </div>
                  )}
                </div>
                {active.returnedReason && (
                  <p className="text-[11.5px] text-amber-700 mt-1.5 flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    Returned: "{active.returnedReason}"
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  intent="success"
                  iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
                  disabled={!canMarkServiceDone || busy}
                  onClick={() => askComplete(active._id, active.label)}
                >
                  Mark service done
                </Button>
                {!canMarkServiceDone && allItemsDone && blockingSiblings.length > 0 && (
                  <span className="text-[10.5px] text-muted-foreground">
                    Waiting on {blockingSiblings.map(b => b.label).join(', ')}
                  </span>
                )}
                {!canMarkServiceDone && !allItemsDone && (
                  <span className="text-[10.5px] text-muted-foreground">
                    Tick every step first
                  </span>
                )}
              </div>
            </div>

            {/* Blocked-by-deps notice — informational, doesn't disable prep ticks */}
            {blockingSiblings.length > 0 && (
              <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p className="leading-snug">
                  This service can't be marked done until {blockingSiblings.map(b => <strong key={b.type}>{b.label}</strong>).reduce((acc: any, el, i) => acc.length ? [...acc, ', ', el] : [el], [])} finish{blockingSiblings.length > 1 ? '' : 'es'}.
                  You can still tick prep items now — server only gates the "Mark service done" action.
                </p>
              </div>
            )}

            {/* Checklist — always editable when user has access; deps don't block prep */}
            <div className="space-y-0.5">
              {active.checklist.length === 0 ? (
                <EmptyState size="sm" title="No SOP items for this service" />
              ) : (
                active.checklist.map((c, i) => {
                  const editable = Boolean(canEditActive) && !busy;
                  return (
                    <label key={i}
                      className={`flex items-start gap-3 px-2 py-2 rounded-lg transition-colors ${
                        editable ? 'hover:bg-primary/[0.03] cursor-pointer' : 'opacity-70'
                      }`}>
                      <input type="checkbox" checked={c.done}
                        disabled={!editable}
                        onChange={e => askToggle(active._id, i, e.target.checked, c.text, active.label)}
                        className="mt-0.5 h-[18px] w-[18px] accent-primary shrink-0 cursor-pointer disabled:cursor-not-allowed" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] leading-snug ${c.done ? 'line-through text-muted-foreground' : ''}`}>{c.text}</p>
                        {c.done && c.doneAt && (
                          <p className="text-[10.5px] text-muted-foreground mt-0.5">
                            Ticked {formatDistanceToNow(new Date(c.doneAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Return-to row */}
            {canEditActive && active.status !== 'done' && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pt-1">
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Needs rework? Return to:</span>
                {services
                  .filter(s => s.status === 'done' || s.status === 'in_progress')
                  .filter(s => s._id !== active._id)
                  .map(s => (
                    <button key={s._id} onClick={() => askReturn(s.serviceType, s.label)} disabled={busy}
                      className="px-2 h-6 rounded-md bg-amber-500/10 text-amber-700 border border-amber-500/30 text-[11px] font-semibold hover:bg-amber-500/15 disabled:opacity-50">
                      ↺ {s.label}
                    </button>
                  ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Activity log */}
        <section className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="px-3 h-10 border-b border-border flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[12.5px] font-bold">Activity log</h3>
            <span className="text-[10.5px] text-muted-foreground">— everyone on this client sees this</span>
          </div>
          <InlineNoteInput onSubmit={async (text) => {
            try {
              const updated = await api.cwAddNote(wf._id, { detail: text, serviceType: active?.serviceType });
              setWf(updated);
              bumpActivity();
              toast.success('Note added');
            } catch { /* interceptor toasts */ }
          }} />
          <div className="max-h-[480px] overflow-y-auto">
            <ActivityTimeline workflowId={wf._id} refreshKey={activityRev} />
          </div>
        </section>

        {/* Footer */}
        <div className="pt-2">
          <Link to="/clients/pipeline" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3 w-3" /> All pipelines
          </Link>
        </div>
      </div>

      {/* Audit-comment modal (drives tick / untick / complete / return / note) */}
      {pendingAction && (
        <CommentRequiredModal
          title={
            pendingAction.kind === 'complete' ? `Mark "${pendingAction.serviceLabel}" complete` :
            pendingAction.kind === 'tick'     ? `Tick: ${pendingAction.itemText}` :
            pendingAction.kind === 'untick'   ? `Untick: ${pendingAction.itemText}` :
            pendingAction.kind === 'return'   ? `Return to ${pendingAction.serviceLabel}` :
                                                'Add a note'
          }
          description={
            pendingAction.kind === 'return'
              ? 'Tell the other team WHY you need this returned — they\'ll see this note.'
              : 'A short note keeps the audit log honest. Cmd-Enter to save.'
          }
          placeholder={
            pendingAction.kind === 'complete' ? 'e.g. Shopify store live, products imported, payments tested.' :
            pendingAction.kind === 'return'   ? 'What needs rework, and what does the other team need to do?' :
            pendingAction.kind === 'note'     ? 'Note for the team on this client…' :
                                                'What did you finish?'
          }
          primaryLabel={
            pendingAction.kind === 'complete' ? 'Mark complete' :
            pendingAction.kind === 'tick'     ? 'Tick' :
            pendingAction.kind === 'untick'   ? 'Untick' :
            pendingAction.kind === 'return'   ? 'Return with note' :
                                                'Add note'
          }
          tone={
            pendingAction.kind === 'untick' || pendingAction.kind === 'return' ? 'danger' :
            pendingAction.kind === 'complete' ? 'success' :
                                                'primary'
          }
          onSubmit={submitPending}
          onClose={() => setPendingAction(null)}
        />
      )}

      {/* Block / Unblock modals */}
      {blockModalOpen && (
        <BlockProjectModal
          defaultType={wf.blockerType || 'waiting_client_input'}
          onSubmit={handleBlock}
          onClose={() => setBlockModalOpen(false)}
        />
      )}
      {unblockModalOpen && (
        <CommentRequiredModal
          title="Unblock this project?"
          description="Tell the audit log what changed — e.g. client confirmed assets received."
          placeholder="What unblocked the project?"
          primaryLabel="Unblock"
          tone="success"
          onSubmit={handleUnblock}
          onClose={() => setUnblockModalOpen(false)}
        />
      )}
    </AppLayout>
  );
}
