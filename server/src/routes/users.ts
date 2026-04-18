import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { listUsers, getUserById, updateUser, deleteUser } from '../controllers/usersController';
import { requireRole } from '../middleware/roleMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/',     listUsers);
router.get('/:id',  getUserById);
router.put('/:id',  requireRole('admin'), updateUser);
router.delete('/:id', requireRole('admin'), deleteUser);

export default router;
