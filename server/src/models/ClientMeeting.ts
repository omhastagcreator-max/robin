import { Schema, model, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * ClientMeeting — an instant meeting with someone OUTSIDE the org
 * (typically a prospect or client). The slug in the URL is the auth.
 *
 * Why distinct from the team `Meeting` model:
 *   - Different participant model (external guests, not Robin users)
 *   - Different LiveKit room scope (one-off, not the agency huddle)
 *   - Different lifecycle (auto-expires; can't recur; usually short)
 *
 * Security: token is unguessable, room is unique per slug, guest LiveKit
 * tokens are short-lived with narrow publish scopes (mic + screen only,
 * no data channels, no admin).
 */
function makeSlug(): string {
  // 12 random URL-safe chars = 72 bits of entropy
  return crypto.randomBytes(9).toString('base64url');
}

const ClientMeetingSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  slug:           { type: String, required: true, unique: true, default: makeSlug },
  hostUserId:     { type: String, required: true, index: true },

  clientName:     { type: String, default: '' },     // optional label "Acme review"
  agencyLabel:    { type: String, default: '' },     // shown to the prospect at top of join page
  note:           { type: String, default: '' },     // internal note

  // Lifecycle
  status: {
    type: String,
    enum: ['scheduled', 'active', 'ended', 'expired'],
    default: 'scheduled',
  },
  maxDurationMinutes: { type: Number, default: 120 }, // 2 hours
  expiresAt:          { type: Date, required: true }, // hard cap; default = createdAt + 24h
  startedAt:          { type: Date },                  // first guest join
  endedAt:            { type: Date },                  // host clicked End
  endReason:          { type: String, enum: ['host_ended', 'expired', 'duration_reached', 'admin_revoked'] },

  // Audit — every guest who joined
  guestJoins: [{
    name:      String,
    joinedAt:  Date,
    leftAt:    Date,
    ip:        String,
  }],
}, { timestamps: true });

ClientMeetingSchema.index({ organizationId: 1, status: 1, expiresAt: 1 });

export default model('ClientMeeting', ClientMeetingSchema);
