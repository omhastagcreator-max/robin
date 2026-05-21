import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  rescoreLead, summarizeWorkflowEndpoint, briefAllProjects,
  getOrgMorningBrief, regenerateOrgMorningBrief,
  getAiHealth, getAiHealthPublic, parseCommandEndpoint,
  copilotEndpoint, getCopilotThread, deleteCopilotThread, updateCopilotPin,
  leadInsightsEndpoint, leadFollowupEndpoint,
  focusEndpoint,
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
// One brief summarizing EVERY active project in the org.
router.post('/brief-all-projects',     requireRole('admin', 'employee', 'sales'),             briefAllProjects);

// Command parser — turns "mark Velloer Living done" / "create task X"
// into structured intent. Frontend confirms + dispatches to the real API.
router.post('/parse-command',          requireRole('admin', 'employee', 'sales'),             parseCommandEndpoint);

// Morning brief — read for any internal staff, admin can regenerate
router.get('/morning-brief',           requireRole('admin', 'employee', 'sales'),             getOrgMorningBrief);
router.post('/morning-brief',          requireRole('admin'),                                   regenerateOrgMorningBrief);

// Authenticated health probe (admin-only). Mirrors the public /health
// but live behind auth for the UI panel that polls it from inside Robin.
router.get('/health-authed',           requireRole('admin'),                                   getAiHealth);

// Robin Copilot — persistent, Robin-aware, per-employee AI thread.
// POST /copilot           — send a message (body: { question, route, workflowId?, leadId? })
// GET  /copilot/thread    — load the user's full conversation history on drawer open
// DELETE /copilot/thread  — "Start fresh" — wipes history, keeps pinned note
// PATCH /copilot/thread/pin — update the user's "always remember this" note
// Caches identical (user, ctx, lastReply, question) for 60s; 30 req/min/user.
router.post  ('/copilot',                requireRole('admin', 'employee', 'sales'), copilotEndpoint);
router.get   ('/copilot/thread',         requireRole('admin', 'employee', 'sales'), getCopilotThread);
router.delete('/copilot/thread',         requireRole('admin', 'employee', 'sales'), deleteCopilotThread);
router.patch ('/copilot/thread/pin',     requireRole('admin', 'employee', 'sales'), updateCopilotPin);

// Lead AI — heuristic insights + drafted follow-up message. Insights are
// free (no LLM); follow-up is one Gemini call cached per (user, lead, channel)
// for 5 min so a salesperson toggling channels doesn't re-bill.
router.get ('/lead-insights/:id',      requireRole('admin', 'sales'),                          leadInsightsEndpoint);
router.post('/lead-followup/:id',      requireRole('admin', 'sales'),                          leadFollowupEndpoint);

// Task AI Focus Mode — "what should I do RIGHT NOW?". Heuristic, no LLM.
// Returns top-N user's open tasks ranked by priority × overdue × age.
router.get ('/focus',                  requireRole('admin', 'employee', 'sales'),             focusEndpoint);

export default router;
