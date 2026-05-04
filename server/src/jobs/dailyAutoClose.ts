import cron from 'node-cron';
import Session from '../models/Session';
import { effectiveEndMs } from '../services/sessionTime';

/**
 * Daily auto-close job.
 *
 * What it does:
 *   At 23:59 IST every day, find every still-open session and force-close
 *   it. The end time we record isn't "now" — it's the session's effective
 *   end (last heartbeat + grace, or the session start if there was none).
 *   That keeps reports honest: if Rishi clocked in at 10am, closed his
 *   browser at 5pm, and never clocked out, the auto-close at 23:59 stamps
 *   his endTime as 5pm:01:30, NOT 23:59.
 *
 * Why we bother running the cron at all if heartbeats already clamp time:
 *   1. UI clarity: an "ended" session shows a clean Stop time. An "active"
 *      session shows "still working" — which would be wrong the next morning.
 *   2. Status accuracy: presence widgets across the app key off
 *      session.status === 'active'/'on_break'. Without the cron, those
 *      widgets would show stale "Working" badges all night.
 *   3. Fresh start: the next day's first clock-in creates a brand-new
 *      Session row, with its own date in the data.
 *
 * The cron schedule string '59 23 * * *' = "minute 59 of hour 23, every day."
 * The {timezone: 'Asia/Kolkata'} option makes that 23:59 IST regardless of
 * what timezone the Render server is set to (typically UTC).
 */

async function runOnce(reason: 'cron' | 'manual' = 'cron') {
  const now = Date.now();
  const open = await Session.find({ status: { $in: ['active', 'on_break'] } });
  if (!open.length) {
    console.log(`[autoClose:${reason}] no open sessions`);
    return { closed: 0 };
  }

  let closed = 0;
  for (const s of open) {
    const endMs = effectiveEndMs(s as any, now);

    // Recompute breakTime for the closed-out session so reports show a
    // sane number even for forgotten clock-outs.
    let breakMs = 0;
    for (const b of (s.breakEvents || []) as any[]) {
      if (!b.startedAt) continue;
      const bs = new Date(b.startedAt).getTime();
      const be = b.endedAt ? new Date(b.endedAt).getTime() : endMs;
      if (be > bs) breakMs += (be - bs);
    }

    s.status = 'ended';
    s.endTime = new Date(endMs);
    s.breakTime = Math.round(breakMs / 60_000);
    s.autoClosedAt = new Date(now);

    // If a break was open, close it at endMs too so totals reconcile.
    const lastBreak = (s.breakEvents || [])[((s.breakEvents || []).length - 1)];
    if (lastBreak && !lastBreak.endedAt) lastBreak.endedAt = new Date(endMs);

    await s.save();
    closed += 1;
  }

  console.log(`[autoClose:${reason}] closed ${closed} forgotten session(s)`);
  return { closed };
}

export function startDailyAutoCloseJob() {
  // 23:59 IST, every day.
  cron.schedule('59 23 * * *', () => {
    runOnce('cron').catch(err => console.error('[autoClose] failed:', err));
  }, { timezone: 'Asia/Kolkata' });

  console.log('[autoClose] cron scheduled — 23:59 IST daily');
}

// Exported for manual triggering / tests.
export { runOnce as runDailyAutoCloseNow };
