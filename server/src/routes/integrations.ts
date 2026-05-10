import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getSheetSource, connectSheet, disconnectSheet, syncNow } from '../controllers/leadSourceController';

const router = Router();
router.use(authMiddleware);

// Status endpoint — anyone internal can check if a sheet is connected.
router.get('/sheet',           requireRole('admin', 'sales', 'employee'), getSheetSource);
// Mutations — admin only.
router.post('/sheet',          requireRole('admin'),         connectSheet);
router.delete('/sheet',        requireRole('admin'),         disconnectSheet);
// Manual "sync now" — admin or sales can trigger.
router.post('/sheet/sync',     requireRole('admin', 'sales'), syncNow);

export default router;
