import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import Meeting from '../models/Meeting';

/**
 * meetingScheduleController — surfaces what's on a person's calendar in
 * the next few days, blending:
 *
 *   1. Recurring brand meetings derived from
 *      ClientWorkflow.recurringMeeting.dayOfWeek / timeIST
 *      (imported from the CRM sheets — every brand has a weekly
 *      check-in like "Wednesday 11am").
 *
 *   2. One-off Meeting rows in the existing Meeting collection.
 *
 * The "upcoming" view returns a flat, sorted list — the WorkroomHome
 * shows the next 3, and the HuddleDock surfaces a banner 10 min before
 * each one starts.
 *
 * No new model. Recurrence lives on the brand record itself; the cron
 * (jobs/meetingScheduler.ts) materialises one-off Meeting rows 24h
 * before each occurrence so accept/decline still works.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/**
 * Compute the next occurrence (as UTC Date) of a recurring slot in IST.
 * If `from` falls on the same dayOfWeek but past the timeIST, we roll
 * forward to next week.
 */
export function nextRecurrence(dayOfWeek: number, timeIST: string, from: Date = new Date()): Date | null {
  if (dayOfWeek == null || dayOfWeek < 0 || dayOfWeek > 6) return null;
  const [hh, mm] = (timeIST || '10:00').split(':').map(n => parseInt(n, 10));
  const hr = isFinite(hh) ? hh : 10;
  const min = isFinite(mm) ? mm : 0;

  // Convert "from" to IST so we can reason about IST weekdays.
  const ist = new Date(from.getTime() + 330 * 60_000);
  const istDow = ist.getUTCDay();          // 0..6 in IST
  let daysAhead = (dayOfWeek - istDow + 7) % 7;
  // If it's the same day but the slot has already passed in IST, push to next week.
  if (daysAhead === 0) {
    const slotMinsToday = hr * 60 + min;
    const nowMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (nowMins >= slotMinsToday) daysAhead = 7;
  }
  // Build the IST instant at the target slot.
  const istTarget = new Date(Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + daysAhead,
    hr, min, 0, 0,
  ));
  // Subtract 330 min to convert from IST instant to UTC.
  return new Date(istTarget.getTime() - 330 * 60_000);
}

/**
 * GET /api/meetings/upcoming
 *
 * Up-to-7-days look-ahead. Combines:
 *   - One-off Meeting rows where I'm host or attendee.
 *   - Recurring brand meetings for brands I own a service on.
 *
 * Returned items are normalised:
 *   { id?, startTime, title, kind: 'one_off' | 'recurring',
 *     workflowId?, clientName?, host?, attendees?, link? }
 */
export async function upcoming(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86_400_000);

    const [oneOffs, brands] = await Promise.all([
      Meeting.find({
        organizationId: orgId,
        status: 'scheduled',
        startTime: { $gte: now, $lt: horizon },
        $or: [{ hostUserId: me }, { attendees: me }],
      }).sort({ startTime: 1 }).lean(),
      ClientWorkflow.find({
        organizationId: orgId,
        'recurringMeeting.dayOfWeek': { $ne: null },
        $or: [
          { 'services.assignedTo': me },
          { currentOwnerId: me },
          { nextActionOwnerId: me },
        ],
      }).select('_id clientName recurringMeeting').lean(),
    ]);

    interface UpcomingRow {
      id?: string;
      startTime: Date;
      title: string;
      kind: 'one_off' | 'recurring';
      workflowId?: string;
      clientName?: string;
      host?: string;
      attendees?: string[];
      link?: string;
    }
    const rows: UpcomingRow[] = [];

    for (const m of oneOffs) {
      rows.push({
        id: String(m._id),
        startTime: m.startTime as Date,
        title: m.title,
        kind: 'one_off',
        host: m.hostUserId,
        attendees: m.attendees as string[],
        link: m.link || undefined,
      });
    }
    for (const b of brands) {
      const rm = (b as any).recurringMeeting || {};
      const next = nextRecurrence(rm.dayOfWeek, rm.timeIST, now);
      if (next && next < horizon) {
        rows.push({
          startTime: next,
          title: rm.label || `${b.clientName} sync`,
          kind: 'recurring',
          workflowId: String(b._id),
          clientName: b.clientName || undefined,
        });
      }
    }
    rows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    res.json(rows.slice(0, 25));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * PUT /api/meetings/recurring/:workflowId
 *
 * Set / update a brand's weekly meeting cadence. Body:
 *   { dayOfWeek: 0-6, timeIST: "HH:MM", label?: string }
 * Or `{ dayOfWeek: null }` to clear it.
 *
 * Anyone with workflow access (admin, sales, employee assigned on the
 * brand) can change this — same posture as the rest of the workflow.
 */
export async function setRecurring(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { dayOfWeek, timeIST, label } = req.body || {};
    const updated = await ClientWorkflow.findOneAndUpdate(
      { _id: req.params.workflowId, organizationId: orgId },
      {
        $set: {
          'recurringMeeting.dayOfWeek': dayOfWeek === null ? null : Math.max(0, Math.min(6, Number(dayOfWeek))),
          'recurringMeeting.timeIST':   String(timeIST || '').slice(0, 5),
          'recurringMeeting.label':     String(label || '').slice(0, 80),
          'recurringMeeting.lastMaterialisedFor': null,    // forces re-materialisation on next cron tick
        },
      },
      { new: true },
    );
    if (!updated) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json(updated.recurringMeeting);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
