import { Schema, model, Types } from 'mongoose';

const ClientAlertSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  clientId: { type: String, required: true },
  alertType: { type: String, default: 'outstanding_balance' },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  priority: { type: String, default: 'normal', enum: ['low', 'normal', 'high'] },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('ClientAlert', ClientAlertSchema);
