import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Meeting from '../models/Meeting';
import User from '../models/User';

/**
 * Meetings controller.
 *
 * Visibility rules applied at the read layer:
 *   - host or attendee → full meeting details (title, description, link)
 *   - anyone else      → busy block only (start/end/type/host name)
 *
 * Times are sent/received as ISO strings; the client decides how to
 * render them in IST.
 */

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

function istToday(): { start: Date; end: Date } {
  const ist = new Date(Date.now() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - 330 * 60_000);
  const end   = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

function dateRangeFromQuery(dateStr?: string): { start: Date; end: Date } {
  if (!dateStr) return istToday();
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return istToday();
  const [, y, mo, d] = m.map(Number) as unknown as number[];
  // IST midnight of that date, expressed in UTC
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 330 * 60_000);
  const end   = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

/** Strip a meeting down to public busy info — no title or description. */
function redactToBusy(m: any) {
  return {
    _id: m._id,
    hostUserId: m.hostUserId,
    type: m.type,
    startTime: m.startTime,
    endTime: m.endTime,
    busy: true,            // marker so the UI knows this is a redacted view
    visibility: m.visibility,
  };
}

/** True when an overlapping meeting exists in the user's calendar. */
async function hasConflict(userId: string, startTime: Date, endTime: Date, excludeId?: string): Promise<boolean> {
  const filter: any = {
    status: 'scheduled',
    $or: [
      { hostUserId: userId },
      { attendees: userId },
    ],
    startTime: { $lt: endTime },
    endTime:   { $gt: startTime },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const overlap = await Meeting.findOne(filter).select('_id');
  return !!overlap;
}

// ── Endpoints ───────────────────────────────────────────────────────────

/** GET /api/meetings/day?date=YYYY-MM-DD — every visible meeting that day. */
export async function listDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { start, end } = dateRangeFromQuery(req.query.date as string);
    const meetings = await Meeting.find({
      organizationId: orgId,
      status: 'scheduled',
      startTime: { $lt: end },
      endTime:   { $gt: start },
    }).lean();

    const me = req.user!.id;
    const visible = meetings
      .filter(m => {
        if (m.visibility === 'public') return true;
        // private: visible only to host + attendees
        return String(m.hostUserId) === me || (m.attendees || []).includes(me);
      })
      .map(m => {
        const isMine = String(m.hostUserId) === me || (m.attendees || []).includes(me);
        return isMine ? m : redactToBusy(m);
      });

    res.json({ date: req.query.date || null, meetings: visible });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** GET /api/meetings/mine?from=&to= — full details on every meeting I'm in. */
export async function listMine(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const filter: any = {
      status: 'scheduled',
      $or: [{ hostUserId: me }, { attendees: me }],
    };
    if (req.query.from || req.query.to) {
      filter.startTime = {};
      if (req.query.from) filter.startTime.$gte = new Date(req.query.from as string);
      if (req.query.to)   filter.startTime.$lt  = new Date(req.query.to   as string);
    }
    const list = await Meeting.find(filter).sort({ startTime: 1 }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** POST /api/meetings — create. Body: { title, startTime, endTime, attendees[], type, link, visibility } */
export async function createMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) {
      console.warn('[meetings] createMeeting blocked — user has no organizationId', { userId: req.user!.id });
      res.status(400).json({ error: 'Your account is not linked to an organization. Ask the admin to set this up.' });
      return;
    }

    const { title, description, type, link, startTime, endTime, attendees, visibility } = req.body || {};
    if (!title || !startTime || !endTime) {
      res.status(400).json({ error: 'title, startTime, endTime required' });
      return;
    }
    const start = new Date(startTime);
    const end   = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      res.status(400).json({ error: 'startTime and endTime must be valid ISO timestamps' });
      return;
    }
    if (!(start.getTime() < end.getTime())) {
      res.status(400).json({ error: 'endTime must be after startTime' });
      return;
    }

    // Detect conflicts for the host AND every attendee — return as warnings,
    // but DO NOT block (people sometimes schedule overlapping meetings on
    // purpose, like prep + main). Client UI displays the warnings.
    const conflictUserIds: string[] = [];
    const allInvolved = Array.from(new Set([req.user!.id, ...(attendees || [])]));
    for (const uid of allInvolved) {
      if (await hasConflict(uid, start, end)) conflictUserIds.push(uid);
    }

    const doc = await Meeting.create({
      organizationId: orgId,
      hostUserId:     req.user!.id,
      title:          String(title).trim(),
      description:    description || '',
      type:           type || 'internal',
      link:           link || '',
      startTime:      start,
      endTime:        end,
      attendees:      Array.from(new Set((attendees || []).filter(Boolean))),
      visibility:     visibility === 'private' ? 'private' : 'public',
    });

    // Push presence update to anyone whose status would have flipped because
    // of this new meeting. Easy way: emit a generic 'meetings:changed' event;
    // clients refetch their day on receipt.
    const io = req.app.get('io');
    if (io) io.emit('meetings:changed', { date: start.toISOString().slice(0, 10) });

    res.status(201).json({ meeting: doc, conflicts: conflictUserIds });
  } catch (err) {
    console.error('[meetings] createMeeting failed', err);
    res.status(500).json({ error: (err as Error).message || 'Could not create meeting' });
  }
}

