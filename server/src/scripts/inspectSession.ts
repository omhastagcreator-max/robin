/**
 * inspectSession.ts — print exactly how a user's live session is being
 * counted, and optionally repair a runaway awayMs OR remove one
 * erroneous break event.
 *
 * Born from "Om logged in at 9:29, took a 1h break, timer shows 5:05"
 * (July 2026): background-tab heartbeat throttling logged hours of
 * phantom away-time. This script shows every input of the worked-time
 * formula so the culprit is visible in one glance, and can reset awayMs
 * to a correct value.
 *
 * Extended Aug 2026 — "I didn't take a break today but it's showing a
 * 2hr break" (Om): awayMs was 0, so the away-time repair didn't apply —
 * the real issue was a genuine (wrong) entry in breakEvents itself, e.g.
 * from an accidental double-tap on Break or some other stray write.
 * REMOVE_BREAK_INDEX drops exactly one break event by the [N] index
 * shown in the INSPECT output, leaving every other (real) break intact.
 *
 * SET_BREAK_MINS goes one step further than REMOVE_BREAK_INDEX — instead
 * of picking which single event to drop, it collapses the WHOLE array
 * into one clean entry of exactly the stated length (anchored at the
 * last existing break's start time). Use this when the employee's own
 * account of "how long" doesn't match ANY single recorded event (e.g.
 * two bad entries totaling 1h57m when only ~10min actually happened).
 *
 * Usage (from server/):
 *   INSPECT:      EMAIL=om@hastag.in npm run inspect-session
 *   REPAIR away:  EMAIL=om@hastag.in SET_AWAY_MINS=0 npm run inspect-session -- --apply
 *   REPAIR break: EMAIL=om@hastag.in REMOVE_BREAK_INDEX=0 npm run inspect-session -- --apply
 *                 (index = the [N] printed next to the break event in INSPECT output)
 *   SET total:    EMAIL=om@hastag.in SET_BREAK_MINS=10 npm run inspect-session -- --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Session from '../models/Session';
import User from '../models/User';
import { sessionTotals, huddleTotalMs, STANDARD_BREAK_MS } from '../services/sessionTime';

const APPLY = process.argv.includes('--apply');
const IST = (d: Date | string | number) =>
  new Date(new Date(d).getTime() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 19) + ' IST';
const fmtH = (ms: number) => {
  const mins = Math.round(ms / 60_000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};

async function main() {
  const email = process.env.EMAIL;
  if (!email) throw new Error('Set EMAIL=<user email>');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('_id name email');
  if (!user) throw new Error(`No user with email ${email}`);

  const session = await Session.findOne({
    userId: String(user._id),
    status: { $in: ['active', 'on_break'] },
  });
  if (!session) throw new Error('No live session for this user.');

  const now = Date.now();
  const t = sessionTotals(session as any, 0, now);
  const grossMs = now - new Date(session.startTime).getTime();

  console.log(`\n── Session inspect · ${user.name || user.email} ─────────────`);
  console.log(`session      : ${session._id}  status=${session.status}`);
  console.log(`startTime    : ${IST(session.startTime)}`);
  console.log(`lastHeartbeat: ${session.lastHeartbeatAt ? IST(session.lastHeartbeatAt) : '—'}`);
  console.log(`now          : ${IST(now)}  (gross elapsed ${fmtH(grossMs)})`);
  console.log(`\nbreakEvents  : ${(session.breakEvents || []).length}`);
  (session.breakEvents || []).forEach((b: any, i: number) => {
    const s = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    const e = b.endedAt ? new Date(b.endedAt).getTime() : null;
    console.log(`  [${i}] ${IST(s)} → ${e ? IST(e) : 'OPEN'}  (${fmtH((e || now) - s)})`);
  });
  console.log(`\n── Worked-time formula inputs ────────────────────────────`);
  console.log(`workedMs (window)   : ${fmtH(t.workedMs)}`);
  console.log(`breakMs             : ${fmtH(t.breakMs)}  (allowance ${fmtH(STANDARD_BREAK_MS)})`);
  console.log(`breakPenaltyMs      : ${fmtH(t.breakPenaltyMs)}  ← only break BEYOND 1h deducts`);
  console.log(`awayMs (raw on doc) : ${fmtH(session.awayMs || 0)}  ← phantom-away suspect`);
  console.log(`awayMs (applied)    : ${fmtH(t.awayMs)}`);
  console.log(`huddleMs            : ${fmtH(huddleTotalMs(session as any, now))}`);
  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`ACTIVE (worked)     : ${fmtH(t.activeMs)}   ← what reports/timer show`);

  const setAway = process.env.SET_AWAY_MINS;
  if (setAway !== undefined) {
    const mins = Math.max(0, parseInt(setAway, 10) || 0);
    console.log(`\nRepair: set awayMs ${fmtH(session.awayMs || 0)} → ${fmtH(mins * 60_000)}`);
    if (APPLY) {
      session.awayMs = mins * 60_000;
      await session.save();
      console.log('SAVED ✔ — user should refresh Robin.');
    } else {
      console.log('DRY RUN — re-run with -- --apply to save.');
    }
  }

  // ── Repair: remove ONE erroneous break event by its printed [N] index ──
  // Aug 2026 — "I didn't take a break today but it's showing a 2hr break."
  // Surgical: drops exactly the one bad entry, every other break the user
  // actually took (e.g. a short lunch) is left untouched.
  const removeIdx = process.env.REMOVE_BREAK_INDEX;
  if (removeIdx !== undefined) {
    const idx = parseInt(removeIdx, 10);
    const events = (session.breakEvents || []) as any[];
    if (Number.isNaN(idx) || idx < 0 || idx >= events.length) {
      console.log(`\nRepair: REMOVE_BREAK_INDEX=${removeIdx} is out of range (0–${events.length - 1}).`);
    } else {
      const target = events[idx];
      const s = target.startedAt ? new Date(target.startedAt).getTime() : 0;
      const e = target.endedAt ? new Date(target.endedAt).getTime() : null;
      console.log(`\nRepair: remove breakEvent [${idx}] ${IST(s)} → ${e ? IST(e) : 'OPEN'} (${fmtH((e || now) - s)})`);
      if (APPLY) {
        events.splice(idx, 1);
        const totalBreakMs = events.reduce((sum: number, b: any) => {
          if (b.startedAt && b.endedAt) return sum + (new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime());
          return sum;
        }, 0);
        session.breakTime = Math.round(totalBreakMs / 60000);
        // Re-flip to active if this removal cleared what made status
        // 'on_break' in the first place (defensive — normally the
        // targeted entry is already closed, but covers the OPEN case too).
        if (session.status === 'on_break' && !events.some(b => !b.endedAt)) {
          session.status = 'active';
        }
        session.markModified('breakEvents');
        await session.save();
        console.log('SAVED ✔ — user should refresh Robin.');
      } else {
        console.log('DRY RUN — re-run with -- --apply to save.');
      }
    }
  }

  // ── Repair: collapse ALL of today's break events into exactly N
  // minutes ────────────────────────────────────────────────────────────
  // Aug 2026 — owner correction: recorded total (1h57m across two
  // events) didn't match what the employee actually remembers taking
  // (~10min). Rather than guess which single event is "the real one,"
  // this replaces the whole array with ONE clean entry of the stated
  // length, anchored at the LAST existing break's start time (closest
  // thing to a real timestamp for when the actual break began) — or
  // `now - N minutes` if there were no break events at all.
  const setBreak = process.env.SET_BREAK_MINS;
  if (setBreak !== undefined) {
    const mins = Math.max(0, parseInt(setBreak, 10) || 0);
    const events = (session.breakEvents || []) as any[];
    const anchorStart = events.length
      ? new Date(events[events.length - 1].startedAt).getTime()
      : now - mins * 60_000;
    const anchorEnd = anchorStart + mins * 60_000;
    console.log(`\nRepair: replace ${events.length} break event(s) (total ${fmtH(t.breakMs)}) with ONE entry of ${fmtH(mins * 60_000)}:`);
    console.log(`  ${IST(anchorStart)} → ${IST(anchorEnd)}`);
    if (APPLY) {
      session.breakEvents = [{ startedAt: new Date(anchorStart), endedAt: new Date(anchorEnd) }] as any;
      session.breakTime = mins;
      if (session.status === 'on_break') session.status = 'active';
      session.markModified('breakEvents');
      await session.save();
      console.log('SAVED ✔ — user should refresh Robin.');
    } else {
      console.log('DRY RUN — re-run with -- --apply to save.');
    }
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error('[inspect-session] FATAL', err.message || err); process.exit(1); });
