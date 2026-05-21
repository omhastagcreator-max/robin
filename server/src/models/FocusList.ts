import { Schema, model, Types } from 'mongoose';

/**
 * FocusList — sales reps mark a small handful of leads/clients that need
 * extra attention this week, optionally assigning teammates to help close
 * them. One FocusList document per (organization, week, ownerId).
 *
 * Why a dedicated model and not just a Lead.tags = 'priority' field?
 *   - It's a *weekly* construct (resets each week, history visible).
 *   - The same lead can appear with a different urgency week to week.
 *   - Assignees + assignment timestamps are needed for the notification
 *     trail; storing them on Lead would muddy the lead lifecycle.
 *
 * weekStart is normalised to the Monday of the focus week (server timezone).
 * That gives us a stable join key without needing a date range.
 */

export const FOCUS_URGENCY = ['watch', 'high', 'critical'] as const;
export type FocusUrgency = typeof FOCUS_URGENCY[number];

const FocusItemSchema = new Schema({
  // Polymorphic reference — exactly one of leadId | clientUserId is set.
  leadId:       { type: Types.ObjectId, ref: 'Lead', default: null },
  clientUserId: { type: Types.ObjectId, ref: 'User', default: null },
  // Snapshot fields so the UI can render even if the lead/user is later
  // renamed or deleted. Updated on add; not auto-refreshed.
  label:        { type: String, required: true },        // "Acme Corp" / "Priya Sharma"
  subLabel:     { type: String, default: '' },           // "demo done · ₹1,20,000"
  urgency:      { type: String, enum: FOCUS_URGENCY, default: 'high' },
  note:         { type: String, default: '' },
  // Team members the rep has assigned to help on this item. Notifications
  // fire on each assignment (see focusListController).
  assignedTo:   [{ type: String }], // userIds (string, matches notification recipientId)
  assignedAt:   { type: Date, default: Date.now },
  // Mark done so the rep can clear without deleting history.
  doneAt:       { type: Date, default: null },
}, { _id: true, timestamps: { createdAt: true, updatedAt: false } });

const FocusListSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  ownerId:        { type: String, required: true, index: true },
  // ISO date string of the Monday of the focus week (YYYY-MM-DD).
  weekStart:      { type: String, required: true, index: true },
  items:          [FocusItemSchema],
}, { timestamps: true });

FocusListSchema.index({ organizationId: 1, ownerId: 1, weekStart: 1 }, { unique: true });

export default model('FocusList', FocusListSchema);
