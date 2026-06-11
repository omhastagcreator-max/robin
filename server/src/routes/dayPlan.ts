import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getMyPlan, getUserPlan, setUserPlan, autoDistribute } from '../controllers/dayPlanController';

const router = Router();
router.use(authMiddleware);

// Self read — any internal role.
router.get('/me', getMyPlan);

// Admin / sales — view anyone's plan.
router.get('/user/:userId',           requireRole('admin', 'sales'), getUserPlan);

// Admin-only writes (sales can read but not edit other people's plans).
router.put('/user/:userId',           requireRole('admin'), setUserPlan);
router.post('/user/:userId/auto-distribute', requireRole('admin'), autoDistribute);

export default router;
