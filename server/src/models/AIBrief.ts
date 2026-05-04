import { Schema, model, Types } from 'mongoose';

/**
 * AIBrief — cached output of an AI generation for a user, keyed by date.
 *
 * Why we cache:
 *   Every Claude API call costs money (small, but it adds up across an
 *   agency × 30 days × every refresh). A morning brief for "today" doesn't
 *   change once it's generated, so we generate it ONCE per user per day
 *   and serve the cached copy on subsequent loads. The dashboard can call
 *   GET /api/ai/morning-brief on every render without worrying.
 *
 * `kind` exists so the same table can hold different brief types later —
 * morning_brief, end_of_day_wrap, weekly_digest, meeting_notes — without a
 * separate collection per feature. (One table, indexed by kind, scales fine.)
 *
 * `dateKey` is a YYYY-MM-DD string in the user's local timezone (we'll
 * compute it server-side from IST for now). String makes the unique index
 * trivial and queries human-readable.
 */
const AIBriefSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  userId:         { type: String, required: true, index: true },
  kind:           { type: String, required: true, enum: ['morning_brief', 'end_of_day', 'weekly_digest'] },
  dateKey:        { type: String, required: true },          // e.g. "2026-05-02"
  content:        { type: String, required: true },          // Markdown body Claude returned
  model:          { type: String },                          // Which Claude model produced it (for debugging)
  inputTokens:    { type: Number },                          // Useful for cost analytics
  outputTokens:   { type: Number },
  meta:           { type: Schema.Types.Mixed },              // Stash the raw payload we sent (for replay/debug)
}, { timestamps: true });

// One brief per user per kind per date.
AIBriefSchema.index({ userId: 1, kind: 1, dateKey: 1 }, { unique: true });

export default model('AIBrief', AIBriefSchema);
