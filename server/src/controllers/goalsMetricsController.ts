import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectGoal from '../models/ProjectGoal';
import Metric from '../models/Metric';

/**
 * Goals + Metrics — STRICT org isolation. All read / update / delete handlers
 * filter by organizationId on the target document.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

// ── Goals ──────────────────────────────────────────────────────────────────────
export async function getGoalsByProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const goals = await ProjectGoal.find({
      projectId: req.params.projectId,
      organizationId: orgId,
    }).sort({ createdAt: -1 });
    res.json(goals);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['projectId', 'title', 'description', 'targetValue', 'currentValue', 'unit', 'dueDate', 'status'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const goal = await ProjectGoal.create({ ...body, organizationId: orgId });
    res.status(201).json(goal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['title', 'description', 'targetValue', 'currentValue', 'unit', 'dueDate', 'status'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const goal = await ProjectGoal.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json(goal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await ProjectGoal.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json({ message: 'Goal deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Metrics ────────────────────────────────────────────────────────────────────
export async function getMetricsByProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { from, to } = req.query;
    const query: any = { projectId: req.params.projectId, organizationId: orgId };
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from as string);
      if (to)   query.date.$lte = new Date(to as string);
    }
    const metrics = await Metric.find(query).sort({ date: 1 });
    res.json(metrics);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createMetric(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['projectId', 'name', 'value', 'unit', 'date', 'category'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const metric = await Metric.create({ ...body, organizationId: orgId });
    res.status(201).json(metric);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
