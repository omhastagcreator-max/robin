import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listTransactions, myTransactions, createTransaction, updateTransaction, myAlerts, readAlert, createAlert } from '../controllers/transactionsController';

const router = Router();
router.use(authMiddleware);
// Transactions
router.get('/transactions', requireRole('admin', 'sales'), listTransactions);
router.get('/transactions/me', requireRole('client'), myTransactions);
router.post('/transactions', requireRole('admin'), createTransaction);
router.put('/transactions/:id', requireRole('admin'), updateTransaction);
// Alerts
router.get('/alerts/me', requireRole('client'), myAlerts);
router.put('/alerts/:id/read', requireRole('client'), readAlert);
router.post('/alerts', requireRole('admin', 'sales'), createAlert);
export default router;
