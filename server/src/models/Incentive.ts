import { Schema, model, Types } from 'mongoose';

/**
 * Incentive — Oct 2026 owner ask: "an incentive section for each
 * employee, visible to everyone — how much is earned by whom".
 *
 * One row per payout entry (an employee can earn several in a month).
 * `month` is the IST calendar month ('YYYY-MM') the incentive counts
 * towards, so totals group cleanly regardless of when it was entered.
 * Admin-entered; read by every internal staff role.
 */
const IncentiveSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: String, required: true, index: true },
  amount:         { type: Number, required: true, min: 0 },
  reason:         { type: String, trim: true, default: '', maxlength: 200 },
  month:          { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  createdBy:      { type: String, required: true },
  // Oct 19 2026 (Rahul's voice note: staff "go to incentives and add their
  // own"): a teammate's own entry is 'pending' until an admin/manager
  // approves it. Only approved entries count in the totals.
  status:         { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
  reviewedBy:     { type: String, default: '' },
  reviewedAt:     { type: Date, default: null },
}, { timestamps: true });

IncentiveSchema.index({ organizationId: 1, month: 1 });

export default model('Incentive', IncentiveSchema);
