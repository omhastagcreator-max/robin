import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getHistory, postMessage } from '../controllers/chatController';

// RBAC fix: previously this route was authenticated-only, which meant
// a `client` role with a valid JWT could read and post to internal-staff
// chat. Restricted to internal staff. Clients have their own queries
// endpoint for support.
const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin', 'employee', 'sales', 'workroom'));
router.get('/history', getHistory);
router.post('/', postMessage);
export default router;
