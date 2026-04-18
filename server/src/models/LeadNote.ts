import { Schema, model, Types } from 'mongoose';

const LeadNoteSchema = new Schema({
  leadId: { type: Types.ObjectId, ref: 'Lead', required: true },
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  authorId: String,
  content: { type: String, required: true },
  type: { type: String, default: 'note', enum: ['note', 'call', 'email', 'meeting'] },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('LeadNote', LeadNoteSchema);
