import { Schema, model } from 'mongoose';

const AdReportSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  projectId:      { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  postedBy:       { type: String, required: true },   // project lead userId
  date:           { type: Date, default: Date.now },
  platform:       { type: String, enum: ['meta', 'google', 'linkedin', 'twitter', 'youtube', 'other'], default: 'meta' },
  // Core metrics
  reach:          { type: Number, default: 0 },
  impressions:    { type: Number, default: 0 },
  clicks:         { type: Number, default: 0 },
  leads:          { type: Number, default: 0 },
  spend:          { type: Number, default: 0 },       // INR
  revenue:        { type: Number, default: 0 },       // revenue attributed
  roas:           { type: Number, default: 0 },       // computed: revenue/spend
  ctr:            { type: Number, default: 0 },       // clicks/impressions * 100
  cpl:            { type: Number, default: 0 },       // spend/leads
  notes:          { type: String },
  isVisible:      { type: Boolean, default: true },   // client can/cannot see
}, { timestamps: true });

AdReportSchema.pre('save', function () {
  if (this.spend > 0) {
    if (this.leads > 0) this.cpl = parseFloat((this.spend / this.leads).toFixed(2));
    if (this.revenue > 0) this.roas = parseFloat((this.revenue / this.spend).toFixed(2));
  }
  if (this.impressions > 0 && this.clicks > 0) {
    this.ctr = parseFloat(((this.clicks / this.impressions) * 100).toFixed(2));
  }
});

export default model('AdReport', AdReportSchema);
