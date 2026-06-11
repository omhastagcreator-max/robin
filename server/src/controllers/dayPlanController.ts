import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import EmployeeDayPlan from '../models/EmployeeDayPlan';
import ClientWorkflow from '../models/ClientWorkflow';
import { notifyDataChanged } from '../services/notify';

/**
 * dayPlanController — admin-curated weekly plan for each employee.
 *
 * Read paths:
 *   GET /api/day-plan/me                 — caller's own plan for this week.
 *   GET /api/day-plan/user/:userId       — admin/sales: anyone's plan.
 *
 * Write paths:
 *   PUT  /api/day-plan/user/:userId          — admin: full overwrite.
 *   POST /api/day-plan/user/:userId/auto-distribute
 *     — admin: round-robin every brand the employee is assigned to
 *       across Mon-Fri (5 days). Preserves any existing tasks/target
 *       on entries the auto-distribute would have written to UNLESS
 *       `replace=true`.
 *
 * Week key format: YYYY-Www (ISO week, IST-anchored). Same convention
 * as EmployeeTarget so weekly screens line up.
 */

async function getOrgIdAndRole(userId: string): Promise<{ orgId: string | null; role: string }> {
  const u = await User.findById(userId).select('organizationId role').lean();
  return { orgId: u?.organizationId ? String(u.organizationId) : null, role: u?.role || 'employee' };
}

function isoWeekKey(d: Date = new Date()): string {
  // IST-anchored. Compute ISO week from the IST date.
  const ist = new Date(d.getTime() + 330 * 60_000);
  const day = ist.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (4 - day)));
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - jan1.getTime()) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function emptyPlan(weekKey: string): any[] {
  // Mon-Fri default. Admin can add 6/7 manually.
  return [1, 2, 3, 4, 5].map(d => ({ dayOfWeek: d, clients: [], tasks: [], target: '', notes: '' }));
}

async function readPlan(orgId: string, userId: string, weekKey: string) {
  let doc = await EmployeeDayPlan.findOne({ organizationId: orgId, userId, weekKey });
  if (!doc) {
    return { userId, weekKey, entries: emptyPlan(weekKey), weeklyTarget: '', notes: '', exists: false };
  }
  return { ...doc.toObject(), exists: true };
}

export async function getMyPlan(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekKey = (req.query.week as string) || isoWeekKey();
    const plan = await readPlan(orgId, me, weekKey);
    res.json(plan);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getUserPlan(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekKey = (req.query.week as string) || isoWeekKey();
    const plan = await readPlan(orgId, req.params.userId, weekKey);
    res.json(plan);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function setUserPlan(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekKey = (req.query.week as string) || isoWeekKey();
    const userId = req.params.userId;

    const { entries, weeklyTarget, notes } = req.body || {};
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'entries[] required' }); return;
    }
    // Sanitise: drop unknown fields, clamp dayOfWeek, validate ObjectIds.
    const clean = entries
      .map((e: any) => ({
        dayOfWeek: Math.max(1, Math.min(7, Number(e.dayOfWeek) || 1)),
        clients:   Array.isArray(e.clients)
          ? e.clients.filter((id: any) => mongoose.Types.ObjectId.isValid(String(id))).map(String)
          : [],
        tasks:     Array.isArray(e.tasks) ? e.tasks.map((s: any) => String(s).slice(0, 200)) : [],
        target:    typeof e.target === 'string' ? e.target.slice(0, 400) : '',
        notes:     typeof e.notes === 'string' ? e.notes.slice(0, 400) : '',
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    const doc = await EmployeeDayPlan.findOneAndUpdate(
      { organizationId: orgId, userId, weekKey },
      {
        $set: {
          entries: clean,
          weeklyTarget: typeof weeklyTarget === 'string' ? weeklyTarget.slice(0, 600) : '',
          notes:        typeof notes === 'string' ? notes.slice(0, 600) : '',
          lastEditedBy: me,
        },
      },
      { new: true, upsert: true },
    );
    notifyDataChanged(req.app.get('io'), orgId, 'day-plan.updated', String(doc._id));
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * autoDistribute — round-robin every brand the employee owns across
 * Mon-Fri. "Owns" = the user is an `assignedTo` on at least one
 * service of that brand. Preserves any tasks/target already set on
 * each day unless `replace=1` is passed.
 *
 * Why round-robin: the agency-owner spec — "no client gets missed
 * before there meeting". If we sorted by brand count or priority,
 * lower-priority brands would consistently land on the same day
 * (e.g. always Friday) and the team would coast on them. Round-robin
 * keeps coverage even and predictable.
 */
export async function autoDistribute(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekKey = (req.query.week as string) || isoWeekKey();
    const userId = req.params.userId;
    const replace = String(req.query.replace || '') === '1';

    // Find every brand this user is a service-owner on.
    const brands = await ClientWorkflow.find({
      organizationId: orgId,
      'services.assignedTo': userId,
    }).select('_id clientName priority').lean();

    // Sort by priority desc → so urgent/high brands hit Monday first.
    const PR = (p: any) => p === 'urgent' ? 3 : p === 'high' ? 2 : p === 'medium' ? 1 : 0;
    const sorted = brands.slice().sort((a, b) => PR(b.priority) - PR(a.priority));

    // Round-robin across 5 days.
    const buckets: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    sorted.forEach((b, i) => {
      const day = (i % 5) + 1;
      buckets[day].push(String(b._id));
    });

    // Load existing plan (or empty) and merge.
    const existing = await EmployeeDayPlan.findOne({ organizationId: orgId, userId, weekKey });
    const baseEntries = existing
      ? existing.entries.toObject() as any[]
      : emptyPlan(weekKey);

    const merged = baseEntries.map(e => {
      const nextClients = buckets[e.dayOfWeek] || [];
      return {
        dayOfWeek: e.dayOfWeek,
        clients:   replace ? nextClients : Array.from(new Set([...(e.clients || []).map(String), ...nextClients])),
        tasks:     replace ? [] : (e.tasks || []),
        target:    replace ? '' : (e.target || ''),
        notes:     replace ? '' : (e.notes || ''),
      };
    });

    const doc = await EmployeeDayPlan.findOneAndUpdate(
      { organizationId: orgId, userId, weekKey },
      { $set: { entries: merged, lastEditedBy: me } },
      { new: true, upsert: true },
    );
    notifyDataChanged(req.app.get('io'), orgId, 'day-plan.distributed', String(doc._id));
    res.json({
      plan: doc,
      summary: {
        brandsDistributed: brands.length,
        perDay: Object.fromEntries(Object.entries(buckets).map(([d, ids]) => [d, ids.length])),
      },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
