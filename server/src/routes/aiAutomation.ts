import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  rescoreLead, summarizeWorkflowEndpoint,
  getOrgMorningBrief, regenerateOrgMorningBrief,
  getAiHealth, getAiHealthPublic,
} from '../controllers/aiAutomationController';

const router = Router();

// Health probe — INTENTIONALLY public so the owner can hit
// /api/ai-automation/health in a browser without juggling JWTs to debug
// "is the AI configured?". The response never includes the key; only
// configured/yes/no, the working model name, and last error string.
router.get('/health', getAiHealthPublic);

router.use(authMiddleware);

// Lead scoring — admin/sales rescore on demand
router.post('/score-lead/:id',         requireRole('admin', 'sales'),                          rescoreLead);

// Workflow summary — any internal staff can ask for the AI status paragraph
router.post('/summarize-workflow/:id', requireRole('admin', 'employee', 'sales'),             summarizeWorkflowEndpoint);

// Morning brief — read for any internal staff, admin can regenerate
router.get('/morning-brief',           requireRole('admin', 'employee', 'sales'),             getOrgMorningBrief);
router.post('/morning-brief',          requireRole('admin'),                                   regenerateOrgMorningBrief);

// Authenticated health probe (admin-only). Mirrors the public /health
// but live behind auth for the UI panel that polls it from inside Robin.
router.get('/health-authed',           requireRole('admin'),                                   getAiHealth);

export default router;
