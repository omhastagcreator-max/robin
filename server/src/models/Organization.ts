import { Schema, model } from 'mongoose';

const OrganizationSchema = new Schema({
  name: { type: String, required: true },
  plan: { type: String, default: 'free' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('Organization', OrganizationSchema);
