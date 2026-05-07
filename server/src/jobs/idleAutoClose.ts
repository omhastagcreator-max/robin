import cron from 'node-cron';
import Session from '../models/Session';
import User from '../models/User';
import { closeSession } from './dailyAutoClose';

/**
 * Idle auto-close.
 *
 * Runs once daily at 18:00 IST (end-of-business sweep). Finds any
 * session whose last heartbeat is older than 10 hours and force-closes
 * it. Catches the case where someone clocked in, closed their browser,
 * and forgot to clock out — but does it as a single end-of-day check
 * rather than every 10 minutes (less noisy, fewer DB writes).
 *
 * Why 10 hours of inactivity: someone genuinely working will have
 * their browser open and heartbeats firing every minute. A 10-hour gap
 * means they went home / closed the laptop ages ago. The threshold
 * lives in one constant below for easy tuning.
 *
 * Sessions with no heartbeat at all (legacy rows or rare races) are
 * ALSO closed if their startTime is older than the threshold.
 *
 * Idempotent — running it twice is a no-op once sessions are ended.
 */

const IDLE_THRESHOLD_MS = 10 * 60 * 60 * 1000; // 10h

async function runOnce(reason: 'cron' | 'manual' = 'cron') {
  const now = Date.now();
  const cutoff = new Date(now - IDLE_THRESHOLD_MS);

  // Find any open sessions whose last heartbeat OR start time is older
  // than the cutoff. We use $or so we catch legacy rows without heartbeats.
  const stale = await Session.find({
    status: { $in: ['active', 'on_break'] },
    $or: [
      { lastHeartbeatAt: { $lt: cutoff } },
      { lastHeartbeatAt: { $exists: false }, startTime: { $lt: cutoff } },
      { lastHeartbeatAt: null,                 startTime: { $lt: cutoff } },
    ],
  });

  if (!stale.length) return { closed: 0 };

  let closed = 0;
  for (const s of stale) {
    await closeSession(s, now);
    closed += 1;
  }

  // Optional: log who got auto-closed so the admin can audit later.
  if (closed > 0) {
    const userIds = Array.from(new Set(stale.map(s => String(s.userId))));
    const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
    const names = users.map(u => u.name || u.email).join(', ');
    console.log(`[idleAutoClose:${reason}] closed ${closed} idle session(s): ${names}`);
  }

  return { closed };
}

export function startIdleAutoCloseJob() {
  // 18:00 IST every day — end-of-business sweep. The cron expression
  // '0 18 * * *' = "minute 0, hour 18, every day". timezone option pins
  // it to IST regardless of where the Render server runs.
  cron.schedule('0 18 * * *', () => {
    runOnce('cron').catch(err => console.error('[idleAutoClose] failed:', err));
  }, { timezone: 'Asia/Kolkata' });
  console.log('[idleAutoClose] cron scheduled — 18:00 IST daily, threshold 10h');
}

export { runOnce as runIdleAutoCloseNow };
