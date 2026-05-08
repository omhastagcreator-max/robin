import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listTransactions, myTransactions, createTransaction, updateTransaction, myAlerts, readAlert, createAlert } from '../controllers/transactionsController';

/**
 * Client finance routes — mounted at /api.
 *
 * IMPORTANT: do NOT use `router.use(authMiddleware)` here. This router is
 * mounted at the bare `/api` prefix, so any global middleware would run for
 * EVERY /api/* request — including public routers that come later in the
 * mount order (/api/meet/:slug, /api/share/meta/:token). Apply
 * authMiddleware per-route instead.
 */

const router = Router();

// Transactions
router.get('/transactions',         authMiddleware, requireRole('admin', 'sales'), listTransactions);
router.get('/transactions/me',      authMiddleware, requireRole('client'),         myTransactions);
router.post('/transactions',        authMiddleware, requireRole('admin'),          createTransaction);
router.put('/transactions/:id',     authMiddleware, requireRole('admin'),          updateTransaction);

// Alerts
router.get('/alerts/me',            authMiddleware, requireRole('client'),         myAlerts);
router.put('/alerts/:id/read',      authMiddleware, requireRole('client'),         readAlert);
router.post('/alerts',              authMiddleware, requireRole('admin', 'sales'), createAlert);

export default router;
