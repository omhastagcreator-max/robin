import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  createWorkflow, listWorkflows, getWorkflow, toggleChecklist,
  completeService, returnService, addNote, reassignService, getServiceTemplates,
  blockWorkflow, unblockWorkflow, listWorkflowActivity,
} from '../controllers/clientWorkflowController';

const router = Router();
router.use(authMiddleware);

// Templates (static — anyone internal can read)
router.get('/templates', requireRole('admin', 'employee', 'sales'), getServiceTemplates);

// List + search
router.get('/',                  requireRole('admin', 'employee', 'sales'), listWorkflows);
router.get('/:id',               requireRole('admin', 'employee', 'sales'), getWorkflow);

// Mutations
router.post('/',                                         requireRole('admin', 'sales'),               createWorkflow);
router.put ('/:id/services/:sid/check',                  requireRole('admin', 'employee', 'sales'),   toggleChecklist);
router.put ('/:id/services/:sid/complete',               requireRole('admin', 'employee', 'sales'),   completeService);
router.put ('/:id/return',                               requireRole('admin', 'employee', 'sales'),   returnService);
router.post('/:id/notes',                                requireRole('admin', 'employee', 'sales'),   addNote);
router.put ('/:id/services/:sid/reassign',               requireRole('admin'),                        reassignService);

// Pipeline 2.0 — explicit blocker + activity timeline.
router.put ('/:id/block',                                requireRole('admin', 'employee', 'sales'),   blockWorkflow);
router.put ('/:id/unblock',                              requireRole('admin', 'employee', 'sales'),   unblockWorkflow);
router.get ('/:id/activity',                             requireRole('admin', 'employee', 'sales'),   listWorkflowActivity);

export default router;
