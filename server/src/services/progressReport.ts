/**
 * progressReport — computes the weekly employee scorecard.
 *
 * Everything is derived from data Robin already records; the team does
 * nothing extra. Week = Monday 00:00 IST → next Monday 00:00 IST.
 *
 * ── The four pillars (weights sum to 100) ────────────────────────────
 *
 * RELIABILITY /25 — shows up, on time
 *   · attendance /15 : days worked ÷ expected days
 *                      (expected = elapsed non-Sundays − approved leaves)
 *   · punctuality /10: avg first-login time. Full marks ≤ 09:30 IST,
 *                      linear falloff to 0 at 12:00.
 *
 * FOCUS /25 — the hours are real
 *   · hours /15      : avg net worked per day ÷ 8h target
 *   · breaks /5      : share of days within the 1h break allowance
 *   · presence /5    : low away-time ratio (full marks ≤ 5% away,
 *                      0 at ≥ 25%)
 *
 * DELIVERY /30 — promises kept (weighted highest on purpose)
 *   · promise /20    : morning-planned tasks marked done by evening
 *                      (the morning-promised vs evening-delivered diff)
 *   · on-time /10    : ProjectTask completions before their dueDate
 *   Neutral half-credit when there's no data to judge (nothing planned /
 *   no due dates) so quiet weeks aren't punished as failures.
 *
 * DISCIPLINE /20 — runs the system
 *   · check-ins      : morning+midday+evening pulses submitted ÷
 *                      (3 × days worked)
 *
 * Improvement = the trend of weekly scores over time. The API returns
 * the last N snapshots; the UI draws the trend line and the
 * week-over-week delta. A rising line IS the progress.
 */
import Session from '../models/Session';
import DailyCheckin from '../models/DailyCheckin';
import ProjectTask from '../models/ProjectTask';
import LeaveApplication from '../models/LeaveApplication';
import User from '../models/User';
import EmployeeProgress from '../models/EmployeeProgress';
import { sessionTotals, huddleTotalMs, effectiveEndMs } from './sessionTime';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_DAY_MS = 8 * 60 * 60 * 1000;       // 8h net work target / day
const BREAK_ALLOWANCE_MS = 60 * 60 * 1000;      // mirrors sessionTime.ts
const MIN_WORKED_DAY_MS = 30 * 60 * 1000;       // <30min net doesn't count as a worked day

/** IST Monday 00:00 of the week containing `nowMs`, in UTC ms. */
export function weekStartMs(nowMs = Date.now()): number {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const dow = ist.getUTCDay();                   // 0=Sun … 6=Sat (in IST disguise)
  const daysSinceMonday = (dow + 6) % 7;
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - daysSinceMonday * DAY_MS;
  return mondayIst - IST_OFFSET_MS;              // back to real UTC
}

export function fmtISTDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MS).toISOString().slice(0, 10);
}

interface DayBucket { activeMs: number; breakMs: number; firstStartMins: number | null }

