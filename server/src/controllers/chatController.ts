import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ChatMessage from '../models/ChatMessage';

export async function getHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const roomId = (req.query.roomId as string) || 'agency-global';
    const limit  = parseInt(req.query.limit as string) || 60;
    const messages = await ChatMessage.find({ roomId })
      .sort({ createdAt: -1 }).limit(limit).lean();
    res.json(messages.reverse()); // oldest first
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function postMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { content, type = 'text', roomId = 'agency-global', mentions = [] } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: 'Message cannot be empty' }); return; }
    const msg = await ChatMessage.create({
      roomId, content: content.trim(), type, mentions,
      senderId:   req.user!.id,
      senderName: req.user!.name,
      senderRole: req.user!.role,
    });
    res.status(201).json(msg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
