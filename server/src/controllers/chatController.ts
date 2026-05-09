import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ChatMessage from '../models/ChatMessage';
import User from '../models/User';

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function getHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const roomId = (req.query.roomId as string) || 'agency-global';
    const limit  = Math.min(parseInt(req.query.limit as string) || 60, 200);
    const messages = await ChatMessage.find({ organizationId: orgId, roomId })
      .sort({ createdAt: -1 }).limit(limit).lean();
    res.json(messages.reverse()); // oldest first
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function postMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const { content, type = 'text', roomId = 'agency-global', mentions = [] } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: 'Message cannot be empty' }); return; }
    const msg = await ChatMessage.create({
      organizationId: orgId,
      roomId, content: content.trim(), type, mentions,
      senderId:   req.user!.id,
      senderName: req.user!.name,
      senderRole: req.user!.role,
    });
    res.status(201).json(msg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
