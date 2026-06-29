import { Schema, model, Types } from 'mongoose';

/**
 * DailyCheckin — the three-times-a-day pulse that keeps Robin honest.
 *
 * Owner ask (June 2026): "When everyone logs in they fill a popup —
 * Meta reports + today's tasks — and can't join the huddle until they
 * do. Half-way through the day (1–2pm IST) another popup: what's done,
 * what's left. Before logout, a final popup: what's done, what's left,
 * WHY it's left. No checkout without this."
 *
 * One document per (user, IST day). Each kind is filled in order:
 *   morning → midday → evening
 *
 * The morning checkin BLOCKS huddle join (hard gate).
 * The midday checkin BLOCKS leaving the page after 1pm IST until done.
 * The evening checkin BLOCKS logout (hard gate).
 *
 * Why a single doc per day (vs three docs): we need to compare "tasks
 * promised this morning" vs "tasks delivered by evening" — the diff is
 * the agency's single most valuable signal. Keeping all three in one
 * document removes any join when admin opens today's report.
 *
 * Tasks are mirrored into ProjectTask docs at submission time so they
 * show up everywhere the existing task UI already lives (workroom inbox,
 * brand workspace, ledger). The mirror is one-way create-only at the
 * morning step; midday + evening updates write status back through the
 * normal task controller so audit logs / notifications stay consistent.
 */

const MorningTaskSchema = new Schema({
  // Linked ProjectTask once mirrored. Set during morning submit.
  taskId: { type: Types.ObjectId, ref: 'ProjectTask' },
  title: { type: String, required: true, trim: true },
  // Optional brand link. When set, we also stamp ProjectTask.clientWorkflowId.
  clientWorkflowId: { type: Types.ObjectId, ref: 'ClientWorkflow', default: null },
  clientWorkflowName: { type: String, default: '' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  // Status WITHIN THIS CHECKIN — separate from ProjectTask.status which
  // is the global source of truth. Mirrors the lifecycle so we can show
  // the morning→midday→evening trajectory on the admin report.
  morningStatus:  { type: String, enum: ['planned'], default: 'planned' },
  middayStatus:   { type: String, enum: ['', 'done', 'in_progress', 'blocked', 'not_started'], default: '' },
  middayNote:     { type: String, default: '' },
  eveningStatus:  { type: String, enum: ['', 'done', 'in_progress', 'rolled_over', 'dropped'], default: '' },
  eveningReason:  { type: String, default: '' },          // why not done
}, { _id: true });

/**
 * Per-brand morning entry. The user's list of brands is computed from
 * their assignments (ClientWorkflow.services[].assignedTo). For each
 * brand they touch we ask:
 *   - what's the Meta state? (running / paused / off / na — chips, not typing)
 *   - one-line note: anything pending or blocking?
 *
 * Stored as a flat array so the admin report can roll up "WOODSIFY today
 * = Meta running, no blockers" without a per-brand subquery.
 */
const MorningBrandEntrySchema = new Schema({
  clientWorkflowId: { type: Types.ObjectId, ref: 'ClientWorkflow', required: true },
  clientName:       { type: String, default: '' },
  // Meta status quick-chip. 'na' = brand has no Meta service.
  metaStatus: {
    type: String,
    enum: ['running', 'paused', 'off', 'pending', 'na'],
    default: 'na',
  },
  // Optional one-liner — copied verbatim onto the brand's ClientWorkflow
  // activity log so the brand workspace shows today's Meta state without
  // needing a join. Keep tight (<140 chars).
  note: { type: String, default: '', maxlength: 280 },
}, { _id: false });

const DailyCheckinSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: Types.ObjectId, ref: 'User', required: true, index: true },
  // IST day key in YYYY-MM-DD form. Computed by the controller using
  // istDayWindow() so we don't fight DST or server-tz drift. Indexed
  // because the daily report queries "today only".
  dateIST:        { type: String, required: true, index: true },

  // ── Morning ──────────────────────────────────────────────────────
  morning: {
    submittedAt: { type: Date, default: null },
    // Auto-tagged based on whether submittedAt is null. Read-only mirror.
    done:        { type: Boolean, default: false },
    brands:      { type: [MorningBrandEntrySchema], default: [] },
    tasks:       { type: [MorningTaskSchema], default: [] },
  },

  // ── Midday (1pm-2pm IST window; user must submit before leaving) ──
  midday: {
    submittedAt: { type: Date, default: null },
    done:        { type: Boolean, default: false },
    blockers:    { type: String, default: '', maxlength: 600 },
  },

  // ── Evening (mandatory before logout) ────────────────────────────
  evening: {
    submittedAt: { type: Date, default: null },
    done:        { type: Boolean, default: false },
    // Plain text "tomorrow plan" — carried forward as a pre-fill for
    // tomorrow's morning checkin so the user doesn't retype the same
    // recurring items every morning.
    tomorrowPlan: { type: String, default: '', maxlength: 600 },
  },
}, { timestamps: true });

// One document per user per day. We rely on this for upsert semantics
// in the controller — every submit becomes a $set on the matching doc.
DailyCheckinSchema.index({ organizationId: 1, userId: 1, dateIST: 1 }, { unique: true });
// Admin "today's report" queries the org for a specific dateIST.
DailyCheckinSchema.index({ organizationId: 1, dateIST: 1 });

export default model('DailyCheckin', DailyCheckinSchema);
