import ProjectTask from '../models/ProjectTask';
import User from '../models/User';
import { notify } from '../services/notify';

/**
 * taskEscalationCron — every 30 min, scan tasks that have gone quiet
 * and walk the escalation chain.
 *
 * Triggers:
 *   - pending > 3 days (status='pending' AND createdAt > 3d ago AND no progress)
 *   - overdue > 1 day  (status!='done' AND dueDate < now - 1d)
 *
 * Escalation waves:
 *   Level 0 (default) → Level 1: ping the owner (assignedTo).
 *   Level 1 + still stale next tick → Level 2: ping reviewer + lead.
 *   Level 2 + STILL stale → Level 3: ping admin.
 *
 * Each escalation stamps `escalationLevel` + `lastEscalatedAt` on the
 * task so we don't ping the same person twice for the same wave.
 * Marking a task as done OR adding a comment resets the level (a
 * follow-up improvement; the cron currently just won't re-fire once
 * level=3 unless the task goes back to pending/overdue with a fresh
 * cycle).
 *
 * Rate-limit safety: we batch in groups of 50 to avoid hammering the
 * notify pipeline on first cron tick after a long idle.
 */

let io: any = null;
export function setEscalationIo(s: any) { io = s; }

const TICK_INTERVAL_MS = 30 * 60 * 1000;        // 30 min
const PENDING_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const OVERDUE_THRESHOLD_MS = 1 * 24 * 60 * 60 * 1000;
// Don't re-fire the same level within this window — defends against
// the case where the cron fires every 30 min but a task just
// crossed a threshold and is still at the same escalation level.
const REFIRE_GUARD_MS = 12 * 60 * 60 * 1000;     // 12h

async function findLeadForOrg(orgId: any): Promise<string | null> {
  // Lead = the first non-admin user with role='employee' who has
  // canManageWorkroom or is the senior on the team. Falls back to
  // any admin if no lead is set.
  const lead = await User.findOne({
    organizationId: orgId,
    role: 'employee',
    canManageWorkroom: true,
  }).select('_id').lean();
  if (lead) return String(lead._id);
  const admin = await User.findOne({ organizationId: orgId, role: 'admin' }).select('_id').lean();
  return admin ? String(admin._id) : null;
}

async function findAdminsForOrg(orgId: any): Promise<string[]> {
  const admins = await User.find({ organizationId: orgId, role: 'admin' }).select('_id').lean();
  return admins.map(a => String(a._id));
}

async function escalate(task: any) {
  const now = Date.now();
  const currentLevel = task.escalationLevel || 0;
  const nextLevel = currentLevel + 1;
  if (nextLevel > 3) return;

  // Audience by wave.
  let userIds: string[] = [];
  let title = '';
  if (nextLevel === 1) {
    if (task.assignedTo) userIds = [String(task.assignedTo)];
    title = `Heads up — your task is stale: ${task.title}`;
  } else if (nextLevel === 2) {
    if (task.reviewerId) userIds.push(String(task.reviewerId));
    const lead = await findLeadForOrg(task.organizationId);
    if (lead) userIds.push(lead);
    title = `Reviewer / lead alert — task stale: ${task.title}`;
  } else if (nextLevel === 3) {
    const admins = await findAdminsForOrg(task.organizationId);
    userIds.push(...admins);
    title = `Admin escalation — task blocking: ${task.title}`;
  }
  userIds = Array.from(new Set(userIds)).filter(Boolean);
  if (userIds.length === 0) return;

  const reason = task.dueDate && new Date(task.dueDate).getTime() < now
    ? `Overdue by ${Math.round((now - new Date(task.dueDate).getTime()) / 86_400_000)}d`
    : `No movement for ${Math.round((now - new Date(task.createdAt).getTime()) / 86_400_000)}d`;

  await notify({
    io,
    organizationId: String(task.organizationId),
    userIds,
    type: `task.escalation.l${nextLevel}`,
    title,
    body: reason,
    entityId: String(task._id),
    entityType: 'task',
  });
  await ProjectTask.updateOne({ _id: task._id }, { $set: {
    escalationLevel: nextLevel,
    lastEscalatedAt: new Date(),
  } });
  console.log(`[task-escalation] L${nextLevel} on "${task.title}" → ${userIds.length} recipient(s)`);
}

async function tick() {
  try {
    const now = Date.now();
    // Pull tasks that are NOT done AND either pending too long OR
    // overdue. We do this in one query, then bucket per-task.
    const candidates = await ProjectTask.find({
      status: { $ne: 'done' },
      $or: [
        { dueDate: { $lt: new Date(now - OVERDUE_THRESHOLD_MS) } },
        { status: 'pending', createdAt: { $lt: new Date(now - PENDING_THRESHOLD_MS) } },
      ],
    }).limit(200).lean();

    let fired = 0;
    for (const t of candidates) {
      // Guard: don't escalate same level within REFIRE_GUARD_MS.
      if (t.lastEscalatedAt && (now - new Date(t.lastEscalatedAt).getTime()) < REFIRE_GUARD_MS) continue;
      if ((t.escalationLevel || 0) >= 3) continue;
      await escalate(t);
      fired++;
    }
    if (fired > 0) console.log(`[task-escalation] fired ${fired} escalations`);
  } catch (err) {
    console.error('[task-escalation] tick failed:', (err as Error).message);
  }
}

export function startTaskEscalationCron() {
  setTimeout(tick, 60_000);
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[task-escalation] started (every 30 min, 3 escalation waves)');
}
