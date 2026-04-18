import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listDeals, createDeal, updateDeal, deleteDeal } from '../controllers/dealsController';

const router = Router();
router.use(authMiddleware);
router.get('/', requireRole('admin', 'sales'), listDeals);
router.post('/', requireRole('admin', 'sales'), createDeal);
router.put('/:id', requireRole('admin', 'sales'), updateDeal);
router.delete('/:id', requireRole('admin'), deleteDeal);
export default router;
