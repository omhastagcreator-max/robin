import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listRisks } from '../controllers/risksController';

const router = Router();
router.use(authMiddleware);

// Risks are an admin/sales view — employees get their personal slice via
// the daily brief, not this firehose feed.
router.get('/', requireRole('admin', 'sales'), listRisks);

export default router;
