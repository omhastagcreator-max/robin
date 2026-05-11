import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  createLeave, listMyLeaves, listAdminLeaves, approveLeave, rejectLeave, cancelLeave, onLeaveToday, leavesSummary, adminEditLeave, myLeaveToday, setWorkingDespiteLeave,
} from '../controllers/leavesController';

const router = Router();
router.use(authMiddleware);

// All internal staff (admin/employee/sales) can apply / view their own /
// cancel their own.
router.post('/',                  requireRole('admin', 'employee', 'sales'), createLeave);
router.get('/mine',               requireRole('admin', 'employee', 'sales'), listMyLeaves);
router.put('/:id/cancel',         requireRole('admin', 'employee', 'sales'), cancelLeave);
// "Are you working today?" flow when user clocks in despite an approved leave
router.get('/mine-today',         requireRole('admin', 'employee', 'sales'), myLeaveToday);
router.put('/mine-today/working', requireRole('admin', 'employee', 'sales'), setWorkingDespiteLeave);

// Admin-only review actions
router.get('/admin',              requireRole('admin'),                     listAdminLeaves);
router.get('/admin/summary',      requireRole('admin'),                     leavesSummary);
router.put('/:id/approve',        requireRole('admin'),                     approveLeave);
router.put('/:id/reject',         requireRole('admin'),                     rejectLeave);
// Admin can fix dates / status on any leave (e.g. correcting an off-by-one)
router.put('/:id/admin-edit',     requireRole('admin'),                     adminEditLeave);

// Public-to-internal-staff: lightweight "who's on leave today" for badges
router.get('/on-leave-today',     requireRole('admin', 'employee', 'sales'), onLeaveToday);

export default router;
