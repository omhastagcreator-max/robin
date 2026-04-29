import { Schema, model, Types } from 'mongoose';

/**
 * A request from an employee to take leave on one or more individual days.
 *
 * Design notes:
 *   - The user picks dates one-by-one (no ranges). Each day carries its own
 *     reason — agencies often want to know why each specific day is needed.
 *   - Applications are private to the requesting employee + admins. Other
 *     employees never see these records, only the resulting "on leave" badge.
 *   - Saturday + Sunday cannot appear together in a single application
 *     (enforced at the controller layer).
 */

const LeaveDaySchema = new Schema({
  date:   { type: Date,   required: true },
  reason: { type: String, required: true, trim: true },
}, { _id: false });

const LeaveApplicationSchema = new Schema({
  userId:         { type: String, required: true, index: true },
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },

  days: { type: [LeaveDaySchema], validate: (v: any[]) => Array.isArray(v) && v.length > 0 },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },

  reviewedBy: String,
  reviewedAt: Date,
  reviewNote: { type: String, trim: true },
}, { timestamps: true });

LeaveApplicationSchema.index({ userId: 1, status: 1 });
LeaveApplicationSchema.index({ organizationId: 1, status: 1 });
LeaveApplicationSchema.index({ 'days.date': 1, status: 1 });

export default model('LeaveApplication', LeaveApplicationSchema);
