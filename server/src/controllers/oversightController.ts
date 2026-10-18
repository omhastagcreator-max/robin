import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import ActivityLog from '../models/ActivityLog';
import DailyCheckin from '../models/DailyCheckin';
import ProjectTask from '../models/ProjectTask';
import WorkflowActivity from '../models/WorkflowActivity';
import LeadNote from '../models/LeadNote';
import ClientMeeting from '../models/ClientMeeting';
import ClientWorkflow from '../models/ClientWorkflow';
import ChatMessage from '../models/ChatMessage';
import LeaveApplication from '../models/LeaveApplication';
import ScreenSession from '../models/ScreenSession';
import { sessionTotals, effectiveEndMs, huddleTotalMs, STANDARD_BREAK_MS } from '../services/sessionTime';
import { deactivateMember } from '../services/teamRoster';

/**
 * oversightController — Oct 2026. Powers the Team Oversight dashboard
 * (/admin/oversight): ONE page where the owner (admin) and manager (Rahul,
 * via the canViewOversight flag) see everything every teammate did on a
 * given IST day — sign-ins, clock-in/out, every break, huddle time,
 * check-ins, tasks, client-work activity — plus a 7-day hours trend.
 *
 * Read-only. All time math goes through services/sessionTime.ts so the
 * numbers match the live timer, Attendance and the payroll report.
 * One endpoint, parallel queries — same reasoning as commandCenterController.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const LATE_AFTER_MINS = 9 * 60 + 30;          // matches progressReport punctuality (full marks ≤ 09:30)
const LONG_SINGLE_BREAK_MS = 30 * 60_000;     // matches useSession long-break warning
const FULL_DAY_MS = 8 * 60 * 60_000;          // 8h net work day (owner's 8h + 1h model)

const istDateKey = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istMinutesOfDay = (d: Date | string) => {
  const t = new Date(new Date(d).getTime() + IST_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

function isAdmin(req: AuthRequest) {
  const r = [req.user?.role, ...(req.user?.roles || [])];
  return r.includes('admin');
}

/** Gate: admin, or anyone admin has granted canViewOversight (e.g. Rahul as manager). */
export async function requireOversight(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  if (isAdmin(req)) { next(); return; }
  try {
    const u = await User.findById(req.user.id).select('canViewOversight').lean();
    if (u && (u as any).canViewOversight === true) { next(); return; }
  } catch { /* fall through */ }
  res.status(403).json({ error: 'Team Oversight is limited to admin and managers' });
}

function deviceLabel(ua: string): string {
  if (!ua) return '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ');
}

type EventType =
  | 'login' | 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  | 'checkin' | 'task_done' | 'task_created' | 'client_work' | 'lead_note'
  | 'meeting' | 'leave' | 'other';

interface TimelineEvent {
  at: string;
  userId: string;
  userName: string;
  type: EventType;
  label: string;
  detail?: string;
}

