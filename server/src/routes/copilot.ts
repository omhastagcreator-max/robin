import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { ask } from '../controllers/copilotController';

const router = Router();
router.use(authMiddleware);

// Open to admin + sales + employee. Employees get scoped answers
// because the snapshot already pulls org-isolated data; we just
// don't expose copilot to client / workroom roles.
router.post('/ask', requireRole('admin', 'sales', 'employee'), ask);

export default router;
