import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import Organization from '../models/Organization';
import LeaveApplication from '../models/LeaveApplication';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

/**
 * Broadcast a session-status change to every connected client so the UI
 * everywhere (sidebars, work room, dashboards) knows when a teammate just
 * went on break or came back. Keeps the agency in sync without polling.
 */
async function broadcastPresence(req: AuthRequest, status: 'active' | 'on_break' | 'ended') {
  const io = req.app.get('io');
  if (!io) return;
  const u = await User.findById(req.user!.id).select('name email role organizationId');
  if (!u) return;
  io.emit('presence:status', {
    userId:         req.user!.id,
    name:           u.name || u.email,
    role:           u.role,
    organizationId: u.organizationId,
    status,         // 'active' | 'on_break' | 'ended'
    at:             new Date().toISOString(),
  });
}

export async function startSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId = await getOrgId(userId);
    const existing = await Session.findOne({ userId, status: { $in: ['active', 'on_break'] } });
    if (existing) { res.json(existing); return; }
    const now = new Date();
    const session = await Session.create({
      userId,
      organizationId: orgId,
      startTime: now,
      status: 'active',
      lastHeartbeatAt: now,         // first heartbeat = creation time
    });
    await broadcastPresence(req, 'active');
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/sessions/heartbeat
 *
 * Client pings this once a minute while the user has the app open. Each
 * ping bumps lastHeartbeatAt to "now" (server time). When the browser is
 * closed, pings stop, and time stops accruing — that's the whole trick.
 *
 * Idempotent: any number of pings have the same effect as one. We use
 * findOneAndUpdate with $set so two tabs racing don't cause issues.
 */
export async function heartbeat(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOneAndUpdate(
      { userId: req.user!.id, status: { $in: ['active', 'on_break'] } },
      { $set: { lastHeartbeatAt: new Date() } },
      { new: true }
    );
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    res.json({ ok: true, lastHeartbeatAt: session.lastHeartbeatAt });
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
    await broadcastPresence(req, 'on_break');
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
    await broadcastPresence(req, 'active');
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
    await broadcastPresence(req, 'ended');
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

/**
 * GET /api/sessions/team-status
 *
 * Returns, for every internal staff member in the org, their current
 * "right now" session status: 'active' | 'on_break' | 'off_clock'.
 * Used by the WorkRoom and other UIs to show who's available to be pinged
 * vs. who's on break (and shouldn't be disturbed).
 */
export async function getTeamSessionStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const staff = await User.find({
      organizationId: orgId,
      role: { $in: ['employee', 'sales', 'admin'] },
      isActive: true,
    }).select('_id name email role team').lean();

    const liveSessions = await Session.find({
      organizationId: orgId,
      status: { $in: ['active', 'on_break'] },
    }).lean();

    const statusByUser = new Map<string, 'active' | 'on_break'>();
    for (const s of liveSessions) {
      statusByUser.set(String(s.userId), s.status as any);
    }

    // Pull approved leaves covering today — those users get 'on_leave' which
    // takes priority over session status (an on-leave employee shouldn't be
    // shown as "Working" even if their session is technically still open).
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    const onLeave = await LeaveApplication.find({
      organizationId: orgId,
      status: 'approved',
      'days.date': { $gte: todayStart, $lt: todayEnd },
    }).select('userId').lean();
    const onLeaveSet = new Set(onLeave.map(l => String(l.userId)));

    const result = staff.map(u => {
      const id = String(u._id);
      const status = onLeaveSet.has(id)
        ? 'on_leave'
        : (statusByUser.get(id) || 'off_clock');
      return {
        userId: id,
        name:   u.name,
        email:  u.email,
        role:   u.role,
        team:   u.team,
        status,
      };
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
