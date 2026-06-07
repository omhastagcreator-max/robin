import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import EmployeeTarget from '../models/EmployeeTarget';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';

/**
 * Targets controller — monthly performance targets per employee.
 *
 * Three primary surfaces:
 *   1. Employee views their own current-month progress on the Workroom.
 *   2. Admin sets / edits any employee's targets for any month.
 *   3. Executive dashboard reads everyone's progress to render the
 *      "How the team is tracking" section.
 *
 * Every GET recomputes actuals from source collections BEFORE returning
 * so the page always shows fresh numbers without a separate cron tick.
 * The recompute is O(few small queries per target line) — well under
 * 50ms for normal monthly windows.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

function monthKey(d: Date = new Date()): string {
  // IST date. +330 minutes pushes UTC into IST so 11:30 PM UTC reads
  // as 5:00 AM next-day IST — matches how the rest of Robin reasons
  // about "today".
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 7); // YYYY-MM
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  // IST → UTC: subtract 5h30m so the IST midnight becomes the right UTC
  // instant. (Mongo stores UTC; we want "the IST month".)
  const start = new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000);
  const end   = new Date(Date.UTC(y, m,     1) - 330 * 60_000);
  return { start, end };
}

/**
 * Recompute actuals for a target sheet in place. Mutates `doc.targets[].actual`
 * and `doc.lastRecomputedAt`. Caller .save()s it.
 */
async function recomputeActuals(doc: any, orgId: string, userId: string, month: string) {
  const { start, end } = monthRange(month);
  for (const line of doc.targets) {
    try {
      if (line.source === 'tasks_done') {
        line.actual = await ProjectTask.countDocuments({
          organizationId: orgId,
          assignedTo: userId,
          status: 'done',
          completedAt: { $gte: start, $lt: end },
        });
      } else if (line.source === 'services_done') {
        // Count completed services across all client workflows for this user.
        const rows = await ClientWorkflow.aggregate([
          { $match: { organizationId: new (require('mongoose').Types.ObjectId)(orgId) } },
          { $unwind: '$services' },
          { $match: {
              'services.assignedTo': userId,
              'services.status': 'done',
              'services.completedAt': { $gte: start, $lt: end },
          } },
          { $count: 'n' },
        ]);
        line.actual = rows[0]?.n || 0;
      } else if (line.source === 'brands_live') {
        // Count distinct brands where THIS user finished a service this month.
        const rows = await ClientWorkflow.aggregate([
          { $match: { organizationId: new (require('mongoose').Types.ObjectId)(orgId) } },
          { $unwind: '$services' },
          { $match: {
              'services.assignedTo': userId,
              'services.status': 'done',
              'services.completedAt': { $gte: start, $lt: end },
          } },
          { $group: { _id: '$_id' } },
          { $count: 'n' },
        ]);
        line.actual = rows[0]?.n || 0;
      }
      // 'manual' lines stay as-set — admin types the number in.
    } catch {
      // Best-effort — leave actual untouched on aggregation failure.
    }
  }
  doc.lastRecomputedAt = new Date();
}

/**
 * GET /api/targets/me?month=YYYY-MM  (defaults to current IST month)
 *
 * Returns the caller's target sheet for that month, recomputing actuals
 * before responding. If no sheet exists yet, returns a 200 with an empty
 * targets array so the UI can render a blank progress card without an
 * extra existence check.
 */
export async function getMyTargets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const month = (req.query.month as string) || monthKey();
    let doc = await EmployeeTarget.findOne({ organizationId: orgId, userId: me, month });
    if (!doc) {
      res.json({ userId: me, month, targets: [], notes: '', exists: false });
      return;
    }
    await recomputeActuals(doc, orgId, me, month);
    await doc.save();
    res.json({ ...doc.toObject(), exists: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/targets/team?month=YYYY-MM  (admin-only)
 *
 * Returns target sheets for every employee in the org for that month,
 * including users who don't have a sheet yet (returned with empty
 * targets so the admin UI can prompt "Set targets" without juggling
 * two data sources). Actuals are recomputed for all existing sheets.
 */
export async function getTeamTargets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const month = (req.query.month as string) || monthKey();

    const users = await User.find({
      organizationId: orgId,
      isActive: true,
      role: { $in: ['admin', 'sales', 'employee'] },
    }).select('_id name email avatarUrl role').lean();

    const sheets = await EmployeeTarget.find({ organizationId: orgId, month });
    const byUser = new Map(sheets.map(s => [String(s.userId), s]));

    const out = [];
    for (const u of users) {
      const id = String(u._id);
      const sheet = byUser.get(id);
      if (sheet) {
        await recomputeActuals(sheet, orgId, id, month);
        await sheet.save();
        out.push({
          userId: id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: u.role,
          targets: sheet.targets, notes: sheet.notes, exists: true, month,
        });
      } else {
        out.push({
          userId: id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: u.role,
          targets: [], notes: '', exists: false, month,
        });
      }
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * PUT /api/targets/user/:userId?month=YYYY-MM
 *
 * Admin upserts a target sheet for an employee. Body shape:
 *   { targets: [{ label, target, unit, source }], notes?: string }
 *
 * Source defaults to 'manual' if not provided. We don't store actuals
 * from the client — the next GET recomputes them from real activity.
 */
export async function setUserTargets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const month = (req.query.month as string) || monthKey();
    const targetUserId = req.params.userId;

    const { targets, notes } = req.body || {};
    if (!Array.isArray(targets)) {
      res.status(400).json({ error: 'targets[] required' }); return;
    }
    // Sanitise — drop anything we don't recognise, clamp negatives.
    const cleanLines = targets
      .filter((t: any) => t && typeof t.label === 'string' && t.label.trim())
      .map((t: any) => ({
        label:  String(t.label).slice(0, 80).trim(),
        target: Math.max(0, Number(t.target) || 0),
        unit:   String(t.unit || '').slice(0, 24),
        actual: 0,
        source: ['tasks_done', 'services_done', 'brands_live', 'manual'].includes(t.source)
          ? t.source : 'manual',
      }));

    const doc = await EmployeeTarget.findOneAndUpdate(
      { organizationId: orgId, userId: targetUserId, month },
      {
        $set: {
          targets: cleanLines,
          notes: typeof notes === 'string' ? notes.slice(0, 1000) : '',
          lastEditedBy: req.user!.id,
        },
        $setOnInsert: { createdBy: req.user!.id },
      },
      { new: true, upsert: true },
    );
    await recomputeActuals(doc, orgId, targetUserId, month);
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
