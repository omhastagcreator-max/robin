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
