import { Schema, model, Types } from 'mongoose';

const ProjectUpdateSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  projectId: { type: Types.ObjectId, ref: 'Project', required: true },
  authorId: { type: String, required: true },
  content: { type: String, required: true },
  requiresApproval: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: null },
  feedback: String,
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('ProjectUpdate', ProjectUpdateSchema);
