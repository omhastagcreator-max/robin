import { Schema, model, Types } from 'mongoose';

const CommentSchema = new Schema({
  authorId: String,
  content: String,
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const ProjectTaskSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  projectId: { type: Types.ObjectId, ref: 'Project' },
  assignedTo: String,
  assignedBy: String,
  title: { type: String, required: true },
  description: String,
  taskType: { type: String, required: true, enum: ['dev', 'ads', 'content', 'admin_task', 'personal'] },
  status: { type: String, default: 'pending', enum: ['pending', 'ongoing', 'done'] },
  priority: { type: String, default: 'medium', enum: ['low', 'medium', 'high', 'urgent'] },
  category: String,
  dueDate: Date,
  timeSpent: { type: Number, default: 0 },
  completedAt: Date,
  comments: [CommentSchema],
}, { timestamps: true });

export default model('ProjectTask', ProjectTaskSchema);
