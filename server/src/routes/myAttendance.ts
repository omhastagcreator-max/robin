import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getMyAttendance } from '../controllers/myAttendanceController';

/** Oct 2026 — every staff member's own attendance calendar (managers can view anyone's). */
const router = Router();
router.use(authMiddleware);
router.get('/', requireRole('admin', 'employee', 'sales', 'workroom'), getMyAttendance);
export default router;
