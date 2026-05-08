import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';

/**
 * requireRole — checks BOTH the primary `role` field AND the multi-role
 * `roles[]` array we added later. A user with primary role 'sales' and
 * an extra 'admin' in roles[] should be treated as both.
 *
 * This was a real bug source: if an admin's primary role got changed to
 * 'meta' (Meta Ads access), they'd lose access to /api/meetings unless
 * 'meta' was added to roles[]. The multi-role array lets people stack
 * permissions cleanly.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
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
