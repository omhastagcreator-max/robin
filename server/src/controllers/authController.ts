import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Organization from '../models/Organization';
import { AuthRequest } from '../middleware/authMiddleware';

function signToken(userId: string, email: string, role: string, name: string): string {
  return jwt.sign(
    { userId, email, role, name },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
  );
}

// POST /api/auth/register
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, role = 'employee', team = '' } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }
    if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) { res.status(409).json({ error: 'Email already in use' }); return; }

    let org = await Organization.findOne();
    if (!org) org = await Organization.create({ name: 'Robin Agency', plan: 'pro' });

    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash: password,   // model pre-save will hash it
      name: name || email.split('@')[0],
      role,
      team,
      organizationId: org._id,
    });

    const token = signToken(String(user._id), user.email, user.role, user.name);
    res.status(201).json({
      token,
      user: { id: String(user._id), email: user.email, name: user.name, role: user.role, team: user.team },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// POST /api/auth/login
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(String(user._id), user.email, user.role, user.name);
    res.json({
      token,
      user: { id: String(user._id), email: user.email, name: user.name, role: user.role, team: user.team, avatarUrl: user.avatarUrl },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// GET /api/auth/me  (requires auth)
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user!.id).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user, role: user.role });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// PUT /api/auth/me  (update own profile)
export async function updateMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, phone, team, avatarUrl } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user!.id,
      { $set: { ...(name && { name }), ...(phone !== undefined && { phone }), ...(team !== undefined && { team }), ...(avatarUrl && { avatarUrl }) } },
      { new: true }
    ).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user, role: user.role });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// PUT /api/auth/password
export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) { res.status(400).json({ error: 'New password must be at least 6 characters' }); return; }
    const user = await User.findById(req.user!.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (currentPassword && !(await user.comparePassword(currentPassword))) {
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }
    user.passwordHash = newPassword;
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
