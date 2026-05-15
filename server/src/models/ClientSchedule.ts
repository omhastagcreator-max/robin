import { Schema, model, Types } from 'mongoose';

/**
 * ClientSchedule — "I (or this teammate) am scheduled to serve THIS client
 * on THIS day." Powers the per-employee weekly client schedule + the
 * "today's clients" reminder that fires on login.
 *
 * Distinct from:
 *   - Tasks: tasks are work items inside a project. A schedule entry is
 *     "I'm working with this client today" — much higher-level, more like
 *     a recurring service slot than a one-off task.
 *   - Meetings: meetings are time-boxed events with a video link. A
 *     schedule entry might or might not include a meeting.
 *
 * The combination of (userId, clientId, serviceDate) is unique — you don't
 * need two entries for the same person/client/day. If the work changes
 * during the day, edit notes/taskType in place.
 */
const ClientScheduleSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  // Whoever is responsible. Stored as plain string (User _id) for symmetry
  // with the rest of the codebase (Task, Reminder, etc. all do this).
  userId:         { type: String, required: true, index: true },
  // The client being served. clientId is a User document with role: 'client'.
  clientId:       { type: String, required: true, index: true },
  // The day this serving slot is for. Stored as Date but treated as a
  // calendar day (no time-of-day). Use the same noon-UTC IST helper that
  // leaves use to avoid off-by-one timezone bugs.
  serviceDate:    { type: Date, required: true, index: true },

  // What kind of work — lets the team filter "show me only meta days".
  // Open enum because each agency has its own service mix.
  taskType: {
    type: String,
    enum: ['meta', 'google_ads', 'content', 'design', 'dev', 'strategy', 'review', 'meeting', 'other'],
    default: 'other',
  },

  // Free-text reminder of the work. Shown in the schedule cards + on the
  // login reminder toast.
  notes:          { type: String, trim: true, maxlength: 500 },

  // Optional per-entry color override. If set, the UI uses this instead of
  // the auto-color derived from taskType. Stored as one of a fixed palette
  // of slug names (blue / pink / purple / etc.) — keeps the rendering
  // logic in one place and prevents arbitrary CSS injection from the API.
  color: {
    type: String,
    enum: ['blue', 'pink', 'purple', 'teal', 'emerald', 'amber', 'orange', 'rose', 'indigo', 'slate', ''],
    default: '',
  },

  // Was this slot actually executed? `skipped` = something came up and we
  // explicitly chose not to serve them this day.
  status: {
    type: String,
    enum: ['planned', 'in_progress', 'done', 'skipped'],
    default: 'planned',
  },

  // For recurring slots — e.g. "every Monday this is Acme's day". Optional;
  // when present, the create flow can fan out N occurrences.
  recurringKey:   { type: String, index: true },

  createdBy:      { type: String, required: true },
}, { timestamps: true });

// Most queries filter by org + user + date window — composite index helps.
ClientScheduleSchema.index({ organizationId: 1, userId: 1, serviceDate: 1 });
// Admin "all schedule" queries also filter by org + date.
ClientScheduleSchema.index({ organizationId: 1, serviceDate: 1 });
// Soft-uniqueness — same person can't double-book the same client on the
// same day. Partial index excludes nulls so the unique constraint doesn't
// trigger on incomplete drafts.
ClientScheduleSchema.index(
  { organizationId: 1, userId: 1, clientId: 1, serviceDate: 1 },
  { unique: true, name: 'one_slot_per_user_client_day' },
);

export default model('ClientSchedule', ClientScheduleSchema);
