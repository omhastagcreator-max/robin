import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Organization from '../models/Organization';

export interface AuthRequest extends Request {
  user?: {
    id:             string;
    email:          string;
    role:           string;
    name:           string;
    team?:          string;
    teams?:         string[];      // additional teams (multi-team support)
    roles?:         string[];      // additional roles (multi-role support)
    organizationId?: string;
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    // JWT payload is { id: userId } — look up fresh user from DB
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id?: string; userId?: string };
    const userId  = payload.id || payload.userId;
    if (!userId) { res.status(401).json({ error: 'Invalid token payload' }); return; }

    const user = await User.findById(userId).select('email name role roles team teams organizationId');
    if (!user) { res.status(401).json({ error: 'User not found' }); return; }

    // SAFETY NET — legacy users without an organizationId would otherwise hit
    // 400 "No organization" on every endpoint after the org-isolation pass.
    // Auto-attach them to the first existing org (the agency) and persist,
    // so this only happens once per stranded account.
    let orgId = user.organizationId ? String(user.organizationId) : undefined;
    if (!orgId) {
      try {
        const fallback = await Organization.findOne().sort({ createdAt: 1 }).select('_id').lean();
        if (fallback?._id) {
          user.organizationId = fallback._id;
          await user.save();
          orgId = String(fallback._id);
          console.warn('[auth] auto-attached user to default org', { userId: String(user._id), email: user.email, orgId });
        }
      } catch (e) {
        console.error('[auth] failed to auto-attach org', e);
      }
    }

    req.user = {
      id:             String(user._id),
      email:          user.email,
      role:           user.role ?? 'employee',
      name:           user.name,
      team:           user.team ?? '',
      teams:          (user as any).teams || [],
      roles:          (user as any).roles || [],
      organizationId: orgId,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Convenience helper — call after authMiddleware.
 * Checks BOTH the primary `role` field AND the `roles[]` multi-role array
 * so admin-granted secondary roles count. Without this, anyone whose
 * primary role got changed to e.g. 'meta' would lose access to
 * everything they should still have.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const primary = req.user.role;
    const extras  = req.user.roles || [];
    const hasMatch = roles.includes(primary) || extras.some(r => roles.includes(r));
    if (!hasMatch) {
      res.status(403).json({ error: `Requires one of roles: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}
