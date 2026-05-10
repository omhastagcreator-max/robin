import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { reportClientError, listErrorLogs } from '../controllers/errorLogController';

/**
 * /api/logs/error — client posts errors here.
 * /api/logs       — admin reads recent error reports.
 */
const router = Router();
router.use(authMiddleware);

router.post('/error', reportClientError);
router.get('/',       listErrorLogs);

export default router;
