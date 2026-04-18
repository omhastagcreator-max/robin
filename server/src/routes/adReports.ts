import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listReports, createReport, updateReport, deleteReport, getSummary } from '../controllers/adReportsController';

const router = Router();
router.use(authMiddleware);
router.get('/',                  listReports);
router.get('/summary',           getSummary);
router.post('/',                 requireRole('admin', 'employee'), createReport);
router.put('/:id',               requireRole('admin', 'employee'), updateReport);
router.delete('/:id',            requireRole('admin'), deleteReport);
export default router;
