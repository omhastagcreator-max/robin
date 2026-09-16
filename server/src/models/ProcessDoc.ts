import { Schema, model, Types } from 'mongoose';

/**
 * ProcessDoc — one SOP / process document (Sep 2026, Robin OS "Process
 * Updates" module).
 *
 * The problem it solves: a change to how we work gets announced in chat,
 * scrolls away, and three weeks later nobody can say what the current
 * rule is or who was told. So this model is built around two facts that
 * have to survive: WHAT the current version says, and WHO has confirmed
 * they read it.
 *
 * Versioning is deliberately simple — `body` is always the current text
 * and `versions[]` keeps every previous one. There's no branching or
 * draft/publish split: for an agency of this size, "the doc" is whatever
 * it says right now, and history is for settling arguments.
 *
 * Acknowledgements reset on every publish. That's the whole point — if
 * the SOP changed, last month's "read it" means nothing, so the team is
 * asked again. `acks` therefore always refers to the CURRENT version.
 */

const VersionSchema = new Schema({
  version:     { type: Number, required: true },
  body:        { type: String, default: '' },
  changeNote:  { type: String, default: '' },   // "what changed and why"
  publishedBy: { type: String, default: '' },   // userId
  publishedAt: { type: Date,   default: Date.now },
}, { _id: false });

const AckSchema = new Schema({
  userId:   { type: String, required: true },
  userName: { type: String, default: '' },
  version:  { type: Number, required: true },   // which version they read
  at:       { type: Date,   default: Date.now },
}, { _id: false });

const ProcessDocSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },

  title: { type: String, required: true },
  // Which team this process belongs to. Mirrors the team vocabulary used
  // by ClientWorkflow.currentOwnerTeam so an SOP can later be pinned to a
  // Decision Tree stage without a translation layer.
  department: {
    type: String,
    enum: ['sales', 'development', 'meta', 'influencer', 'qa', 'general'],
    default: 'general',
    index: true,
  },
  summary: { type: String, default: '' },       // one line, shown in the list
  body:    { type: String, default: '' },       // the current process text

  version:     { type: Number, default: 1 },
  versions:    { type: [VersionSchema], default: [] },

  // Who must acknowledge. Empty = everyone in the org. Otherwise a list of
  // userIds — used when a process only affects one team.
  requiredFor: { type: [String], default: [] },
  acks:        { type: [AckSchema], default: [] },

  // Archived SOPs stay readable (and keep their ack history) but drop out
  // of the default list — we never hard-delete a process record.
  archived:    { type: Boolean, default: false, index: true },

  createdBy:   { type: String, default: '' },
  publishedBy: { type: String, default: '' },
  publishedAt: { type: Date,   default: Date.now },
}, { timestamps: true });

ProcessDocSchema.index({ organizationId: 1, archived: 1, publishedAt: -1 });

export default model('ProcessDoc', ProcessDocSchema);
