import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { updateScreenStatus, listScreenSessions } from '../controllers/screenSessionsController';

const router = Router();
router.use(authMiddleware);
// Internal staff (admin / employee / sales) can broadcast their screen status
router.put('/status', requireRole('employee', 'sales', 'admin'), updateScreenStatus);
// And any internal staff member can list / view other staff screens
router.get('/', requireRole('admin', 'employee', 'sales'), listScreenSessions);
export default router;
