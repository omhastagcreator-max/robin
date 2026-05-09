import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Notification from '../models/Notification';

/**
 * Notifications — owner-scoped reads and writes.
 *
 * Each notification belongs to a single user (recipient). All endpoints
 * verify the actor IS the recipient before reading or modifying.
 *
 * userIds are global ObjectIds so a same-userId-across-orgs collision
 * isn't a real risk, but we still scope by recipient for clean ownership.
 */

export async function listNotifications(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { unreadOnly, page = '1', limit = '50' } = req.query;
    const query: Record<string, unknown> = {
      $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }],
    };
    if (unreadOnly === 'true') query.isRead = false;
    const notifs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(String(page)) - 1) * parseInt(String(limit)))
      .limit(Math.min(parseInt(String(limit)), 200));
    res.json(notifs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function readAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Notification.updateMany(
      { $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }] },
      { isRead: true },
    );
    res.json({ message: 'All marked read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Mark a single notification as read — only if it belongs to the actor.
export async function readOne(req: AuthRequest, res: Response): Promise<void> {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }] },
      { isRead: true },
      { new: true },
    );
    if (!notif) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.json({ message: 'Notification read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Delete a notification — only if it belongs to the actor.
export async function deleteNotification(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await Notification.findOneAndDelete({
      _id: req.params.id,
      $or: [{ recipientId: req.user!.id }, { userId: req.user!.id }],
    });
    if (!result) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Create — admin/system only. Picks ONLY the fields we accept; never spreads
// req.body directly (defends against mass assignment of internal fields).
export async function createNotification(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can create notifications' });
      return;
    }
    const { recipientId, userId, title, message, type, link, meta } = req.body || {};
    const target = recipientId || userId;
    if (!target || !title) {
      res.status(400).json({ error: 'recipientId and title required' });
      return;
    }
    const notif = await Notification.create({ recipientId: target, userId: target, title, message, type, link, meta });
    res.status(201).json(notif);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
