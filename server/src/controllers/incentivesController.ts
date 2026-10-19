import { Response } from 'express';
import { auditDelete } from '../services/auditLog';
import { AuthRequest } from '../middleware/authMiddleware';
import Incentive from '../models/Incentive';
import User from '../models/User';
import { notifyDataChanged } from '../services/notify';

/**
 * Incentives — Oct 2026. Everyone on the team can see who earned what
 * (owner wants it open). Admins add entries for anyone; since Oct 19 any
 * teammate can add their OWN (pending until an admin/manager approves).
 */

async function isReviewer(req: AuthRequest): Promise<boolean> {
  if (req.user!.role === 'admin') return true;
  const u = await User.findById(req.user!.id).select('canViewOversight roles').lean() as any;
  return !!u?.canViewOversight || (u?.roles || []).includes('admin');
}

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

    const reviewer = await isReviewer(req);
    const [allEntries, staff] = await Promise.all([
      Incentive.find({ organizationId: orgId, month, status: { $ne: 'rejected' } }).sort({ createdAt: -1 }).lean(),
      User.find({ organizationId: orgId, role: { $in: ['admin', 'employee', 'sales', 'workroom'] }, isActive: { $ne: false } })
        .select('name email avatarUrl role').lean(),
    ]);
    // Approved entries count; pending ones are shown to their owner and reviewers only.
    const entries = (allEntries as any[]).filter(e => (e.status || 'approved') === 'approved');
    const pending = (allEntries as any[]).filter(e => e.status === 'pending' && (reviewer || String(e.userId) === req.user!.id));
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
        amount: e.amount, reason: e.reason || '', createdAt: e.createdAt, status: 'approved',
      })),
      pending: pending.map(e => ({
        _id: String(e._id), userId: String(e.userId), name: nameOf.get(String(e.userId)) || 'Former teammate',
        amount: e.amount, reason: e.reason || '', createdAt: e.createdAt, status: 'pending',
      })),
      canReview: reviewer,
      // For the admin "add" picker.
      staff: req.user!.role === 'admin'
        ? (staff as any[]).map(u => ({ _id: String(u._id), name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name))
        : [],
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** POST /api/incentives { userId, amount, reason?, month? } — admin adds for
 *  anyone (approved); a teammate adds their own (pending approval). */
export async function createIncentive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const admin = req.user!.role === 'admin';
    const reason = req.body?.reason;
    const userId = admin ? req.body?.userId : req.user!.id;
    const amount = Number(req.body?.amount);
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? String(req.body.month) : istMonthKey();
    if (!userId) { res.status(400).json({ error: 'Pick a teammate' }); return; }
    if (!admin && String(reason || '').trim().length < 3) { res.status(400).json({ error: 'Say what the incentive is for' }); return; }
    if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'Enter an amount above 0' }); return; }
    const target = await User.findOne({ _id: userId, organizationId: orgId }).select('_id').lean();
    if (!target) { res.status(404).json({ error: 'Teammate not found' }); return; }

    const doc = await Incentive.create({
      organizationId: orgId, userId: String(userId), amount: Math.round(amount),
      reason: String(reason || '').slice(0, 200), month, createdBy: req.user!.id,
      status: admin ? 'approved' : 'pending',
    });
    notifyDataChanged(req.app.get('io'), orgId, 'incentive.created', String(doc._id));
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** PUT /api/incentives/:id/review { decision: 'approve' | 'reject' } — admin / manager. */
export async function reviewIncentive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    if (!(await isReviewer(req))) { res.status(403).json({ error: 'Only an admin or manager can approve incentives' }); return; }
    const decision = req.body?.decision === 'reject' ? 'rejected' : req.body?.decision === 'approve' ? 'approved' : null;
    if (!decision) { res.status(400).json({ error: 'decision must be approve or reject' }); return; }
    const doc: any = await Incentive.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    if (doc.status !== 'pending') { res.status(409).json({ error: 'Already reviewed' }); return; }
    doc.status = decision; doc.reviewedBy = req.user!.id; doc.reviewedAt = new Date();
    await doc.save();
    notifyDataChanged(req.app.get('io'), orgId, 'incentive.reviewed', String(doc._id));
    res.json({ ok: true, status: decision });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** DELETE /api/incentives/:id — admin (fix a wrong entry), or the owner while still pending. */
export async function deleteIncentive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrg(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const filter: any = { _id: req.params.id, organizationId: orgId };
    if (req.user!.role !== 'admin') { filter.userId = req.user!.id; filter.status = 'pending'; }
    const gone = await Incentive.findOneAndDelete(filter);
    if (gone) auditDelete(req, 'incentive', gone);   // Oct 2026 — every delete is logged
    const r = { deletedCount: gone ? 1 : 0 };
    if (!r.deletedCount) { res.status(404).json({ error: 'Not found' }); return; }
    notifyDataChanged(req.app.get('io'), orgId, 'incentive.deleted', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
