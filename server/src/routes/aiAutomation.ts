import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  rescoreLead, summarizeWorkflowEndpoint,
  getOrgMorningBrief, regenerateOrgMorningBrief,
} from '../controllers/aiAutomationController';

const router = Router();
router.use(authMiddleware);

// Lead scoring — admin/sales rescore on demand
router.post('/score-lead/:id',         requireRole('admin', 'sales'),                          rescoreLead);

// Workflow summary — any internal staff can ask for the AI status paragraph
router.post('/summarize-workflow/:id', requireRole('admin', 'employee', 'sales'),             summarizeWorkflowEndpoint);

// Morning brief — read for any internal staff, admin can regenerate
router.get('/morning-brief',           requireRole('admin', 'employee', 'sales'),             getOrgMorningBrief);
router.post('/morning-brief',          requireRole('admin'),                                   regenerateOrgMorningBrief);

export default router;
