import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { createQuery, listQueries, replyQuery, updateQueryStatus, sendPaymentAlert } from '../controllers/clientQueriesController';

const router = Router();
router.use(authMiddleware);
router.get('/',                  listQueries);
router.post('/',                 createQuery);
router.post('/:id/reply',        requireRole('admin', 'employee', 'sales'), replyQuery);
router.put('/:id/status',        requireRole('admin', 'employee'), updateQueryStatus);
router.post('/payment-alert',    requireRole('admin', 'sales'), sendPaymentAlert);
export default router;
