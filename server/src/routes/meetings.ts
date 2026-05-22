import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listDay, listMine, createMeeting, updateMeeting, deleteMeeting, findFreeSlots, listInMeetingNow,
} from '../controllers/meetingsController';

const router = Router();
router.use(authMiddleware);
// Any internal staff member can use the calendar — the role list errs
// broad. Clients are the only explicit exclusion. The previous list
// listed 'meta' and 'manager' (neither are real User.role values — the
// enum is admin/employee/client/sales/workroom) and OMITTED 'workroom',
// which produced 403 spam on /api/meetings/now from workroom users
// whose dashboard polls the endpoint. Now uses the canonical internal
// list so every onboarded teammate can hit calendar endpoints.
const internal = requireRole('admin', 'employee', 'sales', 'workroom');

router.get('/day',          internal, listDay);
router.get('/mine',         internal, listMine);
router.get('/now',          internal, listInMeetingNow);
router.get('/find-free',    internal, findFreeSlots);
router.post('/',            internal, createMeeting);
router.put('/:id',          internal, updateMeeting);
router.delete('/:id',       internal, deleteMeeting);

export default router;