/** PUT /api/meetings/:id — update. Only the host can edit. */
export async function updateMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const m = await Meeting.findById(req.params.id);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    if (String(m.hostUserId) !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only the host can edit this meeting' });
      return;
    }
    const allowed = ['title', 'description', 'type', 'link', 'startTime', 'endTime', 'attendees', 'visibility', 'status'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) (m as any)[k] = req.body[k];
    }
    await m.save();
    const io = req.app.get('io');
    if (io) io.emit('meetings:changed', { id: String(m._id) });
    res.json(m);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** DELETE /api/meetings/:id — cancel. Host only. */
export async function deleteMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const m = await Meeting.findById(req.params.id);
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    if (String(m.hostUserId) !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only the host can cancel this meeting' });
      return;
    }
    m.status = 'cancelled';
    await m.save();
    const io = req.app.get('io');
    if (io) io.emit('meetings:changed', { id: String(m._id) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/meetings/now
 *
 * Returns every internal staff member who is RIGHT NOW in a scheduled
 * meeting, with the end time so the UI can render "In meeting · until 3:30".
 *
 * Cheap query: one find() filtered by startTime <= now < endTime.
 * Rolled up per-user (a user appears once even if they're hosting + invited
 * to overlapping meetings — we use the latest endTime).
 */
export async function listInMeetingNow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const now = new Date();
    const live = await Meeting.find({
      organizationId: orgId,
      status: 'scheduled',
      startTime: { $lte: now },
      endTime:   { $gt:  now },
    }).lean();

    // Roll up per user — host AND attendees. Use latest endTime if user is
    // in multiple overlapping meetings (rare but possible).
    const byUser = new Map<string, { endTime: Date; type: string }>();
    for (const m of live) {
      const ids = [m.hostUserId, ...(m.attendees || [])];
      for (const uid of ids) {
        const slot = byUser.get(String(uid));
        const end = new Date(m.endTime);
        if (!slot || end > slot.endTime) {
          byUser.set(String(uid), { endTime: end, type: m.type });
        }
      }
    }

    res.json({
      now,
      users: Array.from(byUser.entries()).map(([userId, v]) => ({
        userId, endTime: v.endTime, type: v.type,
      })),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/meetings/find-free?date=YYYY-MM-DD&duration=30&users=id1,id2
 *
 * Returns up to 8 time slots on the given date when EVERY listed user is
 * free for the requested duration (default 30 minutes), inside the
 * agency's business hours (default 9am-7pm IST).
 *
 * The algorithm:
 *   1. Pull every meeting overlapping that IST day for the listed users.
 *   2. Build a busy-interval array per user.
 *   3. Walk the day in 30-min steps; emit a slot if ALL users are free
 *      for the next `duration` minutes.
 */
export async function findFreeSlots(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const userIds = String(req.query.users || '').split(',').map(s => s.trim()).filter(Boolean);
    if (userIds.length === 0) userIds.push(req.user!.id);

    const duration = Math.max(15, Math.min(240, parseInt(req.query.duration as string) || 30));
    const { start: dayStart, end: dayEnd } = dateRangeFromQuery(req.query.date as string);

    // Business hours: 9am-7pm IST → translate to UTC
    const istOffset = 330 * 60_000;
    const dateLocal = new Date(dayStart.getTime() + istOffset);
    const businessStartUtc = new Date(Date.UTC(
      dateLocal.getUTCFullYear(), dateLocal.getUTCMonth(), dateLocal.getUTCDate(),
      9, 0, 0
    ) - istOffset);
    const businessEndUtc = new Date(Date.UTC(
      dateLocal.getUTCFullYear(), dateLocal.getUTCMonth(), dateLocal.getUTCDate(),
      19, 0, 0
    ) - istOffset);

    const meetings = await Meeting.find({
      organizationId: orgId,
      status: 'scheduled',
      startTime: { $lt: dayEnd },
      endTime:   { $gt: dayStart },
      $or: [
        { hostUserId: { $in: userIds } },
        { attendees:  { $in: userIds } },
      ],
    }).lean();

    const isFree = (uid: string, slotStart: number, slotEnd: number): boolean => {
      for (const m of meetings) {
        const involved = String(m.hostUserId) === uid || (m.attendees || []).includes(uid);
        if (!involved) continue;
        const ms = new Date(m.startTime).getTime();
        const me = new Date(m.endTime).getTime();
        if (slotStart < me && slotEnd > ms) return false;
      }
      return true;
    };

    const slots: Array<{ start: string; end: string }> = [];
    const STEP_MS = 30 * 60_000;
    const durMs = duration * 60_000;
    let cursor = businessStartUtc.getTime();
    const nowMs = Date.now();
    while (cursor + durMs <= businessEndUtc.getTime() && slots.length < 8) {
      // Skip slots in the past
      if (cursor < nowMs - 5 * 60_000) {
        cursor += STEP_MS;
        continue;
      }
      const slotEnd = cursor + durMs;
      const allFree = userIds.every(uid => isFree(uid, cursor, slotEnd));
      if (allFree) {
        slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString() });
      }
      cursor += STEP_MS;
    }

    res.json({ duration, users: userIds, slots });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
