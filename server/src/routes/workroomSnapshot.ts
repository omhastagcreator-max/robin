import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getWorkroomSnapshot } from '../controllers/workroomSnapshotController';

const router = Router();
router.use(authMiddleware);
router.get('/snapshot', getWorkroomSnapshot);
export default router;
