import { Schema, model, Types } from 'mongoose';

// 11-stage pipeline enum
export const LEAD_STAGES = [
  // Prospecting Pipeline
  'new_lead', 'dialed', 'connected', 'demo_booked', 'demo_done', 'demo2_conversion',
  // Sales Follow-through
  'follow_up', 'hot_follow_up', 'cooking',
  // Outcomes
  'won', 'lost',
] as const;

export type LeadStage = typeof LEAD_STAGES[number];

const StageActivitySchema = new Schema({
  stage:     String,
  movedAt:   { type: Date, default: Date.now },
  movedBy:   String,
  note:      String,
}, { _id: false });

const LeadSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
  name:           { type: String, required: true },
  contact:        { type: String },
  email:          { type: String },
  company:        String,
  // Source — three categories drive the sales UI: 'outbound', 'inbound',
  // 'organic'. Legacy values ('referral', 'cold_call', 'website', 'social',
  // 'other') are kept so older docs continue to validate, but the New-Lead
  // form now shows just the three primary buttons. Mapping (for reporting):
  //   referral / social / website   → organic
  //   cold_call                      → outbound
  //   other / ''                     → (unbucketed)
  source: {
    type: String,
    enum: [
      'outbound', 'inbound', 'organic',
      // legacy / fine-grained labels — still accepted for backwards compat
      'referral', 'cold_call', 'website', 'social', 'other', '',
    ],
    default: 'inbound',
  },
  stage: {
    type: String,
    enum: LEAD_STAGES,
    default: 'new_lead',
  },
  // Legacy field kept for backwards compat
  status: {
    type: String,
    default: 'new_lead',
  },
  assignedTo:     String,
  estimatedValue: { type: Number, default: 0 },
  currency:       { type: String, default: 'INR' },
  nextFollowUp:   Date,
  tags:           [String],
  notes:          [{ content: String, authorId: String, createdAt: { type: Date, default: Date.now } }],
  stageHistory:   [StageActivitySchema],
  // Outcome details
  closedAt:             Date,
  lostReason:           String,
  wonAmount:            Number,
  convertedToClientId:  { type: String, default: null }, // set when admin converts lead → client account

  // ── External feed fingerprints (Meta Lead Ads / Google Sheet rows) ────
  // externalId = the stable ID from the upstream system. For Meta this is
  // the lead `id` (or `lead_id`) column on the sheet — guarantees we never
  // double-import the same lead even if the sales rep edits phone/email.
  externalId:   { type: String, index: true },
  // Free-text label so the UI can show "Diwali Promo Reel" alongside the
  // strict `source` enum (which stays as 'social' / 'website' / etc).
  sourceLabel:  { type: String },
  // The original sheet row, header→value, untouched. Lets the Sales UI
  // surface campaign/ad/form/created_time without us having to model them.
  rawData:      { type: Schema.Types.Mixed },
  // Where this lead came from — useful for filtering "show me only Meta leads".
  importedFrom: { type: String, enum: ['manual', 'google-sheet', 'meta-leadgen', 'csv'], default: 'manual' },

  // ── AI lead scoring (Gemini-backed) ───────────────────────────────────
  // Populated automatically on create + on demand via /api/ai/score-lead.
  // The sales kanban renders the score as a coloured chip and uses
  // `aiNextAction` as the row's primary suggestion. Stale-but-present is
  // fine — UI shows scoredAt so the user knows freshness.
  aiScore:      { type: String, enum: ['hot', 'warm', 'cold', ''], default: '' },
  aiReason:     { type: String, default: '' },
  aiNextAction: { type: String, default: '' },
  aiScoredAt:   { type: Date, default: null },

  // ── Payment tracking ─────────────────────────────────────────────────
  // Leads in India don't usually pay 100% upfront — typical flow is "20%
  // to start, 30% after the store goes live, balance after handover."
  // The team asked for a place to record where each lead sits in that
  // flow so a glance at the board answers "who still owes us how much,
  // and what triggers the next payment?"
  //
  //   paymentStatus    chip on every list view (none / part_paid / full_paid / refunded)
  //   paymentPaid      total already collected, in paise-free rupees
  //   paymentTotal     full deal value the rep negotiated
  //   paymentNote      the "what triggers the NEXT payment" sentence in
  //                    plain English ("client will pay 50% after Shopify
  //                    goes live"). Always visible above the history.
  //   paymentEvents[]  mini ledger — every time someone marks payment,
  //                    one entry appends here. Lets us reconstruct the
  //                    timeline without a separate collection.
  paymentStatus: { type: String, enum: ['none', 'part_paid', 'full_paid', 'refunded'], default: 'none' },
  paymentPaid:   { type: Number, default: 0 },
  paymentTotal:  { type: Number, default: 0 },
  paymentNote:   { type: String, default: '' },
  paymentEvents: [{
    status: { type: String, enum: ['part_paid', 'full_paid', 'refunded'] },
    amount: { type: Number, default: 0 },
    note:   { type: String, default: '' },     // condition / reason — "after store goes live"
    by:     { type: String, default: '' },     // userId of whoever marked it
    at:     { type: Date,   default: Date.now },
  }],
}, { timestamps: true });

// Keep status in sync with stage
LeadSchema.pre('save', function () {
  this.status = this.stage;
});

export default model('Lead', LeadSchema);
