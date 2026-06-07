import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import Project from '../models/Project';
import { notify } from '../services/notify';

/**
 * Tasks — STRICT org isolation. Every read, update and delete verifies the
 * task's organizationId matches the actor's organizationId. A task ID alone
 * is NEVER enough to access the task — you must also be in its org.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const orgId  = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Admins see every task in the org; non-admins only see tasks assigned to them.
    // Both queries are org-scoped — no leak even for an admin.
    const query: Record<string, unknown> = role === 'admin'
      ? { organizationId: orgId }
      : { organizationId: orgId, assignedTo: userId };
    const tasks = await ProjectTask.find(query).sort({ dueDate: 1, priority: -1 });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getProjectTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const tasks = await ProjectTask.find({
      projectId: req.params.projectId,
      organizationId: orgId,
    }).sort({ dueDate: 1 });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Only allow whitelisted fields. Never spread req.body — would let a
    // malicious client set organizationId, _id, etc.
    const {
      title, description, priority, status, dueDate, taskType, projectId, clientWorkflowId, assignedTo,
      reviewerId, approverId, requesterId, supportingIds, startDate, dependsOn,
    } = req.body || {};
    if (!title) { res.status(400).json({ error: 'title required' }); return; }
    // Default assignedTo to the creator. listTasks filters non-admins to
    // `assignedTo: userId` only — without this default, a task someone
    // creates for themselves (typical TasksPage / EmployeeDashboard quick-
    // add flow with no explicit assignee) saves successfully but is then
    // invisible to them on next refresh, looking like it "vanished" the
    // moment they navigated away. Explicit assignedTo from the form still
    // wins (e.g. admin/lead assigning to a teammate).
    const finalAssignedTo = assignedTo || req.user!.id;
    const task = await ProjectTask.create({
      title, description, priority, status, dueDate, taskType, projectId, clientWorkflowId,
      assignedTo: finalAssignedTo,
      organizationId: orgId,
      assignedBy: req.user!.id,
      // Responsibility matrix — defaults to empty; UI prompts for the
      // reviewer/approver/requester when creating a high-stakes task.
      reviewerId, approverId, requesterId, supportingIds, startDate, dependsOn,
      // Requester defaults to the creator when not specified — keeps
      // the "every task has a requester" invariant true.
      ...(requesterId ? {} : { requesterId: req.user!.id }),
    });
    // Notify the assignee if it's someone OTHER than the creator.
    if (finalAssignedTo && finalAssignedTo !== req.user!.id) {
      await notify({
        io: req.app.get('io'), organizationId: orgId, actorId: req.user!.id,
        userId: finalAssignedTo,
        type: 'task.assigned',
        title: `New task: ${title}`,
        body:  priority ? `Priority: ${priority}` : 'Check your task list when you can.',
        entityId: String(task._id), entityType: 'task',
      });
    }
    // Update project task count
    if (task.projectId) {
      const count = await ProjectTask.countDocuments({ projectId: task.projectId, organizationId: orgId });
      const done  = await ProjectTask.countDocuments({ projectId: task.projectId, organizationId: orgId, status: 'done' });
      await Project.findOneAndUpdate(
        { _id: task.projectId, organizationId: orgId },
        { totalTasks: count, completedTasks: done },
      );
    }
    res.status(201).json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const task = await ProjectTask.findOne({ _id: req.params.id, organizationId: orgId });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Whitelist updatable fields — same defense against mass assignment.
    const allowed = [
      'title', 'description', 'priority', 'status', 'dueDate', 'taskType',
      'projectId', 'clientWorkflowId', 'assignedTo', 'completedAt',
      // Employee-set ETA (May 2026).
      'estimatedHours', 'estimatedCompletionAt',
      // Responsibility matrix (June 2026 — Mission Control build).
      'reviewerId', 'approverId', 'requesterId', 'supportingIds',
      'startDate', 'actualCompletionAt',
      // Dependencies — accepted as arrays of ObjectId strings.
      'dependsOn',
    ];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    // Mirror status='done' to BOTH completedAt (legacy) and
    // actualCompletionAt (new) so consumers reading either field see
    // the same truth.
    if (patch.status === 'done') {
      if (!patch.completedAt)         patch.completedAt = new Date();
      if (!patch.actualCompletionAt)  patch.actualCompletionAt = patch.completedAt;
    }
    // Stamp the estimate-setter so the UI can show "Sakshi estimated
    // Thursday" rather than just an anonymous date.
    if (patch.estimatedHours !== undefined || patch.estimatedCompletionAt !== undefined) {
      patch.estimatedBy = req.user!.id;
      patch.estimatedAt = new Date();
    }

    // Snapshot the assignee BEFORE the update so we can detect a real change.
    const before = await ProjectTask.findOne({ _id: req.params.id, organizationId: orgId }).select('assignedTo').lean();
    const task = await ProjectTask.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    // Reassignment notification — fires only when assignee actually changed.
    if (patch.assignedTo && before?.assignedTo !== patch.assignedTo && patch.assignedTo !== req.user!.id) {
      await notify({
        io: req.app.get('io'), organizationId: orgId, actorId: req.user!.id,
        userId: patch.assignedTo,
        type: 'task.reassigned',
        title: `Task moved to you: ${task.title}`,
        body:  task.dueDate ? `Due ${new Date(task.dueDate as any).toDateString()}` : 'No due date set',
        entityId: String(task._id), entityType: 'task',
      });
    }

    if (task.projectId) {
      const now = new Date();
      const all = await ProjectTask.find({ projectId: task.projectId, organizationId: orgId });
      await Project.findOneAndUpdate(
        { _id: task.projectId, organizationId: orgId },
        {
          totalTasks:     all.length,
          completedTasks: all.filter(t => t.status === 'done').length,
          overdueTasks:   all.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length,
        },
      );
    }
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await ProjectTask.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ message: 'Task deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * inbox — the WorkroomHome "My Tasks" feed.
 *
 * Returns tasks that touch this user in any of three ways:
 *   - assignedTo === me   ("things I owe")
 *   - assignedBy === me   ("things I'm waiting on")
 *   - clientWorkflowId in {brands where I'm an owner of any service}
 *     ("things on my brands, even if assigned to someone else")
 *
 * Tasks are bucketed in the response so the UI can render them as
 * grouped lists without a second pass. Done tasks are excluded by
 * default (the UI has a Show-completed toggle that hits ?done=1).
 */
