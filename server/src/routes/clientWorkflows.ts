import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  createWorkflow, listWorkflows, getWorkflow, toggleChecklist,
  completeService, returnService, addNote, reassignService, getServiceTemplates,
  blockWorkflow, unblockWorkflow, listWorkflowActivity,
  bulkWorkflowAction, setServiceEta, updateWorkflowDetails,
} from '../controllers/clientWorkflowController';
import { getPerformance, upsertPerformance } from '../controllers/clientPerformanceController';

const router = Router();
router.use(authMiddleware);

// Aug 2026 — 'workroom' added to every internal-staff route below. The
// client-side route guards (App.tsx) and sidebar nav already let workroom
// users into the Client CRM pages; the server routes had fallen out of
// sync and were still 403-ing them (or, for list/get, silently returning
// an empty/own-only list — see canSeeWorkflow()/listWorkflows() in the
// controller). STAFF = every internal role that should have full
// Client CRM parity.
const STAFF = ['admin', 'employee', 'sales', 'workroom'] as const;

// Templates (static — anyone internal can read)
router.get('/templates', requireRole(...STAFF), getServiceTemplates);

// List + search
router.get('/',                  requireRole(...STAFF), listWorkflows);
router.get('/:id',               requireRole(...STAFF), getWorkflow);

// Mutations
// May 2026 — opened to all internal roles so any team member can
// onboard a client they're bringing in. createWorkflow already stamps
// createdBy = req.user.id and writes a 'created' activity row, so
// audit-trail integrity is preserved across the wider author pool.
router.post('/',                                         requireRole(...STAFF),   createWorkflow);
// Full client-detail edit (name/phone/email/priority/tags/payment status) —
// "employees are able to edit a client's details fully" ask, Aug 2026.
// Was already built (controller + client-side EditClientDetailsModal) but
// never actually reachable — no route pointed at it. Fixed alongside the
// Client CRM visibility bug.
router.put ('/:id/details',                               requireRole(...STAFF),   updateWorkflowDetails);
// Per-client performance calendar (Meta ads spend / sales achieved / sales
// target, day+week+month) — same "never wired up" gap as /details above.
router.get ('/:id/performance',                           requireRole(...STAFF),   getPerformance);
router.put ('/:id/performance',                           requireRole(...STAFF),   upsertPerformance);
router.put ('/:id/services/:sid/check',                  requireRole(...STAFF),   toggleChecklist);
router.put ('/:id/services/:sid/complete',                requireRole(...STAFF),   completeService);
router.put ('/:id/return',                                requireRole(...STAFF),   returnService);
router.post('/:id/notes',                                 requireRole(...STAFF),   addNote);
router.put ('/:id/services/:sid/reassign',                requireRole('admin'),    reassignService);
// Assignee enters their tentative completion date — see controller
// docstring. Assignee-or-admin only; controller enforces it.
router.put ('/:id/services/:sid/eta',                     requireRole(...STAFF),   setServiceEta);

// Pipeline 2.0 — explicit blocker + activity timeline.
router.put ('/:id/block',                                 requireRole(...STAFF),   blockWorkflow);
router.put ('/:id/unblock',                               requireRole(...STAFF),   unblockWorkflow);
router.get ('/:id/activity',                              requireRole(...STAFF),   listWorkflowActivity);

// Pipeline 2.1 — bulk actions powering the multi-select toolbar on the
// redesigned ClientPipelinePage. priority + mark-on-track are admin/sales
// only (destructive overwrite); note is open to all internal roles.
router.post('/bulk',                                      requireRole(...STAFF),   bulkWorkflowAction);

export default router;
