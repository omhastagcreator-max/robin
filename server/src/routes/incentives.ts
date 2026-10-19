import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listIncentives, createIncentive, deleteIncentive, reviewIncentive } from '../controllers/incentivesController';

const router = Router();
router.use(authMiddleware);

// Oct 2026 — visible to every internal staff role. Oct 19: teammates add
// their own (pending); admins/managers approve.
router.get('/',       requireRole('admin', 'employee', 'sales', 'workroom'), listIncentives);
router.post('/',      requireRole('admin', 'employee', 'sales', 'workroom'), createIncentive);
router.put('/:id/review', requireRole('admin', 'employee', 'sales', 'workroom'), reviewIncentive);
router.delete('/:id', requireRole('admin', 'employee', 'sales', 'workroom'), deleteIncentive);

export default router;
