import { Schema, model, Types } from 'mongoose';

const ClientTransactionSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  clientId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, required: true, enum: ['pending', 'paid', 'overdue'] },
  description: { type: String, required: true },
  date: { type: Date, default: Date.now },
  invoiceUrl: String,
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('ClientTransaction', ClientTransactionSchema);
