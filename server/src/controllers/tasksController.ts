import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import Project from '../models/Project';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const orgId  = await getOrgId(userId);
    const query  = role === 'admin' ? { organizationId: orgId } : { assignedTo: userId };
    const tasks  = await ProjectTask.find(query).sort({ dueDate: 1, priority: -1 });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getProjectTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tasks = await ProjectTask.find({ projectId: req.params.projectId }).sort({ dueDate: 1 });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const task = await ProjectTask.create({ ...req.body, organizationId: orgId, assignedBy: req.user!.id });
    // Update project task count
    if (task.projectId) {
      const count = await ProjectTask.countDocuments({ projectId: task.projectId });
      const done  = await ProjectTask.countDocuments({ projectId: task.projectId, status: 'done' });
      await Project.findByIdAndUpdate(task.projectId, { totalTasks: count, completedTasks: done });
    }
    res.status(201).json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const task = await ProjectTask.findById(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const patch = { ...req.body };
    if (patch.status === 'done' && !patch.completedAt) patch.completedAt = new Date();
    const task = await ProjectTask.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    // Update project counters
    if (task.projectId) {
      const now = new Date();
      const all = await ProjectTask.find({ projectId: task.projectId });
      await Project.findByIdAndUpdate(task.projectId, {
        totalTasks:     all.length,
        completedTasks: all.filter(t => t.status === 'done').length,
        overdueTasks:   all.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length,
      });
    }
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    await ProjectTask.findByIdAndDelete(req.params.id);
    res.json({ message: 'Task deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { content } = req.body;
    const task = await ProjectTask.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { authorId: req.user!.id, content, createdAt: new Date() } } },
      { new: true }
    );
    res.json(task);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
