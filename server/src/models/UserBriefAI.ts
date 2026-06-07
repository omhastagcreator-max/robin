import { Schema, model, Types } from 'mongoose';

/**
 * UserBriefAI — cache of the Gemini-generated narrative for one
 * (user, day, kind=morning|evening) tuple.
 *
 * Why a separate collection: the structured brief itself is cheap to
 * recompute on every /api/brief/me read (no model required), but the
 * AI paragraph is NOT cheap — each call costs a few free-tier tokens
 * and adds ~600ms latency. We generate it AT MOST once per user per
 * kind per IST day, then read this cache on subsequent calls.
 *
 * The dailyBriefCron pre-populates this row when it fires at 9am +
 * 7pm IST, so when the employee opens Robin the paragraph is warm
 * and instantaneous. If they happen to load the page BEFORE the cron
 * runs (unusual), the live endpoint generates + saves on demand.
 *
 * Stale rows are kept for history/audit — there's no TTL. If a row
 * ever gets too large, a quarterly prune by createdAt is fine.
 */

const UserBriefAISchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: String, required: true, index: true },
  dateIST:        { type: String, required: true },     // YYYY-MM-DD
  kind:           { type: String, enum: ['morning', 'evening'], required: true },

  // The 2-3 sentence Gemini paragraph.
  narrative:      { type: String, required: true },
  // Which model produced it — useful for A/B and debugging quality
  // regressions when Google ships a new flash variant.
  model:          { type: String, default: 'gemini-flash' },
  // Token usage if returned — purely informational.
  tokens:         { type: Number, default: 0 },
}, { timestamps: true });

// One narrative per (user, day, kind).
UserBriefAISchema.index({ userId: 1, dateIST: 1, kind: 1 }, { unique: true });

export default model('UserBriefAI', UserBriefAISchema);
