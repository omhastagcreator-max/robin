import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { listUsers, getUserById, updateUser, deleteUser, createUser, adminResetPassword } from '../controllers/usersController';
import { requireRole } from '../middleware/roleMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/',       listUsers);
router.post('/',      requireRole('admin', 'sales'), createUser);
router.get('/:id',    getUserById);
router.put('/:id',    requireRole('admin'), updateUser);
router.delete('/:id', requireRole('admin'), deleteUser);
// Admin sets a new password for any user in the org. Returns the new
// password in the response so admin can share it.
router.post('/:id/reset-password', requireRole('admin'), adminResetPassword);

export default router;
