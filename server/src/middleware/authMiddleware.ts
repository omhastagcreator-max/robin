import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

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

    req.user = {
      id:             String(user._id),
      email:          user.email,
      role:           user.role ?? 'employee',
      name:           user.name,
      team:           user.team ?? '',
      teams:          (user as any).teams || [],
      roles:          (user as any).roles || [],
      organizationId: user.organizationId ? String(user.organizationId) : undefined,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Convenience helper — call after authMiddleware */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: `Requires one of roles: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}
