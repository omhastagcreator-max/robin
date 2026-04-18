import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Notification from '../models/Notification';

export async function listNotifications(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { unreadOnly, page = '1', limit = '50' } = req.query;
    // Support both recipientId and userId fields for compatibility
    const query: Record<string, unknown> = {
      $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }]
    };
    if (unreadOnly === 'true') query.isRead = false;
    const notifs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(String(page)) - 1) * parseInt(String(limit)))
      .limit(parseInt(String(limit)));
    res.json(notifs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function readAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Notification.updateMany(
      { $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }] },
      { isRead: true }
    );
    res.json({ message: 'All marked read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function readOne(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ message: 'Notification read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteNotification(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createNotification(req: AuthRequest, res: Response): Promise<void> {
  try {
    const notif = await Notification.create(req.body);
    res.status(201).json(notif);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
