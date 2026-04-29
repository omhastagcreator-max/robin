import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  createLeave, listMyLeaves, listAdminLeaves, approveLeave, rejectLeave, cancelLeave, onLeaveToday,
} from '../controllers/leavesController';

const router = Router();
router.use(authMiddleware);

// Employees + sales can apply / view their own / cancel their own
router.post('/',                  requireRole('employee', 'sales'),         createLeave);
router.get('/mine',               requireRole('employee', 'sales'),         listMyLeaves);
router.put('/:id/cancel',         requireRole('employee', 'sales'),         cancelLeave);

// Admin-only review actions
router.get('/admin',              requireRole('admin'),                     listAdminLeaves);
router.put('/:id/approve',        requireRole('admin'),                     approveLeave);
router.put('/:id/reject',         requireRole('admin'),                     rejectLeave);

// Public-to-internal-staff: lightweight "who's on leave today" for badges
router.get('/on-leave-today',     requireRole('admin', 'employee', 'sales'), onLeaveToday);

export default router;
