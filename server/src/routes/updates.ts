import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getProjectUpdates as getUpdates, createUpdate, approveUpdate, rejectUpdate } from '../controllers/updatesController';

const router = Router();
router.use(authMiddleware);
router.get('/project/:projectId', getUpdates);
router.post('/', requireRole('admin', 'employee'), createUpdate);
router.put('/:id/approve', requireRole('client'), approveUpdate);
router.put('/:id/reject', requireRole('client'), rejectUpdate);
export default router;
