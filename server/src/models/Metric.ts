import { Schema, model, Types } from 'mongoose';

const MetricSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  projectId: { type: Types.ObjectId, ref: 'Project', required: true },
  date: { type: Date, required: true },
  metricName: { type: String, required: true },
  value: { type: Number, required: true },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

MetricSchema.index({ projectId: 1, date: 1, metricName: 1 }, { unique: true });

export default model('Metric', MetricSchema);
