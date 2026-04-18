import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getGoalsByProject as getGoals, createGoal, updateGoal, deleteGoal } from '../controllers/goalsMetricsController';

const router = Router();
router.use(authMiddleware);
router.get('/project/:projectId', getGoals);
router.post('/', requireRole('admin', 'employee'), createGoal);
router.put('/:id', requireRole('admin', 'employee'), updateGoal);
router.delete('/:id', requireRole('admin'), deleteGoal);
export default router;
