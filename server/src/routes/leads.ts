import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listLeads, createLead, getLead, updateLead, deleteLead, addLeadNote as addNote, convertLead } from '../controllers/leadsController';

const router = Router();
router.use(authMiddleware);
router.get('/', requireRole('admin', 'sales'), listLeads);
router.post('/', requireRole('admin', 'sales'), createLead);
router.get('/:id', requireRole('admin', 'sales'), getLead);
router.put('/:id', requireRole('admin', 'sales'), updateLead);
router.delete('/:id', requireRole('admin'), deleteLead);
router.post('/:id/notes', requireRole('admin', 'sales'), addNote);
router.post('/:id/convert', requireRole('admin', 'sales'), convertLead);
export default router;
