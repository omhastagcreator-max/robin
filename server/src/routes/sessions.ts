import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { startSession, startBreak, endBreak, endSession, getActiveSession, getSessionHistory, getPerformance } from '../controllers/sessionsController';

const router = Router();
router.use(authMiddleware);
router.post('/start', requireRole('employee'), startSession);
router.post('/break', requireRole('employee'), startBreak);
router.post('/break/end', requireRole('employee'), endBreak);
router.post('/end', requireRole('employee'), endSession);
router.get('/active', requireRole('employee', 'admin'), getActiveSession);
router.get('/history', requireRole('employee', 'admin'), getSessionHistory);
router.get('/performance', requireRole('admin'), getPerformance);
export default router;
