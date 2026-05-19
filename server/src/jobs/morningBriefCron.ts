import Organization from '../models/Organization';
import { buildAndSaveMorningBrief } from '../controllers/aiAutomationController';

/**
 * Daily morning-brief generator — fires at 08:00 IST every day.
 *
 * For each organisation we know about, we build yesterday's snapshot
 * (new leads, hot leads, blocked workflows, open issues, sessions
 * closed, tasks completed, deals won) and ask Gemini for an
 * executive-summary bullet list. Saved to MorningBrief and surfaced
 * on the admin dashboard as a hero card.
 *
 * Robust to flaky network: each org runs in its own try/catch; one
 * failing org doesn't stop the next.
 *
 * Implementation detail: we use a simple setInterval that ticks once a
 * minute and checks "is it 08:00 IST yet today?". The MorningBrief
 * upsert key is (organizationId, istDate) so even if the server
 * restarts mid-day, the brief is only generated once per day per org.
 */

const HOUR_IST = 8;       // 08:00
const MINUTE_IST = 0;

function nowIST() {
  return new Date(Date.now() + 330 * 60_000);
}
function istDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

let lastFiredKey = '';

async function tick() {
  const ist = nowIST();
  const todayKey = istDateKey(ist);
  if (lastFiredKey === todayKey) return;                 // already ran for today
  if (ist.getUTCHours() < HOUR_IST) return;              // too early
  if (ist.getUTCHours() === HOUR_IST && ist.getUTCMinutes() < MINUTE_IST) return;

  lastFiredKey = todayKey;
  try {
    const orgs = await Organization.find().select('_id name').lean();
    for (const o of orgs) {
      try {
        await buildAndSaveMorningBrief(String(o._id), 'cron');
        console.log(`[morning-brief] generated for ${o.name || o._id}`);
      } catch (err) {
        console.error(`[morning-brief] org ${o._id} failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[morning-brief] tick failed:', (err as Error).message);
    // Don't stamp lastFiredKey on outright failure — let next tick retry.
    lastFiredKey = '';
  }
}

export function startMorningBriefCron() {
  // Tick once a minute. Cheap; the guard rails inside tick() keep this
  // idempotent. First tick after startup also catches "server started at
  // 8:30am, we missed the 8:00 mark" by checking the IST hour.
  tick();
  setInterval(tick, 60_000);
  console.log('[morning-brief] cron armed — will fire at 08:00 IST daily.');
}
