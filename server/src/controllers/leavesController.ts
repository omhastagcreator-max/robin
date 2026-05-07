import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import LeaveApplication from '../models/LeaveApplication';
import User from '../models/User';
import ActivityLog from '../models/ActivityLog';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

/** Day-of-week helper: 0 = Sun, 6 = Sat. */
function isWeekendBoth(days: { date: Date }[]): boolean {
  const dows = new Set(days.map(d => new Date(d.date).getDay()));
  return dows.has(0) && dows.has(6); // contains both Sunday and Saturday
}

/**
 * Normalise an incoming date input to NOON UTC of the IST-interpreted day.
 *
 * The bug we're killing: the client used to send `d.toISOString()` which
 * converts IST local midnight (May 12 00:00 IST) to UTC (May 11 18:30Z).
 * The old `startOfDayUtc` then zeroed UTC hours and stored May 11 — a
 * day earlier than the user picked.
 *
 * The fix:
 *   1. Accept either "YYYY-MM-DD" (preferred — timezone-free) or full ISO
 *      strings / Dates (back-compat with old clients).
 *   2. Convert to IST and extract the calendar day (year, month, date).
 *   3. Store as NOON UTC of that day. Noon UTC is the same calendar day
 *      in every timezone from UTC-12 to UTC+12, so display logic ("show
 *      May 12") works regardless of where the viewer is.
 */
function normaliseToIstDay(input: unknown): Date {
  let y: number, m: number, d: number;

  if (typeof input === 'string') {
    const ymd = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      y = +ymd[1]; m = +ymd[2] - 1; d = +ymd[3];
    } else {
      const parsed = new Date(input);
      if (isNaN(parsed.getTime())) throw new Error(`Invalid date: ${input}`);
      const ist = new Date(parsed.getTime() + 330 * 60_000); // shift to IST
      y = ist.getUTCFullYear(); m = ist.getUTCMonth(); d = ist.getUTCDate();
    }
  } else if (input instanceof Date) {
    const ist = new Date(input.getTime() + 330 * 60_000);
    y = ist.getUTCFullYear(); m = ist.getUTCMonth(); d = ist.getUTCDate();
  } else {
    throw new Error('Date required');
  }

  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

/** IST "today" window expressed as UTC bounds — for queries against
 *  noon-UTC dates we now store. */
function istTodayWindow(): { start: Date; end: Date } {
  const nowIst = new Date(Date.now() + 330 * 60_000);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const d = nowIst.getUTCDate();
  // IST midnight today/tomorrow expressed in UTC:
  //   IST 00:00 = UTC of previous day 18:30, but for matching noon-UTC
  //   stored dates we just need any 24h window containing noon UTC of
  //   today's IST date. Easiest: [noonUtc - 13h, noonUtc + 13h).
  const noonUtc = new Date(Date.UTC(y, m, d, 12, 0, 0));
  const start = new Date(noonUtc.getTime() - 13 * 3600_000);
  const end   = new Date(noonUtc.getTime() + 13 * 3600_000);
  return { start, end };
}

