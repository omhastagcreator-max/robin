import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listIncentives, createIncentive, deleteIncentive } from '../controllers/incentivesController';

const router = Router();
router.use(authMiddleware);

// Oct 2026 — visible to every internal staff role; only admins edit.
router.get('/',       requireRole('admin', 'employee', 'sales', 'workroom'), listIncentives);
router.post('/',      requireRole('admin'), createIncentive);
router.delete('/:id', requireRole('admin'), deleteIncentive);

export default router;
