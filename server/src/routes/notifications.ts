import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { listNotifications, readAll, readOne, deleteNotification } from '../controllers/notificationsController';

const router = Router();
router.use(authMiddleware);
router.get('/', listNotifications);
router.put('/read-all', readAll);
router.put('/:id/read', readOne);
router.delete('/:id', deleteNotification);
export default router;
