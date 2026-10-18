import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { requireOversight, getOversightDay, listOversightAccess, setOversightAccess, addMember, listMembers, updateMember } from '../controllers/oversightController';

/**
 * Team Oversight — Oct 2026. Read-only "everything everyone did today"
 * dashboard. Visible to admin + any manager flagged canViewOversight
 * (Rahul). Only admin can grant/revoke that flag.
 */
import { getLogs } from '../controllers/logsController';
const router = Router();
router.use(authMiddleware);

router.get('/logs',           requireOversight, getLogs);     // Oct 2026 — every permanent log in one place (+ CSV)
router.get('/day',            requireOversight, getOversightDay);
router.get('/members',         requireOversight, listMembers);
router.post('/members',        requireOversight, addMember);
router.put('/members/:id',     requireOversight, updateMember);   // admin + managers (Rahul) add a teammate
router.get('/access',         requireRole('admin'), listOversightAccess);
router.put('/access/:id',     requireRole('admin'), setOversightAccess);

export default router;
