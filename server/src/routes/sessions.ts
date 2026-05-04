import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { startSession, startBreak, endBreak, endSession, getActiveSession, getSessionHistory, getPerformance, getTeamSessionStatus, heartbeat } from '../controllers/sessionsController';

const router = Router();
router.use(authMiddleware);
// Sales reps clock in too — opened up so they can use the same session widgets.
router.post('/start',     requireRole('employee', 'sales'),          startSession);
router.post('/break',     requireRole('employee', 'sales'),          startBreak);
router.post('/break/end', requireRole('employee', 'sales'),          endBreak);
router.post('/end',       requireRole('employee', 'sales'),          endSession);
router.post('/heartbeat', requireRole('employee', 'sales'),          heartbeat);
router.get('/active',     requireRole('employee', 'sales', 'admin'), getActiveSession);
router.get('/history',    requireRole('employee', 'sales', 'admin'), getSessionHistory);
router.get('/performance', requireRole('admin'),                     getPerformance);
// Live "who's on break right now" view — accessible to all internal staff
router.get('/team-status', requireRole('admin', 'employee', 'sales'), getTeamSessionStatus);
export default router;
