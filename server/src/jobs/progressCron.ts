/**
 * progressCron — freezes last week's employee progress snapshots.
 *
 * Ticks every minute; at 00:30 IST each Monday it computes and stores
 * the just-ended week (Mon–Sun) for every internal staff member of
 * every organization, marking the docs provisional=false. The live API
 * keeps recomputing the CURRENT week on demand — this cron is what
 * turns the in-flight week into a permanent history point for the
 * improvement trend line.
 *
 * Idempotent: snapshots are upserts, so a missed tick (Render cold
 * start, deploy at 00:30) self-heals — the window check accepts the
 * whole 00:30–01:29 hour and a `lastRunWeek` guard stops double runs.
 */
import Organization from '../models/Organization';
import { weekStartMs, fmtISTDate, snapshotWeekForOrg } from '../services/progressReport';

const IST_OFFSET_MS = 330 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let lastRunWeek = '';

export function startProgressCron() {
  setInterval(async () => {
    try {
      const ist = new Date(Date.now() + IST_OFFSET_MS);
      const isMonday = ist.getUTCDay() === 1;
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (!isMonday || mins < 30 || mins >= 90) return;   // 00:30–01:29 IST window

      const lastWeek = weekStartMs() - WEEK_MS;
      const key = fmtISTDate(lastWeek);
      if (lastRunWeek === key) return;                     // already ran this Monday
      lastRunWeek = key;

      const orgs = await Organization.find({}).select('_id').lean();
      for (const org of orgs) {
        const n = await snapshotWeekForOrg(org._id, lastWeek, false);
        console.log(`[progress-cron] week ${key} · org ${org._id} · ${n} staff snapshotted`);
      }
    } catch (err) {
      console.error('[progress-cron] failed', (err as Error).message);
      lastRunWeek = '';                                    // allow retry next tick
    }
  }, 60_000);
  console.log('[progress-cron] armed — Mondays 00:30 IST');
}
