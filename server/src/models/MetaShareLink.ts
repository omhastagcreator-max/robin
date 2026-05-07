import { Schema, model, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * MetaShareLink — a public-readable URL for one Meta Ads report snapshot.
 *
 * The token in the URL is the auth — no Robin login required to view.
 * That's the whole point: agency sends a link to their client via
 * WhatsApp/email, client clicks, sees a clean read-only report.
 *
 * Security mitigations:
 *   1. token is 24 random bytes (192 bits of entropy) — unguessable.
 *   2. expiresAt: defaults to 14 days from creation, configurable.
 *   3. revokedAt: admin can kill a link instantly if leaked.
 *   4. Bound to ONE ad account + ONE date range — can't be tampered to
 *      see other accounts.
 *   5. We log views for audit (count + lastViewedAt + IP).
 */
function makeToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

const MetaShareLinkSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  token:          { type: String, required: true, unique: true, default: makeToken },
  adAccountId:    { type: String, required: true },
  // Either a date preset ('yesterday', 'last_7d', 'last_30d') OR an explicit range.
  datePreset:     { type: String },
  fromDate:       { type: String },          // YYYY-MM-DD if explicit range
  toDate:         { type: String },
  // Optional context — what client this is for, who created it, custom note.
  clientUserId:   { type: String },          // links to User with role='client', if any
  clientLabel:    { type: String },          // free text, e.g., "Scent Diffuser"
  note:           { type: String },          // internal note, not shown to client
  createdBy:      { type: String, required: true },
  expiresAt:      { type: Date,   required: true },
  revokedAt:      { type: Date,   default: null },
  // Audit
  viewCount:      { type: Number, default: 0 },
  lastViewedAt:   { type: Date },
  lastViewerIp:   { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

MetaShareLinkSchema.index({ organizationId: 1, createdBy: 1 });
MetaShareLinkSchema.index({ adAccountId: 1, expiresAt: -1 });

export default model('MetaShareLink', MetaShareLinkSchema);
