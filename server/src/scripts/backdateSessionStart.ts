/**
 * backdateSessionStart.ts — credit time that was worked but not tracked.
 *
 * The classic case (July 2026): a user filled the morning check-in but
 * never clicked Log In, so the session — and the timer — started hours
 * late. The user first logs in normally (so an active session exists),
 * then an admin runs this script to move that session's startTime back
 * to when work actually began.
 *
 * Safety rails:
 *   - Only touches TODAY's (IST) active / on_break session for the user.
 *   - Refuses to move startTime into the future or by more than 12h.
 *   - Dry-run by default; pass --apply to save.
 *
 * Usage (from server/):
 *   DRY RUN:  EMAIL=om@hastag.com START_IST=09:30 npm run backdate-session
 *   APPLY:    EMAIL=om@hastag.com START_IST=09:30 npm run backdate-session -- --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Session from '../models/Session';
import User from '../models/User';

const APPLY = process.argv.includes('--apply');
const IST_OFFSET_MS = 330 * 60_000;
const MAX_BACKDATE_MS = 12 * 60 * 60 * 1000;

async function main() {
  const email = process.env.EMAIL;
  const startIst = process.env.START_IST; // "HH:MM"
  if (!email || !startIst || !/^\d{1,2}:\d{2}$/.test(startIst)) {
    throw new Error('Set EMAIL=<user email> and START_IST=HH:MM (24h, IST)');
  }
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`[backdate-session] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('_id name email');
  if (!user) throw new Error(`No user with email ${email}`);

  const session = await Session.findOne({
    userId: user._id,
    status: { $in: ['active', 'on_break'] },
  });
  if (!session) {
    throw new Error('No active session — ask the user to Log In first, then re-run.');
  }

  // Build the new start: today's IST date at START_IST, converted to UTC.
  const [hh, mm] = startIst.split(':').map(n => parseInt(n, 10));
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const newStartMs = Date.UTC(
    nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(),
    hh, mm, 0,
  ) - IST_OFFSET_MS;

  const oldStartMs = new Date(session.startTime).getTime();
  const now = Date.now();

  if (newStartMs >= now) throw new Error('New start is in the future — check START_IST.');
  if (newStartMs >= oldStartMs) {
    throw new Error(
      `Session already starts at ${new Date(oldStartMs).toISOString()} — ` +
      'backdating would move it FORWARD. Nothing to do.',
    );
  }
  if (oldStartMs - newStartMs > MAX_BACKDATE_MS) {
    throw new Error('Refusing to backdate by more than 12h — check START_IST.');
  }

  const creditedMs = oldStartMs - newStartMs;
  console.log(
    `[backdate-session] ${user.name || user.email}\n` +
    `  session  : ${session._id}\n` +
    `  old start: ${new Date(oldStartMs).toISOString()}\n` +
    `  new start: ${new Date(newStartMs).toISOString()} (${startIst} IST)\n` +
    `  credited : ${(creditedMs / 3_600_000).toFixed(2)}h`,
  );

  if (APPLY) {
    session.startTime = new Date(newStartMs);
    await session.save();
    console.log('[backdate-session] saved ✔ — user should refresh Robin to see the new total.');
  } else {
    console.log('\nDRY RUN — nothing saved. Re-run with -- --apply to commit.');
  }
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[backdate-session] FATAL', err.message || err);
  process.exit(1);
});
