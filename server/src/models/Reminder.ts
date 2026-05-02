import { Schema, model, Types } from 'mongoose';

/**
 * Personal reminder / weekly-planner item. Per-user; no project link
 * required (though projectId is optional). Used by the dashboard's
 * "This week" planner so anyone can capture a check-in / client meet /
 * deliverable without going through the full task creation flow.
 */
const ReminderSchema = new Schema({
  userId:         { type: String, required: true, index: true },
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  title:          { type: String, required: true, trim: true },
  scheduledFor:   { type: Date, required: true },
  notes:          { type: String, trim: true },
  status:         { type: String, enum: ['pending', 'done'], default: 'pending' },
}, { timestamps: true });

ReminderSchema.index({ userId: 1, scheduledFor: 1 });
ReminderSchema.index({ organizationId: 1, scheduledFor: 1 });

export default model('Reminder', ReminderSchema);
