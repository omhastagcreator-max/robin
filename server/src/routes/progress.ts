import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import { getTeamProgress, recomputeProgress } from '../controllers/progressController';

const router = Router();
router.use(authMiddleware);

/**
 * Same access rule as Team Pulse (routes/checkin.ts): admin, sales, OR
 * any user with the canManageWorkroom flag (Om — manages the floor
 * without full admin). Employees do NOT see progress reports — owner
 * decision, July 2026.
 */
async function canViewProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const primary = req.user.role;
  const extras = req.user.roles || [];
  const ok = ['admin', 'sales'].includes(primary) || extras.some(r => ['admin', 'sales'].includes(r));
  if (ok) { next(); return; }
  try {
    const u = await User.findById(req.user.id).select('canManageWorkroom').lean();
    if (u && (u as any).canManageWorkroom === true) { next(); return; }
  } catch { /* fall through to 403 */ }
  res.status(403).json({ error: 'Requires admin, sales, or workroom manager' });
}

router.get('/team', canViewProgress, getTeamProgress);
router.post('/recompute', canViewProgress, recomputeProgress);

export default router;
