import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';

// GET /api/users
export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const users = await User.find({ isActive: true }).select('-passwordHash').lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/users/:id
export async function getUserById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/users/:id  (admin only)
export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, role, team, phone, isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { ...(name && { name }), ...(role && { role }), ...(team !== undefined && { team }), ...(phone !== undefined && { phone }), ...(isActive !== undefined && { isActive }) } },
      { new: true }
    ).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/users/:id
export async function deleteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'User deactivated' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
