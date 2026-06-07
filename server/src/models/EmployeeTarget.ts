import { Schema, model, Types } from 'mongoose';

/**
 * EmployeeTarget — monthly performance targets per employee.
 *
 * Owner ask (May 2026 agency-OS rebuild): "I want Bhawna to have a
 * monthly target like '4 brand launches, 12 reels delivered' and I
 * want the dashboard to show how close she is in real time."
 *
 * Schema notes:
 *   - One document per (organization, userId, month). month is the
 *     YYYY-MM string so monthly rollovers are trivial and we can
 *     enumerate history by sort.
 *   - targets[] is an array of {label, target, unit, actual, source}.
 *     `actual` is denormalised — the targets controller refreshes it
 *     on every read by counting matching events (completed tasks /
 *     services / brands launched). Cheap because monthly windows are
 *     small.
 *   - `source` describes WHERE actual comes from so the controller
 *     knows which collection to query:
 *       'tasks_done'    → ProjectTask.status='done' that month for this user
 *       'services_done' → ClientWorkflow.services[].assignedTo=user & completedAt in month
 *       'brands_live'   → ClientWorkflow where any service.status==='done' in month
 *       'manual'        → admin types the number in; we don't auto-compute
 *
 *   - createdBy / lastEditedBy tracked for audit.
 */

const TargetLineSchema = new Schema({
  label:  { type: String, required: true, trim: true },
  target: { type: Number, required: true, min: 0 },
  unit:   { type: String, default: '' },          // 'reels', 'launches', '₹'
  actual: { type: Number, default: 0 },           // refreshed on read
  source: {
    type: String,
    enum: ['tasks_done', 'services_done', 'brands_live', 'manual'],
    default: 'manual',
  },
}, { _id: true });

const EmployeeTargetSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: String, required: true, index: true },
  // YYYY-MM (IST). Indexed for monthly rollups on the executive view.
  month:          { type: String, required: true, index: true },
  targets:        { type: [TargetLineSchema], default: [] },
  notes:          { type: String, default: '' },
  createdBy:      { type: String },
  lastEditedBy:   { type: String },
  lastRecomputedAt: { type: Date, default: null },
}, { timestamps: true });

// One target sheet per (org, user, month).
EmployeeTargetSchema.index({ organizationId: 1, userId: 1, month: 1 }, { unique: true });

export default model('EmployeeTarget', EmployeeTargetSchema);
