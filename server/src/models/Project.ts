import { Schema, model, Types } from 'mongoose';

const MemberSchema = new Schema({
  supabaseId: String,
  roleInProject: { type: String, enum: ['lead', 'member'] },
}, { _id: false });

const ProjectSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
  name: { type: String, required: true },
  clientId: String,
  projectLeadId: String,
  projectType: { type: String, required: true, enum: ['ads', 'website', 'combined'] },
  services: [{ type: String }],
  servicesDescription: String,
  dealId: { type: Types.ObjectId, ref: 'Deal' },
  deadline: Date,
  status: { type: String, default: 'active', enum: ['active', 'completed', 'paused', 'cancelled'] },
  totalTasks: { type: Number, default: 0 },
  completedTasks: { type: Number, default: 0 },
  overdueTasks: { type: Number, default: 0 },
  members: [MemberSchema],
}, { timestamps: true });

export default model('Project', ProjectSchema);
