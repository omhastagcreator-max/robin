import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getSnapshot } from '../controllers/commandCenterController';

const router = Router();
router.use(authMiddleware);

// Admin + sales — the Command Center is the agency-overview view.
// Employees / workroom roles are redirected to their Workroom.
router.get('/snapshot', requireRole('admin', 'sales'), getSnapshot);

export default router;
