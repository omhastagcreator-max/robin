import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { postLines, listTranscripts } from '../controllers/transcriptsController';

// RBAC fix: huddle transcripts contain internal discussion — must be
// restricted to internal staff. Previously any authenticated user
// (including `client`) could fetch them.
const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin', 'employee', 'sales', 'workroom'));

router.post('/lines', postLines);
router.get('/',       listTranscripts);

export default router;
