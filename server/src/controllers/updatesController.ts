import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectUpdate from '../models/ProjectUpdate';
import Notification from '../models/Notification';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function getProjectUpdates(req: AuthRequest, res: Response): Promise<void> {
  try {
    const updates = await ProjectUpdate.find({ projectId: req.params.projectId }).sort({ createdAt: -1 });
    res.json(updates);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const update = await ProjectUpdate.create({ ...req.body, organizationId: orgId, authorId: req.user!.id });
    res.status(201).json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function approveUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const update = await ProjectUpdate.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    if (!update) { res.status(404).json({ error: 'Update not found' }); return; }
    await Notification.create({ recipientId: String(update.authorId), title: 'Update approved!', body: `Your project update was approved.`, type: 'success' });
    res.json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function rejectUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { feedback } = req.body;
    const update = await ProjectUpdate.findByIdAndUpdate(req.params.id, { isApproved: false, feedback }, { new: true });
    if (!update) { res.status(404).json({ error: 'Update not found' }); return; }
    await Notification.create({ recipientId: String(update.authorId), title: 'Update rejected', body: feedback || 'Your update needs revision.', type: 'warning' });
    res.json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
