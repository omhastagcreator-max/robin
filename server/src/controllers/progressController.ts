import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import EmployeeProgress from '../models/EmployeeProgress';
import {
  weekStartMs, fmtISTDate, snapshotWeekForUser, snapshotWeekForOrg,
} from '../services/progressReport';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

/**
 * GET /api/progress/team?weeks=8
 *
 * The weekly progress report for every internal staff member. For each
 * person: profile basics, this week's LIVE score (recomputed on every
 * call so it's always current), and up to `weeks` stored snapshots for
 * the trend line. Access: admin / sales / canManageWorkroom (Om) — same
 * gate as Team Pulse, enforced in routes/progress.ts.
 */
export async function getTeamProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const weeks = Math.min(26, Math.max(1, parseInt(String(req.query.weeks || 8), 10) || 8));
    const currentWk = weekStartMs();

    const staff = await User.find({
      organizationId: orgId,
      role: { $in: ['employee', 'sales', 'workroom'] },
      isActive: true,
    }).select('_id name email role team').lean();

    // Recompute the in-flight week live for everyone (cheap: a handful
    // of indexed queries per user, ~5 staff). Past weeks come from the
    // stored snapshots written by the Monday cron.
    const result = await Promise.all(staff.map(async (u) => {
      const uid = String(u._id);
      let current: any = null;
      try { current = await snapshotWeekForUser(uid, orgId, currentWk, true); }
      catch { /* keep nulls — history still renders */ }

      const history = await EmployeeProgress.find({
        organizationId: orgId,
        userId: uid,
        weekStartIST: { $gte: fmtISTDate(currentWk - weeks * WEEK_MS) },
      }).sort({ weekStartIST: 1 }).lean();

      // Week-over-week delta: current score vs last completed week.
      const prev = [...history].reverse().find(h => h.weekStartIST < fmtISTDate(currentWk));
      const delta = current && prev ? (current.score - (prev.score || 0)) : null;

      return {
        userId: uid,
        name: u.name || u.email,
        email: u.email,
        role: u.role,
        team: (u as any).team || '',
        current: current ? {
          weekStartIST: current.weekStartIST,
          score: current.score,
          breakdown: current.breakdown,
          metrics: current.metrics,
          provisional: true,
        } : null,
        delta,
        history: history.map(h => ({
          weekStartIST: h.weekStartIST,
          score: h.score,
          provisional: h.provisional,
        })),
      };
    }));

    result.sort((a, b) => (b.current?.score || 0) - (a.current?.score || 0));
    res.json({ weekStartIST: fmtISTDate(currentWk), team: result });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/progress/recompute?week=YYYY-MM-DD
 *
 * Force-recompute snapshots for the whole org, defaulting to LAST week
 * (the one the cron would have written). Lets an admin backfill after a
 * data repair (fix-open-breaks, backdate-session) changes the inputs.
 */
export async function recomputeProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const lastWk = weekStartMs() - WEEK_MS;
    let wk = lastWk;
    const q = String(req.query.week || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
      // Interpret as an IST date; snap to that week's Monday.
      wk = weekStartMs(new Date(`${q}T00:00:00+05:30`).getTime());
    }
    const isCurrent = wk === weekStartMs();
    const count = await snapshotWeekForOrg(orgId, wk, isCurrent);
    res.json({ ok: true, weekStartIST: fmtISTDate(wk), staffProcessed: count });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
