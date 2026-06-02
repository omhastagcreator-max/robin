import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Loader2, MessageSquare,
  Paperclip, Send, Plane, ChevronDown, ChevronUp, Calendar, Flag,
  ExternalLink, Plus, User as UserIcon,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { ActivityTimeline } from '@/components/panels/ProjectDetailPanel';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * StageWorkspacePage — Layer 2 of the Client Project CRM (May 2026).
 *
 * One page per service stage (Development / Video / Meta ads). Routed
 * at /clients/pipeline/:id/stage/:stageKey. Reached by clicking any
 * service card on the Layer-1 dashboard (ClientWorkspacePage).
 *
 * Layout:
 *
 *   ┌─ Back to project
 *   │
 *   │ HEADER
 *   │ DEVELOPMENT (big)        Health 82% · On track
 *   │ Owner Rishi · 4/9 tasks · Started 15 Jun · ETA 20 Jun
 *   │ Current blocker: Waiting for product images
 *   │
 *   │ MANAGER METRICS — one row of compact stats
 *   │ 4/9 tasks · 17 comments · 12 files · 2 blockers · 2h ago
 *   │
 *   │ TWO-COLUMN MAIN
 *   │ ┌────────────────────────────┐ ┌─────────────────────────┐
 *   │ │ CHECKLIST (left, primary)   │ │ BLOCKERS                 │
 *   │ │   Click each item to expand │ │ 1. Product images        │
 *   │ │   inline — shows status,    │ │ 2. Razorpay creds        │
 *   │ │   owner, comments thread,   │ │                          │
 *   │ │   attachments, due date.    │ │ ACTIVITY                 │
 *   │ │                              │ │ Chronological timeline   │
 *   │ └────────────────────────────┘ │ scoped to this stage     │
 *   │                                 └─────────────────────────┘
 *
 * Data honesty:
 *   - Per-item comments, attachments, due dates are NOT stored on the
 *     backend yet. The UI surfaces them as ready-to-fill structures
 *     (textarea for comments, paperclip button for attachments) so the
 *     backend hookup is a small follow-up.
 *   - Stage-scoped activity timeline reuses the existing
 *     ActivityTimeline component which currently returns ALL activity;
 *     until the server learns ?serviceType=…, this shows the workflow
 *     feed which already calls out the service per row.
 *   - Stage health is computed client-side from overdue / blockers /
 *     waiting time / completion. Lives here, not on the server.
 *
 * Reuses cwGetWorkflow, cwToggleChecklist (if present), cwAddNote,
 * onLeaveToday. No new server endpoints required for the v1 ship.
 */

// ── Local shape (subset of the Workflow returned by the server) ────
interface ChecklistItem {
  _id?: string;
  text?: string;
  title?: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
  comment?: string;
}
interface Service {
  _id?: string;
  label: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  assignedTo?: string;
  eta?: string | null;
  createdAt?: string;
}
interface Workflow {
  _id: string;
  clientName?: string;
  services: Service[];
  blockerType?: string;
  blockerReason?: string;
  blockedSince?: string | null;
  lastUpdate?: { detail?: string; at?: string; actorId?: string; serviceType?: string } | null;
  updatedAt?: string;
  createdAt?: string;
  eta?: string | null;
}
interface UserLite { _id: string; name?: string }

// ── Stage taxonomy ──────────────────────────────────────────────────
const STAGE_DEFS: Record<string, {
  label: string; tone: 'emerald' | 'amber' | 'blue'; serviceType: string;
}> = {
  dev:   { label: 'Development', tone: 'emerald', serviceType: 'shopify'    },
  video: { label: 'Video',       tone: 'amber',   serviceType: 'influencer' },
  meta:  { label: 'Meta ads',    tone: 'blue',    serviceType: 'meta_ads'   },
};