export async function computeWeekForUser(userId: string, orgId: any, wkStart: number) {
  void orgId; // reserved for future org-level config (custom targets etc.)
  const wkEnd = wkStart + 7 * DAY_MS;
  const now = Date.now();
  const effectiveEnd = Math.min(wkEnd, now);

  // ── Sessions overlapping the week ─────────────────────────────────
  const sessions = await Session.find({
    userId,
    startTime: { $lt: new Date(wkEnd) },
    $or: [
      { endTime: { $gte: new Date(wkStart) } },
      { endTime: null },
      { endTime: { $exists: false } },
    ],
  }).lean();

  const days = new Map<string, DayBucket>();
  let grossMs = 0, awayMs = 0, huddleMs = 0, totalActiveMs = 0, totalBreakMs = 0;

  for (const s of sessions) {
    const t = sessionTotals(s as any, wkStart, wkEnd);
    if (t.workedMs <= 0) continue;
    grossMs += t.workedMs;
    awayMs += t.awayMs;
    totalActiveMs += t.activeMs;
    totalBreakMs += t.breakMs;
    huddleMs += Math.min(huddleTotalMs(s as any, wkEnd), t.workedMs);

    // Bucket by the IST date the session STARTED (sessions are one-day).
    const startMs = new Date(s.startTime).getTime();
    const key = fmtISTDate(Math.max(startMs, wkStart));
    const b = days.get(key) || { activeMs: 0, breakMs: 0, firstStartMins: null };
    b.activeMs += t.activeMs;
    b.breakMs += t.breakMs;
    const istMins = Math.floor(((startMs + IST_OFFSET_MS) % DAY_MS) / 60_000);
    if (startMs >= wkStart && (b.firstStartMins === null || istMins < b.firstStartMins)) {
      b.firstStartMins = istMins;
    }
    days.set(key, b);
    void effectiveEndMs; // (kept imported for future per-day end analysis)
  }

  const workedDays = [...days.values()].filter(d => d.activeMs >= MIN_WORKED_DAY_MS);
  const daysWorked = workedDays.length;
  const targetHitDays = workedDays.filter(d => d.activeMs >= TARGET_DAY_MS).length;
  const breakOkDays = workedDays.filter(d => d.breakMs <= BREAK_ALLOWANCE_MS).length;
  const starts = workedDays.map(d => d.firstStartMins).filter((m): m is number => m !== null);
  const avgStartMins = starts.length ? Math.round(starts.reduce((a, b) => a + b, 0) / starts.length) : null;

  // ── Expected days: elapsed non-Sundays − approved leave days ──────
  let elapsedWorkdays = 0;
  for (let d = wkStart; d < effectiveEnd; d += DAY_MS) {
    const dow = new Date(d + IST_OFFSET_MS).getUTCDay();
    if (dow !== 0) elapsedWorkdays++;            // Sunday off
  }
  const leaves = await LeaveApplication.find({
    userId, status: 'approved',
    'days.date': { $gte: new Date(wkStart - DAY_MS), $lt: new Date(wkEnd + DAY_MS) },
  }).lean();
  const leaveDaySet = new Set<string>();
  for (const l of leaves) for (const d of (l as any).days || []) {
    const dm = new Date(d.date).getTime();
    if (dm >= wkStart - DAY_MS && dm < wkEnd + DAY_MS) {
      const key = fmtISTDate(dm);
      if (key >= fmtISTDate(wkStart) && key < fmtISTDate(wkEnd)) leaveDaySet.add(key);
    }
  }
  const leaveDays = leaveDaySet.size;
  const expectedDays = Math.max(0, elapsedWorkdays - leaveDays);

  // ── Check-ins: discipline + morning-promised vs evening-delivered ─
  const weekDates: string[] = [];
  for (let d = wkStart; d < wkEnd; d += DAY_MS) weekDates.push(fmtISTDate(d));
  const checkins = await DailyCheckin.find({ userId, dateIST: { $in: weekDates } }).lean();

  let checkinsDone = 0, tasksPlanned = 0, tasksDelivered = 0, tasksDropped = 0;
  for (const c of checkins as any[]) {
    if (c.morning?.done) checkinsDone++;
    if (c.midday?.done) checkinsDone++;
    if (c.evening?.done) checkinsDone++;
    for (const t of c.morning?.tasks || []) {
      tasksPlanned++;
      if (t.eveningStatus === 'done') tasksDelivered++;
      if (t.eveningStatus === 'dropped') tasksDropped++;
    }
  }
  const checkinRate = daysWorked > 0 ? Math.min(1, checkinsDone / (3 * daysWorked)) : 0;
  const promiseRate = tasksPlanned > 0 ? tasksDelivered / tasksPlanned : null;

  // ── ProjectTask delivery ──────────────────────────────────────────
  const doneTasks = await ProjectTask.find({
    assignedTo: userId, status: 'done',
    completedAt: { $gte: new Date(wkStart), $lt: new Date(wkEnd) },
  }).select('dueDate completedAt').lean();
  const projTasksDone = doneTasks.length;
  const withDue = doneTasks.filter((t: any) => t.dueDate);
  const onTime = withDue.filter((t: any) => new Date(t.completedAt).getTime() <= new Date(t.dueDate).getTime() + DAY_MS).length;
  const onTimeRate = withDue.length > 0 ? onTime / withDue.length : null;

  // ── Scoring ───────────────────────────────────────────────────────
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const attendance = expectedDays > 0 ? clamp01(daysWorked / expectedDays) : 0;
  const punctuality = avgStartMins === null ? 0
    : clamp01(1 - Math.max(0, avgStartMins - (9 * 60 + 30)) / 150); // 09:30 full → 12:00 zero
  const reliability = 15 * attendance + 10 * punctuality;

  const avgActiveMsDay = daysWorked > 0 ? totalActiveMs / daysWorked : 0;
  const hoursScore = 15 * clamp01(avgActiveMsDay / TARGET_DAY_MS);
  const breakScore = daysWorked > 0 ? 5 * (breakOkDays / daysWorked) : 0;
  const awayRatio = grossMs > 0 ? awayMs / grossMs : 0;
  const presenceScore = 5 * clamp01(1 - Math.max(0, awayRatio - 0.05) / 0.20); // ≤5% full → ≥25% zero
  const focus = hoursScore + breakScore + presenceScore;

  const promiseScore = promiseRate === null ? 10 : 20 * clamp01(promiseRate); // neutral half-credit
  const onTimeScore = onTimeRate === null ? 5 : 10 * clamp01(onTimeRate);
  const delivery = promiseScore + onTimeScore;

  const discipline = 20 * checkinRate;

  const breakdown = {
    reliability: Math.round(reliability * 10) / 10,
    focus:       Math.round(focus * 10) / 10,
    delivery:    Math.round(delivery * 10) / 10,
    discipline:  Math.round(discipline * 10) / 10,
  };
  const score = daysWorked === 0 ? 0
    : Math.max(0, Math.min(100, Math.round(reliability + focus + delivery + discipline)));

  const huddleRatio = grossMs > 0 ? huddleMs / grossMs : 0;

  return {
    metrics: {
      daysWorked, expectedDays, leaveDays, targetHitDays, avgStartMins,
      totalActiveMs, avgActiveMsDay: Math.round(avgActiveMsDay),
      totalBreakMs, breakOkDays,
      awayRatio: Math.round(awayRatio * 1000) / 1000,
      huddleRatio: Math.round(huddleRatio * 1000) / 1000,
      tasksPlanned, tasksDelivered, tasksDropped, promiseRate,
      projTasksDone, onTimeRate,
      checkinsDone, checkinRate: Math.round(checkinRate * 1000) / 1000,
    },
    breakdown,
    score,
  };
}

/** Compute + upsert a week snapshot for one user. */
export async function snapshotWeekForUser(userId: string, orgId: any, wkStart: number, provisional: boolean) {
  const result = await computeWeekForUser(userId, orgId, wkStart);
  const weekStartIST = fmtISTDate(wkStart);
  return EmployeeProgress.findOneAndUpdate(
    { organizationId: orgId, userId, weekStartIST },
    { $set: { ...result, provisional, computedAt: new Date() } },
    { upsert: true, new: true },
  );
}

/** Compute + store snapshots for every internal staff member of an org. */
export async function snapshotWeekForOrg(orgId: any, wkStart: number, provisional: boolean) {
  const staff = await User.find({
    organizationId: orgId,
    role: { $in: ['employee', 'sales', 'workroom'] },
    isActive: true,
  }).select('_id').lean();
  for (const u of staff) {
    try { await snapshotWeekForUser(String(u._id), orgId, wkStart, provisional); }
    catch (err) { console.error('[progress] snapshot failed for', String(u._id), (err as Error).message); }
  }
  return staff.length;
}
