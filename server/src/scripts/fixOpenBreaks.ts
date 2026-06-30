/**
 * fixOpenBreaks.ts — owner ask (June 2026): "Why is my break showing
 * 253 hours when I didn't take any?"
 *
 * Root cause: a break event was opened (user clicked Break) and never
 * closed (laptop lid shut, tab killed, network died). Each subsequent
 * page load extends (now − startedAt) until the topbar reports days
 * of break time.
 *
 * This script walks every still-open break event on every active /
 * on_break session and closes it at the LATER of:
 *   (a) breakStart + 4 hours  (the cap — no legitimate break is longer)
 *   (b) lastHeartbeatAt        (when the user was last present)
 *
 * Whichever is sooner = closing time. Status is flipped to 'active'
 * for sessions that were on_break, so the next heartbeat / login
 * resumes the work timer cleanly.
 *
 * Also caps any CLOSED break event whose recorded duration exceeds 4
 * hours back down to 4h — these represent the same bug rectified
 * after the fact (auto-close cron ran), but the inflated duration
 * stuck around in breakTime / reports.
 *
 * Idempotent — safe to re-run any time. Defaults to dry-run; pass
 * --apply to actually update.
 *
 * Usage:
 *   DRY RUN:  npm run fix-open-breaks
 *   APPLY:    npm run fix-open-breaks -- --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Session from '../models/Session';

const APPLY = process.argv.includes('--apply');
const MAX_BREAK_MS = 4 * 60 * 60 * 1000;   // 4h hard cap per break event

function fmtH(ms: number) {
  return (ms / 3_600_000).toFixed(1) + 'h';
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`[fix-open-breaks] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const now = Date.now();
  const sessions = await Session.find({
    status: { $in: ['active', 'on_break'] },
  });

  let openClosed = 0;
  let runawayCapped = 0;
  let sessionsTouched = 0;
  let totalShavedMs = 0;

  for (const s of sessions) {
    let touched = false;
    const lastHb = s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).getTime() : 0;

    for (const b of s.breakEvents || []) {
      const start = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      if (!start) continue;

      if (!b.endedAt) {
        // Open break. Decide a fair end time.
        // Prefer lastHeartbeatAt (user was last present then) if it's
        // after the break started; otherwise cap at startedAt + 4h.
        const cap = start + MAX_BREAK_MS;
        const fairEnd = Math.min(
          Math.max(start + 1, lastHb || (start + MAX_BREAK_MS)),
          cap,
        );
        const before = now - start;
        const after  = fairEnd - start;
        if (before > after + 60_000) {
          // Significant shave — report it.
          console.log(
            `[fix-open-breaks] OPEN  user=${s.userId} session=${s._id} ` +
            `breakStart=${new Date(start).toISOString()} ` +
            `→ closing at ${new Date(fairEnd).toISOString()} ` +
            `(was running ${fmtH(before)}, capped to ${fmtH(after)})`,
          );
        }
        b.endedAt = new Date(fairEnd);
        openClosed += 1;
        touched = true;
        totalShavedMs += Math.max(0, before - after);
      } else {
        // Closed break — cap if longer than 4h.
        const end = new Date(b.endedAt).getTime();
        const dur = end - start;
        if (dur > MAX_BREAK_MS) {
          const newEnd = start + MAX_BREAK_MS;
          console.log(
            `[fix-open-breaks] LONG  user=${s.userId} session=${s._id} ` +
            `duration ${fmtH(dur)} → capping to ${fmtH(MAX_BREAK_MS)}`,
          );
          b.endedAt = new Date(newEnd);
          runawayCapped += 1;
          touched = true;
          totalShavedMs += (dur - MAX_BREAK_MS);
        }
      }
    }

    if (touched) {
      // If we just closed the most recent open break and the session
      // was 'on_break', flip back to 'active' so the user resumes.
      if (s.status === 'on_break') {
        s.status = 'active';
      }
      // Recompute breakTime so the next session-end / report agrees.
      const totalBreakMs = (s.breakEvents || []).reduce((sum: number, b: any) => {
        if (b.startedAt && b.endedAt) return sum + (new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime());
        return sum;
      }, 0);
      s.breakTime = Math.round(totalBreakMs / 60000);
      sessionsTouched += 1;
      if (APPLY) await s.save();
    }
  }

  console.log('\n──── summary ────');
  console.log(`Sessions scanned   : ${sessions.length}`);
  console.log(`Sessions touched   : ${sessionsTouched}`);
  console.log(`Open breaks closed : ${openClosed}`);
  console.log(`Long breaks capped : ${runawayCapped}`);
  console.log(`Total time shaved  : ${fmtH(totalShavedMs)}`);
  if (!APPLY) console.log('\nDRY RUN — nothing was saved. Re-run with --apply to commit.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[fix-open-breaks] FATAL', err);
  process.exit(1);
});
