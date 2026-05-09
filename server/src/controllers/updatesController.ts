import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectUpdate from '../models/ProjectUpdate';
import Notification from '../models/Notification';

/**
 * Project updates — STRICT org isolation. Every read/update is scoped by
 * organizationId so updates from other agencies never leak.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function getProjectUpdates(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const updates = await ProjectUpdate.find({
      projectId: req.params.projectId,
      organizationId: orgId,
    }).sort({ createdAt: -1 });
    res.json(updates);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['projectId', 'title', 'content', 'attachments', 'category'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const update = await ProjectUpdate.create({
      ...body,
      organizationId: orgId,
      authorId: req.user!.id,
    });
    res.status(201).json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function approveUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const update = await ProjectUpdate.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { isApproved: true },
      { new: true },
    );
    if (!update) { res.status(404).json({ error: 'Update not found' }); return; }
    await Notification.create({
      recipientId: String(update.authorId),
      title: 'Update approved!',
      body: 'Your project update was approved.',
      type: 'success',
    });
    res.json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function rejectUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { feedback } = req.body;
    const update = await ProjectUpdate.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { isApproved: false, feedback },
      { new: true },
    );
    if (!update) { res.status(404).json({ error: 'Update not found' }); return; }
    await Notification.create({
      recipientId: String(update.authorId),
      title: 'Update rejected',
      body: feedback || 'Your update needs revision.',
      type: 'warning',
    });
    res.json(update);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
