import { Schema, model, Types } from 'mongoose';

/**
 * VideoSopRun — Oct 2026. One run of the UGC / Video SOP (lib/videoSop.ts)
 * for one brand's UGC Videos service. Deadlines are frozen on the run at
 * start (dueAt / graceUntil) so later SOP edits never move an in-flight
 * brand's goalposts.
 */
const StepItemSchema = new Schema({
  done:   { type: Boolean, default: false },
  doneAt: { type: Date, default: null },
  doneBy: { type: String, default: '' },
}, { _id: false });

const StepSchema = new Schema({
  key:        { type: String, required: true },
  dueAt:      { type: Date, required: true },
  graceUntil: { type: Date, required: true },
  items:      { type: [StepItemSchema], default: [] },
  link:       { type: String, default: '' },
  note:       { type: String, default: '' },
  doneAt:     { type: Date, default: null },
  doneBy:     { type: String, default: '' },
  late:       { type: Boolean, default: false },     // completed after dueAt
  afterGrace: { type: Boolean, default: false },     // completed after graceUntil
  lateReason: { type: String, default: '' },         // LATE_REASONS key
  lateNote:   { type: String, default: '' },
}, { _id: false });

const LogSchema = new Schema({
  at:        { type: Date, default: Date.now },
  actorId:   { type: String, default: '' },
  actorName: { type: String, default: '' },
  action:    { type: String, required: true },
  stepKey:   { type: String, default: '' },
  detail:    { type: String, default: '' },
}, { _id: false });

// Oct 2026 — "day need to update for each step": the assigned person posts
// one update per IST day on whatever step is current (or completes it).
const DailyUpdateSchema = new Schema({
  dateIST: { type: String, required: true },     // YYYY-MM-DD
  at:      { type: Date, default: Date.now },
  by:      { type: String, required: true },
  stepKey: { type: String, default: '' },
  text:    { type: String, required: true },
  blocker: { type: String, default: '' },
}, { _id: false });

const VideoSopRunSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  workflowId:     { type: Types.ObjectId, ref: 'ClientWorkflow', required: true, index: true },
  serviceId:      { type: Types.ObjectId, required: true },
  clientName:     { type: String, default: '' },
  assignedTo:     { type: String, default: '', index: true },
  startedAt:      { type: Date, required: true },
  startedBy:      { type: String, default: '' },
  status:         { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
  completedAt:    { type: Date, default: null },
  brief: {
    product:         { type: String, default: '' },
    price:           { type: String, default: '' },
    offer:           { type: String, default: '' },
    competitors:     { type: String, default: '' },
    competitorLinks: { type: String, default: '' },
    referenceVideo:  { type: String, default: '' },
    videos:          { type: String, default: '' },
    requirements:    { type: String, default: '' },
  },
  // Sales handover (Rishi) captured at onboarding — read-only context for the video team.
  salesBrief:     { type: Schema.Types.Mixed, default: null },
  steps:          { type: [StepSchema], default: [] },
  // Escalation bookkeeping (jobs/videoSopCron.ts).
  lastNotifyLevel: { type: String, enum: ['', 'normal', 'aggressive', 'hyper'], default: '' },
  lastNotifyAt:    { type: Date, default: null },
  normalSentFor:   { type: [String], default: [] },   // step keys already given their "due soon" reminder
  log:            { type: [LogSchema], default: [] },
  dailyUpdates:   { type: [DailyUpdateSchema], default: [] },
  // Evening escalation bookkeeping: IST dates already chased / escalated.
  dailyChasedFor:    { type: String, default: '' },
  dailyEscalatedFor: { type: String, default: '' },
}, { timestamps: true });

VideoSopRunSchema.index({ organizationId: 1, serviceId: 1 }, { unique: true });

export default model('VideoSopRun', VideoSopRunSchema);
