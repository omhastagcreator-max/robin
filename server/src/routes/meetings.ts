import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listDay, listMine, createMeeting, updateMeeting, deleteMeeting, findFreeSlots, listInMeetingNow,
} from '../controllers/meetingsController';

const router = Router();
router.use(authMiddleware);
// Any internal staff member can use the calendar — the role list intentionally
// errs broad. Clients are excluded; everyone else inside the agency is in.
const internal = requireRole('admin', 'employee', 'sales', 'meta', 'manager');

router.get('/day',          internal, listDay);
router.get('/mine',         internal, listMine);
router.get('/now',          internal, listInMeetingNow);
router.get('/find-free',    internal, findFreeSlots);
router.post('/',            internal, createMeeting);
router.put('/:id',          internal, updateMeeting);
router.delete('/:id',       internal, deleteMeeting);

export default router;
