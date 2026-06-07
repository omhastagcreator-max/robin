import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import EmployeeTarget from '../models/EmployeeTarget';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import Deal from '../models/Deal';
import Lead from '../models/Lead';

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

type Period = 'weekly' | 'monthly';

function periodKey(period: Period, d: Date = new Date()): string {
  // All keys are computed in IST so "this week" / "this month" line
  // up with how the agency talks about their schedule. +330 min
  // shifts UTC into IST before slicing.
  const ist = new Date(d.getTime() + 330 * 60_000);
  if (period === 'monthly') {
    return ist.toISOString().slice(0, 7);   // YYYY-MM
  }
  // ISO week. ISO weeks start on Monday and rollover with the IST
  // calendar. The standard trick: pick the Thursday of the week
  // (year-defining), then compute week number from Jan 1 of that year.
  const day = ist.getUTCDay() || 7;                              // 1..7 (Mon..Sun)
  const thursday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (4 - day)));
  const jan1     = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week     = Math.ceil((((thursday.getTime() - jan1.getTime()) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function periodRange(period: Period, key: string): { start: Date; end: Date } {
  if (period === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000);
    const end   = new Date(Date.UTC(y, m,     1) - 330 * 60_000);
    return { start, end };
  }
  // Weekly — key like "2026-W23". Monday of that ISO week (IST 00:00).
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) {
    const fallback = new Date();
    return { start: fallback, end: fallback };
  }
  const year = parseInt(match[1], 10);
  const wk   = parseInt(match[2], 10);
  // ISO week 1 is the week containing Jan 4. Find that Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;                         // 1..7
  const wk1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
  const istMonday = new Date(wk1Monday.getTime() + (wk - 1) * 7 * 86_400_000);
  const start = new Date(istMonday.getTime() - 330 * 60_000);    // IST 00:00 → UTC instant
  const end   = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end };
}

/**
 * Recompute actuals for a target sheet in place. Mutates `doc.targets[].actual`
 * and `doc.lastRecomputedAt`. Caller .save()s it.
 *
 * Handles both monthly and weekly windows uniformly — the caller passes
 * the right period + key.
 */
