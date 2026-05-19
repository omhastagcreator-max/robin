import WorkflowActivity from '../models/WorkflowActivity';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';

/**
 * performWorkflowAction — the SINGLE chokepoint for every mutation on a
 * client workflow in the Pipeline 2.0 design. New controllers should route
 * through this; old ones are migrated incrementally.
 *
 * What this wrapper enforces:
 *   1. A 3-600 char audit comment is REQUIRED (server-side enforcement;
 *      the client modal enforces it too but never trust the client).
 *   2. The action name is one of the typed values in WorkflowActivity's
 *      enum (typo-safe at the source).
 *   3. The mutation runs as a single save (no torn writes).
 *   4. A WorkflowActivity row is written AFTER the mutation succeeds so
 *      we never log an action that wasn't actually applied.
 *   5. The workflow's denormalized rollup (`lastActivityAt`,
 *      `lastActivitySummary`, `lastActorId`) is refreshed so the list
 *      endpoint can render activity glimpses without joining the
 *      activity collection.
 *   6. Optional post-hooks fire after success — used to recompute
 *      `health` async.
 *
 * What this wrapper deliberately does NOT do:
 *   - Authorization. Per-action role / team checks live in the caller
 *     (controllers) so we can give specific 403 messages per route. The
 *     wrapper assumes the caller has already verified.
 *   - Socket emission. The controller emits because it knows the room.
 *     (Could be moved here later when we standardize event shapes.)
 */

export type WorkflowActionType =
  | 'created'
  | 'service_added'
  | 'item_checked'
  | 'item_unchecked'
  | 'service_completed'
  | 'service_reopened'
  | 'service_returned'
  | 'service_reassigned'
  | 'service_blocked'
  | 'service_unblocked'
  | 'eta_updated'
  | 'priority_changed'
  | 'health_changed'
  | 'note_added'
  | 'attachment_added'
  | 'client_update_sent';

export interface WorkflowActionInput {
  workflowId: string;
  actorId:    string;
  action:     WorkflowActionType;
  comment:    string;
  /** Sub-document service ID, if the action targets a service. */
  serviceId?: string;
  /** Service type (shopify/meta_ads/influencer) — copied onto the
   *  activity row for fast filtering without joining the workflow. */
  serviceType?: string;
  /** Checklist index, if the action is on a checklist item. */
  checklistIndex?: number;
  /** Before/after diff — small slices only. The wrapper never serializes
   *  the entire workflow. */
  before?: any;
  after?:  any;
  /** True if this entry should appear in the client-facing summary. */
  isClientRelevant?: boolean;
  /** True if this entry counts as a delay contributor (read by health
   *  inference). */
  isDelayCause?: boolean;
  /** A short, plain-text summary of the action used in the workflow's
   *  denormalized lastActivitySummary field. e.g. "Om completed Shopify
   *  setup". If omitted, the comment is used as-is. */
  summaryForRollup?: string;
  /** Optional mutator. The wrapper loads the workflow doc, calls this
   *  with it, then saves. Throw to abort. */
  mutate?: (wf: any) => void | Promise<void>;
  /** Optional async post-hook — runs AFTER the activity row is written
   *  and the workflow has been saved. Failures here are non-fatal. */
  postHook?: (wf: any) => void | Promise<void>;
}

export interface WorkflowActionResult {
  workflow: any;
  activityId: string;
}

export class WorkflowActionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const ACTION_COMMENT_MIN = 3;
const ACTION_COMMENT_MAX = 600;

/**
 * The contract: every mutation goes through here. Returns the (now-fresh)
 * workflow + the new activity row's id. Throws `WorkflowActionError`
 * with a status code on validation failure — controllers can `.status`
 * the response off it directly.
 */
export async function performWorkflowAction(input: WorkflowActionInput): Promise<WorkflowActionResult> {
  // 1. Validate the comment first — cheapest check.
  const comment = (input.comment || '').trim();
  if (comment.length < ACTION_COMMENT_MIN) {
    throw new WorkflowActionError(400, `Add a short note explaining what changed (at least ${ACTION_COMMENT_MIN} characters).`);
  }
  if (comment.length > ACTION_COMMENT_MAX) {
    throw new WorkflowActionError(400, `Comment is too long (max ${ACTION_COMMENT_MAX} characters).`);
  }

  // 2. Load the workflow + actor identity for the audit log.
  const [wf, actor] = await Promise.all([
    ClientWorkflow.findById(input.workflowId),
    User.findById(input.actorId).select('name email role').lean(),
  ]);
  if (!wf) throw new WorkflowActionError(404, 'Workflow not found');
  if (!actor) throw new WorkflowActionError(403, 'Caller not found');

  // 3. Run the caller-supplied mutator (if any) — they get the live
  //    Mongoose doc and can mutate sub-documents freely. We save after.
  if (input.mutate) await input.mutate(wf);

  // 4. Refresh denormalized activity rollup BEFORE saving so it persists
  //    in the same write.
  const summary = (input.summaryForRollup || comment).slice(0, 200);
  (wf as any).lastActivityAt      = new Date();
  (wf as any).lastActivitySummary = summary;
  (wf as any).lastActorId         = input.actorId;
  // Days-inactive is by-definition 0 right after activity — the cron
  // bumps it later as time passes.
  (wf as any).daysInactive        = 0;

  await wf.save();

  // 5. Write the activity row AFTER the mutation succeeds. If the save
  //    above threw, we never log a phantom action.
  const activityDoc = await WorkflowActivity.create({
    workflowId:       wf._id,
    organizationId:   (wf as any).organizationId,
    action:           input.action,
    serviceId:        input.serviceId || null,
    serviceType:      input.serviceType || null,
    checklistIndex:   typeof input.checklistIndex === 'number' ? input.checklistIndex : null,
    actorId:          input.actorId,
    actorName:        actor.name || actor.email || 'Someone',
    actorRole:        actor.role || '',
    before:           input.before ?? null,
    after:            input.after ?? null,
    comment,
    isClientRelevant: !!input.isClientRelevant,
    isDelayCause:     !!input.isDelayCause,
  });

  // 6. Fire post-hook (e.g. health recompute). Non-fatal — the action
  //    is already committed; a failed post-hook just means the next
  //    cron tick will catch up.
  if (input.postHook) {
    try { await input.postHook(wf); }
    catch (err) { console.error('[workflowAction] postHook failed:', (err as Error).message); }
  }

  return { workflow: wf, activityId: String(activityDoc._id) };
}
