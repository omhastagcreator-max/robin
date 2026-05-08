import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listDay, listMine, createMeeting, updateMeeting, deleteMeeting, findFreeSlots, listInMeetingNow,
} from '../controllers/meetingsController';

const router = Router();
router.use(authMiddleware);
const internal = requireRole('admin', 'employee', 'sales');

router.get('/day',          internal, listDay);
router.get('/mine',         internal, listMine);
router.get('/now',          internal, listInMeetingNow);
router.get('/find-free',    internal, findFreeSlots);
router.post('/',            internal, createMeeting);
router.put('/:id',          internal, updateMeeting);
router.delete('/:id',       internal, deleteMeeting);

export default router;
