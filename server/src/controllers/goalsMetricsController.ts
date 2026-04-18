import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectGoal from '../models/ProjectGoal';
import Metric from '../models/Metric';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

// ── Goals ──────────────────────────────────────────────────────────────────────
export async function getGoalsByProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const goals = await ProjectGoal.find({ projectId: req.params.projectId }).sort({ createdAt: -1 });
    res.json(goals);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const goal = await ProjectGoal.create({ ...req.body, organizationId: orgId });
    res.status(201).json(goal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const goal = await ProjectGoal.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json(goal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    await ProjectGoal.findByIdAndDelete(req.params.id);
    res.json({ message: 'Goal deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Metrics ────────────────────────────────────────────────────────────────────
export async function getMetricsByProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { from, to } = req.query;
    const query: any = { projectId: req.params.projectId };
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
    const metric = await Metric.create({ ...req.body, organizationId: orgId });
    res.status(201).json(metric);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
