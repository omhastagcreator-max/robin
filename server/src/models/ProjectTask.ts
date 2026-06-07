import { Schema, model, Types } from 'mongoose';

const CommentSchema = new Schema({
  authorId: String,
  content: String,
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

/**
 * ProjectTask — the canonical cross-team task object. Despite the legacy
 * name, this is the SINGLE source of truth for "things people owe other
 * people" across the agency:
 *
 *   - Free-standing tasks (no project, no brand) — personal todos, admin
 *     work, internal asks.
 *   - Project tasks  — linked via `projectId`.
 *   - Brand tasks    — linked via `clientWorkflowId` (May 2026 addition).
 *     When Om creates "Fix Sakshi's bug for WOODSIFY", the task gets
 *     clientWorkflowId=<WOODSIFY workflow> + assignedTo=<Sakshi> +
 *     assignedBy=<Om>. It then shows up on BOTH workrooms and on the
 *     WOODSIFY brand workspace's tasks row — single record, three
 *     viewing surfaces.
 *
 * taskType made optional in May 2026 (was required) so brand-tasks
 * created from the WorkroomHome or ClientWorkspacePage don't need to
 * force a category up front. Existing endpoints still allow setting it.
 *
 * Status enum extended with 'blocked' so the risk-detection engine can
 * distinguish "stuck waiting on someone" from "merely not started".
 */
const ProjectTaskSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  projectId: { type: Types.ObjectId, ref: 'Project' },
  /**
   * Brand link. Optional. When set, the task appears on the brand's
   * workspace tasks row AND on the assignee's workroom inbox. The
   * inbox endpoint sorts brand-tagged tasks first because they're
   * client-facing and tend to be highest priority.
   */
  clientWorkflowId: { type: Types.ObjectId, ref: 'ClientWorkflow', index: true },
  assignedTo: { type: String, index: true },
  assignedBy: { type: String, index: true },
  title: { type: String, required: true },
  description: String,
  taskType: { type: String, enum: ['dev', 'ads', 'content', 'admin_task', 'personal'] },
  status: { type: String, default: 'pending', enum: ['pending', 'ongoing', 'done', 'blocked'] },
  priority: { type: String, default: 'medium', enum: ['low', 'medium', 'high', 'urgent'] },
  category: String,
  dueDate: Date,
  timeSpent: { type: Number, default: 0 },
  completedAt: Date,
  comments: [CommentSchema],
  // ── Employee-set ETA (May 2026 agency-OS rebuild) ────────────────
  // The ASSIGNEE'S own estimate of when they'll finish + how many
  // hours of effort it'll take. Separate from `dueDate` (which is
  // the deadline set by the creator). This lets admin distinguish:
  //
  //   - "Sakshi's task is due Friday" (dueDate)        — the deadline
  //   - "Sakshi says she'll finish Thursday, 4h work"  (estimates)   — her plan
  //
  // estimatedBy is stamped with whichever user set the value so we
  // can show "Sakshi estimated 4h" vs. "Om (admin) estimated 4h".
  estimatedHours:        { type: Number, default: null, min: 0 },
  estimatedCompletionAt: { type: Date, default: null },
  estimatedBy:           { type: String, default: '' },
  estimatedAt:           { type: Date, default: null },
}, { timestamps: true });

// Hot path: "tasks assigned to me, not done, sorted by due date" — the
// WorkroomHome inbox query. Compound index covers it without a sort step.
ProjectTaskSchema.index({ organizationId: 1, assignedTo: 1, status: 1, dueDate: 1 });
// "tasks for this brand" — ClientWorkspacePage tasks row.
ProjectTaskSchema.index({ organizationId: 1, clientWorkflowId: 1, status: 1 });

export default model('ProjectTask', ProjectTaskSchema);
