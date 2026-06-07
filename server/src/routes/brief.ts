import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getMyBrief } from '../controllers/briefController';

const router = Router();
router.use(authMiddleware);

// Anyone with an account can see their own brief.
router.get('/me', getMyBrief);

export default router;