async function recomputeActuals(doc: any, orgId: string, userId: string, period: Period, key: string) {
  const { start, end } = periodRange(period, key);
  const orgObjId = new mongoose.Types.ObjectId(orgId);

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
        const rows = await ClientWorkflow.aggregate([
          { $match: { organizationId: orgObjId } },
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
        const rows = await ClientWorkflow.aggregate([
          { $match: { organizationId: orgObjId } },
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
      } else if (line.source === 'deals_won' || line.source === 'sales_revenue') {
        // Sales metrics — Deal → Lead.assignedTo. Aggregate counts (or
        // sums dealValue) of deals closed-won within the window where
        // the originating lead was assigned to this user. Matches the
        // way the existing sales dashboard attributes revenue.
        const rows = await Deal.aggregate([
          { $match: {
              organizationId: orgObjId,
              status: 'won',
              closedAt: { $gte: start, $lt: end },
          } },
          { $lookup: { from: Lead.collection.name, localField: 'leadId', foreignField: '_id', as: 'lead' } },
          { $unwind: '$lead' },
          { $match: { 'lead.assignedTo': userId } },
          line.source === 'deals_won'
            ? { $count: 'n' }
            : { $group: { _id: null, n: { $sum: '$dealValue' } } },
        ]);
        line.actual = Math.round(rows[0]?.n || 0);
      }
      // 'manual' — admin types it in. Untouched here.
    } catch {
      // Best-effort — leave actual untouched on aggregation failure
      // rather than zeroing out a stale-but-valid number.
    }
  }
  doc.lastRecomputedAt = new Date();
}

/**
 * Resolve `period` + `periodKey` from req.query, with sane defaults:
 *   - period defaults to 'monthly' (unchanged from pre-May-2026 callers)
 *   - if period query param is invalid, also fall back to 'monthly'
 *   - month (the periodKey) defaults to the current IST period.
 */
function readPeriod(req: AuthRequest): { period: Period; key: string } {
  const raw = String(req.query.period || 'monthly');
  const period: Period = (raw === 'weekly') ? 'weekly' : 'monthly';
  const key = (req.query.month as string) || periodKey(period);
  return { period, key };
}

/**
 * GET /api/targets/me?period=weekly|monthly&month=<periodKey>
 *
 * Returns the caller's target sheet, recomputing actuals before responding.
 * If no sheet exists yet, returns a 200 with an empty targets array so the
 * UI can render a blank progress card without an extra existence check.
 */
export async function getMyTargets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { period, key } = readPeriod(req);
    let doc = await EmployeeTarget.findOne({ organizationId: orgId, userId: me, period, month: key });
    if (!doc) {
      res.json({ userId: me, period, month: key, targets: [], notes: '', exists: false });
      return;
    }
    await recomputeActuals(doc, orgId, me, period, key);
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
    const { period, key } = readPeriod(req);

    const users = await User.find({
      organizationId: orgId,
      isActive: true,
      role: { $in: ['admin', 'sales', 'employee'] },
    }).select('_id name email avatarUrl role').lean();

    const sheets = await EmployeeTarget.find({ organizationId: orgId, period, month: key });
    const byUser = new Map(sheets.map(s => [String(s.userId), s]));

    const out = [];
    for (const u of users) {
      const id = String(u._id);
      const sheet = byUser.get(id);
      if (sheet) {
        await recomputeActuals(sheet, orgId, id, period, key);
        await sheet.save();
        out.push({
          userId: id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: u.role,
          targets: sheet.targets, notes: sheet.notes, exists: true, period, month: key,
        });
      } else {
        out.push({
          userId: id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: u.role,
          targets: [], notes: '', exists: false, period, month: key,
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
    const { period, key } = readPeriod(req);
    const targetUserId = req.params.userId;

    const { targets, notes } = req.body || {};
    if (!Array.isArray(targets)) {
      res.status(400).json({ error: 'targets[] required' }); return;
    }
    const validSources = ['tasks_done', 'services_done', 'brands_live', 'deals_won', 'sales_revenue', 'manual'];
    // Sanitise — drop anything we don't recognise, clamp negatives.
    // Preserve employee-set fields (etaDate / employeeNote) if they
    // exist on the incoming line so admin re-saving the sheet doesn't
    // wipe the employee's commitment.
    const cleanLines = targets
      .filter((t: any) => t && typeof t.label === 'string' && t.label.trim())
      .map((t: any) => ({
        label:  String(t.label).slice(0, 80).trim(),
        target: Math.max(0, Number(t.target) || 0),
        unit:   String(t.unit || '').slice(0, 24),
        actual: 0,
        source: validSources.includes(t.source) ? t.source : 'manual',
        etaDate:      t.etaDate ? new Date(t.etaDate) : null,
        employeeNote: typeof t.employeeNote === 'string' ? t.employeeNote.slice(0, 280) : '',
      }));

    const doc = await EmployeeTarget.findOneAndUpdate(
      { organizationId: orgId, userId: targetUserId, period, month: key },
      {
        $set: {
          targets: cleanLines,
          notes: typeof notes === 'string' ? notes.slice(0, 1000) : '',
          lastEditedBy: req.user!.id,
        },
        $setOnInsert: { createdBy: req.user!.id, period },
      },
      { new: true, upsert: true },
    );
    await recomputeActuals(doc, orgId, targetUserId, period, key);
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * PUT /api/targets/me/line/:lineId?period=&month=
 *
 * Self-service ETA / commentary endpoint. Any internal role can set
 * `etaDate` and `employeeNote` on their OWN target sheet's line.
 * It does NOT let the employee change target value, label, or source —
 * only admin's setUserTargets can. Used by the MyTargetsCard inline
 * editor.
 */
export async function setMyTargetLineEta(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { period, key } = readPeriod(req);

    const { etaDate, employeeNote } = req.body || {};
    // Find — but DON'T upsert. If no sheet exists, there's nothing
    // to attach an ETA to and we surface a 404 so the UI prompts
    // admin to set targets first.
    const doc = await EmployeeTarget.findOne({ organizationId: orgId, userId: me, period, month: key });
    if (!doc) { res.status(404).json({ error: 'No target sheet yet for this period' }); return; }

    // Mongoose DocumentArray.id() is the right tool for sub-doc lookup
    // by _id, but the lean-inferred type doesn't expose it; cast.
    const line: any = (doc.targets as any).id?.(req.params.lineId)
      || (doc.targets as any[]).find(l => String(l._id) === String(req.params.lineId));
    if (!line) { res.status(404).json({ error: 'Target line not found' }); return; }

    if (etaDate !== undefined) {
      line.etaDate = etaDate ? new Date(etaDate) : null;
    }
    if (employeeNote !== undefined) {
      line.employeeNote = typeof employeeNote === 'string' ? employeeNote.slice(0, 280) : '';
    }
    line.etaSetBy = me;
    line.etaSetAt = new Date();
    await doc.save();
    res.json(line);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
