import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getMorningBrief } from '../controllers/aiController';

const router = Router();
router.use(authMiddleware);

router.get('/morning-brief', getMorningBrief);

export default router;
