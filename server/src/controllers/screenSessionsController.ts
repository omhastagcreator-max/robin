import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ScreenSession from '../models/ScreenSession';
import User from '../models/User';

export async function updateScreenStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const me = await User.findById(userId).select('organizationId');
    const { status, startedAt } = req.body;
    const ss = await ScreenSession.findOneAndUpdate(
      { userId },
      { $set: { status, organizationId: me?.organizationId, ...(startedAt && { startedAt: new Date(startedAt) }) } },
      { upsert: true, new: true }
    );
    res.json(ss);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function listScreenSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId');
    // Internal staff = admin + employee + sales. Clients are excluded from
    // both the viewer side (route guard) and the listing.
    const staff = await User.find({
      organizationId: me?.organizationId,
      role: { $in: ['employee', 'sales', 'admin'] },
      isActive: true,
    }).select('_id name email role team');

    const staffIds = staff.map(e => String(e._id));
    // Exclude the viewer's own session — they don't need to "view themselves".
    const sessions = await ScreenSession.find({
      userId: { $in: staffIds, $ne: req.user!.id },
    });

    const result = sessions.map(s => ({
      ...s.toObject(),
      profile: staff.find(e => String(e._id) === s.userId),
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
