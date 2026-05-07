import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';
import bcrypt from 'bcryptjs';
import Lead from '../models/Lead';
import Project from '../models/Project';

// POST /api/users  (admin creates a new user — client, employee, etc.)
export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, email, password, role = 'client', team = '', phone = '', company = '', department = '', fromLeadId } = req.body;
    if (!name || !email || !password) { res.status(400).json({ error: 'name, email and password are required' }); return; }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) { res.status(409).json({ error: 'A user with this email already exists' }); return; }

    // Inherit org from the creating admin
    const admin = await User.findById(req.user!.id).select('organizationId');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, email: email.toLowerCase(), passwordHash, role, team, phone, department,
      company, organizationId: admin?.organizationId, isActive: true,
    });

    // If created from a won lead — mark the lead as converted
    if (fromLeadId) {
      await Lead.findByIdAndUpdate(fromLeadId, { convertedToClientId: String(user._id) });
    }

    res.status(201).json({ ...user.toObject(), passwordHash: undefined, generatedPassword: password });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/users
export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role, team, isActive } = req.query as Record<string, string>;
    const filter: Record<string, any> = {};
    if (role)     filter.role     = role;
    if (team)     filter.team     = team;
    if (isActive !== undefined) filter.isActive = isActive !== 'false';
    else filter.isActive = { $ne: false };   // default: exclude deactivated
    const users = await User.find(filter).select('-passwordHash').lean();
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
//
// Now also accepts `teams: string[]` and `roles: string[]` so admin can
// assign an employee to multiple teams (e.g., ads + influencer) or grant
// secondary roles. Primary `team` and `role` stay as the canonical
// values; the arrays are additive on top.
export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, role, team, teams, roles, phone, isActive } = req.body;
    const update: Record<string, any> = {};
    if (name)                  update.name = name;
    if (role)                  update.role = role;
    if (team !== undefined)    update.team = team;
    if (Array.isArray(teams))  update.teams = Array.from(new Set(teams.filter(Boolean)));
    if (Array.isArray(roles))  update.roles = Array.from(new Set(roles.filter(Boolean)));
    if (phone !== undefined)   update.phone = phone;
    if (isActive !== undefined) update.isActive = isActive;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: update },
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
