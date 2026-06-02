import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Phone, Mail, Sparkles, ExternalLink, CheckCircle2,
  Ban, Unlock, MessageSquare, X, ChevronDown,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { Button }     from '@/components/ui/Button';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Row }        from '@/components/ui/Row';
import { CommentRequiredModal } from '@/components/shared/CommentRequiredModal';
import * as api from '@/api';

/**
 * <ProjectDetailPanel /> — drawer content for a single Project (workflow).
 *
 * Anatomy:
 *   - Identity header: client name, phone, email, health pill.
 *   - Action strip: Block / Unblock buttons (drive WorkflowActivity).
 *   - Health snapshot: AI one-paragraph status (paste-ready).
 *   - Service rows: progress + status + jump to full detail.
 *   - Activity timeline: cursor-paginated /activity feed with Load more.
 *   - Footer: "Open full pipeline" → /clients/pipeline/:id.
 *
 * Block/Unblock writes a typed `service_blocked` / `service_unblocked`
 * WorkflowActivity row and triggers a health recompute. The activity
 * timeline reads from the dedicated WorkflowActivity collection — NOT
 * the legacy inline `wf.activity[]` array.
 */

interface ChecklistItem { done: boolean; text?: string; title?: string }
interface Service {
  _id?: string;
  label: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  assignedTo?: string;
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
  // ── Fields surfaced in the at-a-glance section ────────────────────
  // All of these are already populated by /api/client-workflows; the
  // panel just needed to start rendering them so a user opening the
  // drawer from search lands on a complete status snapshot.
  lastUpdate?: { detail?: string; at?: string; action?: string; serviceType?: string; actorId?: string };
  nextAction?: string;
  nextBestAction?: string;
  currentOwnerTeam?: '' | 'sales' | 'development' | 'meta' | 'influencer' | 'qa';
  eta?: string | null;
  etaConfidence?: '' | 'high' | 'medium' | 'low';
  delayCause?: string;
  updatedAt?: string;
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

function statusToPill(status: Service['status']): Status {
  switch (status) {
    case 'done':        return 'ready_to_deliver';
    case 'in_progress': return 'in_huddle';
    case 'blocked':     return 'blocked';
    default:            return 'waiting_internal';
  }
}

function healthToPill(h?: string): Status {
  return (h as Status) || 'healthy';
}

// Pretty label for the typed WorkflowActivity.action enum.
function actionLabel(a: ActivityRow): string {
  const verb: Record<string, string> = {
    service_started:    'Service started',
    service_completed:  'Service completed',
    service_returned:   'Service returned',
    service_reopened:   'Service reopened',
    service_blocked:    'Project blocked',
    service_unblocked:  'Project unblocked',
    checklist_checked:  'Step checked',
    checklist_unchecked:'Step unchecked',
    service_reassigned: 'Service reassigned',
    note_added:         'Note added',
  };
  const head = verb[a.action] || a.action.replace(/_/g, ' ');
  return a.serviceType ? `${head} · ${a.serviceType}` : head;
}

// ─── Inline Block modal ────────────────────────────────────────────────────────
// Lives here (not shared) because Block needs a structured `blockerType`
// selector on top of the audit comment — CommentRequiredModal is single-field.
const BLOCKER_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'waiting_client_input',      label: 'Waiting on client',           hint: 'Surfaces as waiting_client; client-relevant.' },
  { value: 'waiting_internal_approval', label: 'Waiting on internal approval',hint: 'Surfaces as waiting_internal.' },
  { value: 'dependency',                label: 'Dependency blocked',          hint: 'Another team / vendor / asset.' },
  { value: 'technical',                 label: 'Technical issue',             hint: 'Bug / API outage / data issue.' },
  { value: 'budget',                    label: 'Budget / scope hold',         hint: 'Awaiting commercial sign-off.' },
];

