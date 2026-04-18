import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { updateScreenStatus, listScreenSessions } from '../controllers/screenSessionsController';

const router = Router();
router.use(authMiddleware);
router.put('/status', requireRole('employee'), updateScreenStatus);
router.get('/', requireRole('admin'), listScreenSessions);
export default router;
