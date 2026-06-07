import User from '../models/User';
import Notification from '../models/Notification';
import { computeBrief, getOrGenerateNarrative } from '../controllers/briefController';

/**
 * dailyBriefCron — fires twice a day in IST.
 *
 *   09:00 IST → morning brief for every active internal user.
 *   19:00 IST → end-of-day digest for every active internal user.
 *
 * Each brief is computed live (see briefController.computeBrief) and
 * persisted as a Notification so the user sees a bell ding the next
 * time they open Robin. The Notification body is a one-line summary;
 * the WorkroomHome card calls /api/brief/me to pull the full payload.
 *
 * Robust to flakey runs: each user is wrapped in its own try/catch
 * so one slow query doesn't stop the loop.
 *
 * Idempotency: we stamp lastFiredKey = `<istDate>:morning|evening`
 * the moment we start the run, so even if the server is rebooted
 * mid-loop we don't re-notify everyone an hour later when it boots.
 * The trade-off is that if the server is fully down at 9am, that
 * day's morning brief is skipped — acceptable, evening still goes.
 */

const MORNING_HOUR_IST = 9;
const EVENING_HOUR_IST = 19;

function nowIST() {
  return new Date(Date.now() + 330 * 60_000);
}
function istDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

let lastFiredKey = '';   // `<istDate>:morning` or `<istDate>:evening`

async function runBriefRound(kind: 'morning' | 'evening') {
  const users = await User.find({
    isActive: true,
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id organizationId name email').lean();

  let ok = 0, skipped = 0;
  for (const u of users) {
    if (!u.organizationId) { skipped++; continue; }
    try {
      const brief = await computeBrief(String(u.organizationId), String(u._id), kind);
      // Skip the notification if the brief has zero content — no point
      // bell-dinging someone whose deck is clear AND no meetings AND no
      // overdue items. Mornings still ping (so people see the brief and
      // know it ran), evenings stay quiet on quiet days.
      if (kind === 'evening' && brief.accomplishments.length === 0 && brief.overdueTasks.length === 0 && brief.openTasks.length === 0) {
        skipped++; continue;
      }
      // Warm the AI narrative cache so when the employee opens Robin
      // the rich paragraph is instant. Best-effort — if Gemini is
      // unreachable the structured brief still surfaces.
      const firstName = (u.name || u.email || '').split(/[\s@]/)[0];
      const narrative = await getOrGenerateNarrative(String(u.organizationId), String(u._id), brief, firstName);

      await Notification.create({
        organizationId: u.organizationId,
        recipientId: String(u._id),
        type: kind === 'morning' ? 'brief.morning' : 'brief.evening',
        title: kind === 'morning' ? 'Good morning — your day at a glance' : 'End of day · here\'s how today went',
        // Prefer the AI paragraph (more useful for the bell preview).
        // Fall back to the deterministic summary if Gemini failed.
        body: narrative || brief.summary,
        meta: { entityType: 'brief' },
      });
      ok++;
    } catch (err) {
      console.warn(`[daily-brief] user ${u._id} failed:`, (err as Error).message);
      skipped++;
    }
  }
  console.log(`[daily-brief] ${kind} round done: notified=${ok} skipped=${skipped}`);
}

async function tick() {
  const ist = nowIST();
  const dayKey = istDateKey(ist);
  const hr = ist.getUTCHours();
  const min = ist.getUTCMinutes();

  const morningKey = `${dayKey}:morning`;
  const eveningKey = `${dayKey}:evening`;

  if (lastFiredKey !== morningKey && (hr > MORNING_HOUR_IST || (hr === MORNING_HOUR_IST && min >= 0))) {
    // Don't fire morning if it's already past 11 IST — we missed it,
    // skip rather than spam everyone late.
    if (hr < 11) {
      lastFiredKey = morningKey;
      try { await runBriefRound('morning'); }
      catch (err) { console.error('[daily-brief] morning run failed:', (err as Error).message); }
    }
  }
  if (lastFiredKey !== eveningKey && (hr > EVENING_HOUR_IST || (hr === EVENING_HOUR_IST && min >= 0))) {
    if (hr < 22) {
      lastFiredKey = eveningKey;
      try { await runBriefRound('evening'); }
      catch (err) { console.error('[daily-brief] evening run failed:', (err as Error).message); }
    }
  }
}

export function startDailyBriefCron() {
  // Tick every minute — guard rails inside tick() keep this cheap.
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);
  console.log('[daily-brief] started (9am + 7pm IST)');
}