function BlockProjectModal({
  defaultType, onSubmit, onClose,
}: {
  defaultType?: string;
  onSubmit: (payload: { blockerType: string; blockerReason: string; comment: string }) => Promise<void>;
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

  const trimmed   = blockerReason.trim();
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 600 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // We use the same string for `comment` (audit trail) and `blockerReason`
      // (structured "WHY blocked" field on the workflow). They mean the same
      // thing in this UX — the modal asks once.
      await onSubmit({ blockerType, blockerReason: trimmed, comment: trimmed });
      onClose();
    } catch {
      // toast surfaced by caller
    } finally {
      setSubmitting(false);
    }
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
              <Ban className="h-4 w-4 text-rose-500 shrink-0" />
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
                  {BLOCKER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {BLOCKER_OPTIONS.find(o => o.value === blockerType)?.hint}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Reason (visible to admin)</label>
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
                <span>{trimmed.length < 3 ? `${3 - trimmed.length} more character${3 - trimmed.length === 1 ? '' : 's'} needed` : 'Looks good'}</span>
                <span className="tabular-nums">{blockerReason.length} / 600</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={submitting}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit}
                className="px-4 h-9 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white transition-colors">
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

// ─── Activity timeline ────────────────────────────────────────────────────────
// Exported (May 2026) so the new PipelineFocusedView can embed the same
// timeline inline instead of forcing users into the drawer. Same data,
// same look; consumers pass workflowId + a refreshKey they can bump
// after mutations.
export function ActivityTimeline({ workflowId, refreshKey }: { workflowId: string; refreshKey: number }) {
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
      const data = await api.cwListActivity(workflowId, { limit: 30 });
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
      const data = await api.cwListActivity(workflowId, { cursor, limit: 30 });
      setRows(prev => [...prev, ...(data.rows as ActivityRow[])]);
      setCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return <div className="px-4 py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <div className="px-4 py-3 text-[11.5px] text-rose-600">{error}</div>;
  }

  if (rows.length === 0) {
    return <EmptyState size="sm" title="No activity yet" />;
  }

  return (
    <>
      {rows.map(a => (
        <Row key={a._id}>
          <Row.Main>
            <Row.Title>{actionLabel(a)}</Row.Title>
            {a.comment && <p className="text-[11.5px] text-foreground/80 mt-0.5 line-clamp-2">{a.comment}</p>}
            <Row.Meta>
              {a.actorName ? `${a.actorName} · ` : ''}
              {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </Row.Meta>
          </Row.Main>
        </Row>
      ))}
      {hasMore && (
        <div className="px-4 py-2">
          <Button size="xs" intent="ghost" loading={loadingMore} onClick={loadMore}>
            Load older
          </Button>
        </div>
      )}
    </>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────
//
// Props:
//   - workflowId: the project to load
//   - autoSummary (optional): fire the AI status snapshot automatically
//     as soon as the workflow data lands. The search-bar entry point on
//     ClientPipelinePage passes this so a user who types a phone number
//     and hits Enter sees the AI brief without an extra click.
export function ProjectDetailPanel({ workflowId, autoSummary = false }: { workflowId: string; autoSummary?: boolean }) {
  const [wf, setWf]           = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);

  // AI snapshot
  const [aiSummary, setAiSummary] = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiBusy, setAiBusy]       = useState(false);

  // Action modals
  const [blockModalOpen, setBlockModalOpen]   = useState(false);
  const [unblockModalOpen, setUnblockModalOpen] = useState(false);

  // Bumps to force ActivityTimeline to refetch after a state-changing action.
  const [activityRev, setActivityRev] = useState(0);
  const bumpActivity = () => setActivityRev(r => r + 1);

  const load = async () => {
    try { setWf(await api.cwGetWorkflow(workflowId)); }
    catch { /* axios toast */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [workflowId]);

  const generateSummary = async () => {
    setAiBusy(true);
    try { setAiSummary(await api.aiSummarizeWorkflow(workflowId)); }
    catch { toast.error('AI summary failed'); }
    finally { setAiBusy(false); }
  };

  // Auto-fire the AI summary once when caller asked for it and the
  // workflow has loaded. `firedRef` prevents a second fire if the
  // panel re-renders before the summary call resolves.
  const autoSummaryFiredRef = useRef(false);
  useEffect(() => {
    if (!autoSummary) return;
    if (!wf) return;
    if (autoSummaryFiredRef.current) return;
    if (aiSummary) return;
    autoSummaryFiredRef.current = true;
    void generateSummary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSummary, wf]);

  if (loading || !wf) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const services = wf.services || [];
  const total    = services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const done     = services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct      = total ? Math.round((done / total) * 100) : 0;
  const isBlocked = Boolean(wf.blockerType);

  const handleBlock = async (payload: { blockerType: string; blockerReason: string; comment: string }) => {
    try {
      const updated = await api.cwBlock(workflowId, payload);
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
      const updated = await api.cwUnblock(workflowId, { comment });
      setWf(updated as Workflow);
      bumpActivity();
      toast.success('Project unblocked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to unblock');
      throw err;
    }
  };

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <section className="p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-bold tracking-tight">{wf.clientName || 'Unnamed client'}</h2>
          <StatusPill state={healthToPill(wf.health)} size="sm" label={wf.healthReason || undefined} />
        </div>
        <div className="space-y-1 text-[12px]">
          {wf.clientPhone && (
            <a href={`tel:${wf.clientPhone}`} className="flex items-center gap-1.5 text-primary hover:underline tabular-nums">
              <Phone className="h-3 w-3" /> {wf.clientPhone}
            </a>
          )}
          {wf.clientEmail && (
            <a href={`mailto:${wf.clientEmail}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Mail className="h-3 w-3" /> {wf.clientEmail}
            </a>
          )}
        </div>

        {/* Action strip — Block / Unblock */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!isBlocked ? (
            <Button
              size="xs"
              intent="secondary"
              iconLeft={<Ban className="h-3 w-3" />}
              onClick={() => setBlockModalOpen(true)}
            >
              Mark blocked
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                intent="primary"
                iconLeft={<Unlock className="h-3 w-3" />}
                onClick={() => setUnblockModalOpen(true)}
              >
                Unblock
              </Button>
              <span className="inline-flex items-center gap-1 text-[11px] text-rose-600">
                <Ban className="h-3 w-3" />
                {wf.blockerType?.replace(/_/g, ' ')}
                {wf.blockerReason && <span className="text-muted-foreground">· {wf.blockerReason}</span>}
              </span>
            </>
          )}
        </div>
      </section>

      {/* At-a-glance — current stage, last update, next action. Added so
          a user opening the panel from search (Enter / phone-number
          auto-open) sees the most important context immediately,
          without having to scroll into the activity feed or scan the
          services list. All fields come from the same /api/client
          -workflows payload the page already loads — we just weren't
          rendering them before. */}
      {(() => {
        // Pick the current stage label. Preference order:
        //   1. The first service with status 'in_progress'
        //   2. Otherwise the first non-done service ('pending' / 'blocked')
        //   3. Otherwise "All done" when every service is done
        //   4. Fallback "—" when there are no services
        const inProgress = services.find(s => s.status === 'in_progress');
        const pending    = services.find(s => s.status !== 'done');
        const stageLabel = inProgress?.label
          || (pending ? pending.label : (services.length > 0 ? 'All done' : '—'));
        const stageStatus = inProgress?.status || pending?.status || (services.length > 0 ? 'done' : 'pending');
        const lastUpdateAt = wf.lastUpdate?.at || wf.updatedAt;
        const nextAction   = wf.nextAction || wf.nextBestAction;
        return (
          <section className="p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              At a glance
            </p>
            <div className="space-y-2">
              {/* Current stage */}
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">Current stage</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[12.5px] font-semibold truncate">{stageLabel}</span>
                  <StatusPill state={statusToPill(stageStatus)} size="xs" />
                </div>
              </div>
              {/* Last update (most recent activity-log entry the server
                  decorates onto the workflow) */}
              {(wf.lastUpdate?.detail || lastUpdateAt) && (
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">Last update</span>
                  <div className="min-w-0">
                    {wf.lastUpdate?.detail && (
                      <p className="text-[12.5px] leading-snug">{wf.lastUpdate.detail}</p>
                    )}
                    {lastUpdateAt && (
                      <p className="text-[10.5px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(lastUpdateAt), { addSuffix: true })}
                        {wf.lastUpdate?.serviceType && ` · ${wf.lastUpdate.serviceType}`}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {/* Next action — either the human-set field or the AI
                  recommendation if it's the only one we have. */}
              {nextAction && (
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">Next action</span>
                  <p className="text-[12.5px] leading-snug">{nextAction}</p>
                </div>
              )}
              {/* Owner team & ETA — only render when present so we don't
                  show two empty rows for half-onboarded workflows. */}
              {wf.currentOwnerTeam && (
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">Owner team</span>
                  <span className="text-[12.5px] capitalize">{wf.currentOwnerTeam}</span>
                </div>
              )}
              {wf.eta && (
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">ETA</span>
                  <span className="text-[12.5px]">
                    {wf.eta}
                    {wf.etaConfidence && (
                      <span className="text-muted-foreground"> · {wf.etaConfidence} confidence</span>
                    )}
                  </span>
                </div>
              )}
              {wf.delayCause && (
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">Delay cause</span>
                  <p className="text-[12.5px] leading-snug text-rose-700">{wf.delayCause}</p>
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* Progress + AI */}
      <section className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat block value={`${pct}%`} label="overall" tone="primary" />
          <Stat block value={`${done}/${total}`} label="steps" />
          <Stat block value={services.length} label="services" />
        </div>

        <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary/80">AI status snapshot</span>
          </div>
          {aiSummary ? (
            <p className="text-[12.5px] leading-snug">{aiSummary.text}</p>
          ) : (
            <p className="text-[11.5px] text-muted-foreground">One-paragraph status the team can paste to the client.</p>
          )}
          <Button size="xs" intent="secondary" loading={aiBusy} onClick={generateSummary} iconLeft={<Sparkles className="h-3 w-3" />}>
            {aiSummary ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </section>

      {/* Services */}
      <section className="py-1">
        <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Services</p>
        {services.length === 0 ? (
          <EmptyState size="sm" title="No services added yet" />
        ) : (
          services.map(s => {
            const sTotal = s.checklist?.length || 0;
            const sDone  = (s.checklist || []).filter(c => c.done).length;
            const sPct   = sTotal ? Math.round((sDone / sTotal) * 100) : 0;
            return (
              <Row key={s._id || s.serviceType} accent={
                s.status === 'done'        ? 'success' :
                s.status === 'blocked'     ? 'danger'  :
                s.status === 'in_progress' ? 'primary' :
                                             'none'
              }>
                <Row.Leading>
                  <CheckCircle2 className={`h-3.5 w-3.5 ${
                    s.status === 'done'    ? 'text-emerald-600' :
                    s.status === 'blocked' ? 'text-rose-500'    :
                                             'text-muted-foreground'
                  }`} />
                </Row.Leading>
                <Row.Main>
                  <Row.Title>{s.label}</Row.Title>
                  <Row.Meta>{sDone} of {sTotal} steps · {sPct}%</Row.Meta>
                </Row.Main>
                <Row.Trail>
                  <StatusPill state={statusToPill(s.status)} size="xs" />
                </Row.Trail>
              </Row>
            );
          })
        )}
      </section>

      {/* Activity timeline (cursor-paginated WorkflowActivity feed) */}
      <section className="py-1">
        <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Activity</p>
        </div>
        <ActivityTimeline workflowId={workflowId} refreshKey={activityRev} />
      </section>

      {/* Footer */}
      <section className="p-3 bg-muted/30">
        <Link to={`/clients/pipeline/${wf._id}`}>
          <Button size="sm" intent="secondary" iconRight={<ExternalLink className="h-3 w-3" />}>
            Open full pipeline
          </Button>
        </Link>
      </section>

      {/* Modals */}
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
    </div>
  );
}