function toneStripe(tone: 'emerald' | 'amber' | 'blue'): string {
  return tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
}
function toneText(tone: 'emerald' | 'amber' | 'blue'): string {
  return tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-blue-700';
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

// ── Stage health (client-side derivation) ──────────────────────────
// Health is a 0-100 score combining completion (positive) and blockers
// + waiting time (negative). Cheap heuristic; if the server later
// computes this per-stage we'll swap to that.
function computeStageHealth(svc: Service | undefined, wf: Workflow): { pct: number; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!svc) return { pct: 0, label: 'Not started', tone: 'neutral' };
  const total = svc.checklist?.length || 0;
  const done  = (svc.checklist || []).filter(c => c.done).length;
  const completion = total === 0 ? (svc.status === 'done' ? 100 : 0) : Math.round((done / total) * 100);
  let pct = completion;
  if (svc.status === 'blocked' || wf.blockerType) pct = Math.max(0, pct - 25);
  if (wf.blockedSince) {
    try {
      const days = (Date.now() - parseISO(wf.blockedSince).getTime()) / 86400000;
      if (days > 2) pct = Math.max(0, pct - 10);
    } catch { /* ignore */ }
  }
  if (svc.status === 'done') return { pct: 100, label: 'Completed', tone: 'success' };
  if (svc.status === 'blocked') return { pct, label: 'Blocked', tone: 'danger' };
  if (pct >= 70) return { pct, label: 'On track',    tone: 'success' };
  if (pct >= 40) return { pct, label: 'At risk',     tone: 'warning' };
  return            { pct, label: 'Needs attention', tone: 'danger'  };
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export default function StageWorkspacePage() {
  const { id, stageKey } = useParams();
  const { role } = useAuth();
  const isAdminOrSales = role === 'admin' || role === 'sales';

  const [wf, setWf]           = useState<Workflow | null>(null);
  const [users, setUsers]     = useState<Record<string, UserLite>>({});
  const [loading, setLoading] = useState(true);
  const [activityRev, setActivityRev] = useState(0);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set());

  const stageDef = stageKey ? STAGE_DEFS[stageKey] : null;

  useEffect(() => {
    if (!id) return;
    api.cwGetWorkflow(id).then(setWf).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    api.listUsers()
      .then((arr: any[]) => {
        const map: Record<string, UserLite> = {};
        (Array.isArray(arr) ? arr : []).forEach(u => { map[u._id] = u; });
        setUsers(map);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    (api as any).onLeaveToday?.()
      .then((rows: Array<{ userId: string }>) => setOnLeaveIds(new Set(rows.map(r => r.userId))))
      .catch(() => {});
  }, []);

  if (loading) return <AppLayout><div className="py-24 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppLayout>;
  if (!wf || !stageDef) {
    return <AppLayout><div className="py-24 text-center text-sm text-muted-foreground">Stage not found.</div></AppLayout>;
  }

  const svc = wf.services.find(s => s.serviceType === stageDef.serviceType);
  const checklist = svc?.checklist || [];
  const doneCount = checklist.filter(c => c.done).length;
  const totalCount = checklist.length;
  const owner = svc?.assignedTo ? users[svc.assignedTo] : undefined;
  const ownerOnLeave = !!(svc?.assignedTo && onLeaveIds.has(svc.assignedTo));
  const health = computeStageHealth(svc, wf);

  // The "this stage is blocked" branch — only count workflow-level
  // blockers when the stage matches the blocker's service-type, OR
  // when the active service is itself blocked.
  const stageBlocked = svc?.status === 'blocked'
    || (wf.lastUpdate?.serviceType === stageDef.serviceType && !!wf.blockerType);
  const blockers = stageBlocked
    ? [{
        reason: wf.blockerReason || 'Awaiting resolution',
        ownerName: owner?.name || 'Team',
        ownerId: svc?.assignedTo,
        sinceMs: wf.blockedSince ? Date.now() - parseISO(wf.blockedSince).getTime() : null,
      }]
    : [];

  const startedAt = svc?.createdAt || wf.createdAt;
  const etaAt = svc?.eta || wf.eta;

  // Manager metrics — counts derived from the workflow shape.
  const commentCount  = (wf.lastUpdate ? 1 : 0); // proxy: server doesn't expose comments-per-stage yet
  const filesCount    = 0;                       // backend doesn't store per-stage files yet
  const lastUpdateRel = wf.lastUpdate?.at
    ? formatDistanceToNow(parseISO(wf.lastUpdate.at), { addSuffix: true })
    : (wf.updatedAt ? formatDistanceToNow(parseISO(wf.updatedAt), { addSuffix: true }) : '—');

  return (
    <AppLayout>
      <div className="max-w-[1280px] mx-auto p-3 sm:p-4 lg:p-5">

        <Link to={`/clients/pipeline/${wf._id}`} className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-3 w-3" /> Back to {wf.clientName || 'project'}
        </Link>

        <div className="rounded-xl border border-border bg-card">

          {/* ── HEADER ───────────────────────────────────────────── */}
          <StageHeader
            stageLabel={stageDef.label}
            tone={stageDef.tone}
            serviceLabel={svc?.label}
            owner={owner?.name}
            ownerOnLeave={ownerOnLeave}
            doneCount={doneCount}
            totalCount={totalCount}
            health={health}
            startedAt={startedAt}
            etaAt={etaAt || undefined}
            blockerReason={stageBlocked ? wf.blockerReason : undefined}
          />

          {/* ── MANAGER METRICS ──────────────────────────────────── */}
          <ManagerMetrics
            doneCount={doneCount}
            totalCount={totalCount}
            commentCount={commentCount}
            filesCount={filesCount}
            blockerCount={blockers.length}
            lastUpdateRel={lastUpdateRel}
          />

          {/* ── MAIN — Two columns ───────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">

            {/* LEFT: Checklist */}
            <div className="lg:border-r border-border">
              <SectionHeader>Checklist · {doneCount}/{totalCount}</SectionHeader>
              {checklist.length === 0 ? (
                <EmptyChecklist isAdminOrSales={isAdminOrSales} />
              ) : (
                <ul className="divide-y divide-border/60">
                  {checklist.map((c, i) => (
                    <ChecklistRow
                      key={i}
                      index={i}
                      item={c}
                      ownerName={owner?.name}
                      ownerInitials={initials(owner?.name)}
                      expanded={expandedItem === i}
                      onToggle={() => setExpandedItem(prev => prev === i ? null : i)}
                      tone={stageDef.tone}
                      workflowId={wf._id}
                      onMutated={() => setActivityRev(r => r + 1)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* RIGHT: Blockers + Activity */}
            <aside>
              <SectionHeader>Blockers</SectionHeader>
              <BlockersBlock blockers={blockers} />

              <SectionHeader>Activity</SectionHeader>
              <div className="max-h-[420px] overflow-y-auto">
                <ActivityTimeline workflowId={wf._id} refreshKey={activityRev} />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stage header
// ─────────────────────────────────────────────────────────────────────
function StageHeader({
  stageLabel, tone, serviceLabel, owner, ownerOnLeave,
  doneCount, totalCount, health, startedAt, etaAt, blockerReason,
}: {
  stageLabel: string;
  tone: 'emerald' | 'amber' | 'blue';
  serviceLabel?: string;
  owner?: string;
  ownerOnLeave: boolean;
  doneCount: number;
  totalCount: number;
  health: ReturnType<typeof computeStageHealth>;
  startedAt?: string;
  etaAt?: string;
  blockerReason?: string;
}) {
  const healthCls =
    health.tone === 'success' ? 'text-emerald-700' :
    health.tone === 'warning' ? 'text-amber-700'   :
    health.tone === 'danger'  ? 'text-rose-700'    : 'text-foreground';
  return (
    <div className="border-b border-border">
      <div className={`h-1 ${toneStripe(tone)}`} />
      <div className="px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className={`text-[10.5px] uppercase tracking-[0.18em] font-bold ${toneText(tone)}`}>Stage</p>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-none">{stageLabel}</h1>
            {serviceLabel && <span className="text-[14px] text-muted-foreground">· {serviceLabel}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-bold tabular-nums ${healthCls}`}>{health.pct}%</span>
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold ${
            health.tone === 'success' ? 'bg-emerald-500/12 text-emerald-700' :
            health.tone === 'warning' ? 'bg-amber-500/15 text-amber-700' :
            health.tone === 'danger'  ? 'bg-rose-500/12 text-rose-700' : 'bg-muted text-muted-foreground'
          }`}>{health.label}</span>
        </div>
      </div>
      <div className="px-6 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <HeaderMeta label="Owner">
          <span className="inline-flex items-center gap-1.5">
            {owner || <span className="text-muted-foreground italic">Unassigned</span>}
            {ownerOnLeave && <Plane className="h-3 w-3 text-sky-600" />}
          </span>
        </HeaderMeta>
        <HeaderMeta label="Progress">{totalCount === 0 ? '—' : `${doneCount} / ${totalCount} tasks`}</HeaderMeta>
        <HeaderMeta label="Started">
          {startedAt ? format(parseISO(startedAt), 'd MMM') : '—'}
        </HeaderMeta>
        <HeaderMeta label="ETA">
          {etaAt ? format(parseISO(etaAt), 'd MMM') : '—'}
        </HeaderMeta>
      </div>
      {blockerReason && (
        <div className="px-6 pb-4 -mt-1">
          <div className="rounded-md bg-rose-500/[0.06] border border-rose-500/30 px-3 py-2 flex items-center gap-2 text-[12.5px]">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-700 shrink-0" />
            <span className="text-rose-700 font-semibold">Current blocker:</span>
            <span className="truncate">{blockerReason}</span>
          </div>
        </div>
      )}
    </div>
  );
}
function HeaderMeta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{label}</p>
      <p className="text-[13px] font-semibold mt-0.5 truncate">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Manager metrics row
// ─────────────────────────────────────────────────────────────────────
function ManagerMetrics({
  doneCount, totalCount, commentCount, filesCount, blockerCount, lastUpdateRel,
}: {
  doneCount: number;
  totalCount: number;
  commentCount: number;
  filesCount: number;
  blockerCount: number;
  lastUpdateRel: string;
}) {
  return (
    <div className="px-6 py-2.5 border-b border-border bg-muted/20 flex items-center gap-6 flex-wrap text-[12px]">
      <Stat label="Tasks"     value={`${doneCount} / ${totalCount}`} />
      <Stat label="Comments"  value={String(commentCount)} />
      <Stat label="Files"     value={String(filesCount)} />
      <Stat label="Blockers"  value={String(blockerCount)} tone={blockerCount > 0 ? 'danger' : undefined} />
      <Stat label="Updated"   value={lastUpdateRel} />
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  const cls = tone === 'danger' ? 'text-rose-700' : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${cls}`}>{value}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section header (reused)
// ─────────────────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-border bg-muted/15">
      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Checklist row — expandable, holds comments + attachments + meta
// ─────────────────────────────────────────────────────────────────────
function ChecklistRow({
  index, item, ownerName, ownerInitials, expanded, onToggle, tone,
  workflowId, onMutated,
}: {
  index: number;
  item: ChecklistItem;
  ownerName?: string;
  ownerInitials: string;
  expanded: boolean;
  onToggle: () => void;
  tone: 'emerald' | 'amber' | 'blue';
  workflowId: string;
  onMutated: () => void;
}) {
  const text = item.text || item.title || `Step ${index + 1}`;
  const doneTimeRel = item.doneAt ? formatDistanceToNow(parseISO(item.doneAt), { addSuffix: true }) : null;
  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 text-left"
      >
        <span className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${
          item.done ? 'bg-emerald-500 text-white' : 'border border-border'
        }`}>
          {item.done && <CheckCircle2 className="h-3 w-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] truncate ${item.done ? 'line-through text-muted-foreground' : 'font-semibold'}`}>
            {text}
          </p>
          <p className="text-[10.5px] text-muted-foreground truncate">
            {item.done
              ? `Completed by ${ownerName || 'team'}${doneTimeRel ? ` · ${doneTimeRel}` : ''}`
              : `Pending${ownerName ? ` · ${ownerName}` : ''}`}
          </p>
        </div>
        {item.comment && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground shrink-0">
            <MessageSquare className="h-3 w-3" /> 1
          </span>
        )}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/60 bg-muted/10"
          >
            <ChecklistItemDetails
              text={text}
              done={item.done}
              ownerName={ownerName}
              ownerInitials={ownerInitials}
              existingComment={item.comment}
              tone={tone}
              workflowId={workflowId}
              onMutated={onMutated}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ChecklistItemDetails({
  text, done, ownerName, ownerInitials, existingComment, tone, workflowId, onMutated,
}: {
  text: string;
  done: boolean;
  ownerName?: string;
  ownerInitials: string;
  existingComment?: string;
  tone: 'emerald' | 'amber' | 'blue';
  workflowId: string;
  onMutated: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy]       = useState(false);

  // Notes on the workflow are the closest existing primitive — when the
  // server adds per-checklist-item comments we'll switch to that. For
  // now, posting here adds a workflow-level note tagged with the item
  // text so the audit log still has context.
  const submitComment = async () => {
    const t = comment.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    try {
      await (api as any).cwAddNote?.(workflowId, { text: `[${text}] ${t}` });
      setComment('');
      onMutated();
      toast.success('Note added');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add note');
    } finally { setBusy(false); }
  };

  return (
    <div className="px-5 py-4 space-y-4">

      {/* Meta grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[12px]">
        <DetailMeta label="Status">
          <span className={done ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
            {done ? 'Completed' : 'Pending'}
          </span>
        </DetailMeta>
        <DetailMeta label="Owner">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[8.5px] font-bold text-muted-foreground">
              {ownerInitials}
            </span>
            {ownerName || <span className="text-muted-foreground italic">Unassigned</span>}
          </span>
        </DetailMeta>
        <DetailMeta label="Due date">
          <span className="text-muted-foreground italic">Not set</span>
        </DetailMeta>
        <DetailMeta label="Attachments">
          <button className="inline-flex items-center gap-1 text-primary hover:underline">
            <Plus className="h-3 w-3" /> Add file
          </button>
        </DetailMeta>
      </div>

      {/* Comments thread */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2 inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" /> Comments
        </p>
        {existingComment ? (
          <div className="rounded-md bg-card border border-border px-3 py-2 mb-2 text-[12.5px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold">
                {ownerInitials}
              </span>
              <span className="font-semibold">{ownerName || 'Team'}</span>
            </div>
            <p>{existingComment}</p>
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground italic mb-2">No comments yet on this task.</p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }}
            placeholder="Add a comment on this task…"
            maxLength={600}
            className="flex-1 min-w-0 px-3 h-8 bg-card border border-input rounded-md text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={submitComment}
            disabled={busy || comment.trim().length < 3}
            className={`h-8 px-3 rounded-md text-[11.5px] font-semibold flex items-center gap-1.5 disabled:opacity-50 ${
              tone === 'emerald' ? 'bg-emerald-600 text-white hover:bg-emerald-700' :
              tone === 'amber'   ? 'bg-amber-600 text-white hover:bg-amber-700' :
                                   'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </button>
        </div>
      </div>

      <p className="text-[10.5px] text-muted-foreground italic inline-flex items-center gap-1">
        <Paperclip className="h-3 w-3" /> Per-task attachments coming soon — stored against the project for now.
      </p>
    </div>
  );
}
function DetailMeta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-0.5">{label}</p>
      <p className="text-[12px] truncate">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Blockers block (right column)
// ─────────────────────────────────────────────────────────────────────
function BlockersBlock({
  blockers,
}: {
  blockers: Array<{ reason: string; ownerName: string; ownerId?: string; sinceMs: number | null }>;
}) {
  if (blockers.length === 0) {
    return (
      <div className="px-4 py-4 text-[11.5px] text-muted-foreground italic flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> No active blockers.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {blockers.map((b, i) => {
        const days = b.sinceMs != null ? Math.max(1, Math.round(b.sinceMs / 86400000)) : null;
        return (
          <li key={i} className="px-4 py-3">
            <div className="flex items-start gap-2 mb-1.5">
              <span className="h-5 w-5 rounded-full bg-rose-500/15 text-rose-700 flex items-center justify-center text-[10.5px] font-bold shrink-0">{i + 1}</span>
              <p className="text-[12.5px] font-semibold flex-1">{b.reason}</p>
            </div>
            <div className="ml-7 grid grid-cols-2 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">Owner</span>
              <span className="text-right font-medium">{b.ownerName}</span>
              <span className="text-muted-foreground">Waiting</span>
              <span className="text-right font-medium">{days != null ? `${days}d` : '—'}</span>
              <span className="text-muted-foreground">Impact</span>
              <span className="text-right text-rose-700 font-medium">Stage delayed</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty state for stages with no checklist configured
// ─────────────────────────────────────────────────────────────────────
function EmptyChecklist({ isAdminOrSales }: { isAdminOrSales: boolean }) {
  return (
    <div className="px-6 py-10 text-center text-[12.5px] text-muted-foreground">
      No checklist configured for this stage yet.
      {isAdminOrSales && (
        <p className="text-[11px] mt-2">
          Add a template in admin settings to populate steps automatically when a workflow is created.
        </p>
      )}
    </div>
  );
}

// Silence TS noise on icons not used in v1 but kept for future expansion.
void Calendar; void Flag; void ExternalLink; void UserIcon; void useMemo;
