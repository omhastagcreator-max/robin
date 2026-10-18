import { Schema, model, Types } from 'mongoose';

const ActivityLogSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  userId: String,
  action: { type: String, required: true },
  entity: String,
  entityId: Types.ObjectId,
  metadata: Schema.Types.Mixed,
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

ActivityLogSchema.index({ organizationId: 1, createdAt: -1 });
// Oct 2026 — Team Oversight: per-user sign-in lookups (auth.login / auth.resume).
ActivityLogSchema.index({ userId: 1, action: 1, createdAt: -1 });

export default model('ActivityLog', ActivityLogSchema);
