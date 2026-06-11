import { Schema, model, Types } from 'mongoose';

/**
 * EmployeeDayPlan — one per (org, user, ISO week). Captures what an
 * employee should focus on each day of that week:
 *
 *   - clients they "own" that day (e.g. for check-in calls / reviews)
 *   - tasks they should perform for those clients
 *   - the weekly target they're shooting for by the next meeting
 *
 * The day-allocation can be auto-distributed via the round-robin
 * controller: take every brand the employee is assigned to (any
 * service.assignedTo === userId), then evenly spread them Mon-Fri so
 * no client gets skipped between weekly meetings.
 *
 * The agency owner edits this from the Command Center; the employee
 * sees a read-only version pinned to the top of their Workroom.
 *
 * Schema notes:
 *   - `weekKey` is the ISO-week string YYYY-Www (e.g. '2026-W23').
 *     Matches the format already used by EmployeeTarget.
 *   - `entries` is an array of per-day plans. Always five entries
 *     (Mon-Fri) for the auto-distribute path; admin can add Sat/Sun
 *     manually if needed.
 */

const DayPlanEntrySchema = new Schema({
  // ISO weekday: 1=Mon ... 7=Sun.
  dayOfWeek: { type: Number, required: true, min: 1, max: 7 },
  // Brands to focus on this day. Stored as workflow IDs; UI resolves
  // names from the existing brand list.
  clients:   { type: [{ type: Types.ObjectId, ref: 'ClientWorkflow' }], default: [] },
  // Free-text task lines for this day. Each entry is a single line.
  tasks:     { type: [String], default: [] },
  // What needs to be achieved BY the next meeting for this day's
  // clients. Persists as a single string so admin can write a
  // sentence rather than a structured list.
  target:    { type: String, default: '' },
  notes:     { type: String, default: '' },
}, { _id: true });

const EmployeeDayPlanSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: String, required: true, index: true },
  // YYYY-Www (ISO week, IST-anchored).
  weekKey:        { type: String, required: true, index: true },
  entries:        { type: [DayPlanEntrySchema], default: [] },
  // Overall weekly target — the agency-level commitment the employee
  // is signing up for. Separate from each day's per-client target.
  weeklyTarget:   { type: String, default: '' },
  notes:          { type: String, default: '' },
  lastEditedBy:   { type: String, default: '' },
}, { timestamps: true });

// One plan per (org, user, week).
EmployeeDayPlanSchema.index({ organizationId: 1, userId: 1, weekKey: 1 }, { unique: true });

export default model('EmployeeDayPlan', EmployeeDayPlanSchema);
