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
 * POST /api/sessions/on-call
 *
 * Toggle the "On Call" do-not-disturb flag. Stored on the User (not Session)
 * because admins don't clock in but still want to mark themselves as
 * on a call. Body: { on: boolean }. Broadcasts presence:on-call so every
 * teammate's UI updates instantly.
 *
 * On Call is INDEPENDENT of break/work status — calls ARE work — so we
 * don't touch session.status here at all.
 */
export async function setOnCall(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const on = !!req.body?.on;
    const now = on ? new Date() : null;

    const u = await User.findByIdAndUpdate(
      userId,
      { $set: { onCallSince: now } },
      { new: true }
    ).select('name email role organizationId onCallSince');
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }

    // Broadcast to the org so other people's UIs update instantly.
    const io = req.app.get('io');
    if (io) {
      io.emit('presence:on-call', {
        userId,
        name: u.name || u.email,
        organizationId: u.organizationId,
        on,
        since: u.onCallSince,
      });
    }

    res.json({ ok: true, onCallSince: u.onCallSince });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Heartbeats arrive every 60s while the tab is open. If we see one MORE
 * than this many ms after the previous one, the gap was the user being
 * offline / having Robin closed — that gap is "away time" and gets added
 * to awayMs so it isn't counted as worked time.
 *
 * 90s = normal 60s cadence + 30s slack for slow networks. Any gap bigger
 * than this is a real absence, not network jitter.
 */
const AWAY_THRESHOLD_MS = 90_000;

/**
 * POST /api/sessions/heartbeat
 *
 * Client pings this once a minute while the user has the app open. Each
 * ping bumps lastHeartbeatAt to "now" (server time). When the browser is
 * closed, pings stop, and time stops accruing — that's the whole trick.
 *
 * Gap detection: if the previous lastHeartbeatAt was more than 90s ago,
 * the user was away. The away duration (gap minus the normal 60s cadence)
 * gets added to session.awayMs so end-of-day reports + the live UI
 * subtract that time from "worked." Pauses the timer within one heartbeat
 * cycle of the user closing their tab — no need to wait for the 8pm cron.
 */
export async function heartbeat(req: AuthRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    // Read current state first so we can compute the gap before $set.
    const current = await Session.findOne(
      { userId: req.user!.id, status: { $in: ['active', 'on_break'] } },
      { lastHeartbeatAt: 1, awayMs: 1, status: 1 },
    ).lean();
    if (!current) { res.status(404).json({ error: 'No active session' }); return; }

    const update: any = { $set: { lastHeartbeatAt: now } };
    const last = current.lastHeartbeatAt ? new Date(current.lastHeartbeatAt).getTime() : null;
    if (last) {
      const gap = now.getTime() - last;
      // A gap bigger than the threshold = the user was away. Subtract the
      // normal heartbeat cadence (60s) from the gap so we only count the
      // EXTRA time, not the full interval. Don't accumulate away time
      // while the user is on break — break time is its own bucket.
      if (gap > AWAY_THRESHOLD_MS && current.status !== 'on_break') {
        const awayThisGap = gap - 60_000;
        update.$inc = { awayMs: awayThisGap };
      }
    }

    const session = await Session.findOneAndUpdate(
      { userId: req.user!.id, status: { $in: ['active', 'on_break'] } },
      update,
      { new: true },
    );
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    res.json({ ok: true, lastHeartbeatAt: session.lastHeartbeatAt, awayMs: session.awayMs });
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
    const now = new Date();
    session.status = 'ended';
    session.endTime = now;
    const totalBreakMs = (session.breakEvents || []).reduce((sum: number, b: any) => {
      if (b.startedAt && b.endedAt) return sum + (new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime());
      return sum;
    }, 0);
    session.breakTime = Math.round(totalBreakMs / 60000);

    // Trailing-gap detection: if the last heartbeat was > 90s ago, the user
    // was away between then and end-of-session. That gap counts as away
    // time too (covers the case where the user closes their tab and never
    // explicitly clicks End — the 8pm cron then ends the session and we
    // need to backfill the trailing gap so it doesn't show as worked).
    // (No 'on_break' check needed here — we already set status to 'ended'
    // above. The TS narrowing rightly rejects the comparison.)
    if (session.lastHeartbeatAt) {
      const trailingGap = now.getTime() - new Date(session.lastHeartbeatAt).getTime();
      if (trailingGap > 90_000) {
        const awayThisGap = trailingGap - 60_000;
        session.awayMs = (session.awayMs || 0) + awayThisGap;
      }
    }

    // Finalise any open huddle interval — user clocking out without a
    // huddle:left signal (most common path) should still get credit for
    // the time they were in the huddle.
    if (session.huddleJoinedAt) {
      const open = now.getTime() - new Date(session.huddleJoinedAt).getTime();
      if (open > 0) session.huddleMs = (session.huddleMs || 0) + open;
      session.huddleJoinedAt = null;
    }

    await session.save();
    await broadcastPresence(req, 'ended');
    res.json(session);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Huddle attendance — used to compute working time ──────────────────────
/**
 * POST /api/sessions/huddle-joined
 *
 * Marks the user as currently in the agency huddle. Working time = time
 * spent in huddle, so the timer "starts" the moment this fires.
 *
 * Idempotent — if huddleJoinedAt is already set, leave it alone (don't
 * reset the start so a refresh during huddle doesn't reset the counter).
 */
export async function huddleJoined(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: { $in: ['active', 'on_break'] } });
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    if (!session.huddleJoinedAt) {
      session.huddleJoinedAt = new Date();
      await session.save();
    }
    res.json({ ok: true, huddleJoinedAt: session.huddleJoinedAt, huddleMs: session.huddleMs });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/sessions/huddle-left
 *
 * Marks the user as no longer in the huddle — flushes the open interval
 * into huddleMs and clears huddleJoinedAt. After this the worked-time
 * counter is paused until the next huddle:joined.
 */
