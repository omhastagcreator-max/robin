import { Schema, model, Types } from 'mongoose';

const BreakEventSchema = new Schema({
  startedAt: Date,
  endedAt: Date,
}, { _id: false });

const SessionSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  userId: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: Date,
  breakTime: { type: Number, default: 0 },
  status: { type: String, default: 'active', enum: ['active', 'on_break', 'ended'] },
  breakEvents: [BreakEventSchema],
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('Session', SessionSchema);
