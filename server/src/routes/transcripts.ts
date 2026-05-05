import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { postLines, listTranscripts } from '../controllers/transcriptsController';

const router = Router();
router.use(authMiddleware);

router.post('/lines', postLines);
router.get('/',       listTranscripts);

export default router;
