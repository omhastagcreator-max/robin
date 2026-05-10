import cron from 'node-cron';
import Session from '../models/Session';
import User from '../models/User';
import Notification from '../models/Notification';
import { closeSession } from './dailyAutoClose';

/**
 * End-of-day inactivity sweep.
 *
 * Runs once at 20:00 IST every day. Finds every session whose last
 * heartbeat is older than 60 minutes (configurable) and force-closes it.
 *
 * Why this exists: people forget to log out at end of day. Without this
 * sweep, their session stays "active" all night, pollutes presence
 * widgets, and inflates the next morning's "still working" badge until
 * the midnight cleanup. Running at 8 PM with a 1-hour idle window means:
 *   • Anyone whose last activity was before 7 PM gets their day ended now.
 *   • Anyone still actively working at 8 PM (heartbeats firing) is left
 *     alone — they'll get auto-closed at midnight if they really forget.
 *   • The endTime stamped is their LAST heartbeat, not "now" — accurate
 *     worked time, not inflated.
 *
 * On-break sessions are excluded — break is an intentional pause and the
 * user is expected to come back.
 *
 * Sends a notification so the user knows why they got logged out.
 *
 * Tunable via env:
 *   IDLE_INACTIVITY_MIN  — minutes of idle before auto-end (default 60)
 *   IDLE_CHECK_CRON      — cron expression (default "0 20 * * *" = 20:00 IST)
 */

const DEFAULT_IDLE_MIN   = 60;
const DEFAULT_CHECK_CRON = '0 20 * * *';   // 20:00 IST

async function runOnce(reason: 'cron' | 'manual' = 'cron') {
  const idleMin = Number(process.env.IDLE_INACTIVITY_MIN) || DEFAULT_IDLE_MIN;
  const idleMs  = idleMin * 60 * 1000;
  const now     = Date.now();
  const cutoff  = new Date(now - idleMs);

  // Active sessions only — don't end on-break sessions.
  // Sessions with no heartbeat at all are also caught (legacy / race rows)
  // if their start time is older than the cutoff.
  const stale = await Session.find({
    status: 'active',
    $or: [
      { lastHeartbeatAt: { $lt: cutoff, $ne: null } },
      { lastHeartbeatAt: { $exists: false }, startTime: { $lt: cutoff } },
      { lastHeartbeatAt: null,                 startTime: { $lt: cutoff } },
    ],
  });

  if (!stale.length) {
    console.log(`[idleAutoClose:${reason}] no idle sessions (threshold ${idleMin}m)`);
    return { closed: 0 };
  }

  let closed = 0;
  for (const s of stale) {
    await closeSession(s, now);

    // Notify the user — best-effort, don't fail the close if this errors.
    try {
      await Notification.create({
        recipientId: String(s.userId),
        userId:      String(s.userId),
        title: 'Robin logged you out for the day',
        message: `We didn't see any activity for over ${idleMin} minutes, so we ended your day to keep your time honest. If you're still working, just log back in.`,
        type: 'info',
      });
    } catch { /* ignore */ }

    closed += 1;
  }

  // Audit log who got auto-closed
  const userIds = Array.from(new Set(stale.map(s => String(s.userId))));
  const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
  const names = users.map(u => u.name || u.email).join(', ');
  console.log(`[idleAutoClose:${reason}] closed ${closed} idle session(s) (>${idleMin}m): ${names}`);

  return { closed };
}

export function startIdleAutoCloseJob() {
  const expr     = process.env.IDLE_CHECK_CRON    || DEFAULT_CHECK_CRON;
  const idleMin  = Number(process.env.IDLE_INACTIVITY_MIN) || DEFAULT_IDLE_MIN;
  cron.schedule(expr, () => {
    runOnce('cron').catch(err => console.error('[idleAutoClose] failed:', err));
  }, { timezone: 'Asia/Kolkata' });
  console.log(`[idleAutoClose] scheduled "${expr}" IST — threshold ${idleMin}m`);
}

export { runOnce as runIdleAutoCloseNow };
