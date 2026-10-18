import { Response } from 'express';
import { auditDelete } from '../services/auditLog';
import { AuthRequest } from '../middleware/authMiddleware';
import Incentive from '../models/Incentive';
import User from '../models/User';
import { notifyDataChanged } from '../services/notify';

/**
 * Incentives — Oct 2026. Everyone on the team can see who earned what
 * (owner wants it open); only admins can add or remove entries.
 */

function istMonthKey(d = new Date()): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}

async function getOrg(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/** GET /api/incentives?month=YYYY-MM — per-employee totals + entries. */
export async function listIncentives(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const q = String(req.query.month || '');
    const month = /^\d{4}-\d{2}$/.test(q) ? q : istMonthKey();

    const [entries, staff] = await Promise.all([
      Incentive.find({ organizationId: orgId, month }).sort({ createdAt: -1 }).lean(),
      User.find({ organizationId: orgId, role: { $in: ['admin', 'employee', 'sales', 'workroom'] }, isActive: { $ne: false } })
        .select('name email avatarUrl role').lean(),
    ]);
    const nameOf = new Map(staff.map((u: any) => [String(u._id), u.name || u.email || 'Teammate']));

    const byUser = new Map<string, { userId: string; name: string; avatarUrl?: string; total: number; count: number }>();
    for (const e of entries as any[]) {
      const id = String(e.userId);
      const row = byUser.get(id) || {
        userId: id,
        name: nameOf.get(id) || 'Former teammate',
        avatarUrl: (staff as any[]).find(u => String(u._id) === id)?.avatarUrl,
        total: 0, count: 0,
      };
      row.total += e.amount; row.count += 1;
      byUser.set(id, row);
    }
    const people = Array.from(byUser.values()).sort((a, b) => b.total - a.total);

    res.json({
      month,
      total: people.reduce((s, p) => s + p.total, 0),
      people,
      entries: (entries as any[]).map(e => ({
        _id: String(e._id), userId: String(e.userId), name: nameOf.get(String(e.userId)) || 'Former teammate',
        amount: e.amount, reason: e.reason || '', createdAt: e.createdAt,
      })),
      // For the admin "add" picker.
      staff: req.user!.role === 'admin'
        ? (staff as any[]).map(u => ({ _id: String(u._id), name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name))
        : [],
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** POST /api/incentives { userId, amount, reason?, month? } — admin only. */
export async function createIncentive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { userId, reason } = req.body || {};
    const amount = Number(req.body?.amount);
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? String(req.body.month) : istMonthKey();
    if (!userId) { res.status(400).json({ error: 'Pick a teammate' }); return; }
    if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'Enter an amount above 0' }); return; }
    const target = await User.findOne({ _id: userId, organizationId: orgId }).select('_id').lean();
    if (!target) { res.status(404).json({ error: 'Teammate not found' }); return; }

    const doc = await Incentive.create({
      organizationId: orgId, userId: String(userId), amount: Math.round(amount),
      reason: String(reason || '').slice(0, 200), month, createdBy: req.user!.id,
    });
    notifyDataChanged(req.app.get('io'), orgId, 'incentive.created', String(doc._id));
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** DELETE /api/incentives/:id — admin only (fix a wrong entry). */
export async function deleteIncentive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const gone = await Incentive.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (gone) auditDelete(req, 'incentive', gone);   // Oct 2026 — every delete is logged
    const r = { deletedCount: gone ? 1 : 0 };
    if (!r.deletedCount) { res.status(404).json({ error: 'Not found' }); return; }
    notifyDataChanged(req.app.get('io'), orgId, 'incentive.deleted', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
