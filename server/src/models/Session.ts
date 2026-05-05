import { Schema, model, Types } from 'mongoose';

const BreakEventSchema = new Schema({
  startedAt: Date,
  endedAt: Date,
}, { _id: false });

/**
 * Session — one clock-in / clock-out cycle for a user.
 *
 * The interesting fields:
 *  - lastHeartbeatAt: bumped every time the client pings /sessions/heartbeat.
 *    Time calculations clamp the "end" of a still-open session to
 *    lastHeartbeatAt + small grace period, so closed-browser time never
 *    accrues. Persisted (vs. just memory) so a server restart doesn't lose
 *    the high-water mark.
 *  - autoClosedAt: set when the daily cron force-closes a forgotten session.
 *    Lets us label such rows in the UI ("auto-clocked out at 23:59") and
 *    distinguish them from sessions where the user clicked Stop.
 */
const SessionSchema = new Schema({
  organizationId:  { type: Types.ObjectId, ref: 'Organization' },
  userId:          { type: String, required: true },
  startTime:       { type: Date, required: true },
  endTime:         Date,
  breakTime:       { type: Number, default: 0 },
  status:          { type: String, default: 'active', enum: ['active', 'on_break', 'ended'] },
  breakEvents:     [BreakEventSchema],
  lastHeartbeatAt: { type: Date },
  autoClosedAt:    { type: Date },
  // ── On Call (independent of break) ────────────────────────────────────
  // Whitelist for "do not disturb" — when set, the team UI shows an
  // "On call" badge so colleagues know not to ping you. Doesn't pause the
  // work timer (calls ARE work).
  onCallSince:     { type: Date, default: null },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

// Speed up the cron query — find every still-open session in the org.
SessionSchema.index({ status: 1, lastHeartbeatAt: 1 });

export default model('Session', SessionSchema);
