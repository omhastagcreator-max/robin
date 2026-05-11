import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import bcrypt from 'bcryptjs';
import Lead from '../models/Lead';

/**
 * Users controller — STRICT org isolation.
 *
 * Every endpoint here verifies that the actor and the target user share the
 * same organizationId. Without this, one agency could enumerate / read /
 * modify users belonging to another agency, which is the single biggest
 * SaaS data-breach risk in this app.
 */

async function getActorOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

// POST /api/users  (admin creates a new user — client, employee, etc.)
export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, email, password, role = 'client', team = '', phone = '', company = '', department = '', fromLeadId } = req.body;
    if (!name || !email || !password) { res.status(400).json({ error: 'name, email and password are required' }); return; }

    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    // Org-scoped uniqueness — same email is allowed in different agencies.
    // Mongo's unique index on email would normally collide; we manually
    // check within-org uniqueness instead.
    const exists = await User.findOne({ email: email.toLowerCase(), organizationId: orgId });
    if (exists) { res.status(409).json({ error: 'A user with this email already exists in your agency' }); return; }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, email: email.toLowerCase(), passwordHash, role, team, phone, department,
      company, organizationId: orgId, isActive: true,
    });

    if (fromLeadId) {
      // Org-check the lead too — don't let an admin convert another agency's lead.
      await Lead.findOneAndUpdate(
        { _id: fromLeadId, organizationId: orgId },
        { convertedToClientId: String(user._id) },
      );
    }

    res.status(201).json({ ...user.toObject(), passwordHash: undefined, generatedPassword: password });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/users — list users in MY organization only.
export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const { role, team, isActive } = req.query as Record<string, string>;
    const filter: Record<string, any> = { organizationId: orgId };
    if (role)     filter.role     = role;
    if (team)     filter.team     = team;
    if (isActive !== undefined) filter.isActive = isActive !== 'false';
    else filter.isActive = { $ne: false };   // default: exclude deactivated

    const users = await User.find(filter).select('-passwordHash').lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/users/:id — returns the user only if they're in MY organization.
export async function getUserById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const user = await User.findOne({ _id: req.params.id, organizationId: orgId }).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/users/:id — admin only, target must be in the same org.
export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const { name, role, team, teams, roles, phone, isActive } = req.body;
    const update: Record<string, any> = {};
    if (name)                  update.name = name;
    if (role)                  update.role = role;
    if (team !== undefined)    update.team = team;
    if (Array.isArray(teams))  update.teams = Array.from(new Set(teams.filter(Boolean)));
    if (Array.isArray(roles))  update.roles = Array.from(new Set(roles.filter(Boolean)));
    if (phone !== undefined)   update.phone = phone;
    if (isActive !== undefined) update.isActive = isActive;

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { $set: update },
      { new: true }
    ).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/users/:id — soft delete. Org-scoped.
export async function deleteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const result = await User.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { isActive: false },
    );
    if (!result) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ message: 'User deactivated' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/users/:id/reset-password  (admin only, org-scoped)
 * Body: { newPassword?: string }   — if omitted, a random one is generated
 *
 * Used when someone forgets their password and admin wants to set a new one.
 * Hashes via bcrypt directly (bypassing Mongoose middleware would store
 * plaintext — that's why we don't use findOneAndUpdate here).
 *
 * Returns the new password so the admin can share it with the user. The
 * user should change it on first login (we'll add a "must reset" flag in
 * a future pass).
 */
export async function adminResetPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const orgId = await getActorOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'Your account is not linked to an organization.' }); return; }

    const target = await User.findOne({ _id: req.params.id, organizationId: orgId });
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }

    // Either use the password the admin typed, or generate a sensible random one.
    let newPassword: string = (req.body?.newPassword || '').toString().trim();
    if (!newPassword) {
      // Pattern: Capital + 4 chars + @ + 4 digits → easy to read out loud, hard to guess.
      const rand = Math.random().toString(36).slice(2, 6);
      const num  = Math.floor(1000 + Math.random() * 9000);
      newPassword = `${rand[0].toUpperCase()}${rand.slice(1)}@${num}`;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }

    target.passwordHash = await bcrypt.hash(newPassword, 12);
    await target.save();

    res.json({
      ok: true,
      message: `Password reset for ${target.name || target.email}`,
      newPassword,                                 // returned so admin can share it
      email: target.email,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
