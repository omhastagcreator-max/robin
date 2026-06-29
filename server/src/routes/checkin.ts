import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import User from '../models/User';
import {
  getMyCheckinToday,
  submitMorning,
  submitMidday,
  submitEvening,
  getAdminCheckinReport,
  getCheckinSuggestions,
} from '../controllers/checkinController';

const router = Router();
router.use(authMiddleware);

/**
 * canViewTeamPulse — admin, sales, OR any user with the
 * canManageWorkroom flag (e.g. Om the developer who manages the floor
 * but doesn't have full admin). This middleware does a single User
 * lookup per request to read the flag, since it isn't stamped onto
 * the JWT payload.
 */
async function canViewTeamPulse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const primary = req.user.role;
  const extras  = req.user.roles || [];
  const ok = ['admin', 'sales'].includes(primary) || extras.some(r => ['admin', 'sales'].includes(r));
  if (ok) { next(); return; }
  try {
    const u = await User.findById(req.user.id).select('canManageWorkroom').lean();
    if (u && (u as any).canManageWorkroom === true) { next(); return; }
  } catch { /* fall through to 403 */ }
  res.status(403).json({ error: 'Requires admin, sales, or workroom manager' });
}

// Self — every internal role gets their own state + can submit.
router.get('/today',         getMyCheckinToday);
router.get('/suggestions',   getCheckinSuggestions);
router.post('/morning',      submitMorning);
router.post('/midday',       submitMidday);
router.post('/end',          submitEvening);

// Admin / sales / workroom-managers — see everyone's checkin for any day.
// Accepts ?date=YYYY-MM-DD (IST); defaults to today.
router.get('/admin/today',   canViewTeamPulse, getAdminCheckinReport);

// Backwards-friendly alias for the new TeamPulsePage. Same handler;
// kept as a named route so it's clear in logs that the call came from
// the dashboard vs. the Command Center widget.
router.get('/admin/report',  canViewTeamPulse, getAdminCheckinReport);

// Keep the original requireRole import wired in case future routes
// need stricter access. (Silences unused-import in noUnusedLocals.)
void requireRole;

export default router;