export async function inbox(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me   = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const showDone = String(req.query.done || '') === '1';

    // Brands I own (so brand-tasks-for-me-by-someone-else still show up).
    const ClientWorkflow = (await import('../models/ClientWorkflow')).default;
    const myBrands = await ClientWorkflow.find({
      organizationId: orgId,
      $or: [
        { 'services.assignedTo': me },
        { currentOwnerId: me },
        { nextActionOwnerId: me },
      ],
    }).select('_id clientName').lean();
    const brandIds = myBrands.map(b => b._id);

    const baseQ: any = { organizationId: orgId };
    if (!showDone) baseQ.status = { $ne: 'done' };

    const [mine, delegated, brandTasks] = await Promise.all([
      // assigned to me
      ProjectTask.find({ ...baseQ, assignedTo: me }).sort({ priority: -1, dueDate: 1 }).limit(50).lean(),
      // I delegated to others (assignedBy me, assignedTo someone else)
      ProjectTask.find({ ...baseQ, assignedBy: me, assignedTo: { $ne: me } }).sort({ priority: -1, dueDate: 1 }).limit(30).lean(),
      // for brands I touch, but not directly assigned to me (cross-team visibility)
      brandIds.length
        ? ProjectTask.find({
            ...baseQ,
            clientWorkflowId: { $in: brandIds },
            assignedTo: { $ne: me },
            assignedBy: { $ne: me },
          }).sort({ priority: -1, dueDate: 1 }).limit(30).lean()
        : Promise.resolve([]),
    ]);

    // Tiny brand-name map so the UI doesn't have to fan out a second
    // request per task. Server-side enrichment keeps the inbox response
    // a single document.
    const brandIdToName = new Map(myBrands.map(b => [String(b._id), b.clientName || '']));
    const enrich = (t: any) => ({
      ...t,
      clientName: t.clientWorkflowId ? brandIdToName.get(String(t.clientWorkflowId)) || '' : '',
    });

    res.json({
      mine:       mine.map(enrich),
      delegated:  delegated.map(enrich),
      brandTasks: (brandTasks as any[]).map(enrich),
      counts: {
        mine:      mine.length,
        delegated: delegated.length,
        brand:     brandTasks.length,
      },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Tasks scoped to one brand workflow — used on ClientWorkspacePage's
 * tasks row. Org-isolated like everything else.
 */
export async function listForWorkflow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const tasks = await ProjectTask.find({
      organizationId: orgId,
      clientWorkflowId: req.params.workflowId,
    }).sort({ status: 1, priority: -1, dueDate: 1 });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * setDependencies — PUT /api/tasks/:id/dependencies
 * Body: { dependsOn: string[] }  // array of taskIds that must finish first
 *
 * Atomicity matters here: when task B says "I depend on A", we must
 * ALSO update task A's `dependencyOf` to include B. Otherwise the
 * inverse query "what does A unblock?" misses B and the dependency
 * graph becomes a one-way street.
 *
 * Steps:
 *   1. Validate every incoming dependsOn ID exists in the same org.
 *   2. Snapshot the OLD dependsOn list so we can compute removed deps.
 *   3. Save the new list.
 *   4. For each ADDED dep → $addToSet on that task's dependencyOf.
 *   5. For each REMOVED dep → $pull this task from its dependencyOf.
 *
 * Reject self-references and cycles (A→B→A) — refuse with 400.
 */
export async function setDependencies(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const taskId = req.params.id;
    const incoming = Array.isArray(req.body?.dependsOn) ? req.body.dependsOn.map(String) : [];

    if (incoming.includes(taskId)) {
      res.status(400).json({ error: 'A task cannot depend on itself' }); return;
    }

    const me = await ProjectTask.findOne({ _id: taskId, organizationId: orgId }).select('_id dependsOn').lean();
    if (!me) { res.status(404).json({ error: 'Task not found' }); return; }

    // Validate the new deps exist in the same org. Bulk fetch.
    const valid = await ProjectTask.find({
      _id: { $in: incoming },
      organizationId: orgId,
    }).select('_id dependsOn').lean();
    const validIds = new Set<string>(valid.map(v => String(v._id)));
    const cleaned: string[] = incoming.filter((id: string) => validIds.has(id));

    // Cycle detection: walk dependsOn from each new dep; if we reach `taskId`,
    // adding this dep would create a cycle.
    for (const depId of cleaned) {
      const cycle = await hasCycle(orgId, depId, taskId, new Set());
      if (cycle) {
        res.status(400).json({ error: `Adding dependency ${depId} would create a cycle` }); return;
      }
    }

    const oldDeps = new Set<string>(((me.dependsOn as any[]) || []).map(String));
    const newDeps = new Set<string>(cleaned);
    const added   = [...newDeps].filter((x: string) => !oldDeps.has(x));
    const removed = [...oldDeps].filter((x: string) => !newDeps.has(x));

    // Apply.
    await ProjectTask.updateOne(
      { _id: taskId, organizationId: orgId },
      { $set: { dependsOn: cleaned } },
    );
    if (added.length > 0) {
      await ProjectTask.updateMany(
        { _id: { $in: added }, organizationId: orgId },
        { $addToSet: { dependencyOf: taskId } },
      );
    }
    if (removed.length > 0) {
      await ProjectTask.updateMany(
        { _id: { $in: removed }, organizationId: orgId },
        { $pull: { dependencyOf: taskId } },
      );
    }

    res.json({ dependsOn: cleaned, added: added.length, removed: removed.length });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** Recursive cycle check. Returns true if dep eventually depends on `target`. */
async function hasCycle(orgId: string, depId: string, target: string, visited: Set<string>): Promise<boolean> {
  if (depId === target) return true;
  if (visited.has(depId)) return false;
  visited.add(depId);
  const node = await ProjectTask.findOne({ _id: depId, organizationId: orgId }).select('dependsOn').lean();
  if (!node) return false;
  for (const child of ((node.dependsOn as any[]) || []).map(String)) {
    if (await hasCycle(orgId, child, target, visited)) return true;
  }
  return false;
}

/**
 * getGraph — GET /api/tasks/:id/graph
 *
 * Returns the task + its immediate dependency neighbors, both directions:
 *   {
 *     task: { ... },
 *     dependsOn:    [{_id, title, status, dueDate, assignedTo}],
 *     dependencyOf: [{_id, title, status, dueDate, assignedTo}],
 *     impact: { downstreamOpenCount, downstreamOverdueCount }
 *   }
 *
 * Used by the brand workspace to render "Blocked by X · Blocks Y, Z"
 * and the AI Copilot for "what happens if I slip this?".
 */
export async function getGraph(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const task = await ProjectTask.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    const [dependsOnNodes, dependencyOfNodes] = await Promise.all([
      ProjectTask.find({ _id: { $in: (task.dependsOn as any[]) || [] } })
        .select('_id title status dueDate assignedTo').lean(),
      ProjectTask.find({ _id: { $in: (task.dependencyOf as any[]) || [] } })
        .select('_id title status dueDate assignedTo').lean(),
    ]);

    const now = Date.now();
    const downstreamOpenCount = dependencyOfNodes.filter(t => t.status !== 'done').length;
    const downstreamOverdueCount = dependencyOfNodes.filter(t =>
      t.status !== 'done' && t.dueDate && new Date(t.dueDate as any).getTime() < now,
    ).length;

    res.json({
      task,
      dependsOn: dependsOnNodes,
      dependencyOf: dependencyOfNodes,
      impact: { downstreamOpenCount, downstreamOverdueCount },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: 'comment cannot be empty' }); return; }
    const task = await ProjectTask.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { $push: { comments: { authorId: req.user!.id, content: content.trim(), createdAt: new Date() } } },
      { new: true },
    );
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
