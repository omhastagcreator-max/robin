import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getHistory, postMessage } from '../controllers/chatController';

const router = Router();
router.use(authMiddleware);
router.get('/history', getHistory);
router.post('/', postMessage);
export default router;
