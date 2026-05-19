import { Schema, model, Types } from 'mongoose';

/**
 * WorkflowActivity — Pipeline 2.0 audit log, separated from ClientWorkflow.
 *
 * Previously the activity stream lived as an inline `activity[]` array on each
 * ClientWorkflow doc. That worked at small scale but:
 *   1. Every workflow doc inflated 500 entries × ~200 bytes = ~100 KB
 *   2. Full-text search across activity was impossible (no per-array indexing)
 *   3. The detail page fetched 500 entries on every load even if the UI
 *      showed only 30.
 *   4. Activity from BEFORE the workflow was archived could never be recovered.
 *
 * The 2.0 design moves activity into its own collection with proper indexes,
 * cursor pagination, before/after state diffs, attachments, and a mandatory
 * audit comment. The legacy inline `activity[]` array on ClientWorkflow stays
 * temporarily as a backstop; once we backfill + verify, a follow-up migration
 * removes it.
 */
const WorkflowActivitySchema = new Schema({
  // Where this happened
  workflowId:     { type: Types.ObjectId, ref: 'ClientWorkflow', required: true, index: true },
  organizationId: { type: Types.ObjectId, ref: 'Organization',   required: true, index: true },

  // What happened — the typed action. Keep this enum in sync with
  // performWorkflowAction in services/workflowActions.ts.
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'service_added',
      'item_checked',
      'item_unchecked',
      'service_completed',
      'service_reopened',
      'service_returned',
      'service_reassigned',
      'service_blocked',
      'service_unblocked',
      'eta_updated',
      'priority_changed',
      'health_changed',
      'note_added',
      'attachment_added',
      'client_update_sent',
    ],
  },

  // Which service this targets (if applicable)
  serviceId:      { type: Types.ObjectId, default: null },
  serviceType:    { type: String, default: null },
  checklistIndex: { type: Number, default: null },

  // Who did it — captured at write time so reassignments / employee
  // departures don't break the audit story later.
  actorId:    { type: Types.ObjectId, ref: 'User', required: true, index: true },
  actorName:  { type: String, default: '' },
  actorRole:  { type: String, default: '' },

  // Structured state-diff. `before` is the pre-mutation snapshot of the
  // affected slice; `after` is the post-mutation snapshot. Either or both
  // may be null for actions that don't have a meaningful diff (e.g.
  // note_added). Keep these small — we don't want to ship the whole
  // workflow shape into every activity row.
  before: { type: Schema.Types.Mixed, default: null },
  after:  { type: Schema.Types.Mixed, default: null },

  // MANDATORY audit comment — 3-600 chars. Enforced server-side in
  // performWorkflowAction; the modal on the client enforces it too.
  comment: { type: String, required: true, minlength: 3, maxlength: 600 },

  // Optional attachments (URL refs to Cloudinary / S3 once we wire image
  // upload). For now the schema reserves the shape.
  attachments: {
    type: [{
      url:         { type: String, required: true },
      name:        { type: String, default: '' },
      contentType: { type: String, default: '' },
      size:        { type: Number, default: 0 },
    }],
    default: [],
  },

  // Flags for downstream filtering — populated at write time by the
  // action wrapper based on action type + comment heuristics.
  // `isClientRelevant` marks entries we surface in the client-facing
  // shareable update; `isDelayCause` marks entries that the health
  // inference should treat as a contributing cause for the project's
  // current delay state.
  isClientRelevant: { type: Boolean, default: false, index: true },
  isDelayCause:     { type: Boolean, default: false },
}, { timestamps: true });

// Hot paths.
WorkflowActivitySchema.index({ workflowId: 1, createdAt: -1 });
WorkflowActivitySchema.index({ organizationId: 1, action: 1, createdAt: -1 });
WorkflowActivitySchema.index({ actorId: 1, createdAt: -1 });
// Full-text search on the audit comment.
WorkflowActivitySchema.index({ comment: 'text' });

export default model('WorkflowActivity', WorkflowActivitySchema);