export async function huddleLeft(req: AuthRequest, res: Response): Promise<void> {
  try {
    const session = await Session.findOne({ userId: req.user!.id, status: { $in: ['active', 'on_break'] } });
    if (!session) { res.status(404).json({ error: 'No active session' }); return; }
    if (session.huddleJoinedAt) {
      const open = Date.now() - new Date(session.huddleJoinedAt).getTime();
      if (open > 0) session.huddleMs = (session.huddleMs || 0) + open;
      session.huddleJoinedAt = null;
      await session.save();
    }
    res.json({ ok: true, huddleMs: session.huddleMs });
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

    // Derive a real-time presence per user. An "active" session whose last
    // heartbeat is older than the away threshold means the user closed
    // their tab / browser — they shouldn't show up as "Working" to
    // teammates. Promote those to a separate 'away' state so the UI can
    // render "Robin closed" instead of green-dot Working.
    const AWAY_AFTER_MS = 120_000; // 2 min — heartbeat is 60s + buffer
    const nowMs = Date.now();
    const statusByUser = new Map<string, 'active' | 'on_break' | 'away'>();
    for (const s of liveSessions) {
      const id = String(s.userId);
      if (s.status === 'on_break') {
        // Breaks are intentional — never show as "away" even if the user
        // closed the tab during one. Break has its own UX.
        statusByUser.set(id, 'on_break');
        continue;
      }
      const hbAge = s.lastHeartbeatAt ? nowMs - new Date(s.lastHeartbeatAt).getTime() : Infinity;
      statusByUser.set(id, hbAge > AWAY_AFTER_MS ? 'away' : 'active');
    }

    // Pull approved leaves covering today (in IST) — those users get
    // 'on_leave' which takes priority over session status. We compare
    // against a 26h window centred on noon UTC of today's IST date so
    // it matches our noon-UTC-stored leave dates regardless of where
    // the server happens to be (Render is UTC).
    const nowIst = new Date(Date.now() + 330 * 60_000);
    const noonUtcToday = new Date(Date.UTC(
      nowIst.getUTCFullYear(),
      nowIst.getUTCMonth(),
      nowIst.getUTCDate(),
      12, 0, 0,
    ));
    const istWindowStart = new Date(noonUtcToday.getTime() - 13 * 3600_000);
    const istWindowEnd   = new Date(noonUtcToday.getTime() + 13 * 3600_000);
    const onLeave = await LeaveApplication.find({
      organizationId: orgId,
      status: 'approved',
      'days.date': { $gte: istWindowStart, $lt: istWindowEnd },
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
