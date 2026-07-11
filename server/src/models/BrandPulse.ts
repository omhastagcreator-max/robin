import mongoose, { Schema } from 'mongoose';

/**
 * BrandPulse — a random, blocking accountability question about a brand,
 * fired at an employee during work hours (owner ask, July 2026).
 *
 * "Ask randomly about all the brands' progress any time from all the
 *  employees and make them responsible to answer — then only they can
 *  continue Robin. Allow skip if they're not managing the brand, ask
 *  who is, then ask them."
 *
 * Lifecycle:
 *   pending    → the blocking modal shows this to `userId` until acted on
 *   answered   → answer recorded (visible on the Progress page)
 *   redirected → user said "not my brand" and named the manager; a NEW
 *                pending pulse is created for that person, linked via
 *                redirectedFrom. Chains are capped at 2 hops so a
 *                question can't ping-pong forever.
 *
 * Questions are marketing-agency-flavoured: sales achieved, target
 * status, next plan, ad performance, blockers, client communication.
 * The question bank lives in jobs/brandPulseCron.ts.
 */
const BrandPulseSchema = new Schema({
  organizationId:   { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
  /** Who must answer (String userId — matches Session.userId convention). */
  userId:           { type: String, required: true, index: true },
  clientWorkflowId: { type: Schema.Types.ObjectId, ref: 'ClientWorkflow', required: true },
  clientName:       { type: String, default: '' },
  questionKind: {
    type: String,
    enum: [
      'sales_achieved', 'target_status', 'next_plan', 'ad_performance',
      'blockers', 'client_update', 'engagement', 'content_script',
    ],
    required: true,
  },
  question:         { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'answered', 'redirected'],
    default: 'pending',
    index: true,
  },
  answer:           { type: String, default: '' },
  /** Redirect chain bookkeeping. */
  redirectedTo:     { type: String, default: null },   // userId the question moved to
  redirectedFrom:   { type: String, default: null },   // userId who passed it here
  hop:              { type: Number, default: 0 },      // 0 = original ask
  askedAt:          { type: Date, default: Date.now },
  answeredAt:       { type: Date, default: null },
}, { timestamps: true });

BrandPulseSchema.index({ organizationId: 1, userId: 1, status: 1 });
BrandPulseSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.model('BrandPulse', BrandPulseSchema);
