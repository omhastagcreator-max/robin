import ClientWorkflow from '../models/ClientWorkflow';
import Meeting from '../models/Meeting';
import { nextRecurrence } from '../controllers/meetingScheduleController';

/**
 * meetingScheduler — once an hour, look at every brand workflow that
 * has a recurringMeeting set and materialise the next occurrence into
 * a real Meeting row IF it's coming up within the next 24h AND we
 * haven't already created it.
 *
 * Why bother creating a Meeting row when the recurrence rule itself is
 * enough to render "upcoming meetings"?
 *   - One-off Meeting rows participate in the existing meetings UI
 *     (accept/decline, notes, attendees, calendar integrations).
 *   - The HuddleDock "starts in 10 min" banner reads Meeting rows.
 *   - Once a meeting is over, the row stays as historical proof it
 *     happened — the recurrence rule alone leaves no audit trail.
 *
 * lastMaterialisedFor is stamped after creation so we don't make
 * duplicates on the next tick.
 */

const TICK_INTERVAL_MS = 60 * 60 * 1000;          // every hour
// Materialise 7 days ahead so the TeamCalendar shows the next week
// of brand meetings AND the day-before reminder cron has a row to
// stamp 24h before each occurrence.
const LOOK_AHEAD_MS    = 7 * 24 * 60 * 60 * 1000;

async function tick() {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + LOOK_AHEAD_MS);

    const wfs = await ClientWorkflow.find({
      'recurringMeeting.dayOfWeek': { $ne: null },
    }).select('_id organizationId clientName recurringMeeting services currentOwnerId nextActionOwnerId createdBy').lean();

    for (const wf of wfs) {
      try {
        const rm: any = (wf as any).recurringMeeting || {};
        const next = nextRecurrence(rm.dayOfWeek, rm.timeIST, now);
        if (!next) continue;
        if (next.getTime() > horizon.getTime()) continue;
        // Already materialised this exact occurrence — skip.
        if (rm.lastMaterialisedFor && Math.abs(new Date(rm.lastMaterialisedFor).getTime() - next.getTime()) < 60_000) continue;

        // Attendees = everyone who owns any service on the brand,
        // dedup. Host = createdBy fallback to nextActionOwnerId.
        const attendees = Array.from(new Set(
          ((wf.services as any[]) || [])
            .map(s => s.assignedTo)
            .filter(Boolean)
            .map(String),
        ));
        const hostUserId = String((wf as any).createdBy || (wf as any).currentOwnerId || attendees[0] || '');
        if (!hostUserId) continue;        // nothing to attach to

        const title = rm.label || `${wf.clientName || 'Brand'} weekly sync`;
        const endTime = new Date(next.getTime() + 30 * 60 * 1000);   // 30 min default

        // Idempotency belt-and-suspenders: also de-dup by (org, host, startTime)
        // in case lastMaterialisedFor was wiped.
        const exists = await Meeting.findOne({
          organizationId: wf.organizationId,
          hostUserId,
          startTime: next,
          title,
        }).lean();
        if (exists) continue;

        await Meeting.create({
          organizationId: wf.organizationId,
          hostUserId,
          title,
          description: `Recurring sync for ${wf.clientName}. Auto-scheduled by Robin from the brand's weekly cadence.`,
          type: 'client',
          startTime: next,
          endTime,
          attendees,
          visibility: 'public',
          status: 'scheduled',
        });

        await ClientWorkflow.updateOne(
          { _id: wf._id },
          { $set: { 'recurringMeeting.lastMaterialisedFor': next } },
        );
        console.log(`[meeting-scheduler] materialised ${wf.clientName} @ ${next.toISOString()}`);
      } catch (err) {
        console.warn(`[meeting-scheduler] failed for ${wf._id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[meeting-scheduler] tick failed:', (err as Error).message);
  }
}

export function startMeetingScheduler() {
  // Fire shortly after boot so dev/test sees the effect quickly, then
  // every hour. Boot delay avoids racing the DB connect.
  setTimeout(tick, 15_000);
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[meeting-scheduler] started (every hour, 24h look-ahead)');
}
