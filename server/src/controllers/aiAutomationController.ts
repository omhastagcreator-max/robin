import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { scoreLead, summarizeWorkflow, summarizeAllProjects, generateMorningBrief, aiHealth, parseCommand, askRobin, draftLeadFollowup } from '../services/aiTriage';
import { withAICache, withRateLimit, computeLeadInsights } from '../services/aiInsights';
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
 * POST /api/ai-automation/parse-command
 *
 * Takes a natural-language message ("mark velloer living done") and
 * returns the structured action the AI extracted, so the frontend can
 * confirm + dispatch to the real API endpoint.
 *
 * We deliberately DON'T execute the action server-side — the frontend
 * shows a confirmation card first, then calls the existing endpoint
 * (api.createTask, api.cwCompleteService, etc.). Keeps the AI in the
 * advisory loop and lets the user veto.
 */
export async function parseCommandEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) { res.status(400).json({ error: 'Please type a command.' }); return; }
    if (message.length > 600) { res.status(400).json({ error: 'Command too long.' }); return; }
    const r = await parseCommand(message);
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/ai-automation/health-authed  (admin-only — used by the UI panel)
 */
export async function getAiHealth(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const h = await aiHealth();
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/ai-automation/health  (PUBLIC — intentionally)
 *
 * Same payload as the authed version, no JWT required. Safe to expose:
 * the response only reveals `configured: true/false`, the model name,
 * and the last error string — never the API key itself. The owner can
 * hit this URL in any browser without juggling tokens to debug why
 * AI is silent.
 */
export async function getAiHealthPublic(_req: any, res: Response): Promise<void> {
  try {
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
 * POST /api/ai-automation/brief-all-projects
 * One Gemini call → one-paragraph state of every active project.
 * The Project Pipeline page surfaces this as a "Brief all projects" button.
 */
export async function briefAllProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const list = await ClientWorkflow.find({
      organizationId: orgId,
      // Skip workflows where every service is done — focus on active work.
      'services.status': { $ne: 'done' },
    }).select('clientName services activity').lean();

    const projects = (list as any[]).map(wf => {
      const services = (wf.services || []).map((s: any) => {
        const total = s.checklist?.length || 0;
        const done  = (s.checklist || []).filter((c: any) => c.done).length;
        return {
          label: s.label, serviceType: s.serviceType, status: s.status,
          pct: total ? Math.round((done / total) * 100) : 0,
          remaining: total - done,
        };
      });
      const lastActivity = (wf.activity || []).slice(-1)[0];
      return {
        clientName: wf.clientName,
        services,
        lastUpdate: lastActivity ? (lastActivity.detail || lastActivity.action) : null,
      };
    });

    const r = await summarizeAllProjects(projects);
    res.json({ ...r, projectCount: projects.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

// ─── Robin Copilot ─────────────────────────────────────────────────────
/**
 * POST /api/ai-automation/copilot
 * Body: { question, route, workflowId?, leadId? }
 *
 * The context-aware "Robin Copilot" — the user types a question, we pull
 * the minimum useful slice of agency context based on the route they're
 * on, and pass it to Gemini via askRobin().
 *
 * Caching: identical (user, route, question, contextId) within 60s → cached
 * answer. Stops the same prompt being re-billed when the user toggles the
 * drawer or re-clicks a quick prompt.
 *
 * Rate limit: 30 req/min per user (token bucket in aiInsights). Returns
 * 429 with a helpful message when exhausted.
 */
export async function copilotEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId   = req.user!.id;
    const role     = req.user!.role;
    const question = String(req.body?.question || '').trim();
    const route    = String(req.body?.route || '').trim() || '/';
    const wfId     = req.body?.workflowId ? String(req.body.workflowId) : null;
    const leadId   = req.body?.leadId     ? String(req.body.leadId)     : null;

    if (!question)           { res.status(400).json({ error: 'Please type a question.' }); return; }
    if (question.length > 800) { res.status(400).json({ error: 'Question too long (max 800 chars).' }); return; }

    const orgId = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    // Build context based on route + IDs the caller surfaced.
    const context: any = { url: route, userRole: role };

    if (wfId) {
      const wf = await ClientWorkflow.findOne({ _id: wfId, organizationId: orgId })
        .select('clientName clientPhone services health healthReason blockerType blockerReason eta riskScore delayCause nextBestAction predictedCompletionAt lastActivityAt lastActivitySummary priority')
        .lean() as any;
      if (wf) {
        context.workflow = {
          name:           wf.clientName,
          health:         wf.health,
          healthReason:   wf.healthReason,
          blockerType:    wf.blockerType,
          blockerReason:  wf.blockerReason,
          eta:            wf.eta,
          predictedEnd:   wf.predictedCompletionAt,
          riskScore:      wf.riskScore,
          delayCause:     wf.delayCause,
          nextBestAction: wf.nextBestAction,
          priority:       wf.priority,
          lastActivity:   wf.lastActivitySummary,
          services: (wf.services || []).map((s: any) => ({
            type:     s.serviceType,
            label:    s.label,
            status:   s.status,
            progress: `${(s.checklist || []).filter((c: any) => c.done).length}/${(s.checklist || []).length}`,
          })),
        };
      }
    }

    if (leadId) {
      const lead = await Lead.findOne({ _id: leadId, organizationId: orgId })
        .select('name company contact email stage estimatedValue aiScore aiReason aiNextAction')
        .lean() as any;
      if (lead) {
        context.lead = {
          name:           lead.name,
          company:        lead.company,
          stage:          lead.stage,
          estimatedValue: lead.estimatedValue,
          aiScore:        lead.aiScore,
          aiNextAction:   lead.aiNextAction,
        };
      }
    }

    // Generic context when on a "list" route — pull a tiny operational
    // snapshot scoped to the role. Cheap; Mongo indexes cover it.
    if (route.startsWith('/clients/pipeline') && !wfId) {
      const wfs = await ClientWorkflow.find({
        organizationId: orgId,
        'services.status': { $ne: 'done' },
      })
        .select('clientName health riskScore delayCause nextBestAction')
        .sort({ riskScore: -1, lastActivityAt: -1 })
        .limit(15).lean();
      context.atRiskProjects = (wfs as any[]).filter(w => (w.riskScore || 0) >= 40).map(w => ({
        name: w.clientName, risk: w.riskScore, reason: w.delayCause, next: w.nextBestAction,
      }));
    }

    if (route.startsWith('/tasks')) {
      const tasks = await ProjectTask.find({
        assignedTo: userId,
        status: { $in: ['pending', 'ongoing'] },
      }).select('title priority dueDate status').sort({ dueDate: 1, priority: -1 }).limit(10).lean();
      context.myOpenTasks = (tasks as any[]).map(t => ({
        title: t.title, priority: t.priority, due: t.dueDate, status: t.status,
      }));
    }

    if (route.startsWith('/sales')) {
      const leads = await Lead.find({
        organizationId: orgId,
        stage: { $nin: ['won', 'lost'] },
      }).select('name company stage aiScore aiNextAction').sort({ aiScore: 1 }).limit(15).lean();
      context.openLeads = (leads as any[]).map(l => ({
        name: l.name, company: l.company, stage: l.stage, score: l.aiScore, next: l.aiNextAction,
      }));
    }

    // Cache key = question + route + ID context. 60s TTL.
    const ctxKey  = wfId ? `wf:${wfId}` : leadId ? `lead:${leadId}` : route;
    const cacheKey = `copilot:${userId}:${ctxKey}:${question.toLowerCase().slice(0, 120)}`;

    const result = await withRateLimit(userId, () =>
      withAICache(cacheKey, 60_000, () => askRobin(question, context))
    );

    res.json({ answer: result.answer, aiUsed: result.aiUsed });
  } catch (err: any) {
    if (err?.status === 429) {
      res.status(429).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
}

// ─── Lead AI insights + drafted follow-up ─────────────────────────────
/**
 * GET /api/ai-automation/lead-insights/:id
 * Returns the heuristic AI insight block (closingProbability, ghostingRisk,
 * nextMove) for one lead. No LLM call — derived from stage + aiScore +
 * notes timeline. Free, fast, always populated.
 */
export async function leadInsightsEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const lead = await Lead.findOne({ _id: req.params.id, organizationId: orgId })
      .select('stage aiScore aiReason aiNextAction estimatedValue createdAt notes')
      .lean() as any;
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const insights = computeLeadInsights({
      stage:          lead.stage,
      aiScore:        lead.aiScore,
      estimatedValue: lead.estimatedValue,
      createdAt:      lead.createdAt,
      notes:          lead.notes,
    });
    res.json({
      ...insights,
      aiScore:      lead.aiScore,
      aiReason:     lead.aiReason,
      aiNextAction: lead.aiNextAction,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/ai-automation/lead-followup/:id
 * Body: { channel?: 'whatsapp' | 'email' }
 *
 * Drafts a paste-ready follow-up message tuned to the lead's stage + score +
 * how long they've been silent. Cached per (user, lead, channel) for 5 min.
 */
export async function leadFollowupEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId  = req.user!.id;
    const orgId   = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const channel: 'whatsapp' | 'email' = req.body?.channel === 'email' ? 'email' : 'whatsapp';

    const lead = await Lead.findOne({ _id: req.params.id, organizationId: orgId })
      .select('name company stage aiScore aiNextAction estimatedValue notes createdAt')
      .lean() as any;
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    // Days since most recent contact — used by the prompt to soften the tone.
    const lastNoteAt = (() => {
      const dates = (lead.notes || []).map((n: any) => n.createdAt ? new Date(n.createdAt).getTime() : 0).filter(Boolean);
      if (!dates.length) return lead.createdAt ? new Date(lead.createdAt).getTime() : Date.now();
      return Math.max(...dates);
    })();
    const daysSinceLastContact = Math.max(0, Math.round((Date.now() - lastNoteAt) / (24 * 3600 * 1000)));

    const cacheKey = `leadfollowup:${userId}:${req.params.id}:${channel}`;
    const result = await withRateLimit(userId, () =>
      withAICache(cacheKey, 5 * 60_000, () => draftLeadFollowup({
        name:                 lead.name,
        company:              lead.company,
        stage:                lead.stage,
        aiScore:              lead.aiScore,
        aiNextAction:         lead.aiNextAction,
        estimatedValue:       lead.estimatedValue,
        daysSinceLastContact,
        channel,
      }))
    );
    res.json({ ...result, channel, daysSinceLastContact });
  } catch (err: any) {
    if (err?.status === 429) { res.status(429).json({ error: err.message }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
}
