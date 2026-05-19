import { Schema, model, Types } from 'mongoose';

/**
 * Issue — a user-reported problem with Robin.
 *
 * Captured automatically (URL, browser, role, recent console errors) +
 * whatever the user types/screenshots. The triage service classifies and
 * suggests workarounds via Claude; admins can mark resolved or escalate.
 */
const IssueSchema = new Schema({
  // Reporter
  userId:         { type: Types.ObjectId, ref: 'User', required: true, index: true },
  userName:       { type: String, default: '' },
  userEmail:      { type: String, default: '' },
  userRole:       { type: String, default: '' },
  organizationId: { type: Types.ObjectId, ref: 'Organization', index: true },

  // What the user said
  description:    { type: String, required: true },
  // Optional data URL of a screenshot (kept inline so we don't need a blob
  // store; capped at ~2 MB by the controller).
  screenshotData: { type: String, default: '' },

  // What we captured automatically
  context: {
    url:           { type: String, default: '' },
    userAgent:     { type: String, default: '' },
    viewport:      { type: String, default: '' },
    recentErrors:  { type: [String], default: [] },     // last few window.onerror lines
    recentNetwork: { type: [String], default: [] },     // last few failed API calls
  },

  // What Claude said (empty until the triage service runs)
  ai: {
    category:        { type: String, default: '' },     // 'permission', 'network', 'bug', 'usage', 'other'
    severity:        { type: String, default: '' },     // 'low', 'medium', 'high', 'blocking'
    area:            { type: String, default: '' },     // 'huddle', 'sales', 'admin', 'pipeline', etc.
    suspectedCause:  { type: String, default: '' },
    suggestedFix:    { type: String, default: '' },     // user-facing workaround
    adminNote:       { type: String, default: '' },     // engineering-side note
  },

  // Lifecycle
  status:     { type: String, enum: ['open', 'investigating', 'resolved', 'wont_fix', 'duplicate'], default: 'open', index: true },
  resolvedBy: { type: Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date,  default: null },
  resolution: { type: String, default: '' },
}, { timestamps: true });

IssueSchema.index({ createdAt: -1 });
IssueSchema.index({ 'ai.area': 1, status: 1 });

export default model('Issue', IssueSchema);
