import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getTodayStats } from '../controllers/teamStatsController';

const router = Router();
router.use(authMiddleware);

// Open to all internal roles; the controller filters non-admin/sales
// down to just their own row.
router.get('/today', getTodayStats);

export default router;
