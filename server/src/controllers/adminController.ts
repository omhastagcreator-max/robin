import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Project from '../models/Project';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';
import ActivityLog from '../models/ActivityLog';
import bcrypt from 'bcryptjs';
import Organization from '../models/Organization';

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

    let totalWorkedMs = 0;
    let totalBreakMs  = 0;

    for (const s of sessions) {
      const startMs = new Date(s.startTime as Date).getTime();
      const endMs   = s.endTime ? new Date(s.endTime as Date).getTime() : now;

      // Clamp the worked window into the requested period
      const clampedStart = Math.max(startMs, startDate.getTime());
      const clampedEnd   = Math.min(endMs, now);
      if (clampedEnd <= clampedStart) continue;

      totalWorkedMs += (clampedEnd - clampedStart);

      // Always re-derive breaks from breakEvents (breakTime is only finalised
      // when a session ends, so live sessions report 0 there).
      for (const b of (s.breakEvents || [])) {
        if (!b.startedAt) continue;
        const bStart = new Date(b.startedAt as Date).getTime();
        const bEnd   = b.endedAt ? new Date(b.endedAt as Date).getTime() : now;
        const cs = Math.max(bStart, startDate.getTime());
        const ce = Math.min(bEnd,   now);
        if (ce > cs) totalBreakMs += (ce - cs);
      }
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
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
