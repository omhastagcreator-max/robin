import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { adminStats, atRiskProjects, employeeDashboard, clientDashboard, salesDashboard } from '../controllers/dashboardController';

const router = Router();
router.use(authMiddleware);
router.get('/stats', requireRole('admin'), adminStats);
router.get('/at-risk', requireRole('admin'), atRiskProjects);
router.get('/employee', requireRole('employee', 'admin'), employeeDashboard);
router.get('/client', requireRole('client'), clientDashboard);
router.get('/sales', requireRole('sales', 'admin'), salesDashboard);
export default router;
