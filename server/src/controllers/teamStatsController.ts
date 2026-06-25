import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import Session from '../models/Session';

/**
 * teamStatsController — per-employee activity rollup.
 *
 * GET /api/team-stats/today
 *
 * Returns one row per internal teammate with their counts for the
 * current IST day (00:00 IST → now). All numbers are derived from
 * the existing audit-trailed collections — no separate "stats"
 * counter is maintained. That way:
 *   - There's nothing to reset or get out of sync.
 *   - The view is the truth at every moment; refresh = up-to-date.
 *   - Backfilling history (e.g. yesterday's view) is a one-line
 *     window swap on the same query.
 *
 * Each row contains:
 *   tasksDoneToday          — ProjectTask with status='done' and
 *                             completedAt inside today
 *   tasksCreatedToday       — assignedBy === user, createdAt today
 *   tasksAcceptedToday      — assignedTo === user, status moved from
 *                             pending_acceptance to pending today
 *                             (we approximate via etaSetAt + status)
 *   servicesCompletedToday  — ClientWorkflow.services where
 *                             assignedTo === user and completedAt today
 *   brandsTouchedToday      — distinct ClientWorkflow IDs the user
 *                             touched today (task done OR service done)
 *   hoursWorkedToday        — Session.totalActiveMs accumulated today
 *   hoursInHuddleToday      — Session.huddleMs accumulated today
 *
 * Admin / sales can see everyone. Employees see only their own row
 * (we apply the filter post-aggregation).
 */

async function getOrgIdAndRole(userId: string): Promise<{ orgId: string | null; role: string }> {
  const u = await User.findById(userId).select('organizationId role').lean();
  return { orgId: u?.organizationId ? String(u.organizationId) : null, role: u?.role || 'employee' };
}

// IST-anchored day boundary helpers. IST = UTC+05:30.
function istDayWindow(): { start: Date; end: Date; istDate: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const istMid = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0));
  const start = new Date(istMid.getTime() - 330 * 60_000);     // IST 00:00 → UTC
  const end   = new Date(start.getTime() + 86_400_000);
  const istDate = ist.toISOString().slice(0, 10);
  return { start, end, istDate };
}

