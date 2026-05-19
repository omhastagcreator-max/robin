import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { scoreLead, summarizeWorkflow, generateMorningBrief, aiHealth } from '../services/aiTriage';
import User from '../models/User';
import Lead from '../models/Lead';
import ClientWorkflow from '../models/ClientWorkflow';
import Issue from '../models/Issue';
import Session from '../models/Session';
import Deal from '../models/Deal';
import ProjectTask from '../models/ProjectTask';
import MorningBrief from '../models/MorningBrief';

// Local helper — matches the inline pattern used in other controllers.
async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/**
 * GET /api/ai-automation/health  (admin-only)
 * Returns the live AI status: whether the key is set, which model is
 * working, and the exact last error if any. Hit this from a browser
 * (logged in as admin) to debug why the AI is silent.
 */
export async function getAiHealth(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const h = await aiHealth();
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/ai-automation/score-lead/:id  — admin/sales
 * Re-score one lead on demand (auto-scoring happens on create).
 */
export async function rescoreLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const lead = await Lead.findOne({ _id: req.params.id, organizationId: orgId });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const noteText = Array.isArray((lead as any).notes) && (lead as any).notes.length
      ? (lead as any).notes.map((n: any) => n?.content || '').join('\n')
      : '';
    const ai = await scoreLead({
      name: lead.name || undefined,
      email: lead.email || undefined,
      phone: (lead as any).contact || undefined,
      source: lead.source as any,
      stage: lead.stage as any,
      estimatedValue: lead.estimatedValue,
      notes: noteText,
      createdAt: (lead as any).createdAt,
    });
    if (ai.aiUsed) {
      lead.set({
        aiScore: ai.score, aiReason: ai.reason, aiNextAction: ai.nextAction,
        aiScoredAt: new Date(),
      } as any);
      await lead.save();
    }
    res.json({ leadId: String(lead._id), ...ai });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/ai-automation/summarize-workflow/:id
 * "Where is this client?" — one paragraph the team can paste to the client.
 */
export async function summarizeWorkflowEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const r = await summarizeWorkflow({
      clientName: (wf as any).clientName,
      services:   (wf as any).services || [],
      activity:   (wf as any).activity || [],
    });
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/ai-automation/morning-brief — latest org brief.
 */
export async function getOrgMorningBrief(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const latest = await MorningBrief.findOne({ organizationId: orgId })
      .sort({ istDate: -1 })
      .lean();
    res.json(latest || null);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/ai-automation/morning-brief — admin-only manual regen.
 */
export async function regenerateOrgMorningBrief(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const brief = await buildAndSaveMorningBrief(String(orgId), 'manual');
    res.json(brief);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Build a snapshot of yesterday's activity, ask Gemini for a brief,
 * upsert into MorningBrief. Used by both the cron and the manual route.
 */
export async function buildAndSaveMorningBrief(orgId: string, generatedBy: 'cron' | 'manual') {
  const istNow  = new Date(Date.now() + 330 * 60_000);
  const istDate = istNow.toISOString().slice(0, 10);
  const yStart = new Date(Date.now() - 24 * 3600 * 1000); yStart.setHours(0, 0, 0, 0);
  const yEnd   = new Date(); yEnd.setHours(0, 0, 0, 0);

  const [leadsCreated, hotLeadsRaw, wfList, openIssues, sessionsClosed, tasksCompleted, dealsClosed] = await Promise.all([
    Lead.countDocuments({ organizationId: orgId, createdAt: { $gte: yStart, $lt: yEnd } }),
    Lead.find({ organizationId: orgId, aiScore: 'hot', stage: { $nin: ['won', 'lost'] } })
      .select('name estimatedValue aiNextAction').sort({ updatedAt: -1 }).limit(8).lean(),
    ClientWorkflow.find({ organizationId: orgId, 'services.status': 'blocked' })
      .select('clientName services').limit(8).lean(),
    Issue.find({ organizationId: orgId, status: { $in: ['open', 'investigating'] } })
      .select('description ai.area ai.severity').sort({ createdAt: -1 }).limit(8).lean(),
    Session.countDocuments({ organizationId: orgId, endTime: { $gte: yStart, $lt: yEnd } }),
    ProjectTask.countDocuments({ status: 'done', completedAt: { $gte: yStart, $lt: yEnd } }),
    Deal.countDocuments({ organizationId: orgId, status: 'closed_won', closedAt: { $gte: yStart, $lt: yEnd } }).catch(() => 0),
  ]);

  const blockedWorkflows: Array<{ clientName: string; serviceLabel: string }> = [];
  for (const wf of wfList as any[]) {
    const blockedSvc = (wf.services || []).find((s: any) => s.status === 'blocked');
    if (blockedSvc) blockedWorkflows.push({
      clientName: wf.clientName || 'Unnamed',
      serviceLabel: blockedSvc.label || blockedSvc.serviceType,
    });
  }

  const snapshot = {
    date: istDate,
    leadsCreated,
    hotLeads: (hotLeadsRaw as any[]).map(l => ({
      name: l.name, estimatedValue: l.estimatedValue, nextAction: l.aiNextAction,
    })),
    blockedWorkflows,
    openIssues: (openIssues as any[]).map(i => ({
      description: i.description, area: i.ai?.area || 'general', severity: i.ai?.severity || 'medium',
    })),
    sessionsClosed,
    tasksCompletedYesterday: tasksCompleted,
    dealsClosed,
  };

  const ai = await generateMorningBrief(snapshot);
  const doc = await MorningBrief.findOneAndUpdate(
    { organizationId: orgId, istDate },
    { $set: { summary: ai.text, snapshot, generatedBy, aiUsed: ai.aiUsed } },
    { new: true, upsert: true },
  );
  return doc;
}
