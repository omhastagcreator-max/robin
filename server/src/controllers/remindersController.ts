import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Reminder from '../models/Reminder';
import User from '../models/User';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

// GET /api/reminders/mine?from=ISO&to=ISO
export async function listMyReminders(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const filter: any = { userId: req.user!.id };
    if (from || to) {
      filter.scheduledFor = {};
      if (from) filter.scheduledFor.$gte = new Date(from);
      if (to)   filter.scheduledFor.$lte = new Date(to);
    }
    const list = await Reminder.find(filter).sort({ scheduledFor: 1 }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/reminders
export async function createReminder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { title, scheduledFor, notes } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    if (!scheduledFor) {
      res.status(400).json({ error: 'A scheduled date is required' });
      return;
    }
    const doc = await Reminder.create({
      userId:         req.user!.id,
      organizationId: orgId,
      title:          String(title).trim(),
      scheduledFor:   new Date(scheduledFor),
      notes:          notes ? String(notes) : undefined,
    });
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/reminders/:id
export async function updateReminder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const doc = await Reminder.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    const { title, scheduledFor, notes, status } = req.body || {};
    if (title        !== undefined) doc.title        = String(title).trim();
    if (scheduledFor !== undefined) doc.scheduledFor = new Date(scheduledFor);
    if (notes        !== undefined) doc.notes        = String(notes);
    if (status       !== undefined) doc.status       = status;
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/reminders/:id
export async function deleteReminder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const doc = await Reminder.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
