import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientSchedule from '../models/ClientSchedule';
import User from '../models/User';
import { notify } from '../services/notify';

/**
 * Per-org client schedule — every read/write enforces organizationId AND
 * (for non-admins) restricts to the actor's own slots so teammates can't
 * see or edit each other's schedules.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/**
 * IST-safe day normalisation — store every serviceDate at noon UTC of the
 * date the user picked. Avoids the classic "user picks 12 May, server
 * stores 11 May 18:30 UTC, render thinks 11 May" timezone bug. Same helper
 * the leaves controller uses.
 */
function normaliseToIstDay(input: any): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  // Take Y/M/D from IST (UTC+5:30), build noon UTC of that day.
  const ist = new Date(d.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 12, 0, 0, 0));
}

function istTodayBounds(): { from: Date; to: Date } {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const from = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0));
  const to   = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 999));
  return { from, to };
}

// ── List schedule entries ─────────────────────────────────────────────────
/**
 * GET /api/client-schedule?from=2026-05-12&to=2026-05-18&userId=xxx
 *
 * Defaults to the current week if no range. Non-admins are forced to their
 * OWN userId regardless of what they pass — they can't view someone else's.
 * Admins can pass `userId` to look at a specific teammate, or omit it to
 * see the whole org's schedule.
 *
 * Response is enriched with the client's name + the assignee's name so the
 * UI doesn't need a second round-trip per row.
 */
