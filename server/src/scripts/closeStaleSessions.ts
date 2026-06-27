/**
 * closeStaleSessions.ts — one-off cleanup for the "WORKING shows
 * 00:00:00" bug.
 *
 * Background: before the June 2026 fix, startSession would reuse ANY
 * existing active session — including ones from yesterday whose tabs
 * had been closed without a Log Out. The overnight gap accumulated
 * hours of awayMs, so the live timer (which subtracts awayMs from
 * elapsed time) returned 0 even though the session was technically
 * still "active".
 *
 * The startSession endpoint now detects and ends stale sessions before
 * creating a fresh one — but anyone CURRENTLY logged in with a stale
 * session won't trigger that path until they Log Out and back in. This
 * script finds them and force-ends those sessions so the next page
 * refresh / login starts fresh.
 *
 * Rule: a session is stale if its lastHeartbeatAt is more than 4h old
 * (or missing). We end it at the lastHeartbeatAt time, not "now", so
 * the end-of-day report doesn't count the gap as worked time.
 *
 * Idempotent: re-running closes anything still stale, no-op on healthy
 * sessions.
 *
 * How to run:
 *
 *     cd server
 *     npm run close-stale-sessions
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Session from '../models/Session';

const STALE_MS = 4 * 60 * 60 * 1000;

(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const now = Date.now();
  const cutoff = new Date(now - STALE_MS);
  const candidates = await Session.find({
    status: { $in: ['active', 'on_break'] },
    $or: [
      { lastHeartbeatAt: null },
      { lastHeartbeatAt: { $lt: cutoff } },
    ],
  });

  if (candidates.length === 0) {
    console.log('No stale sessions found — nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found ${candidates.length} stale session(s). Ending…`);
  let closed = 0;
  for (const s of candidates) {
    const lastBeat = (s as any).lastHeartbeatAt ? new Date((s as any).lastHeartbeatAt).getTime() : 0;
    (s as any).status  = 'ended';
    // End at last known activity, not now — so we don't claim the
    // user worked overnight. Falls back to the session's startTime
    // if there's no heartbeat at all.
    (s as any).endTime = lastBeat ? new Date(lastBeat) : (s as any).startTime;
    await s.save();
    closed++;
    const userPart = (s as any).userId ? `user ${String((s as any).userId)}` : 'unknown user';
    const ageH = lastBeat ? Math.round((now - lastBeat) / 3_600_000) : '∞';
    console.log(`  closed ${userPart}  (idle ${ageH}h)`);
  }

  console.log(`\nClosed ${closed} session(s). Next Log In click for each affected user will create a fresh, working session.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('closeStaleSessions failed:', err);
  process.exit(1);
});
