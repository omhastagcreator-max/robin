/**
 * inspectSession.ts — print exactly how a user's live session is being
 * counted, and optionally repair a runaway awayMs.
 *
 * Born from "Om logged in at 9:29, took a 1h break, timer shows 5:05"
 * (July 2026): background-tab heartbeat throttling logged hours of
 * phantom away-time. This script shows every input of the worked-time
 * formula so the culprit is visible in one glance, and can reset awayMs
 * to a correct value.
 *
 * Usage (from server/):
 *   INSPECT:      EMAIL=om@hastag.in npm run inspect-session
 *   REPAIR away:  EMAIL=om@hastag.in SET_AWAY_MINS=0 npm run inspect-session -- --apply
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
  for (const b of session.breakEvents || []) {
    const s = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    const e = b.endedAt ? new Date(b.endedAt).getTime() : null;
    console.log(`  · ${IST(s)} → ${e ? IST(e) : 'OPEN'}  (${fmtH((e || now) - s)})`);
  }
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
  await mongoose.disconnect();
}

main().catch(err => { console.error('[inspect-session] FATAL', err.message || err); process.exit(1); });
