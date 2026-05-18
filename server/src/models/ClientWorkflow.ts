import { Schema, model, Types } from 'mongoose';

/**
 * ClientWorkflow — one document per (org, client) that captures the
 * pipeline of services we're delivering for that client. Each entry in
 * `services` is one service line (e.g. Meta Ads, Website Edit) with its
 * own SOP checklist, status, and assigned employee.
 *
 * A workflow's "current stage" is derived (not stored) by looking at
 * which services are not yet `done` and which are blocked. The model
 * stores facts; presentation logic computes display state.
 *
 * AI hook: a future automation worker can read this collection, find
 * stalled services (e.g. assignee on leave + checklist 80% done +
 * no activity in 5 days), and surface them or auto-reassign. Activity
 * log + checklist shape are designed for that.
 */

const ChecklistItemSchema = new Schema({
  text:        { type: String, required: true },
  done:        { type: Boolean, default: false },
  doneAt:      { type: Date },
  doneBy:      { type: String },     // userId of whoever ticked it
}, { _id: false });

const ServiceSchema = new Schema({
  serviceType: { type: String, required: true },     // matches ServiceType in workflowTemplates
  label:       { type: String, required: true },     // snapshot at creation so renames don't lose history
  assignedTo:  { type: String, index: true },        // userId — auto-picked by team, can be reassigned
  status: {
    type: String,
    enum: ['blocked', 'pending', 'in_progress', 'done'],
    default: 'pending',
  },
  checklist:   { type: [ChecklistItemSchema], default: [] },
  startedAt:   { type: Date },
  completedAt: { type: Date },
  // If this service was returned by a downstream team for rework — the
  // last return note. Cleared when the service is re-completed.
  returnedReason: { type: String },
  returnedAt:     { type: Date },
}, { _id: true });

const ActivitySchema = new Schema({
  at:        { type: Date, default: Date.now },
  actorId:   { type: String, required: true },     // userId
  actorName: { type: String },
  // Free-form action label. Examples: 'created', 'item_checked',
  // 'service_completed', 'service_returned', 'note', 'reassigned'.
  action:    { type: String, required: true },
  // Service this activity is about, if applicable. Stored as serviceType
  // string (not subdoc _id) so the log survives service removal/addition.
  serviceType: { type: String },
  // Free-text body — the human-readable detail of what happened.
  detail:    { type: String },
}, { _id: false });

const ClientWorkflowSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  clientId:       { type: String, required: true, index: true },
  // Snapshot of client identity at creation time so search-by-phone keeps
  // working even if the User doc is later edited.
  clientName:     { type: String },
  clientPhone:    { type: String, index: true },
  clientEmail:    { type: String, index: true },

  services:       { type: [ServiceSchema], default: [] },

  // Denormalised payment status so the sales team can scan a list without
  // clicking into each client. Source of truth: ClientTransaction model.
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid', 'overdue', 'na'],
    default: 'na',
  },

  // Full ordered activity log — append-only.
  activity:       { type: [ActivitySchema], default: [] },

  createdBy:      { type: String, required: true },
}, { timestamps: true });

// One workflow per (org, client) — uniqueness enforced.
ClientWorkflowSchema.index({ organizationId: 1, clientId: 1 }, { unique: true });
// Phone search hits this index hard — used by the universal search bar.
ClientWorkflowSchema.index({ organizationId: 1, clientPhone: 1 });

/**
 * Cap activity[] at the last 500 entries on every save so a chatty
 * workflow can't blow past Mongo's 16MB document limit. 500 entries is
 * months of normal use for any single client; older history is fine to
 * archive later if we ever need it.
 */
ClientWorkflowSchema.pre('save', function (next) {
  const ACTIVITY_CAP = 500;
  const self = this as any;
  if (self.activity && self.activity.length > ACTIVITY_CAP) {
    self.activity = self.activity.slice(-ACTIVITY_CAP);
  }
  next();
});

export default model('ClientWorkflow', ClientWorkflowSchema);
