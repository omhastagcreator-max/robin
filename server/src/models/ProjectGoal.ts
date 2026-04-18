import { Schema, model, Types } from 'mongoose';

const ProjectGoalSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  projectId: { type: Types.ObjectId, ref: 'Project', required: true },
  title: { type: String, required: true },
  metricName: { type: String, required: true },
  targetValue: { type: Number, required: true },
  currentValue: { type: Number, default: 0 },
  betterDirection: { type: String, enum: ['up', 'down'] },
}, { timestamps: true });

export default model('ProjectGoal', ProjectGoalSchema);
