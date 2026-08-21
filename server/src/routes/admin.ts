import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listEmployees, listClients, getActivityLog, inviteUser, updateUserRole, resetUserPassword, getEmployeeReport, deactivateUser, getAttendance, getMonthlyAttendance, getRangeAttendance, getRangeAttendanceSummary, bulkCreateMetaClients, setCanManageWorkroom, setCanEditAllClients
} from '../controllers/adminController';

const router = Router();

const adminOnly = [authMiddleware, requireRole('admin')];

router.get('/employees',                ...adminOnly, listEmployees);
router.get('/employees/:id/report',     ...adminOnly, getEmployeeReport);
router.get('/attendance',               ...adminOnly, getAttendance);
router.get('/attendance/monthly',       ...adminOnly, getMonthlyAttendance);
router.get('/attendance/range',         ...adminOnly, getRangeAttendance);
router.post('/attendance/range/summary', ...adminOnly, getRangeAttendanceSummary);
router.post('/meta/clients/bulk',       ...adminOnly, bulkCreateMetaClients);
router.get('/clients',                  ...adminOnly, listClients);
router.get('/activity',                 ...adminOnly, getActivityLog);
router.post('/invite',                  ...adminOnly, inviteUser);
router.put('/users/:id/role',           ...adminOnly, updateUserRole);
router.put('/users/:id/can-manage-workroom', ...adminOnly, setCanManageWorkroom);
router.put('/users/:id/can-edit-all-clients', ...adminOnly, setCanEditAllClients);
router.put('/users/:id/reset-password', ...adminOnly, resetUserPassword);
router.delete('/users/:id',             ...adminOnly, deactivateUser);

export default router;
