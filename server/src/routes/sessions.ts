import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { startSession, startBreak, endBreak, endSession, getActiveSession, getSessionHistory, getPerformance, getTeamSessionStatus, heartbeat, setOnCall } from '../controllers/sessionsController';

const router = Router();
router.use(authMiddleware);
// Admins clock in too now — same widget for every internal role.
router.post('/start',     requireRole('admin', 'employee', 'sales'), startSession);
router.post('/break',     requireRole('admin', 'employee', 'sales'), startBreak);
router.post('/break/end', requireRole('admin', 'employee', 'sales'), endBreak);
router.post('/end',       requireRole('admin', 'employee', 'sales'), endSession);
router.post('/heartbeat', requireRole('admin', 'employee', 'sales'), heartbeat);
router.post('/on-call',   requireRole('admin', 'employee', 'sales'), setOnCall);
router.get('/active',     requireRole('admin', 'employee', 'sales'), getActiveSession);
router.get('/history',    requireRole('admin', 'employee', 'sales'), getSessionHistory);
router.get('/performance', requireRole('admin'),                     getPerformance);
// Live "who's on break right now" view — accessible to all internal staff
router.get('/team-status', requireRole('admin', 'employee', 'sales'), getTeamSessionStatus);
export default router;
