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
  source: {
    type: String,
    enum: ['referral', 'cold_call', 'website', 'social', 'inbound', 'outbound', 'other', ''],
    default: 'other',
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
  closedAt:       Date,
  lostReason:     String,
  wonAmount:      Number,
}, { timestamps: true });

// Keep status in sync with stage
LeadSchema.pre('save', function () {
  this.status = this.stage;
});

export default model('Lead', LeadSchema);
