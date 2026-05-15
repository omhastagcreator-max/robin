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
  // Total time the user was offline / had Robin closed during this session,
  // in milliseconds. Accumulated by the heartbeat endpoint whenever the gap
  // between consecutive heartbeats exceeds the away threshold (90s) — that
  // gap is treated as "user wasn't actually working." Subtracted from
  // worked-time alongside breakTime, so closing your tab pauses your timer
  // within ~90s instead of waiting for the 8pm cron to clean up.
  awayMs:          { type: Number, default: 0 },

  // ── Huddle tracking — working time = time spent in the agency huddle ──
  // The agency model is "everyone hangs out in the always-on voice room
  // while working." Joining the huddle starts the work counter; leaving
  // it pauses the counter (the user is presumed AFK / not actually
  // collaborating). These fields persist that accounting:
  //
  //   huddleJoinedAt — non-null while currently inside the huddle.
  //                    On join: set to now. On leave: cleared after
  //                    flushing elapsed into huddleMs.
  //   huddleMs       — cumulative completed huddle time so far this
  //                    session. Open huddle interval (now - huddleJoinedAt)
  //                    is added on read; finalised on session end.
  huddleJoinedAt:  { type: Date, default: null },
  huddleMs:        { type: Number, default: 0 },
  // ── On Call (independent of break) ────────────────────────────────────
  // Whitelist for "do not disturb" — when set, the team UI shows an
  // "On call" badge so colleagues know not to ping you. Doesn't pause the
  // work timer (calls ARE work).
  onCallSince:     { type: Date, default: null },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

// Speed up the cron query — find every still-open session in the org.
SessionSchema.index({ status: 1, lastHeartbeatAt: 1 });

export default model('Session', SessionSchema);
