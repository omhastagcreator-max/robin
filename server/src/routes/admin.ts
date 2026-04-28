import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listEmployees, listClients, getActivityLog, inviteUser, updateUserRole, resetUserPassword, getEmployeeReport
} from '../controllers/adminController';

const router = Router();

const adminOnly = [authMiddleware, requireRole('admin')];

router.get('/employees',                ...adminOnly, listEmployees);
router.get('/employees/:id/report',     ...adminOnly, getEmployeeReport);
router.get('/clients',                  ...adminOnly, listClients);
router.get('/activity',                 ...adminOnly, getActivityLog);
router.post('/invite',                  ...adminOnly, inviteUser);
router.put('/users/:id/role',           ...adminOnly, updateUserRole);
router.put('/users/:id/reset-password', ...adminOnly, resetUserPassword);

export default router;
