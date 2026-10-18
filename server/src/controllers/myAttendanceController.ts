import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import ActivityLog from '../models/ActivityLog';
import LeaveApplication from '../models/LeaveApplication';
import { sessionTotals, effectiveEndMs, huddleTotalMs, STANDARD_BREAK_MS } from '../services/sessionTime';

/**
 * myAttendanceController — Oct 2026 (owner: "each employee should get a
 * calendar view to see his login and logout time, working hrs and
 * everything"). GET /api/my-attendance?month=YYYY-MM
 *   · everyone gets their OWN month
 *   · admin / Team-Oversight managers (Rahul) may pass ?userId= for anyone
 * Same sessionTotals() math as the live timer, Attendance and Team Oversight,
 * and the same day rules as Attendance: ≥6h net = present, Sunday = off,
 * approved leave beats everything.
 */
const IST = 330 * 60_000;
const DAY = 86_400_000;
const FULL_DAY_MS = 6 * 3_600_000;      // matches buildAttendanceMatrix "present"
const LATE_AFTER_MINS = 9 * 60 + 30;
const dayKey = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const minsIST = (d: Date | string) => { const t = new Date(new Date(d).getTime() + IST); return t.getUTCHours() * 60 + t.getUTCMinutes(); };

export async function getMyAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me: any = await User.findById(req.user!.id).select('organizationId canViewOversight role roles').lean();
    const orgId = me?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    let targetId = req.user!.id;
    if (req.query.userId && String(req.query.userId) !== req.user!.id) {
      const mgr = [me.role, ...(me.roles || [])].includes('admin') || me.canViewOversight === true;
      if (!mgr) { res.status(403).json({ error: 'You can only see your own attendance' }); return; }
      targetId = String(req.query.userId);
    }
    const target: any = await User.findOne({ _id: targetId, organizationId: orgId }).select('_id name role department createdAt').lean();
    if (!target) { res.status(404).json({ error: 'Teammate not found' }); return; }

    const monthStr = (req.query.month as string) || dayKey(Date.now()).slice(0, 7);
    const m = monthStr.match(/^(\d{4})-(\d{2})$/);
    if (!m) { res.status(400).json({ error: 'Invalid month — use YYYY-MM' }); return; }
    const start = Date.UTC(+m[1], +m[2] - 1, 1) - IST;
    const end = Date.UTC(+m[1], +m[2], 1) - IST;
    const now = Date.now();

    const [sessions, logs, leaves] = await Promise.all([
      Session.find({ userId: String(targetId), startTime: { $lt: new Date(end) },
        $or: [{ endTime: { $gte: new Date(start) } }, { endTime: null }, { endTime: { $exists: false } }] }).sort({ startTime: 1 }).lean(),
      ActivityLog.find({ userId: String(targetId), action: { $in: ['auth.login', 'auth.resume'] }, createdAt: { $gte: new Date(start), $lt: new Date(end) } })
        .select('createdAt action metadata').sort({ createdAt: 1 }).lean(),
      LeaveApplication.find({ userId: String(targetId), status: { $in: ['approved', 'pending'] },
        'days.date': { $gte: new Date(start - DAY), $lt: new Date(end + DAY) } }).lean(),
    ]);
    const leaveByDay = new Map<string, { status: string; dayType: string; reason: string }>();
    for (const l of leaves as any[]) for (const d of l.days || []) {
      const k = dayKey(new Date(d.date).getTime());
      if (!leaveByDay.has(k) || l.status === 'approved') leaveByDay.set(k, { status: l.status, dayType: d.dayType || 'full', reason: d.reason || '' });
    }

    const days: any[] = [];
    for (let ds = start; ds < end; ds += DAY) {
      const de = ds + DAY;
      const key = dayKey(ds);
      const future = ds > now;
      const winEnd = Math.min(de, now);
      let activeMs = 0, breakMs = 0, workedMs = 0, huddleMs = 0;
      const sess: any[] = [];
      const breaks: any[] = [];
      for (const s of sessions as any[]) {
        const st = new Date(s.startTime).getTime();
        const en = effectiveEndMs(s, now);
        if (st >= de || en <= ds || future) continue;
        const t = sessionTotals(s, ds, winEnd);
        activeMs += t.activeMs; breakMs += t.breakMs; workedMs += t.workedMs;
        const h = huddleTotalMs(s, now); huddleMs += h;
        sess.push({ start: s.startTime, end: s.endTime || null, open: !s.endTime, autoClosed: !!s.autoClosedAt, activeMs: t.activeMs, breakMs: t.breakMs, huddleMs: h });
        for (const b of s.breakEvents || []) {
          if (!b.startedAt) continue;
          const bs = new Date(b.startedAt).getTime();
          if (bs < ds || bs >= de) continue;
          const be = b.endedAt ? new Date(b.endedAt).getTime() : Math.min(en, now);
          breaks.push({ start: b.startedAt, end: b.endedAt || null, ms: Math.max(0, be - bs) });
        }
      }
      const dayLogs = (logs as any[]).filter(l => { const t = new Date(l.createdAt).getTime(); return t >= ds && t < de; });
      const firstSeenCand = [...dayLogs.map(l => new Date(l.createdAt).getTime()), ...sess.map(x => new Date(x.start).getTime()).filter(t => t >= ds)];
      const firstSeen = firstSeenCand.length ? new Date(Math.min(...firstSeenCand)).toISOString() : null;
      const clockIn = sess.length ? sess[0].start : null;
      const lastS = sess[sess.length - 1];
      const clockOut = lastS && lastS.end ? lastS.end : null;
      const leave = leaveByDay.get(key) || null;
      const isSunday = new Date(ds + IST).getUTCDay() === 0;
      // Days before the account existed aren't "absent" — they weren't on the team yet.
      const joinedKey = target.createdAt ? dayKey(new Date(target.createdAt).getTime()) : '';
      let status: string;
      if (future) status = 'future';
      else if (joinedKey && key < joinedKey && activeMs === 0) status = 'not_joined';
      else if (leave?.status === 'approved') status = 'leave';
      else if (activeMs >= FULL_DAY_MS) status = 'present';
      else if (activeMs > 0) status = (key === dayKey(now) && lastS?.open) ? 'working' : 'partial';
      else status = isSunday ? 'off' : (key === dayKey(now) ? 'not_yet' : 'absent');
      days.push({
        date: key, status, isSunday, firstSeen, clockIn, clockOut, workedMs, activeMs, breakMs, huddleMs,
        breakCount: breaks.length, breaks, sessions: sess, leave,
        late: !!clockIn && minsIST(clockIn) > LATE_AFTER_MINS,
        overBreak: breakMs > STANDARD_BREAK_MS,
        logins: dayLogs.map(l => ({ at: l.createdAt, kind: l.action === 'auth.login' ? 'login' : 'opened' })),
      });
    }
    const past = days.filter(d => d.status !== 'future');
    const worked = past.filter(d => d.activeMs > 0);
    const totals = {
      present: past.filter(d => d.status === 'present').length,
      partial: past.filter(d => d.status === 'partial' || d.status === 'working').length,
      absent: past.filter(d => d.status === 'absent').length,
      leave: past.filter(d => d.status === 'leave').length,
      late: past.filter(d => d.late).length,
      activeMs: worked.reduce((a, d) => a + d.activeMs, 0),
      breakMs: worked.reduce((a, d) => a + d.breakMs, 0),
      avgActiveMs: worked.length ? worked.reduce((a, d) => a + d.activeMs, 0) / worked.length : 0,
      daysWorked: worked.length,
    };
    res.json({ month: monthStr, user: { id: String(target._id), name: target.name, department: target.department || '' }, days, totals });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
