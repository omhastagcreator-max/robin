/**
 * capOmBreaks.ts — clamp Om's total break time across the LAST ISO
 * week so it doesn't exceed 12 hours.
 *
 * Background: Robin's worked-hour calculation gives every teammate a
 * 1-hour break credit per day. Anything beyond that gets deducted
 * from effective working time. Last week Om's session rows somehow
 * accumulated far more break time than 12h total, which made his
 * displayed worked-hours look way too low.
 *
 * What this script does:
 *   1. Finds Om (matches name 'Om' in the agency org).
 *   2. Pulls every Session for him with startTime inside last ISO
 *      week (Monday 00:00 IST through next Monday 00:00 IST).
 *   3. Computes the current sum of breakMs across those sessions.
 *   4. If the sum > 12h, proportionally scales each session's
 *      breakMs down so the new total is exactly 12h.
 *      We also walk breakEvents[] and trim each event's endedAt
 *      relative to startedAt so the audit trail stays consistent.
 *   5. Prints before/after so admin can sanity-check.
 *
 * Idempotent: re-running after the cap is already applied is a no-op
 * because the new sum is already <= 12h.
 *
 * How to run:
 *
 *     cd server
 *     npm run cap-om-breaks
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Session from '../models/Session';
import User from '../models/User';
import Organization from '../models/Organization';

const CAP_HOURS = 12;
const CAP_MS    = CAP_HOURS * 60 * 60 * 1000;

function lastWeekRange(): { start: Date; end: Date; label: string } {
  // ISO week containing "yesterday" (so even if you run this on a
  // Monday, it still refers to the FULL previous week).
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  // Move back 7 days from today and find that week's Monday.
  const sevenAgo = new Date(ist.getTime() - 7 * 86_400_000);
  const dow = sevenAgo.getUTCDay() || 7;        // 1..7 (Mon..Sun in ISO)
  const monday = new Date(Date.UTC(
    sevenAgo.getUTCFullYear(), sevenAgo.getUTCMonth(),
    sevenAgo.getUTCDate() - (dow - 1), 0, 0, 0,
  ));
  const start = new Date(monday.getTime() - 330 * 60_000);  // IST → UTC
  const end   = new Date(start.getTime() + 7 * 86_400_000);
  const label = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} (IST)`;
  return { start, end, label };
}

(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }

  const om = await User.findOne({
    organizationId: org._id,
    name: { $regex: '^Om', $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id name email').lean();
  if (!om) { console.error('User "Om" not found in this org.'); process.exit(1); }
  console.log(`Found Om → ${om.name} (${String(om._id)})`);

  const { start, end, label } = lastWeekRange();
  console.log(`Last week window: ${label}`);

  const sessions = await Session.find({
    userId: String(om._id),
    startTime: { $gte: start, $lt: end },
  });
  if (sessions.length === 0) {
    console.log('No sessions found for Om in that window. Nothing to cap.');
    await mongoose.disconnect();
    process.exit(0);
  }
  console.log(`Found ${sessions.length} sessions.`);

  const totalBefore = sessions.reduce((s, sess) => s + ((sess as any).breakMs || 0), 0);
  const totalBeforeHrs = Math.round((totalBefore / 3_600_000) * 100) / 100;
  console.log(`Current total breakMs: ${totalBeforeHrs}h`);

  if (totalBefore <= CAP_MS) {
    console.log(`Already at or below the ${CAP_HOURS}h cap — nothing to do.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // Proportional scale-down: every session's breakMs * (CAP / total).
  const scale = CAP_MS / totalBefore;
  let touched = 0;
  for (const sess of sessions) {
    const before = (sess as any).breakMs || 0;
    if (before === 0) continue;
    const after = Math.floor(before * scale);
    (sess as any).breakMs = after;

    // Walk breakEvents[] and proportionally trim each event so the
    // audit trail matches the new total. We do this by scaling the
    // duration of each event in place.
    const events: any[] = (sess as any).breakEvents || [];
    for (const ev of events) {
      if (!ev.startedAt) continue;
      const startedAt = new Date(ev.startedAt).getTime();
      const endedAt   = ev.endedAt ? new Date(ev.endedAt).getTime() : startedAt;
      const duration  = Math.max(0, endedAt - startedAt);
      if (duration === 0) continue;
      const scaled    = Math.floor(duration * scale);
      ev.endedAt      = new Date(startedAt + scaled).toISOString();
    }
    await sess.save();
    touched++;
  }

  const totalAfter = sessions.reduce((s, sess) => s + ((sess as any).breakMs || 0), 0);
  console.log(`Scaled down ${touched} sessions (factor ${(scale * 100).toFixed(1)}%).`);
  console.log(`New total breakMs: ${Math.round((totalAfter / 3_600_000) * 100) / 100}h (cap was ${CAP_HOURS}h).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('capOmBreaks failed:', err);
  process.exit(1);
});
