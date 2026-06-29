import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  getMyCheckinToday,
  submitMorning,
  submitMidday,
  submitEvening,
  getAdminCheckinReport,
} from '../controllers/checkinController';

const router = Router();
router.use(authMiddleware);

// Self — every internal role gets their own state + can submit.
router.get('/today',     getMyCheckinToday);
router.post('/morning',  submitMorning);
router.post('/midday',   submitMidday);
router.post('/end',      submitEvening);

// Admin / sales — see everyone's checkin status for today.
router.get('/admin/today', requireRole('admin', 'sales'), getAdminCheckinReport);

export default router;
