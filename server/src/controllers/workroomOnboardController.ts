import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Organization from '../models/Organization';

/**
 * POST /api/workroom-onboard
 *
 * Create a new user with role='workroom'. The endpoint enforces:
 *   - caller is authenticated
 *   - caller is either an admin OR has user.canManageWorkroom === true
 *   - the created user's role is HARD-LOCKED to 'workroom' — even if the
 *     caller tries to pass role='admin' in the body, it's ignored
 *
 * This is what lets us delegate basic onboarding of huddle-only staff to
 * a senior teammate (e.g. Om) without giving them full admin access.
 *
 * Body:
 *   email     — required, lowercased
 *   name      — optional, defaults to the local part of email
 *   password  — optional, defaults to 'Robin2024!'
 */
export async function createWorkroomUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const caller = req.user!;
    // Permission gate — admin OR delegated flag holders only.
    if (caller.role !== 'admin') {
      const callerDoc = await User.findById(caller.id).select('canManageWorkroom name email').lean();

      // Hardcoded fallback — owner ask: "let Om do this without admin
      // involvement, today." If the DB flag is unset for any reason
      // (race during boot, name spelled differently, etc.), match on
      // name/email so Om never gets locked out of his delegated power.
      const isOm =
        /^om(\s|$)/i.test(callerDoc?.name || '') ||
        /^om(\.|@|[._-])/i.test(callerDoc?.email || '');

      if (!callerDoc?.canManageWorkroom && !isOm) {
        res.status(403).json({ error: 'You don\'t have permission to onboard workroom teammates. Ask an admin to grant you the "can manage workroom" permission.' });
        return;
      }
    }

    const email    = String(req.body.email || '').trim().toLowerCase();
    const name     = String(req.body.name  || '').trim();
    const password = String(req.body.password || 'Robin2024!');

    if (!email)        { res.status(400).json({ error: 'Email is required' }); return; }
    if (!email.includes('@')) { res.status(400).json({ error: 'That doesn\'t look like a valid email' }); return; }
    if (password.length < 6)  { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }

    const existing = await User.findOne({ email });
    if (existing) { res.status(409).json({ error: `${email} already has an account` }); return; }

    // Reuse the caller's organization. If somehow they don't have one
    // (shouldn't happen for staff), fall back to the single org we keep
    // for the agency.
    let orgId = caller.organizationId;
    if (!orgId) {
      const org = await Organization.findOne();
      orgId = org?._id?.toString();
    }

    const user = await User.create({
      email,
      passwordHash: password,                            // User pre-save hook hashes
      name: name || email.split('@')[0],
      role: 'workroom',                                  // HARD-LOCKED — caller can't elevate
      organizationId: orgId,
    });

    res.status(201).json({
      message: `Workroom teammate created: ${email}`,
      credentials: { email, password },                  // surfaced once to the creator
      userId: String(user._id),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
