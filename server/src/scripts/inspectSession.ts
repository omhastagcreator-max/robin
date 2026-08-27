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
 * SET_START_IST / SET_END_IST (Aug 2026) set the day's clock times
 * directly, for when someone reports the whole day wrong rather than one
 * bad break — e.g. "logged in 9:13, 1:30 break, 7:30 work." Worked time is
 * always elapsed − break − away, so a fixed worked total needs a fixed
 * END too; setting only the start on a live session leaves it ticking up.
 *
 * Usage (from server/):
 *   REPORT:       EMAIL=om@hastag.in DAYS=7 npm run inspect-session
 *                 (read-only multi-day breakdown — run this FIRST)
 *   INSPECT:      EMAIL=om@hastag.in npm run inspect-session
 *   REPAIR away:  EMAIL=om@hastag.in SET_AWAY_MINS=0 npm run inspect-session -- --apply
 *   REPAIR break: EMAIL=om@hastag.in REMOVE_BREAK_INDEX=0 npm run inspect-session -- --apply
 *                 (index = the [N] printed next to the break event in INSPECT output)
 *   SET total:    EMAIL=om@hastag.in SET_BREAK_MINS=10 npm run inspect-session -- --apply
 *   GO ON BREAK:  EMAIL=om@hastag.in START_BREAK_AGO_MINS=30 npm run inspect-session -- --apply
 *                 (opens a LIVE break started 30m ago; reopens the session
 *                  if it had been closed, since the two can't coexist)
 *   WHOLE DAY:    EMAIL=om@hastag.in SET_START_IST=09:13 SET_END_IST=18:13 \
 *                   SET_BREAK_MINS=90 SET_AWAY_MINS=0 npm run inspect-session -- --apply
 *   (add INCLUDE_ENDED=1 to re-target a session already closed)
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

  // By default we only touch a LIVE session (that's the common repair
  // case). INCLUDE_ENDED=1 widens it to today's session whatever its
  // status — needed once SET_END_IST has closed it, so a follow-up run
  // can still inspect or re-correct the same day.
  const includeEnded = process.env.INCLUDE_ENDED === '1';
  const istNow = new Date(Date.now() + 330 * 60_000);
  const istMidnightUtc = new Date(Date.UTC(
    istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(),
  ).valueOf() - 330 * 60_000);

  // ── DAYS=<n> — multi-day report before touching anything ────────────
  // Aug 2026 — "fetch Om's full report first." Prints every session in
  // the window with the same worked-time maths the app uses, so a repair
  // is made against real numbers instead of a guess. Read-only: when DAYS
  // is set the script prints and exits, ignoring every repair flag.
  const days = parseInt(process.env.DAYS || '', 10);
  if (!Number.isNaN(days) && days > 0) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await Session.find({ userId: String(user._id), startTime: { $gte: since } })
      .sort({ startTime: -1 });
    console.log(`\n── ${user.name || user.email} · last ${days} day(s) · ${rows.length} session(s) ──`);
    let totWorked = 0, totBreak = 0;
    for (const s of rows) {
      const t = sessionTotals(s as any, 0, Date.now());
      const isToday = new Date(s.startTime).getTime() >= istMidnightUtc.getTime();
      totWorked += t.activeMs; totBreak += t.breakMs;
      console.log(`\n${isToday ? '>>> TODAY' : '        '}  ${String(s._id)}  status=${s.status}`);
      console.log(`   start   : ${IST(s.startTime)}`);
      console.log(`   end     : ${s.endTime ? IST(s.endTime) : '— still open'}`);
      console.log(`   elapsed ${fmtH(t.workedMs)} · break ${fmtH(t.breakMs)} · away ${fmtH(t.awayMs)}  →  WORKED ${fmtH(t.activeMs)}`);
      (s.breakEvents || []).forEach((b: any, i: number) => {
        const bs = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        const be = b.endedAt ? new Date(b.endedAt).getTime() : null;
        console.log(`     [${i}] ${IST(bs)} → ${be ? IST(be) : 'OPEN'}  (${fmtH((be || Date.now()) - bs)})`);
      });
    }
    console.log(`\n   TOTAL worked ${fmtH(totWorked)} · total break ${fmtH(totBreak)}`);
    console.log('   (read-only report — repair flags are ignored while DAYS is set)\n');
    await mongoose.disconnect();
    return;
  }

  const session = await Session.findOne(
    includeEnded
      ? { userId: String(user._id), startTime: { $gte: istMidnightUtc } }
      : { userId: String(user._id), status: { $in: ['active', 'on_break'] } },
  ).sort({ startTime: -1 });
  if (!session) {
    throw new Error(includeEnded
      ? 'No session found for this user today.'
      : 'No live session for this user. (Add INCLUDE_ENDED=1 to target today\'s ended session.)');
  }

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

  // ── Repair: put the user ON BREAK, started N minutes ago ────────────
  // Aug 2026 — owner: "add Om on break from last 30 mins." Distinct from
  // SET_BREAK_MINS, which collapses history into one CLOSED entry — this
  // opens a LIVE break (no endedAt) so the app shows him on break right
  // now and his timer is paused, exactly as if he'd pressed Break 30
  // minutes ago.
  //
  // Consistency guard: an ended session with an open break is a nonsense
  // state the UI can't render (and the 4h auto-heal would later "fix" in
  // a surprising way). So if the session was closed, this reopens it —
  // clearing endTime and refreshing lastHeartbeatAt, since a stale
  // heartbeat would otherwise clamp the counted time short.
  const startBreakAgo = process.env.START_BREAK_AGO_MINS;
  if (startBreakAgo !== undefined) {
    const mins = Math.max(0, parseInt(startBreakAgo, 10) || 0);
    const startedAt = new Date(now - mins * 60_000);
    const events = (session.breakEvents || []) as any[];
    const alreadyOpen = events.find(b => !b.endedAt);

    console.log(`\nRepair: open a live break started ${mins}m ago (${IST(startedAt)})`);
    if (alreadyOpen) {
      console.log(`  NOTE: a break is already open (started ${IST(alreadyOpen.startedAt)}) — its start will be moved instead of adding a second one.`);
    }
    if (session.endTime) {
      console.log(`  NOTE: session was ended at ${IST(session.endTime)} — reopening it, since a closed session can't hold a live break.`);
    }
    if (startedAt.getTime() < new Date(session.startTime).getTime()) {
      console.log('  ⚠️  That start time is BEFORE the session began — refusing.');
    } else if (APPLY) {
      if (alreadyOpen) alreadyOpen.startedAt = startedAt;
      else events.push({ startedAt, endedAt: null });
      session.breakEvents = events as any;
      session.endTime = undefined as any;
      session.autoClosedAt = undefined as any;
      session.status = 'on_break';
      session.lastHeartbeatAt = new Date(now);
      session.markModified('breakEvents');
      await session.save();
      console.log('SAVED ✔ — Om now shows as on break; refresh Robin.');
    } else {
      console.log('DRY RUN — re-run with -- --apply to save.');
    }
  }

  // ── Repair: set the day's START and/or END clock times (IST) ─────────
  // Aug 2026 — owner: "Om logged in 9:13, add 1:30 hrs of break and 7:30
  // hr of work." Those three numbers only reconcile as a CLOSED day:
  // worked = elapsed − break, so 7:30 worked + 1:30 break = 9:00 elapsed
  // = 09:13 → 18:13. Setting the start alone on a still-running session
  // can't produce a fixed 7:30 — it would just keep ticking up.
  //
  // Use together with SET_BREAK_MINS / SET_AWAY_MINS, e.g.:
  //   EMAIL=om@hastag.in SET_START_IST=09:13 SET_END_IST=18:13 \
  //     SET_BREAK_MINS=90 SET_AWAY_MINS=0 npm run inspect-session -- --apply
  //
  // Both take HH:MM in IST and are anchored to the session's own calendar
  // day, so this never silently moves a session to a different date.
  const parseIstOnSessionDay = (hhmm: string): Date | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    // The session's start date, expressed in IST.
    const istStart = new Date(new Date(session.startTime).getTime() + 330 * 60_000);
    const utcMs = Date.UTC(
      istStart.getUTCFullYear(), istStart.getUTCMonth(), istStart.getUTCDate(), h, mi, 0,
    ) - 330 * 60_000;
    return new Date(utcMs);
  };

  const setStart = process.env.SET_START_IST;
  const setEnd   = process.env.SET_END_IST;

  if (setStart || setEnd) {
    let newStart = session.startTime ? new Date(session.startTime) : null;
    let newEnd   = session.endTime ? new Date(session.endTime) : null;

    if (setStart) {
      const d = parseIstOnSessionDay(setStart);
      if (!d) { console.log(`\nSET_START_IST="${setStart}" is not HH:MM — skipping.`); }
      else { newStart = d; console.log(`\nRepair: startTime ${IST(session.startTime)} → ${IST(d)}`); }
    }
    if (setEnd) {
      const d = parseIstOnSessionDay(setEnd);
      if (!d) { console.log(`SET_END_IST="${setEnd}" is not HH:MM — skipping.`); }
      else { newEnd = d; console.log(`Repair: endTime ${session.endTime ? IST(session.endTime) : '— (still open)'} → ${IST(d)}  (session will be marked ended)`); }
    }

    if (newStart && newEnd && newEnd.getTime() <= newStart.getTime()) {
      console.log('⚠️  End is not after start — refusing to write these times.');
    } else {
      const elapsed = newStart && newEnd ? newEnd.getTime() - newStart.getTime() : null;
      if (elapsed != null) {
        const breakMs = (session.breakEvents || []).reduce((sum: number, b: any) => (
          b.startedAt && b.endedAt ? sum + (new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime()) : sum
        ), 0);
        console.log(`  → elapsed ${fmtH(elapsed)} − break ${fmtH(breakMs)} − away ${fmtH(session.awayMs || 0)} = worked ${fmtH(Math.max(0, elapsed - breakMs - (session.awayMs || 0)))}`);
        console.log('  (run this AFTER/with SET_BREAK_MINS so the break figure above is the corrected one)');
      }
      if (APPLY) {
        if (newStart) session.startTime = newStart;
        if (setEnd && newEnd) {
          session.endTime = newEnd;
          session.status = 'ended';
          // Keep the heartbeat clamp from truncating the corrected span —
          // effectiveEndMs prefers endTime when set, but a stale
          // lastHeartbeatAt would look wrong in the inspect output.
          session.lastHeartbeatAt = newEnd;
        }
        await session.save();
        console.log('SAVED ✔');
      } else {
        console.log('DRY RUN — re-run with -- --apply to save.');
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error('[inspect-session] FATAL', err.message || err); process.exit(1); });
