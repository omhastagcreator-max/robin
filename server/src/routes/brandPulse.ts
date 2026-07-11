import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import {
  getMyPendingPulse, answerPulse, redirectPulse, getPulseReport,
} from '../controllers/brandPulseController';

const router = Router();
router.use(authMiddleware);

/** Same gate as Team Pulse / Progress: admin, sales, or canManageWorkroom (Om). */
async function canViewReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const primary = req.user.role;
  const extras = req.user.roles || [];
  const ok = ['admin', 'sales'].includes(primary) || extras.some(r => ['admin', 'sales'].includes(r));
  if (ok) { next(); return; }
  try {
    const u = await User.findById(req.user.id).select('canManageWorkroom').lean();
    if (u && (u as any).canManageWorkroom === true) { next(); return; }
  } catch { /* fall through */ }
  res.status(403).json({ error: 'Requires admin, sales, or workroom manager' });
}

// Self — every staff member answers their own questions.
router.get('/pending',       getMyPendingPulse);
router.post('/:id/answer',   answerPulse);
router.post('/:id/redirect', redirectPulse);

// Report — the accountability + brand-intel rollup.
router.get('/admin/report',  canViewReport, getPulseReport);

export default router;
