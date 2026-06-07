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
  unit:   { type: String, default: '' },          // 'reels', 'launches', '₹', '$'
  actual: { type: Number, default: 0 },           // refreshed on read
  /**
   * `source` tells the recompute pass WHICH collection to read for actuals:
   *
   *   tasks_done     — ProjectTask.status='done' in period for this user
   *   services_done  — ClientWorkflow.services[].completedAt in period
   *   brands_live    — distinct brands the user shipped a service on
   *   deals_won      — count of Deals (status='won') closed in period,
   *                    joined through Lead.assignedTo
   *   sales_revenue  — sum of Deal.dealValue ditto. Currency-agnostic;
   *                    admin sets the unit (e.g. '₹') in the target row.
   *   manual         — admin types the actual in by hand (no auto-fill)
   */
  source: {
    type: String,
    enum: ['tasks_done', 'services_done', 'brands_live', 'deals_won', 'sales_revenue', 'manual'],
    default: 'manual',
  },
  // ── Employee-set fields (May 2026) ───────────────────────────────
  // The EMPLOYEE estimates when they'll hit this target + their own
  // commentary on it. Admin sees these read-only on the executive
  // dashboard so the agency owner gets the team's own forecast.
  // Separate from the admin's `notes` on the sheet so admin's notes
  // and the employee's commitment never clash on the same field.
  etaDate:        { type: Date, default: null },
  employeeNote:   { type: String, default: '' },
  etaSetBy:       { type: String, default: '' },     // userId of last writer
  etaSetAt:       { type: Date, default: null },
}, { _id: true });

const EmployeeTargetSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: String, required: true, index: true },

  /**
   * Cadence of the target sheet (May 2026 addition).
   *
   *   'monthly' — the `month` field holds YYYY-MM (e.g. '2026-06').
   *   'weekly'  — the `month` field holds ISO-week YYYY-Www (e.g. '2026-W23').
   *
   * Field name stayed `month` to avoid a migration; semantically it's
   * the `periodKey`. The recompute pass uses `period` to know which
   * format to parse and which time window to query for actuals.
   */
  period:         { type: String, enum: ['weekly', 'monthly'], default: 'monthly', index: true },
  // periodKey — YYYY-MM (monthly) or YYYY-Www (weekly).
  month:          { type: String, required: true, index: true },
  targets:        { type: [TargetLineSchema], default: [] },
  notes:          { type: String, default: '' },
  createdBy:      { type: String },
  lastEditedBy:   { type: String },
  lastRecomputedAt: { type: Date, default: null },
}, { timestamps: true });

// One sheet per (org, user, period, periodKey). Both weekly + monthly
// sheets can coexist for the same employee without colliding.
EmployeeTargetSchema.index({ organizationId: 1, userId: 1, period: 1, month: 1 }, { unique: true });

export default model('EmployeeTarget', EmployeeTargetSchema);