export async function getTodayStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId, role } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const orgObjId = new mongoose.Types.ObjectId(orgId);

    const { start, end, istDate } = istDayWindow();

    // Fetch in parallel — every aggregation is independent.
    const [users, tasks, workflows, sessions] = await Promise.all([
      User.find({
        organizationId: orgId,
        isActive: true,
        role: { $in: ['admin', 'sales', 'employee'] },
      }).select('_id name email avatarUrl role team').lean(),
      ProjectTask.find({
        organizationId: orgId,
        $or: [
          { completedAt: { $gte: start, $lt: end } },
          { createdAt:   { $gte: start, $lt: end } },
          { estimatedAt: { $gte: start, $lt: end } },
        ],
      }).select('_id status assignedTo assignedBy completedAt createdAt clientWorkflowId estimatedBy estimatedAt').lean(),
      ClientWorkflow.find({ organizationId: orgObjId }).select('_id services').lean(),
      Session.find({
        organizationId: orgId,
        $or: [
          { endTime:   { $gte: start, $lt: end } },
          { startTime: { $gte: start, $lt: end } },
          { status: { $in: ['active', 'on_break'] } },  // still-open sessions count partial-day time
        ],
      }).select('userId startTime endTime status huddleMs huddleJoinedAt totalActiveMs breakMs').lean(),
    ]);

    // Index tasks per assignee / creator for cheap lookups.
    const tasksByAssignee  = new Map<string, any[]>();
    const tasksByCreator   = new Map<string, any[]>();
    for (const t of tasks) {
      if (t.assignedTo) {
        if (!tasksByAssignee.has(String(t.assignedTo))) tasksByAssignee.set(String(t.assignedTo), []);
        tasksByAssignee.get(String(t.assignedTo))!.push(t);
      }
      if (t.assignedBy) {
        if (!tasksByCreator.has(String(t.assignedBy))) tasksByCreator.set(String(t.assignedBy), []);
        tasksByCreator.get(String(t.assignedBy))!.push(t);
      }
    }
    // Services completed today by assignee.
    const svcDoneByUser = new Map<string, { wf: string; svc: any }[]>();
    for (const w of workflows) {
      for (const s of (w.services as any[]) || []) {
        if (s.status === 'done' && s.completedAt && new Date(s.completedAt) >= start && new Date(s.completedAt) < end && s.assignedTo) {
          const uid = String(s.assignedTo);
          if (!svcDoneByUser.has(uid)) svcDoneByUser.set(uid, []);
          svcDoneByUser.get(uid)!.push({ wf: String(w._id), svc: s });
        }
      }
    }
    // Per-user session aggregates (one user can have multiple sessions today).
    const sessByUser = new Map<string, any[]>();
    for (const s of sessions) {
      const uid = String(s.userId);
      if (!sessByUser.has(uid)) sessByUser.set(uid, []);
      sessByUser.get(uid)!.push(s);
    }

    const now = Date.now();
    const rows = users.map(u => {
      const uid = String(u._id);
      const myTasks  = tasksByAssignee.get(uid) || [];
      const myCreated = tasksByCreator.get(uid) || [];
      const tasksDone = myTasks.filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= start && new Date(t.completedAt) < end);
      const tasksCreatedToday = myCreated.filter(t => t.createdAt && new Date(t.createdAt) >= start && new Date(t.createdAt) < end);
      const tasksAcceptedToday = myTasks.filter(t =>
        String(t.estimatedBy || '') === uid
        && t.estimatedAt && new Date(t.estimatedAt) >= start && new Date(t.estimatedAt) < end
        && t.status !== 'done'      // exclude already-done so we don't double-count vs Done
      );
      const svcsDone  = svcDoneByUser.get(uid) || [];
      const brandsTouched = new Set<string>([
        ...tasksDone.map(t => String(t.clientWorkflowId || '')).filter(Boolean),
        ...svcsDone.map(s => s.wf),
      ]);

      // Session aggregates for today. We sum totalActiveMs from
      // sessions that ended today, plus the partial-window for any
      // still-open session (now - max(startTime, dayStart)).
      let workedMs = 0;
      let huddleMs = 0;
      for (const s of (sessByUser.get(uid) || [])) {
        const startedAt = new Date(s.startTime).getTime();
        const winStart  = Math.max(startedAt, start.getTime());
        const winEnd    = s.endTime ? new Date(s.endTime).getTime() : now;
        // Clamp inside today's window.
        const clamped   = Math.min(winEnd, end.getTime()) - winStart;
        if (clamped > 0) workedMs += clamped - (s.breakMs || 0);
        // huddleMs is a running counter on the session — use the
        // delta-since-day-start if the session straddles midnight.
        if (s.endTime || startedAt >= start.getTime()) {
          huddleMs += s.huddleMs || 0;
        }
        // Open huddle interval — add the partial slice since join.
        if (s.huddleJoinedAt) {
          const joined = new Date(s.huddleJoinedAt).getTime();
          const slice  = Math.min(now, end.getTime()) - Math.max(joined, start.getTime());
          if (slice > 0) huddleMs += slice;
        }
      }

      return {
        userId: uid,
        name:   u.name || u.email || '—',
        email:  u.email,
        role:   u.role,
        team:   u.team,
        avatarUrl: u.avatarUrl,
        tasksDoneToday:        tasksDone.length,
        tasksCreatedToday:     tasksCreatedToday.length,
        tasksAcceptedToday:    tasksAcceptedToday.length,
        servicesCompletedToday: svcsDone.length,
        brandsTouchedToday:    brandsTouched.size,
        hoursWorkedToday:      Math.round((workedMs / 3_600_000) * 10) / 10,
        hoursInHuddleToday:    Math.round((huddleMs / 3_600_000) * 10) / 10,
      };
    });

    // Non-admin / non-sales see only themselves.
    const visible = (role === 'admin' || role === 'sales')
      ? rows
      : rows.filter(r => r.userId === me);

    // Default sort: most productive at top (tasks done desc, then hours worked desc).
    visible.sort((a, b) => (b.tasksDoneToday - a.tasksDoneToday) || (b.hoursWorkedToday - a.hoursWorkedToday));

    res.json({
      istDate,
      windowStart: start.toISOString(),
      windowEnd:   end.toISOString(),
      rows: visible,
      totals: visible.reduce((m, r) => ({
        tasksDone:           m.tasksDone           + r.tasksDoneToday,
        tasksCreated:        m.tasksCreated        + r.tasksCreatedToday,
        tasksAccepted:       m.tasksAccepted       + r.tasksAcceptedToday,
        servicesCompleted:   m.servicesCompleted   + r.servicesCompletedToday,
        brandsTouched:       m.brandsTouched       + r.brandsTouchedToday,
        hoursWorked:         Math.round((m.hoursWorked + r.hoursWorkedToday) * 10) / 10,
        hoursInHuddle:       Math.round((m.hoursInHuddle + r.hoursInHuddleToday) * 10) / 10,
      }), { tasksDone: 0, tasksCreated: 0, tasksAccepted: 0, servicesCompleted: 0, brandsTouched: 0, hoursWorked: 0, hoursInHuddle: 0 }),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
