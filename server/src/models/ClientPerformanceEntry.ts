import { Schema, model, Types } from 'mongoose';

/**
 * ClientPerformanceEntry — per-client performance calendar (Aug 2026
 * owner ask: "for each client add one calendar where we can add meta
 * ads spend, total sales achieved, what is sales target for each
 * client" — logged at daily, weekly, AND monthly granularity, owner's
 * explicit choice when asked).
 *
 * One doc per (clientWorkflow, periodType, periodKey) — e.g. a client
 * can have an independent entry for "2026-08-11" (day), "2026-W32"
 * (ISO week), and "2026-08" (month) all at once. These are NOT
 * auto-summed from each other — a rep logs whichever granularity is
 * convenient for them (daily spend if they track it that closely,
 * or just a monthly total if that's all they have). Keeping the three
 * levels independent avoids double-counting bugs and matches how the
 * owner actually asked for it (daily AND weekly AND monthly, not
 * "daily that rolls up to monthly").
 *
 * periodKey formats (also mirrored in the calendar UI):
 *   day   → 'YYYY-MM-DD'      e.g. '2026-08-11'
 *   week  → 'YYYY-Www'        ISO week, e.g. '2026-W32'
 *   month → 'YYYY-MM'         e.g. '2026-08'
 */

const ClientPerformanceEntrySchema = new Schema({
  organizationId:   { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  clientWorkflowId: { type: Types.ObjectId, ref: 'ClientWorkflow', required: true, index: true },

  periodType: { type: String, enum: ['day', 'week', 'month'], required: true },
  periodKey:  { type: String, required: true },      // see format doc above
  periodStart: { type: Date, required: true, index: true },
  periodEnd:   { type: Date, required: true },

  metaAdsSpend:   { type: Number, default: 0, min: 0 },
  salesAchieved:  { type: Number, default: 0, min: 0 },
  salesTarget:    { type: Number, default: 0, min: 0 },

  notes: { type: String, default: '' },

  enteredBy: { type: Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// One entry per client per exact period — upsert-friendly.
ClientPerformanceEntrySchema.index(
  { clientWorkflowId: 1, periodType: 1, periodKey: 1 },
  { unique: true },
);
// Range queries for the calendar (e.g. "all day-entries in August").
ClientPerformanceEntrySchema.index({ clientWorkflowId: 1, periodType: 1, periodStart: -1 });

export default model('ClientPerformanceEntry', ClientPerformanceEntrySchema);
