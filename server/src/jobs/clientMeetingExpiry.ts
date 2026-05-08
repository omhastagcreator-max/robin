import cron from 'node-cron';
import ClientMeeting from '../models/ClientMeeting';

/**
 * Auto-expire client meetings.
 *
 * Two checks every 5 minutes:
 *   1. expiresAt has passed → mark 'expired'
 *   2. (active && startedAt + maxDurationMinutes has passed) →
 *      mark 'ended' with reason 'duration_reached'
 *
 * Idempotent. Doesn't disturb already-ended meetings.
 */
async function runOnce() {
  const now = new Date();
  let closed = 0;

  // Hard expiry — link is dead, no one can join
  const expiredRes = await ClientMeeting.updateMany(
    { status: { $in: ['scheduled', 'active'] }, expiresAt: { $lt: now } },
    { $set: { status: 'expired', endReason: 'expired', endedAt: now } }
  );
  closed += expiredRes.modifiedCount || 0;

  // Active meetings past their duration → graceful end
  const candidates = await ClientMeeting.find({
    status: 'active',
    startedAt: { $exists: true, $ne: null },
  }).select('_id startedAt maxDurationMinutes');

  for (const m of candidates) {
    if (!m.startedAt) continue;
    const expectedEnd = new Date(m.startedAt).getTime() + (m.maxDurationMinutes || 120) * 60_000;
    if (expectedEnd < now.getTime()) {
      await ClientMeeting.updateOne(
        { _id: m._id },
        { $set: { status: 'ended', endReason: 'duration_reached', endedAt: now } }
      );
      closed += 1;
    }
  }

  if (closed > 0) console.log(`[clientMeetingExpiry] auto-closed ${closed} meeting(s)`);
}

export function startClientMeetingExpiryJob() {
  cron.schedule('*/5 * * * *', () => {
    runOnce().catch(err => console.error('[clientMeetingExpiry] failed:', err));
  });
  console.log('[clientMeetingExpiry] cron scheduled — every 5 minutes');
}

export { runOnce as runClientMeetingExpiryNow };
