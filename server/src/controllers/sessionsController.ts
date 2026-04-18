import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import Organization from '../models/Organization';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function startSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId = await getOrgId(userId);
    const existing = await Session.findOne({ userId, status: { $in: ['active', 'on_break'] } });
    if (existing) { res.json(existing); return; }
    const session = await Session.create({ userId, organizationId: orgId, startTime: new Date(), status: 'active' });
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function startBreak(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: 'active' });
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    session.status = 'on_break';
    session.breakEvents = session.breakEvents || [];
    session.breakEvents.push({ startedAt: new Date() } as any);
    await session.save();
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function endBreak(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: 'on_break' });
    if (!session) { res.status(404).json({ error: 'Not on break' }); return; }
    session.status = 'active';
    const last = session.breakEvents?.[session.breakEvents.length - 1];
    if (last && !last.endedAt) last.endedAt = new Date();
    await session.save();
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function endSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: { $in: ['active', 'on_break'] } });
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    session.status = 'ended';
    session.endTime = new Date();
    const totalBreakMs = (session.breakEvents || []).reduce((sum: number, b: any) => {
      if (b.startedAt && b.endedAt) return sum + (new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime());
      return sum;
    }, 0);
    session.breakTime = Math.round(totalBreakMs / 60000);
    await session.save();
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getActiveSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: { $in: ['active', 'on_break'] } });
    res.json(session || null);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getSessionHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page = 1, limit = 30 } = req.query;
    const sessions = await Session.find({ userId: req.user!.id, status: 'ended' })
      .sort({ startTime: -1 }).skip((+page - 1) * +limit).limit(+limit);
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getPerformance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { from, to, userId } = req.query;
    const match: any = { organizationId: orgId, status: 'ended' };
    if (userId) match.userId = userId;
    if (from || to) {
      match.startTime = {};
      if (from) match.startTime.$gte = new Date(from as string);
      if (to)   match.startTime.$lte = new Date(to as string);
    }
    const sessions = await Session.find(match).sort({ startTime: -1 });
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