// GET /api/oversight/day?date=YYYY-MM-DD
export async function getOversightDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId').lean();
    const orgId = me?.organizationId ? String(me.organizationId) : null;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const orgObjId = new mongoose.Types.ObjectId(orgId);

    const todayKey = istDateKey(Date.now());
    const dateStr = (req.query.date as string) || todayKey;
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { res.status(400).json({ error: 'Invalid date — use YYYY-MM-DD' }); return; }
    const dayStart = Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_MS;
    const dayEnd = dayStart + DAY_MS;
    const now = Date.now();
    const winEnd = Math.min(dayEnd, now);
    const isToday = dateStr === todayKey;
    const weekStart = dayStart - 6 * DAY_MS;
    const dStart = new Date(dayStart), dEnd = new Date(dayEnd);

    const staff = await User.find({
      organizationId: orgId,
      isActive: true,
      role: { $in: ['admin', 'employee', 'sales', 'workroom'] },
    }).select('_id name email role roles team avatarUrl onCallSince').sort({ name: 1 }).lean();
    const staffIds = staff.map(u => String(u._id));
    const staffObjIds = staff.map(u => u._id);

    const [
      sessions, authLogs, otherLogs, checkins, tasksToday, openTasks,
      wfActs, leadNotes, meetings, chatCounts, leaves, screens,
    ] = await Promise.all([
      Session.find({
        organizationId: orgId,
        $or: [
          { startTime: { $gte: new Date(weekStart), $lt: dEnd } },
          { endTime: { $gte: new Date(weekStart), $lt: dEnd } },
          { startTime: { $lt: new Date(weekStart) }, endTime: { $gte: dEnd } },
          { startTime: { $lt: dEnd }, status: { $in: ['active', 'on_break'] } },
        ],
      }).sort({ startTime: 1 }).lean(),
      ActivityLog.find({
        userId: { $in: staffIds },
        action: { $in: ['auth.login', 'auth.resume'] },
        createdAt: { $gte: dStart, $lt: dEnd },
      }).sort({ createdAt: 1 }).lean(),
      ActivityLog.find({
        organizationId: orgObjId,
        action: { $nin: ['auth.login', 'auth.resume'] },
        createdAt: { $gte: dStart, $lt: dEnd },
      }).sort({ createdAt: -1 }).limit(400).lean(),
      DailyCheckin.find({ organizationId: orgObjId, dateIST: dateStr }).lean(),
      ProjectTask.find({
        organizationId: orgId,
        $or: [
          { completedAt: { $gte: dStart, $lt: dEnd } },
          { createdAt: { $gte: dStart, $lt: dEnd } },
        ],
      }).select('_id title status assignedTo assignedBy completedAt createdAt dueDate priority').lean(),
      ProjectTask.find({
        organizationId: orgId,
        status: { $ne: 'done' },
        assignedTo: { $in: staffIds },
      }).select('assignedTo dueDate status').lean(),
      WorkflowActivity.find({
        organizationId: orgObjId,
        createdAt: { $gte: dStart, $lt: dEnd },
      }).select('actorId actorName action comment serviceType createdAt workflowId').sort({ createdAt: -1 }).limit(500)
        .populate({ path: 'workflowId', select: 'clientName name brandName' }).lean(),
      LeadNote.find({ organizationId: orgObjId, createdAt: { $gte: dStart, $lt: dEnd } })
        .select('authorId type content createdAt leadId').populate({ path: 'leadId', select: 'name company' }).lean(),
      ClientMeeting.find({
        organizationId: orgObjId,
        $or: [{ createdAt: { $gte: dStart, $lt: dEnd } }, { startedAt: { $gte: dStart, $lt: dEnd } }],
      }).select('hostUserId clientName status createdAt startedAt endedAt').lean(),
      ChatMessage.aggregate([
        { $match: { organizationId: orgObjId, createdAt: { $gte: dStart, $lt: dEnd }, type: { $ne: 'system' } } },
        { $group: { _id: '$senderId', n: { $sum: 1 } } },
      ]),
      LeaveApplication.find({
        organizationId: orgObjId,
        status: { $in: ['approved', 'pending'] },
        'days.date': { $gte: new Date(dayStart - DAY_MS), $lt: new Date(dayEnd + DAY_MS) },
      }).lean(),
      ScreenSession.find({ userId: { $in: staffIds } }).select('userId status startedAt').lean(),
    ]);

    const nameOf = new Map(staff.map(u => [String(u._id), u.name || u.email]));
    const timeline: TimelineEvent[] = [];
    const push = (e: Omit<TimelineEvent, 'userName'>) => {
      const t = new Date(e.at).getTime();
      if (!(t >= dayStart && t < dayEnd)) return;
      timeline.push({ ...e, userName: nameOf.get(e.userId) || 'Someone' });
    };

    const chatBy = new Map<string, number>(chatCounts.map((c: any) => [String(c._id), c.n]));
    const screenBy = new Map(screens.map((s: any) => [String(s.userId), s]));

    const rows = staff.map((u: any) => {
      const uid = String(u._id);
      const mySessions = sessions.filter(s => String(s.userId) === uid);

      // ── Today's sessions (clamped to the IST day) ────────────────
      const daySessions = mySessions.filter(s => {
        const st = new Date(s.startTime).getTime();
        const en = effectiveEndMs(s as any, now);
        return st < dayEnd && en > dayStart;
      });
      let workedMs = 0, activeMs = 0, breakMs = 0, huddleMs = 0;
      const breaks: Array<{ startedAt: string; endedAt: string | null; durationMs: number; ongoing: boolean }> = [];
      const sessionRows = daySessions.map(s => {
        const t = sessionTotals(s as any, dayStart, winEnd);
        workedMs += t.workedMs; activeMs += t.activeMs; breakMs += t.breakMs;
        const h = huddleTotalMs(s as any, now);
        huddleMs += h;
        const effEnd = effectiveEndMs(s as any, now);
        const evs = (s.breakEvents || []) as any[];
        evs.forEach((b, i) => {
          if (!b.startedAt) return;
          const bs = new Date(b.startedAt).getTime();
          // Only the LAST event may be ongoing — earlier open events are
          // broken data (see the break-desync fix notes in CLAUDE.md).
          const isLast = i === evs.length - 1;
          const ongoing = !b.endedAt && isLast && s.status === 'on_break';
          const be = b.endedAt ? new Date(b.endedAt).getTime() : (ongoing ? Math.min(effEnd, winEnd) : bs);
          if (be <= dayStart || bs >= dayEnd) return;
          breaks.push({ startedAt: new Date(bs).toISOString(), endedAt: b.endedAt ? new Date(be).toISOString() : null, durationMs: Math.max(0, be - bs), ongoing });
          push({ at: new Date(bs).toISOString(), userId: uid, type: 'break_start', label: 'Started a break' });
          if (b.endedAt) push({ at: new Date(be).toISOString(), userId: uid, type: 'break_end', label: 'Back from break', detail: `${Math.round((be - bs) / 60000)} min` });
        });
        push({ at: new Date(s.startTime).toISOString(), userId: uid, type: 'clock_in', label: 'Clocked in' });
        if (s.endTime) push({
          at: new Date(s.endTime).toISOString(), userId: uid, type: 'clock_out',
          label: s.autoClosedAt ? 'Auto clocked-out (forgot to log out)' : 'Clocked out',
          detail: `${(t.activeMs / 3_600_000).toFixed(1)}h worked`,
        });
        return {
          id: String(s._id),
          startTime: s.startTime,
          endTime: s.endTime || null,
          effectiveEnd: new Date(effEnd).toISOString(),
          status: s.status,
          autoClosedAt: s.autoClosedAt || null,
          lastHeartbeatAt: s.lastHeartbeatAt || null,
          activeMs: t.activeMs,
          breakMs: t.breakMs,
          huddleMs: h,
        };
      });
      breaks.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const longestBreakMs = breaks.reduce((mx, b) => Math.max(mx, b.durationMs), 0);

      const openSession = isToday ? mySessions.find(s => s.status === 'active' || s.status === 'on_break') : undefined;
      const lastHb = mySessions.reduce<number>((mx, s) => Math.max(mx, s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).getTime() : 0), 0);
      const hbFresh = !!openSession && lastHb > 0 && now - lastHb < 3 * 60_000;
      const inHuddle = !!openSession && !!(openSession as any).huddleJoinedAt && hbFresh;

      // ── Logins / app opens ───────────────────────────────────────
      const myAuth = authLogs.filter((l: any) => String(l.userId) === uid);
      const logins = myAuth.map((l: any) => ({
        at: l.createdAt,
        method: l.metadata?.method || (l.action === 'auth.resume' ? 'session' : 'password'),
        kind: l.action === 'auth.login' ? 'login' : 'opened',
        device: deviceLabel(l.metadata?.userAgent || ''),
        ip: l.metadata?.ip || '',
      }));
      for (const l of logins) push({
        at: new Date(l.at).toISOString(), userId: uid, type: 'login',
        label: l.kind === 'login' ? `Signed in${l.method === 'google' ? ' with Google' : ''}` : 'Opened Robin',
        detail: l.device || undefined,
      });

      const firstClockIn = daySessions.length ? daySessions[0].startTime : null;
      const lastSession = daySessions[daySessions.length - 1];
      const lastClockOut = lastSession && lastSession.status === 'ended' ? (lastSession.endTime || null) : null;
      const firstSeenCandidates = [
        ...(firstClockIn ? [new Date(firstClockIn).getTime()] : []),
        ...logins.map(l => new Date(l.at).getTime()),
      ].filter(t => t >= dayStart);
      const firstSeen = firstSeenCandidates.length ? new Date(Math.min(...firstSeenCandidates)).toISOString() : null;

      // ── Leave ────────────────────────────────────────────────────
      let leave: null | { status: string; dayType: string; reason: string } = null;
      for (const l of leaves as any[]) {
        if (String(l.userId) !== uid) continue;
        for (const d of l.days || []) {
          if (istDateKey(new Date(d.date).getTime()) === dateStr) {
            if (!leave || l.status === 'approved') leave = { status: l.status, dayType: d.dayType || 'full', reason: d.reason || '' };
          }
        }
      }

      // ── Check-ins ────────────────────────────────────────────────
      const ck: any = checkins.find((c: any) => String(c.userId) === uid);
      const plannedTasks = ck?.morning?.tasks || [];
      const checkin = {
        morningAt: ck?.morning?.submittedAt || null,
        middayAt: ck?.midday?.submittedAt || null,
        eveningAt: ck?.evening?.submittedAt || null,
        planned: plannedTasks.length,
        done: plannedTasks.filter((t: any) => t.eveningStatus === 'done' || t.middayStatus === 'done').length,
        blockers: ck?.midday?.blockers || '',
        tomorrowPlan: ck?.evening?.tomorrowPlan || '',
        tasks: plannedTasks.map((t: any) => ({
          title: t.title, client: t.clientWorkflowName || '',
          status: t.eveningStatus || t.middayStatus || 'planned',
          reason: t.eveningReason || t.middayNote || '',
        })),
      };
      if (checkin.morningAt) push({ at: new Date(checkin.morningAt).toISOString(), userId: uid, type: 'checkin', label: 'Morning check-in', detail: `${checkin.planned} task${checkin.planned === 1 ? '' : 's'} planned` });
      if (checkin.middayAt) push({ at: new Date(checkin.middayAt).toISOString(), userId: uid, type: 'checkin', label: 'Midday check-in', detail: checkin.blockers ? `Blocker: ${checkin.blockers}` : undefined });
      if (checkin.eveningAt) push({ at: new Date(checkin.eveningAt).toISOString(), userId: uid, type: 'checkin', label: 'Evening check-in', detail: `${checkin.done}/${checkin.planned} planned tasks done` });

      // ── Tasks ────────────────────────────────────────────────────
      const doneToday = tasksToday.filter((t: any) => t.assignedTo === uid && t.completedAt && new Date(t.completedAt).getTime() >= dayStart && new Date(t.completedAt).getTime() < dayEnd);
      const createdToday = tasksToday.filter((t: any) => t.assignedBy === uid && new Date(t.createdAt).getTime() >= dayStart);
      for (const t of doneToday) push({ at: new Date(t.completedAt as any).toISOString(), userId: uid, type: 'task_done', label: 'Completed a task', detail: t.title });
      for (const t of createdToday) push({ at: new Date(t.createdAt).toISOString(), userId: uid, type: 'task_created', label: t.assignedTo && t.assignedTo !== uid ? `Assigned a task to ${nameOf.get(t.assignedTo) || 'someone'}` : 'Created a task', detail: t.title });
      const myOpen = openTasks.filter((t: any) => t.assignedTo === uid);
      const overdue = myOpen.filter((t: any) => t.dueDate && new Date(t.dueDate).getTime() < now).length;

      // ── Client work / sales activity ─────────────────────────────
      const myWf = wfActs.filter((a: any) => String(a.actorId) === uid);
      for (const a of myWf as any[]) {
        const client = a.workflowId?.clientName || a.workflowId?.brandName || a.workflowId?.name || '';
        push({
          at: new Date(a.createdAt).toISOString(), userId: uid, type: 'client_work',
          label: `${String(a.action).replace(/_/g, ' ')}${client ? ` · ${client}` : ''}`,
          detail: a.comment,
        });
      }
      const myNotes = leadNotes.filter((n: any) => n.authorId === uid);
      for (const n of myNotes as any[]) push({
        at: new Date(n.createdAt).toISOString(), userId: uid, type: 'lead_note',
        label: `Lead ${n.type || 'note'}${n.leadId?.name ? ` · ${n.leadId.name}` : ''}`,
        detail: String(n.content || '').slice(0, 160),
      });
      const myMeetings = meetings.filter((mt: any) => mt.hostUserId === uid);
      for (const mt of myMeetings as any[]) push({
        at: new Date(mt.startedAt || mt.createdAt).toISOString(), userId: uid, type: 'meeting',
        label: `Client meeting${mt.clientName ? ` · ${mt.clientName}` : ''}`, detail: mt.status,
      });

      // ── 7-day trend (ending on the selected day) ─────────────────
      const week = Array.from({ length: 7 }, (_, i) => {
        const ds = weekStart + i * DAY_MS, de = Math.min(ds + DAY_MS, now);
        let a = 0, b = 0;
        if (de > ds) for (const s of mySessions) {
          const st = new Date(s.startTime).getTime();
          if (st >= de || effectiveEndMs(s as any, now) <= ds) continue;
          const t = sessionTotals(s as any, ds, de);
          a += t.activeMs; b += t.breakMs;
        }
        return { date: istDateKey(ds), activeMs: a, breakMs: b };
      });
      const workedDays = week.filter(d => d.activeMs > 0);
      const weekAvgActiveMs = workedDays.length ? workedDays.reduce((s, d) => s + d.activeMs, 0) / workedDays.length : 0;

      // ── Status + flags ───────────────────────────────────────────
      let status: 'working' | 'on_break' | 'away' | 'clocked_out' | 'not_in' | 'on_leave';
      if (openSession) status = openSession.status === 'on_break' ? 'on_break' : (hbFresh ? 'working' : 'away');
      else if (daySessions.length) status = 'clocked_out';
      else if (leave?.status === 'approved') status = 'on_leave';
      else status = 'not_in';

      const flags: string[] = [];
      if (firstClockIn && istMinutesOfDay(firstClockIn) > LATE_AFTER_MINS) flags.push('late');
      if (breakMs > STANDARD_BREAK_MS) flags.push('over_break');
      if (longestBreakMs > LONG_SINGLE_BREAK_MS) flags.push('long_break');
      if (daySessions.some(s => s.autoClosedAt)) flags.push('auto_closed');
      if (status === 'clocked_out' && activeMs < FULL_DAY_MS) flags.push('short_day');
      if (daySessions.length && !checkin.morningAt) flags.push('no_checkin');
      if (status === 'away') flags.push('idle');
      if (overdue > 0) flags.push('overdue_tasks');

      const scr: any = screenBy.get(uid);
      return {
        user: { id: uid, name: u.name, email: u.email, role: u.role, team: u.team, avatarUrl: u.avatarUrl },
        status,
        inHuddle,
        onCall: !!u.onCallSince && !!openSession,
        screenSharing: !!scr && scr.status === 'active' && !!openSession,
        firstSeen,
        logins,
        firstClockIn,
        lastClockOut,
        lastSeen: lastHb ? new Date(lastHb).toISOString() : null,
        workedMs, activeMs, breakMs, huddleMs,
        breakCount: breaks.length,
        longestBreakMs,
        breaks,
        sessions: sessionRows,
        leave,
        checkin,
        tasks: { done: doneToday.length, created: createdToday.length, open: myOpen.length, overdue, doneTitles: doneToday.map((t: any) => t.title) },
        activity: { clientWork: myWf.length, leadNotes: myNotes.length, meetings: myMeetings.length, chats: chatBy.get(uid) || 0 },
        week,
        weekAvgActiveMs,
        flags,
      };
    });

    // Org-level log rows (leave requests, vault access…) into the feed.
    for (const l of otherLogs as any[]) {
      const uid = String(l.userId || '');
      if (!nameOf.has(uid)) continue;
      const a = String(l.action || '');
      push({
        at: new Date(l.createdAt).toISOString(), userId: uid,
        type: a.startsWith('leave') ? 'leave' : a === 'client.opened' ? 'client_work' : 'other',
        label: a === 'client.opened' ? `Opened client · ${l.metadata?.label || ''}` : a.replace(/[._]/g, ' '),
        detail: a === 'client.opened' ? undefined : (l.metadata?.reason || l.metadata?.label || undefined),
      });
    }

    timeline.sort((a, b) => b.at.localeCompare(a.at));

    const present = rows.filter(r => r.sessions.length > 0);
    const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const kpis = {
      staff: rows.length,
      present: present.length,
      workingNow: rows.filter(r => r.status === 'working').length,
      onBreakNow: rows.filter(r => r.status === 'on_break').length,
      inHuddleNow: rows.filter(r => r.inHuddle).length,
      notIn: rows.filter(r => r.status === 'not_in').length,
      onLeave: rows.filter(r => r.status === 'on_leave' || r.leave?.status === 'approved').length,
      late: rows.filter(r => r.flags.includes('late')).length,
      overBreak: rows.filter(r => r.flags.includes('over_break') || r.flags.includes('long_break')).length,
      totalActiveMs: sum(r => r.activeMs),
      totalBreakMs: sum(r => r.breakMs),
      totalHuddleMs: sum(r => r.huddleMs),
      avgActiveMs: present.length ? sum(r => r.activeMs) / present.length : 0,
      tasksDone: sum(r => r.tasks.done),
      overdueTasks: sum(r => r.tasks.overdue),
      checkinsMorning: rows.filter(r => r.checkin.morningAt).length,
      checkinsEvening: rows.filter(r => r.checkin.eveningAt).length,
      activityEvents: timeline.length,
    };

    res.json({
      date: dateStr,
      isToday,
      generatedAt: new Date(now).toISOString(),
      thresholds: { lateAfter: '09:30', breakAllowanceMs: STANDARD_BREAK_MS, longSingleBreakMs: LONG_SINGLE_BREAK_MS, fullDayMs: FULL_DAY_MS },
      kpis,
      rows,
      timeline: timeline.slice(0, 600),
    });
  } catch (err) {
    console.error('[oversight] getOversightDay failed', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

// GET /api/oversight/access — admin only: who has manager access
export async function listOversightAccess(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId').lean();
    const users = await User.find({
      organizationId: me?.organizationId,
      isActive: true,
      role: { $in: ['admin', 'employee', 'sales', 'workroom'] },
    }).select('_id name email role roles canViewOversight').sort({ name: 1 }).lean();
    res.json(users.map((u: any) => ({
      id: String(u._id), name: u.name, email: u.email, role: u.role,
      isAdmin: u.role === 'admin' || (u.roles || []).includes('admin'),
      canViewOversight: u.canViewOversight === true,
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/oversight/access/:id  { enabled: boolean } — admin only
export async function setOversightAccess(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId').lean();
    const enabled = req.body?.enabled === true;
    const upd = await User.updateOne({ _id: req.params.id, organizationId: me?.organizationId }, { $set: { canViewOversight: enabled } });
    if (!upd.matchedCount) { res.status(404).json({ error: 'User not found' }); return; }
    const u: any = await User.findById(req.params.id).select('_id name canViewOversight').lean();
    ActivityLog.create({
      organizationId: me?.organizationId, userId: req.user!.id,
      action: enabled ? 'oversight.access_granted' : 'oversight.access_revoked',
      entity: 'user', entityId: u!._id, metadata: { label: u!.name },
    }).catch(() => {});
    res.json({ id: String(u._id), name: u.name, canViewOversight: u.canViewOversight === true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/oversight/members — Oct 2026 ("add one option at Rahul's end to
 * add new member"). Admin and Team-Oversight managers (Rahul) can add a
 * teammate. Managers can't create admins. Returns a starting password ONCE
 * (the model bcrypts it on save) for Rahul to share.
 */
const MEMBER_ROLES = ['employee', 'sales', 'workroom'];
const MEMBER_TEAMS = ['development', 'meta', 'influencer', 'sales', 'design', 'script', 'social', 'qa', 'management'];
function startingPassword(name: string) {
  const first = (name.split(/\s+/)[0] || 'Robin').replace(/[^a-z]/gi, '') || 'Robin';
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}@${n}`;
}
export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId name').lean();
    const orgId = me?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
    const role = String(req.body?.role || 'employee');
    const teams: string[] = Array.isArray(req.body?.teams) ? req.body.teams.filter((t: string) => MEMBER_TEAMS.includes(t)) : [];
    const allowedRoles = isAdmin(req) ? [...MEMBER_ROLES, 'admin'] : MEMBER_ROLES;
    if (name.length < 2) { res.status(400).json({ error: 'Enter the full name' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'Enter a valid email' }); return; }
    if (!allowedRoles.includes(role)) { res.status(400).json({ error: isAdmin(req) ? 'Pick a role' : 'Managers can add employees, sales or workroom staff — ask an admin for admin accounts' }); return; }
    const password = startingPassword(name);

    const existing: any = await User.findOne({ email });
    if (existing) {
      if (String(existing.organizationId) !== String(orgId)) { res.status(409).json({ error: 'That email is already used by another Robin account' }); return; }
      if (existing.isActive !== false) { res.status(409).json({ error: `${existing.name || email} is already on the team` }); return; }
      existing.isActive = true; existing.name = name; existing.role = role; existing.teams = teams;
      existing.team = teams[0] || ''; if (phone) existing.phone = phone;
      existing.passwordHash = password;
      await existing.save();
      res.json({ id: String(existing._id), name, email, role, teams, password, reactivated: true });
      return;
    }
    const u: any = await User.create({
      name, email, phone, role, teams, team: teams[0] || '', organizationId: orgId, isActive: true, passwordHash: password,
    });
    ActivityLog.create({ organizationId: orgId, userId: req.user!.id, action: 'member.added', entity: 'user', entityId: u._id,
      metadata: { label: `${name} (${role}${teams.length ? ` · ${teams.join(', ')}` : ''})` } }).catch(() => {});
    res.status(201).json({ id: String(u._id), name, email, role, teams, password, reactivated: false });
  } catch (err: any) {
    if (err?.code === 11000) { res.status(409).json({ error: 'That email is already used' }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
}

// GET /api/oversight/members — Team & roles list (active + removed)
export async function listMembers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId').lean();
    const users = await User.find({ organizationId: me?.organizationId, role: { $in: ['admin', 'employee', 'sales', 'workroom'] } })
      .select('_id name email phone role roles team teams department isActive canViewOversight createdAt').sort({ isActive: -1, name: 1 }).lean();
    const open = await ClientWorkflow.aggregate([
      { $match: { organizationId: me?.organizationId } }, { $unwind: '$services' },
      { $match: { 'services.status': { $ne: 'done' } } }, { $group: { _id: '$services.assignedTo', n: { $sum: 1 } } },
    ]);
    const openBy = new Map(open.map((o: any) => [String(o._id), o.n]));
    res.json(users.map((u: any) => ({
      id: String(u._id), name: u.name, email: u.email, phone: u.phone || '', role: u.role,
      isAdmin: u.role === 'admin' || (u.roles || []).includes('admin'),
      teams: u.teams || [], department: u.department || '', isActive: u.isActive !== false,
      canViewOversight: u.canViewOversight === true, openStages: openBy.get(String(u._id)) || 0,
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/oversight/members/:id  { role?, teams?, department?, isActive? }
export async function updateMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = await User.findById(req.user!.id).select('organizationId').lean();
    const orgId = String(me?.organizationId || '');
    const u: any = await User.findOne({ _id: req.params.id, organizationId: orgId });
    if (!u) { res.status(404).json({ error: 'Teammate not found' }); return; }
    const admin = isAdmin(req);
    const targetIsAdmin = u.role === 'admin' || (u.roles || []).includes('admin');
    if (!admin && targetIsAdmin) { res.status(403).json({ error: 'Only an admin can change an admin account' }); return; }
    const body = req.body || {};
    if (body.isActive === false) {
      if (String(u._id) === req.user!.id) { res.status(400).json({ error: "You can't remove yourself" }); return; }
      const { moved } = await deactivateMember(orgId, String(u._id), req.user!.id);
      res.json({ ok: true, removed: true, reassigned: moved });
      return;
    }
    if (body.isActive === true && u.isActive === false) u.isActive = true;
    if (body.role !== undefined) {
      const allowed = admin ? ['admin', ...MEMBER_ROLES] : MEMBER_ROLES;
      if (!allowed.includes(body.role)) { res.status(400).json({ error: admin ? 'Pick a valid role' : 'Managers can set employee, sales or workroom' }); return; }
      if (String(u._id) === req.user!.id && body.role !== u.role) { res.status(400).json({ error: "You can't change your own role" }); return; }
      u.role = body.role;
    }
    if (Array.isArray(body.teams)) { u.teams = body.teams.filter((t: string) => MEMBER_TEAMS.includes(t)); u.team = u.teams[0] || ''; }
    if (typeof body.department === 'string') u.department = body.department.trim().slice(0, 80);
    await u.save();
    ActivityLog.create({ organizationId: orgId, userId: req.user!.id, action: 'member.updated', entity: 'user', entityId: u._id,
      metadata: { label: `${u.name}: ${u.role}${u.teams?.length ? ` · ${u.teams.join(', ')}` : ''}${u.department ? ` · ${u.department}` : ''}` } }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
