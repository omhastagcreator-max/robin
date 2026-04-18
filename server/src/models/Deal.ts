import { Schema, model, Types } from 'mongoose';

const DealSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
  leadId: { type: Types.ObjectId, ref: 'Lead' },
  dealValue: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  serviceType: { type: String, required: true, enum: ['ads', 'website', 'combined', 'seo', 'social'] },
  status: { type: String, default: 'open', enum: ['open', 'won', 'lost'] },
  closedAt: Date,
  notes: String,
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('Deal', DealSchema);
