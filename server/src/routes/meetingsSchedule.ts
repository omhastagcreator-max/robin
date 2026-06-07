import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { upcoming, setRecurring } from '../controllers/meetingScheduleController';

const router = Router();
router.use(authMiddleware);

// Mounted under /api/meetings (alongside existing meetings routes) so
// the URL is /api/meetings/upcoming + /api/meetings/recurring/:wfId.
router.get('/upcoming', upcoming);
router.put('/recurring/:workflowId', setRecurring);

export default router;
