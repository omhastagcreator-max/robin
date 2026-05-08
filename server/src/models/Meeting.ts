import { Schema, model, Types } from 'mongoose';

/**
 * Meeting — a scheduled time block on someone's calendar.
 *
 * Visibility model (the key product decision):
 *   - default 'public' — busy slot is visible to the whole org so they
 *     can plan around it, but only the host + invited attendees see the
 *     title/description. Everyone else sees just "busy".
 *   - 'private' — only host + attendees know the slot exists at all.
 *     Use sparingly (therapy, personal, sensitive interview).
 *
 * Type drives color coding in the calendar grid:
 *   client = orange · internal = blue · focus = green · personal = grey
 *
 * `attendees` are internal Robin staff invited (we don't sync to external
 * calendars yet). When an attendee accepts, their own UI shows the meeting
 * with full details too.
 */
const MeetingSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  hostUserId:     { type: String, required: true, index: true },

  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  type:           { type: String, enum: ['client', 'internal', 'focus', 'personal'], default: 'internal' },
  link:           { type: String, default: '' },     // optional Zoom/Meet/etc URL

  startTime:      { type: Date, required: true },
  endTime:        { type: Date, required: true },

  attendees:      { type: [String], default: [] },   // userIds of invited internal staff
  visibility:     { type: String, enum: ['public', 'private'], default: 'public' },
  status:         { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
}, { timestamps: true });

// The hot query is "what meetings overlap this day for these users?"
// Index hostUserId + startTime AND attendees + startTime.
MeetingSchema.index({ organizationId: 1, startTime: 1 });
MeetingSchema.index({ hostUserId: 1, startTime: 1 });
MeetingSchema.index({ attendees: 1, startTime: 1 });

export default model('Meeting', MeetingSchema);
