import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Project from '../models/Project';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';
import ActivityLog from '../models/ActivityLog';
import bcrypt from 'bcryptjs';
import Organization from '../models/Organization';
import { sessionTotals, effectiveEndMs } from '../services/sessionTime';

// GET /api/admin/employees
export async function listEmployees(req: AuthRequest, res: Response): Promise<void> {
  try {
    const employees = await User.find({ role: { $in: ['employee', 'sales'] }, isActive: true }).select('-passwordHash').lean();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const enriched = await Promise.all(employees.map(async (e) => {
      const activeSession = await Session.findOne({ userId: String(e._id), status: { $in: ['active', 'on_break'] } });
      const tasksDoneToday = await ProjectTask.countDocuments({
        assignedTo: String(e._id), status: 'done',
        completedAt: { $gte: today },
      });
      return {
        ...e,
        sessionStatus: activeSession?.status || 'none',
        tasksDoneToday,
      };
    }));

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/clients
export async function listClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const clients = await User.find({ role: 'client', isActive: true }).select('-passwordHash').lean();
    const enriched = await Promise.all(clients.map(async (c) => {
      const projectCount = await Project.countDocuments({ clientId: String(c._id), status: 'active' });
      return { ...c, projectCount };
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/activity
export async function getActivityLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/admin/invite  (creates user directly)
export async function inviteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email, role = 'employee', name = '', team = '', password = 'Robin2024!' } = req.body;
    if (!email) { res.status(400).json({ error: 'Email required' }); return; }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) { res.status(409).json({ error: 'User already exists' }); return; }

    let org = await Organization.findOne();
    if (!org) org = await Organization.create({ name: 'Robin Agency', plan: 'pro' });

    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash: password,
      name: name || email.split('@')[0],
      role,
      team,
      organizationId: org._id,
    });

    res.status(201).json({ 
      message: `User created: ${email}`,
      credentials: { email, password, role },
      userId: String(user._id),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/admin/users/:id/role
export async function updateUserRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/admin/users/:id
// Soft-deactivate the user (preserves history). Admin can't deactivate themselves.
export async function deactivateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.params.id === req.user!.id) {
      res.status(400).json({ error: "You can't deactivate your own admin account" });
      return;
    }
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    user.isActive = false;
    await user.save();
    res.json({ message: `${user.name || user.email} has been removed`, userId: String(user._id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/admin/users/:id/reset-password
export async function resetUserPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { newPassword = 'Robin2024!' } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    user.passwordHash = newPassword;
    await user.save();
    res.json({ message: 'Password reset', newPassword });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/attendance?date=YYYY-MM-DD
//
// Daily attendance report: every internal staff member with their
// session timestamps for the chosen IST date. Lets admin see at a
// glance who clocked in when, who's still active, who got auto-closed
// for forgetting to clock out.
export async function getAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Pull org from current admin
    const adminUser = await User.findById(req.user!.id).select('organizationId');
    const orgId = adminUser?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    // IST date window. Default = today in IST.
    const dateStr = (req.query.date as string) || (() => {
      const ist = new Date(Date.now() + 330 * 60_000);
      return ist.toISOString().slice(0, 10);
    })();
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { res.status(400).json({ error: 'Invalid date — use YYYY-MM-DD' }); return; }
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    // IST midnight start of that day, expressed in UTC = -5:30h from IST
    const dayStartIstUtc = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 330 * 60_000);
    const dayEndIstUtc   = new Date(dayStartIstUtc.getTime() + 24 * 3600 * 1000);
    const now = Date.now();

    // Pull every internal staff member.
    const staff = await User.find({
      organizationId: orgId,
      role: { $in: ['admin', 'employee', 'sales'] },
      isActive: true,
    }).select('_id name email role team avatarUrl').sort({ name: 1 }).lean();

    // Pull all sessions that overlap that IST day.
    const sessions = await Session.find({
      organizationId: orgId,
      $or: [
        { startTime: { $gte: dayStartIstUtc, $lt: dayEndIstUtc } },           // started in-day
        { endTime:   { $gte: dayStartIstUtc, $lt: dayEndIstUtc } },           // ended in-day
        { startTime: { $lt: dayStartIstUtc }, endTime:   { $gte: dayEndIstUtc } }, // spanned
        { startTime: { $lt: dayStartIstUtc }, status: { $in: ['active', 'on_break'] } }, // still open
      ],
    }).sort({ startTime: 1 }).lean();

    // Group + summarise per user.
    const byUser = staff.map((u: any) => {
      const uid = String(u._id);
      const userSessions = sessions.filter(s => String(s.userId) === uid);

      // Compute time totals clamped to the IST day window.
      let totalWorkedMs = 0;
      let totalBreakMs  = 0;
      const sessionRows = userSessions.map(s => {
        const t = sessionTotals(s as any, dayStartIstUtc.getTime(), Math.min(dayEndIstUtc.getTime(), now));
        totalWorkedMs += t.workedMs;
        totalBreakMs  += t.breakMs;
        const effEnd = effectiveEndMs(s as any, now);
        return {
          _id: s._id,
          startTime: s.startTime,
          endTime:   s.endTime || null,
          effectiveEnd: new Date(effEnd),
          status:    s.status,
          autoClosedAt: s.autoClosedAt || null,
          lastHeartbeatAt: s.lastHeartbeatAt || null,
          breakEvents: s.breakEvents || [],
          workedMs: t.workedMs,
          breakMs:  t.breakMs,
          activeMs: t.activeMs,
        };
      });
      const totalActiveMs = Math.max(0, totalWorkedMs - totalBreakMs);

      // Friendly aggregates for the row.
      const firstClockIn = userSessions.length ? userSessions[0].startTime : null;
      const lastSession  = userSessions[userSessions.length - 1];
      const lastClockOut = lastSession?.endTime || null;
      const isStillActive = userSessions.some(s => s.status === 'active' || s.status === 'on_break');

      return {
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          team: u.team,
          avatarUrl: u.avatarUrl,
        },
        firstClockIn,
        lastClockOut,
        isStillActive,
        sessionCount: userSessions.length,
        totalWorkedMs,
        totalActiveMs,
        totalBreakMs,
        sessions: sessionRows,
      };
    });

    res.json({
      date: dateStr,
      now: new Date(now),
      windowStart: dayStartIstUtc,
      windowEnd:   dayEndIstUtc,
      rows: byUser,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/employees/:id/report?period=daily|weekly|monthly
export async function getEmployeeReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const period = (req.query.period as string) || 'daily';

    // Compute startDate based on server time
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // Default daily = today 00:00

    if (period === 'weekly') {
      const day = startDate.getDay();                              // 0 = Sun, 1 = Mon …
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1); // back to Monday
      startDate.setDate(diff);
    } else if (period === 'monthly') {
      startDate.setDate(1); // first of the month
    }

    // Verify employee exists
    const employee = await User.findById(id).select('-passwordHash').lean();
    if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }

    // Activity log for the timeframe
    const activities = await ActivityLog.find({ userId: id, createdAt: { $gte: startDate } })
      .sort({ createdAt: -1 })
      .lean();

    // Tasks assigned to user that were touched (created/updated/completed) within the timeframe
    const tasksTouchedInPeriod = await ProjectTask.find({
      assignedTo: id,
      $or: [
        { createdAt:   { $gte: startDate } },
        { updatedAt:   { $gte: startDate } },
        { completedAt: { $gte: startDate } },
      ],
    }).populate('projectId', 'name').sort({ updatedAt: -1 }).lean();

    // Tasks completed within the timeframe
    const completedTasks = await ProjectTask.find({
      assignedTo: id,
      status: 'done',
      completedAt: { $gte: startDate },
    }).populate('projectId', 'name').sort({ completedAt: -1 }).lean();

    // Tasks currently ongoing (not bounded by period — overall pipeline)
    const ongoingTasks = await ProjectTask.find({
      assignedTo: id,
      status: { $in: ['pending', 'ongoing'] },
    }).populate('projectId', 'name').sort({ dueDate: 1 }).lean();

    // Tasks newly assigned to user inside the period
    const totalTasksAssignedInPeriod = await ProjectTask.countDocuments({
      assignedTo: id,
      createdAt: { $gte: startDate },
    });

    // ── Session time aggregation (working / active / break hours) ──────────
    // Pull every session that overlaps the period: it either started inside
    // the window, or it's still open (no endTime) and was started before.
    const now = Date.now();
    const sessions = await Session.find({
      userId: id,
      $or: [
        { startTime: { $gte: startDate } },                                // started in period
        { endTime:   { $gte: startDate } },                                // ended in period
        { status:    { $in: ['active', 'on_break'] } },                    // still running
      ],
    }).lean();

    // Use the shared sessionTime service so heartbeat-clamped time flows
    // through reports too. A forgotten clock-out no longer adds phantom hours.
    let totalWorkedMs = 0;
    let totalBreakMs  = 0;
    for (const s of sessions) {
      const t = sessionTotals(s as any, startDate.getTime(), now);
      totalWorkedMs += t.workedMs;
      totalBreakMs  += t.breakMs;
    }
    const activeMs = Math.max(0, totalWorkedMs - totalBreakMs);

    // ── Task completion stats ───────────────────────────────────────────────
    // "Touched" tasks within the period are the realistic universe of work
    // they engaged with this period. Completion rate = done / touched.
    const totalTasksTouched   = tasksTouchedInPeriod.length;
    const completedInTouched  = tasksTouchedInPeriod.filter((t: any) => t.status === 'done').length;
    const completionRate      = totalTasksTouched > 0
      ? Math.round((completedInTouched / totalTasksTouched) * 100)
      : 0;

    // Status + priority breakdowns — useful for the "brief info" card
    const statusBreakdown   = { pending: 0, ongoing: 0, done: 0 } as Record<string, number>;
    const priorityBreakdown = { low: 0, medium: 0, high: 0, urgent: 0 } as Record<string, number>;
    for (const t of tasksTouchedInPeriod as any[]) {
      if (t.status   in statusBreakdown)   statusBreakdown[t.status]++;
      if (t.priority in priorityBreakdown) priorityBreakdown[t.priority]++;
    }

    // Overdue tasks among the user's overall ongoing pipeline
    const overdueCount = ongoingTasks.filter((t: any) =>
      t.dueDate && new Date(t.dueDate).getTime() < now
    ).length;

    // ── Attendance: per-day clock-in/out + averages over last 30 days ─────
    // We pull a wider window (30 days) for the *averages* so they're
    // statistically meaningful, but the per-day list is scoped to the
    // current report period.
    const periodSessions = sessions
      .filter(s => s.startTime)
      .map(s => ({
        _id: s._id,
        startTime: s.startTime,
        endTime: s.endTime || null,
        status: s.status,
        autoClosedAt: s.autoClosedAt || null,
      }))
      .sort((a, b) => new Date(a.startTime as any).getTime() - new Date(b.startTime as any).getTime());

    // Group per IST date — for each date, take the FIRST start and LAST end.
    const byDate = new Map<string, { firstStart: Date; lastEnd: Date | null; count: number }>();
    const istDateKey = (d: Date) => {
      const ist = new Date(d.getTime() + 330 * 60_000);
      return ist.toISOString().slice(0, 10);
    };
    for (const s of periodSessions) {
      const key = istDateKey(new Date(s.startTime as any));
      const slot = byDate.get(key);
      const start = new Date(s.startTime as any);
      const end = s.endTime ? new Date(s.endTime as any) : null;
      if (!slot) {
        byDate.set(key, { firstStart: start, lastEnd: end, count: 1 });
      } else {
        if (start < slot.firstStart) slot.firstStart = start;
        if (end && (!slot.lastEnd || end > slot.lastEnd)) slot.lastEnd = end;
        slot.count += 1;
      }
    }
    const dailyAttendance = Array.from(byDate.entries())
      .map(([dateKey, v]) => ({
        date: dateKey,
        firstStart: v.firstStart,
        lastEnd: v.lastEnd,
        sessionCount: v.count,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    // Compute typical start / end of day. Use the last 30 days of CLOSED
    // sessions (so we don't include incomplete days). Convert to "minutes
    // since IST midnight" for averaging, then format as HH:MM.
    const thirtyDaysAgo = new Date(now - 30 * 86400_000);
    const recentClosed = await Session.find({
      userId: id,
      startTime: { $gte: thirtyDaysAgo },
    }).select('startTime endTime').lean();

    const minutesIst = (d: Date) => {
      const ist = new Date(d.getTime() + 330 * 60_000);
      return ist.getUTCHours() * 60 + ist.getUTCMinutes();
    };
    const startMins: number[] = [];
    const endMins: number[] = [];
    // Group recent sessions per date and take first start / last end per day
    const recentByDate = new Map<string, { first: Date; last: Date | null }>();
    for (const s of recentClosed) {
      const start = new Date(s.startTime as any);
      const k = istDateKey(start);
      const slot = recentByDate.get(k);
      const end = s.endTime ? new Date(s.endTime as any) : null;
      if (!slot) recentByDate.set(k, { first: start, last: end });
      else {
        if (start < slot.first) slot.first = start;
        if (end && (!slot.last || end > slot.last)) slot.last = end;
      }
    }
    for (const v of recentByDate.values()) {
      startMins.push(minutesIst(v.first));
      if (v.last) endMins.push(minutesIst(v.last));
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const fmtHM = (m: number | null) => {
      if (m === null) return null;
      const h = Math.floor(m / 60);
      const mm = String(m % 60).padStart(2, '0');
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${mm} ${period}`;
    };
    const avgStartMin = avg(startMins);
    const avgEndMin   = avg(endMins);

    res.json({
      period,
      startDate,
      employee,
      stats: {
        // Tasks
        totalTasksDoneInPeriod:     completedTasks.length,
        totalTasksAssignedInPeriod,
        totalTasksOngoing:          ongoingTasks.length,
        activityCount:              activities.length,
        // Time (all in milliseconds; client formats to hours/minutes)
        totalWorkedMs,
        activeMs,
        totalBreakMs,
        sessionCount:               sessions.length,
      },
      completion: {
        totalTasksTouched,
        completedInTouched,
        completionRate,           // 0–100
        statusBreakdown,
        priorityBreakdown,
        overdueCount,
      },
      activities,
      tasks: {
        completed: completedTasks,
        ongoing:   ongoingTasks,
        touched:   tasksTouchedInPeriod,
      },
      attendance: {
        // Averages over the LAST 30 DAYS — separate window from the
        // report period so they're statistically stable.
        usualStartTime: fmtHM(avgStartMin),  // e.g. "9:42 AM"
        usualEndTime:   fmtHM(avgEndMin),    // e.g. "6:15 PM"
        sampleSize:     recentByDate.size,    // how many days the avg is based on
        // Per-day attendance for the REPORT PERIOD only.
        days: dailyAttendance,
      },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