export async function listSchedule(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 7 * 86400_000);
    const toDate   = to   ? new Date(String(to))   : new Date(Date.now() + 7 * 86400_000);

    const filter: any = {
      organizationId: orgId,
      serviceDate: { $gte: fromDate, $lte: toDate },
    };

    // Non-admins ONLY see their own slots. Admins can pass userId to
    // narrow to a specific teammate, or omit for whole-org view.
    if (req.user!.role !== 'admin') {
      filter.userId = req.user!.id;
    } else if (req.query.userId) {
      filter.userId = String(req.query.userId);
    }

    const items = await ClientSchedule.find(filter).sort({ serviceDate: 1, createdAt: 1 }).lean();
    if (items.length === 0) { res.json([]); return; }

    // Hydrate client + user display info in one round trip each.
    const clientIds = Array.from(new Set(items.map(i => i.clientId)));
    const userIds   = Array.from(new Set(items.map(i => i.userId)));
    const [clients, users] = await Promise.all([
      User.find({ _id: { $in: clientIds }, organizationId: orgId }).select('name email company').lean(),
      User.find({ _id: { $in: userIds   }, organizationId: orgId }).select('name email').lean(),
    ]);
    const clientById = new Map(clients.map(c => [String(c._id), c]));
    const userById   = new Map(users.map(u   => [String(u._id), u]));

    res.json(items.map(i => ({
      ...i,
      client: clientById.get(i.clientId)
        ? { name: clientById.get(i.clientId)!.name, email: clientById.get(i.clientId)!.email, company: (clientById.get(i.clientId) as any).company }
        : null,
      assignee: userById.get(i.userId) ? { name: userById.get(i.userId)!.name, email: userById.get(i.userId)!.email } : null,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Today's clients for the logged-in user (powers login reminder) ────────
/**
 * GET /api/client-schedule/today
 *
 * Returns the clients the actor is scheduled to serve today (IST day).
 * Used by the login-time reminder toast and the dashboard "today" widget.
 */
export async function todaysClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { from, to } = istTodayBounds();
    const items = await ClientSchedule.find({
      organizationId: orgId,
      userId: req.user!.id,
      serviceDate: { $gte: from, $lte: to },
    }).sort({ createdAt: 1 }).lean();

    if (items.length === 0) { res.json([]); return; }

    const clientIds = Array.from(new Set(items.map(i => i.clientId)));
    const clients = await User.find({ _id: { $in: clientIds }, organizationId: orgId })
      .select('name email company').lean();
    const byId = new Map(clients.map(c => [String(c._id), c]));

    res.json(items.map(i => ({
      _id: i._id,
      clientId: i.clientId,
      clientName: byId.get(i.clientId)?.name || 'Client',
      clientCompany: (byId.get(i.clientId) as any)?.company || '',
      taskType: i.taskType,
      status: i.status,
      notes: i.notes,
      color: (i as any).color || '',
      serviceDate: i.serviceDate,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Create ───────────────────────────────────────────────────────────────
/**
 * POST /api/client-schedule
 * Body: { clientId, serviceDate, userId?, taskType?, notes?, recurringKey? }
 *
 * Non-admins can only create slots for THEMSELVES — userId is ignored.
 * Admins can create slots for any teammate by passing userId.
 */
export async function createSchedule(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { clientId, serviceDate, userId, taskType, notes, color, recurringKey } = req.body || {};
    if (!clientId)    { res.status(400).json({ error: 'clientId required' });    return; }
    if (!serviceDate) { res.status(400).json({ error: 'serviceDate required' }); return; }

    // Verify the client actually exists in this org.
    const client = await User.findOne({ _id: clientId, organizationId: orgId, role: 'client' }).select('_id').lean();
    if (!client) { res.status(400).json({ error: 'Client not found in this organization' }); return; }

    // Non-admins can only schedule themselves.
    const targetUserId = (req.user!.role === 'admin' && userId) ? String(userId) : req.user!.id;

    // If admin is assigning to someone else, verify they're in this org.
    if (targetUserId !== req.user!.id) {
      const u = await User.findOne({ _id: targetUserId, organizationId: orgId }).select('_id').lean();
      if (!u) { res.status(400).json({ error: 'Assignee not found in this organization' }); return; }
    }

    let normalisedDate: Date;
    try { normalisedDate = normaliseToIstDay(serviceDate); }
    catch { res.status(400).json({ error: 'Invalid serviceDate' }); return; }

    try {
      const item = await ClientSchedule.create({
        organizationId: orgId,
        userId: targetUserId,
        clientId,
        serviceDate: normalisedDate,
        taskType: taskType || 'other',
        notes,
        color: color || '',
        recurringKey,
        createdBy: req.user!.id,
      });
      // If admin scheduled someone ELSE (vs. self), ping them.
      if (targetUserId !== req.user!.id) {
        const c = await User.findById(clientId).select('name').lean();
        await notify({
          io: req.app.get('io'), organizationId: orgId, actorId: req.user!.id,
          userId: targetUserId,
          type: 'schedule.assigned',
          title: `New client slot · ${c?.name || 'Client'}`,
          body:  `${(taskType || 'work')} on ${normalisedDate.toDateString()}${notes ? ` · ${String(notes).slice(0, 80)}` : ''}`,
          entityId: String(item._id), entityType: 'schedule',
        });
      }
      res.status(201).json(item);
    } catch (e: any) {
      // Hit the unique index — same person/client/day already exists.
      if (e?.code === 11000) {
        res.status(409).json({ error: 'This client is already on the schedule for that day' });
        return;
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Update ───────────────────────────────────────────────────────────────
/**
 * PUT /api/client-schedule/:id
 * Body: any of { taskType, notes, status, serviceDate, userId, clientId }
 *
 * Non-admins can only update their OWN entries. Org check is enforced
 * regardless of role.
 */
export async function updateSchedule(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const filter: any = { _id: req.params.id, organizationId: orgId };
    if (req.user!.role !== 'admin') filter.userId = req.user!.id;

    const allowed = ['taskType', 'notes', 'status', 'serviceDate', 'userId', 'clientId', 'color'];
    const patch: Record<string, any> = {};
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'serviceDate') {
        try { patch.serviceDate = normaliseToIstDay(req.body[k]); }
        catch { res.status(400).json({ error: 'Invalid serviceDate' }); return; }
      } else if (k === 'userId' && req.user!.role !== 'admin') {
        // Non-admins can't reassign to someone else.
        continue;
      } else {
        patch[k] = req.body[k];
      }
    }

    try {
      const item = await ClientSchedule.findOneAndUpdate(filter, patch, { new: true });
      if (!item) { res.status(404).json({ error: 'Schedule entry not found' }); return; }
      res.json(item);
    } catch (e: any) {
      if (e?.code === 11000) {
        res.status(409).json({ error: 'This client is already on the schedule for that day' });
        return;
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Delete ───────────────────────────────────────────────────────────────
/**
 * DELETE /api/client-schedule/:id
 * Same permission rules as update.
 */
export async function deleteSchedule(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const filter: any = { _id: req.params.id, organizationId: orgId };
    if (req.user!.role !== 'admin') filter.userId = req.user!.id;
    const result = await ClientSchedule.findOneAndDelete(filter);
    if (!result) { res.status(404).json({ error: 'Schedule entry not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
