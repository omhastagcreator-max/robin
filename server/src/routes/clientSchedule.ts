import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listSchedule, createSchedule, updateSchedule, deleteSchedule, todaysClients,
} from '../controllers/clientScheduleController';

/**
 * /api/client-schedule
 *
 * All internal staff (admin/employee/sales) can read & write their own
 * schedule. Server-side controllers enforce that non-admins can only see
 * and edit their OWN entries.
 */
const router = Router();
router.use(authMiddleware);

router.get   ('/today',  requireRole('admin', 'employee', 'sales'), todaysClients);
router.get   ('/',       requireRole('admin', 'employee', 'sales'), listSchedule);
router.post  ('/',       requireRole('admin', 'employee', 'sales'), createSchedule);
router.put   ('/:id',    requireRole('admin', 'employee', 'sales'), updateSchedule);
router.delete('/:id',    requireRole('admin', 'employee', 'sales'), deleteSchedule);

export default router;
