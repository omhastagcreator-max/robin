import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listMyReminders, createReminder, updateReminder, deleteReminder,
} from '../controllers/remindersController';

const router = Router();
router.use(authMiddleware);

const staff = requireRole('admin', 'employee', 'sales');

router.get('/mine',     staff, listMyReminders);
router.post('/',        staff, createReminder);
router.put('/:id',      staff, updateReminder);
router.delete('/:id',   staff, deleteReminder);

export default router;
