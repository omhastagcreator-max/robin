import mongoose, { Schema } from 'mongoose';

/**
 * EmployeeProgress — one document per (employee, ISO week) holding the
 * computed weekly scorecard. Written by the Monday-00:30-IST cron (for
 * the week that just ended) and recomputed on demand from the progress
 * API for the in-flight week.
 *
 * The metrics come exclusively from data Robin already records —
 * sessions, daily check-ins, tasks, leaves — so tracking progress costs
 * the team zero extra effort. See services/progressReport.ts for the
 * exact formulas and score weights.
 */
const MetricsSchema = new Schema({
  // Reliability
  daysWorked:      { type: Number, default: 0 },
  expectedDays:    { type: Number, default: 0 },   // non-Sundays elapsed − approved leave days
  leaveDays:       { type: Number, default: 0 },
  targetHitDays:   { type: Number, default: 0 },   // days with ≥ 8h net work
  avgStartMins:    { type: Number, default: null }, // avg first-login time, minutes past IST midnight
  // Focus
  totalActiveMs:   { type: Number, default: 0 },   // net worked (post break-credit + away)
  avgActiveMsDay:  { type: Number, default: 0 },
  totalBreakMs:    { type: Number, default: 0 },
  breakOkDays:     { type: Number, default: 0 },   // days within the 1h allowance
  awayRatio:       { type: Number, default: 0 },   // awayMs / gross clocked
  huddleRatio:     { type: Number, default: 0 },   // huddleMs / gross clocked
  // Delivery
  tasksPlanned:    { type: Number, default: 0 },   // morning check-in tasks
  tasksDelivered:  { type: Number, default: 0 },   // eveningStatus === 'done'
  tasksDropped:    { type: Number, default: 0 },
  promiseRate:     { type: Number, default: null }, // delivered / planned (null = nothing planned)
  projTasksDone:   { type: Number, default: 0 },   // ProjectTask completions this week
  onTimeRate:      { type: Number, default: null }, // done before dueDate (null = none had due dates)
  // Discipline
  checkinsDone:    { type: Number, default: 0 },   // morning+midday+evening pulses submitted
  checkinRate:     { type: Number, default: 0 },   // done / (3 × daysWorked)
}, { _id: false });

const BreakdownSchema = new Schema({
  reliability: { type: Number, default: 0 },  // /25
  focus:       { type: Number, default: 0 },  // /25
  delivery:    { type: Number, default: 0 },  // /30
  discipline:  { type: Number, default: 0 },  // /20
}, { _id: false });

const EmployeeProgressSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
  userId:         { type: String, required: true, index: true },
  /** IST Monday of the week this snapshot covers, as YYYY-MM-DD. */
  weekStartIST:   { type: String, required: true },
  metrics:        { type: MetricsSchema, default: () => ({}) },
  breakdown:      { type: BreakdownSchema, default: () => ({}) },
  score:          { type: Number, default: 0 },   // 0–100 composite
  /** True while the week is still in progress (recomputed on read). */
  provisional:    { type: Boolean, default: false },
  computedAt:     { type: Date, default: Date.now },
}, { timestamps: true });

EmployeeProgressSchema.index({ organizationId: 1, userId: 1, weekStartIST: 1 }, { unique: true });
EmployeeProgressSchema.index({ organizationId: 1, weekStartIST: 1 });

export default mongoose.model('EmployeeProgress', EmployeeProgressSchema);
