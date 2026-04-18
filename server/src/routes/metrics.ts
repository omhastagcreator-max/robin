import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getMetricsByProject as getMetrics, createMetric } from '../controllers/goalsMetricsController';

const router = Router();
router.use(authMiddleware);
router.get('/project/:projectId', getMetrics);
router.post('/', requireRole('admin', 'employee'), createMetric);
export default router;
