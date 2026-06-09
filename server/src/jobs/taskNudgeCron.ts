import ProjectTask from '../models/ProjectTask';
import { notify } from '../services/notify';

/**
 * taskNudgeCron — every 6h, ping the task CREATOR with a "check on
 * the assignee" reminder for two situations:
 *
 *   1. PENDING ACCEPTANCE > 24h
 *      Assignee hasn't tapped Accept yet. Creator gets:
 *      "X hasn't accepted '<task>' yet. Maybe chase?"
 *
 *   2. ACCEPTED + STALE > 3 DAYS
 *      Task moved to 'pending' or 'ongoing' but no updates in 3+ days
 *      (we proxy via updatedAt because the activity log on tasks is
 *      lighter than on workflows). Creator gets:
 *      "X has had '<task>' for 3 days. Time to check in?"
 *
 * Idempotency: each ping stamps lastCreatorNudgeAt. We won't re-ping
 * for the same task within 24h. Once the task is done or the assignee
 * accepts/responds, the field is irrelevant (stays as audit history).
 *
 * Why poke the CREATOR (not the assignee): the assignee is already
 * escalated by taskEscalationCron at separate thresholds. This cron
 * complements that — it gives the creator visibility so they can
 * intervene rather than waiting for the system to escalate them.
 */

let io: any = null;
export function setNudgeIo(s: any) { io = s; }

const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;    // every 6h
const DAY_MS           = 24 * 60 * 60 * 1000;
const PENDING_THRESHOLD_MS = 24 * 60 * 60 * 1000;     // pending > 24h
const STALE_THRESHOLD_MS   = 3 * 24 * 60 * 60 * 1000; // accepted but no movement > 3d

async function tick() {
  try {
    const now = Date.now();
    const pendingCutoff = new Date(now - PENDING_THRESHOLD_MS);
    const staleCutoff   = new Date(now - STALE_THRESHOLD_MS);
    const dayAgo        = new Date(now - DAY_MS);

    // Bucket 1: pending_acceptance, created > 24h ago, no recent nudge.
    const pending = await ProjectTask.find({
      status: 'pending_acceptance',
      createdAt: { $lt: pendingCutoff },
      $or: [
        { lastCreatorNudgeAt: null },
        { lastCreatorNudgeAt: { $lt: dayAgo } },
      ],
      assignedBy: { $exists: true, $ne: null },
    }).limit(200).lean();

    // Bucket 2: pending/ongoing, untouched for > 3 days, no recent nudge.
    const stale = await ProjectTask.find({
      status: { $in: ['pending', 'ongoing'] },
      updatedAt: { $lt: staleCutoff },
      $or: [
        { lastCreatorNudgeAt: null },
        { lastCreatorNudgeAt: { $lt: dayAgo } },
      ],
      assignedBy: { $exists: true, $ne: null },
    }).limit(200).lean();

    let pinged = 0;
    for (const t of pending) {
      if (!t.assignedBy || t.assignedBy === t.assignedTo) continue;
      const days = Math.max(1, Math.round((now - new Date(t.createdAt).getTime()) / DAY_MS));
      await notify({
        io,
        organizationId: String(t.organizationId),
        userId: t.assignedBy,
        type: 'task.nudge.pending_acceptance',
        title: `Still waiting on accept: ${t.title}`,
        body:  `Assignee hasn't accepted in ${days}d. Maybe chase or reassign?`,
        entityId: String(t._id), entityType: 'task',
      });
      await ProjectTask.updateOne({ _id: t._id }, { $set: { lastCreatorNudgeAt: new Date() } });
      pinged++;
    }
    for (const t of stale) {
      if (!t.assignedBy || t.assignedBy === t.assignedTo) continue;
      const days = Math.max(1, Math.round((now - new Date(t.updatedAt).getTime()) / DAY_MS));
      await notify({
        io,
        organizationId: String(t.organizationId),
        userId: t.assignedBy,
        type: 'task.nudge.stale',
        title: `No movement on: ${t.title}`,
        body:  `${days}d since the last update. Time to check in with the assignee?`,
        entityId: String(t._id), entityType: 'task',
      });
      await ProjectTask.updateOne({ _id: t._id }, { $set: { lastCreatorNudgeAt: new Date() } });
      pinged++;
    }
    if (pinged > 0) console.log(`[task-nudge] reminded ${pinged} creator(s)`);
  } catch (err) {
    console.error('[task-nudge] tick failed:', (err as Error).message);
  }
}

export function startTaskNudgeCron() {
  setTimeout(tick, 90_000);                    // wait ~90s after boot
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[task-nudge] started (every 6h)');
}
