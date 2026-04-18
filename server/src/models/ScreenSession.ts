import { Schema, model, Types } from 'mongoose';

const ScreenSessionSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  status: { type: String, default: 'stopped', enum: ['active', 'stopped'] },
  startedAt: Date,
}, { timestamps: { createdAt: false, updatedAt: 'updatedAt' } });

export default model('ScreenSession', ScreenSessionSchema);
