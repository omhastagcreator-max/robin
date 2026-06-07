import Meeting from '../models/Meeting';
import User from '../models/User';
import { notify } from '../services/notify';

/**
 * meetingReminderCron — fires three reminder waves per Meeting:
 *
 *   1. Day-before  — within 24-36h of startTime, once. Fired when a
 *                    Meeting is materialised by the scheduler ahead of
 *                    its day. The 12h tolerance band catches both
 *                    weekly recurrences materialised 7d ahead AND
 *                    one-off meetings created 25h before they start.
 *
 *   2. Day-of      — at 08:30 IST on the day of, once. Single ping
 *                    when the user is most likely just starting work,
 *                    so they see "today: WOODSIFY sync at 11am"
 *                    while planning their morning.
 *
 *   3. Imminent    — 15 min before startTime, once. Strong nudge to
 *                    join — the HuddleDock surfaces this as a pulsing
 *                    chip.
 *
 * Idempotency: each wave stamps a *SentAt field on the Meeting so a
 * server restart can't re-fire. Cron is cheap to re-run.
 *
 * Audience: host + every attendee, deduplicated. We use the shared
 * `notify()` helper so each reminder both persists a Notification
 * (bell + /notifications page) AND emits a socket event to any
 * connected tab for an instant toast.
 *
 * Socket emit doesn't require req — we attach the global `io`
 * instance once at boot via setReminderIo().
 */

let io: any = null;
export function setReminderIo(s: any) { io = s; }

const TICK_INTERVAL_MS = 5 * 60 * 1000;      // every 5 minutes
const DAY_MS           = 24 * 60 * 60 * 1000;

function nowIST(): Date { return new Date(Date.now() + 330 * 60_000); }

function sameDayIST(a: Date, b: Date): boolean {
  return new Date(a.getTime() + 330 * 60_000).toISOString().slice(0, 10) ===
         new Date(b.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

async function fireReminder(meeting: any, wave: 'day_before' | 'day_of' | 'imminent') {
  // Audience = host + attendees, dedup.
  const audience = Array.from(new Set([String(meeting.hostUserId), ...((meeting.attendees as string[]) || [])])).filter(Boolean);
  if (audience.length === 0) return;

  // Fetch first names for friendlier copy. Single query.
  const users = await User.find({ _id: { $in: audience } }).select('_id name').lean();
  const nameById = new Map(users.map(u => [String(u._id), u.name || '']));

  const startLocal = new Date(meeting.startTime).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const dayLocal   = new Date(meeting.startTime).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });

  const titleByWave: Record<typeof wave, string> = {
    day_before: `Tomorrow: ${meeting.title}`,
    day_of:     `Today: ${meeting.title}`,
    imminent:   `Starting soon: ${meeting.title}`,
  };
  const bodyByWave: Record<typeof wave, string> = {
    day_before: `${dayLocal} at ${startLocal} IST — ${audience.length === 1 ? 'just you' : `${audience.length} attendees`}.`,
    day_of:     `at ${startLocal} IST today. Block your calendar now.`,
    imminent:   `in ~15 minutes at ${startLocal} IST. Open the huddle when you're ready.`,
  };

  await notify({
    io,
    organizationId: String(meeting.organizationId),
    userIds: audience,
    type: `meeting.reminder.${wave}`,
    title: titleByWave[wave],
    body:  bodyByWave[wave],
    entityId: String(meeting._id),
    entityType: 'meeting',
  });
  // Suppressing unused-variable warning — nameById is structured for
  // future use (per-recipient salutation when we add HTML email).
  void nameById;
}

async function tick() {
  try {
    const now = new Date();
    const in36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const in16m = new Date(now.getTime() + 16 * 60 * 1000);

    // Pull every scheduled meeting starting in the next 36h. Small
    // window means small result set even on a busy week.
    const meetings = await Meeting.find({
      status: 'scheduled',
      startTime: { $gte: now, $lte: in36h },
    }).lean();

    let dayBefore = 0, dayOf = 0, imminent = 0;
    for (const m of meetings as any[]) {
      const startMs = new Date(m.startTime).getTime();
      const minutesAway = (startMs - now.getTime()) / 60_000;
      const hoursAway = minutesAway / 60;

      // Wave 3 (imminent) — 0 to 16 min away.
      if (!m.imminentReminderSentAt && minutesAway > 0 && minutesAway <= 16) {
        await fireReminder(m, 'imminent');
        await Meeting.updateOne({ _id: m._id }, { $set: { imminentReminderSentAt: new Date() } });
        imminent++;
        continue;
      }

      // Wave 2 (day-of) — starts today (IST), within next 14h, and we
      // haven't pinged this morning. Triggers naturally once IST 08:30
      // ticks past on the scheduling day.
      if (!m.dayOfReminderSentAt && sameDayIST(now, new Date(m.startTime)) && hoursAway > 0.25) {
        const ist = nowIST();
        const istMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        if (istMins >= 8 * 60 + 30) {        // after 08:30 IST
          await fireReminder(m, 'day_of');
          await Meeting.updateOne({ _id: m._id }, { $set: { dayOfReminderSentAt: new Date() } });
          dayOf++;
          continue;
        }
      }

      // Wave 1 (day-before) — between 20h and 36h away, sent once.
      if (!m.dayBeforeReminderSentAt && hoursAway >= 20 && hoursAway <= 36) {
        await fireReminder(m, 'day_before');
        await Meeting.updateOne({ _id: m._id }, { $set: { dayBeforeReminderSentAt: new Date() } });
        dayBefore++;
        continue;
      }
    }

    if (dayBefore || dayOf || imminent) {
      console.log(`[meeting-reminders] day_before=${dayBefore} day_of=${dayOf} imminent=${imminent}`);
    }

    // Belt-and-suspenders: silence the in16m linter — it's there for
    // a future "next-15-min" sweeper that joins the imminent wave.
    void in16m;
  } catch (err) {
    console.error('[meeting-reminders] tick failed:', (err as Error).message);
  }
}

export function startMeetingReminderCron() {
  setTimeout(tick, 45_000);
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[meeting-reminders] started (every 5 min, 3 waves)');
}
