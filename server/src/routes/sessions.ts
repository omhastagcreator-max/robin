import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { startSession, startBreak, endBreak, endSession, getActiveSession, getSessionHistory, getPerformance, getTeamSessionStatus, heartbeat, setOnCall, huddleJoined, huddleLeft } from '../controllers/sessionsController';

const router = Router();
router.use(authMiddleware);
// Admins clock in too now — same widget for every internal role.
router.post('/start',     requireRole('admin', 'employee', 'sales', 'workroom'), startSession);
router.post('/break',     requireRole('admin', 'employee', 'sales', 'workroom'), startBreak);
router.post('/break/end', requireRole('admin', 'employee', 'sales', 'workroom'), endBreak);
router.post('/end',       requireRole('admin', 'employee', 'sales', 'workroom'), endSession);
router.post('/heartbeat', requireRole('admin', 'employee', 'sales', 'workroom'), heartbeat);
router.post('/on-call',   requireRole('admin', 'employee', 'sales', 'workroom'), setOnCall);
// Huddle attendance — drives the "working time = time in huddle" model.
router.post('/huddle-joined', requireRole('admin', 'employee', 'sales', 'workroom'), huddleJoined);
router.post('/huddle-left',   requireRole('admin', 'employee', 'sales', 'workroom'), huddleLeft);
router.get('/active',     requireRole('admin', 'employee', 'sales', 'workroom'), getActiveSession);
router.get('/history',    requireRole('admin', 'employee', 'sales', 'workroom'), getSessionHistory);
router.get('/performance', requireRole('admin'),                     getPerformance);
// Live "who's on break right now" view — accessible to all internal staff
router.get('/team-status', requireRole('admin', 'employee', 'sales', 'workroom'), getTeamSessionStatus);
export default router;