// POST /api/leaves
export async function createLeave(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { days } = req.body || {};

    if (!Array.isArray(days) || days.length === 0) {
      res.status(400).json({ error: 'Pick at least one day' });
      return;
    }

    // Normalise + validate each entry
    const cleaned: { date: Date; reason: string }[] = [];
    const seen = new Set<string>();
    for (const raw of days) {
      if (!raw?.date)   { res.status(400).json({ error: 'Each day needs a date' });   return; }
      if (!raw?.reason || !String(raw.reason).trim()) {
        res.status(400).json({ error: 'Each day needs a reason' });
        return;
      }
      const d = normaliseToIstDay(raw.date);
      const key = d.toISOString();
      if (seen.has(key)) continue; // de-dupe duplicate clicks
      seen.add(key);
      cleaned.push({ date: d, reason: String(raw.reason).trim() });
    }

    // Saturday + Sunday in the same application not allowed
    if (isWeekendBoth(cleaned)) {
      res.status(400).json({ error: 'Cannot apply for leave on Saturday and Sunday together' });
      return;
    }

    // Reject if any of these days already have an approved/pending leave for this user
    const existing = await LeaveApplication.findOne({
      userId: req.user!.id,
      status: { $in: ['pending', 'approved'] },
      'days.date': { $in: cleaned.map(c => c.date) },
    });
    if (existing) {
      res.status(409).json({ error: 'One or more of those days already has a leave request' });
      return;
    }

    const doc = await LeaveApplication.create({
      userId: req.user!.id,
      organizationId: orgId,
      days: cleaned,
      status: 'pending',
    });

    await ActivityLog.create({
      organizationId: orgId,
      userId: req.user!.id,
      action: 'leave.applied',
      entity: 'LeaveApplication',
      entityId: doc._id,
      metadata: { dayCount: cleaned.length },
    });

    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/leaves/mine — own applications only
export async function listMyLeaves(req: AuthRequest, res: Response): Promise<void> {
  try {
    const list = await LeaveApplication.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/leaves/admin — admin sees everyone (org-scoped)
export async function listAdminLeaves(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { status } = req.query as Record<string, string>;
    const filter: any = { organizationId: orgId };
    if (status) filter.status = status;

    const list = await LeaveApplication.find(filter).sort({ createdAt: -1 }).lean();

    // Hydrate with user info so the admin sees names without an extra round trip
    const userIds = Array.from(new Set(list.map(l => l.userId)));
    const users = await User.find({ _id: { $in: userIds } }).select('_id name email role team').lean();
    const userMap = new Map(users.map(u => [String(u._id), u]));

    res.json(list.map(l => ({
      ...l,
      user: userMap.get(String(l.userId)) || null,
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/leaves/:id/approve
export async function approveLeave(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const doc = await LeaveApplication.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    if (doc.status !== 'pending') { res.status(409).json({ error: 'Already reviewed' }); return; }

    doc.status     = 'approved';
    doc.reviewedBy = req.user!.id;
    doc.reviewedAt = new Date();
    if (req.body?.note) doc.reviewNote = String(req.body.note);
    await doc.save();

    await ActivityLog.create({
      organizationId: orgId,
      userId: req.user!.id,
      action: 'leave.approved',
      entity: 'LeaveApplication',
      entityId: doc._id,
      metadata: { for: doc.userId, dayCount: doc.days.length },
    });

    // Push a notification to the requester
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${doc.userId}`).emit('notification:new', {
        title: 'Leave approved',
        body:  `${doc.days.length} day${doc.days.length === 1 ? '' : 's'} approved`,
        type: 'success',
      });

      // If today is among the approved days, push an immediate presence update
      // so the "on leave" badge appears across the org in real time.
      const { start, end } = istTodayWindow();
      const coversToday = doc.days.some((d: any) => {
        const t = new Date(d.date).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      if (coversToday) {
        const u = await User.findById(doc.userId).select('name email role');
        io.emit('presence:status', {
          userId: doc.userId,
          name:   u?.name || u?.email,
          role:   u?.role,
          status: 'on_leave',
          at:     new Date().toISOString(),
        });
      }
    }

    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/leaves/:id/reject
export async function rejectLeave(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const doc = await LeaveApplication.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    if (doc.status !== 'pending') { res.status(409).json({ error: 'Already reviewed' }); return; }

    doc.status     = 'rejected';
    doc.reviewedBy = req.user!.id;
    doc.reviewedAt = new Date();
    doc.reviewNote = req.body?.note ? String(req.body.note) : '';
    await doc.save();

    await ActivityLog.create({
      organizationId: orgId,
      userId: req.user!.id,
      action: 'leave.rejected',
      entity: 'LeaveApplication',
      entityId: doc._id,
      metadata: { for: doc.userId, note: doc.reviewNote },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${doc.userId}`).emit('notification:new', {
        title: 'Leave rejected',
        body:  doc.reviewNote || 'Please contact admin for details',
        type: 'warning',
      });
    }

    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/leaves/:id/cancel — employee cancels their own pending application
export async function cancelLeave(req: AuthRequest, res: Response): Promise<void> {
  try {
    const doc = await LeaveApplication.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    if (doc.status !== 'pending') { res.status(409).json({ error: 'Only pending applications can be cancelled' }); return; }
    doc.status = 'cancelled';
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/leaves/on-leave-today  — minimal payload for badge rendering
// Returns userIds (and names) of employees whose approved leave covers today.
export async function onLeaveToday(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { start, end } = istTodayWindow();

    const list = await LeaveApplication.find({
      organizationId: orgId,
      status: 'approved',
      'days.date': { $gte: start, $lt: end },
    }).lean();

    const userIds = Array.from(new Set(list.map(l => l.userId)));
    const users = await User.find({ _id: { $in: userIds } }).select('_id name email role team').lean();
    res.json(users.map(u => ({
      userId: String(u._id),
      name:   u.name,
      role:   u.role,
      team:   u.team,
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
