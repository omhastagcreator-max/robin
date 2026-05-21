import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { scoreLead, summarizeWorkflow, summarizeAllProjects, generateMorningBrief, aiHealth, parseCommand, askRobin, askRobinThread, draftLeadFollowup, generateEmployeeReport, type EmployeeReportInput } from '../services/aiTriage';
import { sessionTotals, huddleTotalMs } from '../services/sessionTime';
import { withAICache, withRateLimit, computeLeadInsights, computeTaskFocus } from '../services/aiInsights';
import { buildUserContext, rolePersona, getOrCreateThread, appendTurn, resetThread, recentTurnsForPrompt } from '../services/robinAI';
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
 * "Where is this client?" — paste-ready paragraph for the client.
 *
 * Reads the FULL audit trail (every checklist comment + every note) from
 * the WorkflowActivity collection — not just the last 8 entries from the
 * legacy inline wf.activity[] array. Also looks up the team of each
 * service's current assignee so the AI can attribute delays to a named
 * department instead of saying "the team is working on it".
 */
export async function summarizeWorkflowEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).lean() as any;
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }

    // ── 1. Pull the canonical audit trail. WorkflowActivity is the
    //       source of truth (each row has the mandatory 3-600 char
    //       comment); the inline wf.activity is a legacy backstop. Read
    //       both and dedupe by (action, serviceType, checklistIndex, at).
    const WorkflowActivity = (await import('../models/WorkflowActivity')).default as any;
    const rows = await WorkflowActivity.find({ workflowId: wf._id })
      .sort({ createdAt: -1 })
      .limit(120)  // generous — months of work for a normal client
      .select('action serviceType serviceId checklistIndex actorId actorRole comment createdAt')
      .lean();

    // ── 2. Look up actor teams in one query. We need this to attribute
    //       each comment to a department (Dev / Meta / Influencer / …).
    const actorIds = Array.from(new Set([
      ...rows.map((r: any) => String(r.actorId)).filter(Boolean),
      ...((wf.services || []) as any[]).map(s => String(s.assignedTo || '')).filter(Boolean),
    ]));
    const actors = await User.find({ _id: { $in: actorIds } }).select('_id teams role').lean() as any[];
    const teamByUserId: Record<string, string> = {};
    for (const a of actors) {
      // Pick the first team that maps to a department label. If a user is
      // on multiple teams (rare) we go with the first — good enough for
      // client-facing prose.
      const t = (a.teams || []).find((x: string) => ['sales','development','meta','influencer','qa'].includes(x))
             || (a.role === 'sales' ? 'sales' : '');
      teamByUserId[String(a._id)] = t || '';
    }

    // ── 3. Group activity into per-service step comments + free notes.
    //       Step comments: action ∈ {checklist_checked, checklist_unchecked,
    //       service_completed, service_returned} with a checklistIndex.
    //       Free notes: action='note' (no checklistIndex).
    const stepCommentsByService: Record<string, Array<{ index: number; text: string; actorTeam?: string; at?: string | Date }>> = {};
    const notes: Array<{ at?: string | Date; actorTeam?: string; text: string }> = [];

    for (const r of rows as any[]) {
      if (!r.comment) continue;
      const actorTeam = teamByUserId[String(r.actorId)] || '';
      if (r.action === 'note') {
        notes.push({ at: r.createdAt, actorTeam, text: r.comment });
      } else if (typeof r.checklistIndex === 'number' && r.serviceType) {
        if (!stepCommentsByService[r.serviceType]) stepCommentsByService[r.serviceType] = [];
        stepCommentsByService[r.serviceType].push({
          index:     r.checklistIndex,
          text:      r.comment,
          actorTeam,
          at:        r.createdAt,
        });
      } else if (r.action === 'service_completed' || r.action === 'service_returned') {
        // No checklistIndex but still useful narrative — push as a note.
        notes.push({ at: r.createdAt, actorTeam, text: `${r.action.replace(/_/g,' ')}: ${r.comment}` });
      }
    }

    // ── 3b. Fallback — the WorkflowActivity collection is the canonical
    //       source, but older workflows (and the seeded dummies) only
    //       have entries on the legacy inline wf.activity[] array. When
    //       WorkflowActivity returns nothing, pull from the inline array
    //       so the AI still has the team's running commentary to use.
    if (rows.length === 0 && Array.isArray(wf.activity) && wf.activity.length > 0) {
      for (const a of wf.activity as any[]) {
        if (!a.detail) continue;
        const actorTeam = teamByUserId[String(a.actorId)] || '';
        if (a.action === 'note' || !a.serviceType) {
          notes.push({ at: a.at, actorTeam, text: a.detail });
        } else {
          // The legacy array doesn't carry checklistIndex, so we attribute
          // these as free notes scoped to the service via the prose.
          notes.push({
            at:        a.at,
            actorTeam,
            text:      `(${a.serviceType.replace(/_/g, ' ')}) ${a.detail}`,
          });
        }
      }
    }

    // ── 4. Translate the team code on each service into the friendly
    //       department label the AI prompt uses.
    const TEAM_TO_DEPT: Record<string, string> = {
      sales: 'Sales', development: 'Dev', meta: 'Meta Ads', influencer: 'Influencer', qa: 'QA',
    };
    const services = (wf.services || []).map((s: any) => {
      const ownerTeam = teamByUserId[String(s.assignedTo || '')] || '';
      const fallbackTeam = s.serviceType === 'shopify' ? 'development'
                        :  s.serviceType === 'meta_ads' ? 'meta'
                        :  s.serviceType === 'influencer' ? 'influencer'
                        :  '';
      return {
        label:        s.label,
        serviceType:  s.serviceType,
        status:       s.status,
        departmentLabel: TEAM_TO_DEPT[ownerTeam || fallbackTeam] || '',
        checklist:    s.checklist || [],
        stepComments: stepCommentsByService[s.serviceType] || [],
      };
    });

    const r = await summarizeWorkflow({
      clientName:       wf.clientName,
      blockerType:      wf.blockerType,
      blockerReason:    wf.blockerReason,
      blockedSince:     wf.blockedSince,
      currentOwnerTeam: wf.currentOwnerTeam,
      services,
      notes,
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
    if (question.length > 1200) { res.status(400).json({ error: 'Message too long (max 1200 chars).' }); return; }

    const orgId = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    // ── 1. The "Robin-aware + per-employee" core ────────────────────
    // Pull what Robin knows about this specific user: their open
    // projects, tasks, leads, focus items, weekly priorities. Cached
    // 30s in robinAI so a fast back-and-forth doesn't hammer Mongo.
    const me = await User.findById(userId).select('name role teams').lean() as any;
    const userContext = await buildUserContext(userId, orgId);

    // ── 2. Route-local enrichment ───────────────────────────────────
    // When the user is staring at a specific workflow / lead, splice
    // that into the context too so the AI can answer "what's blocking
    // THIS project" naturally without us re-asking.
    if (wfId) {
      const wf = await ClientWorkflow.findOne({ _id: wfId, organizationId: orgId })
        .select('clientName clientPhone services health healthReason blockerType blockerReason eta riskScore delayCause nextBestAction predictedCompletionAt lastActivityAt lastActivitySummary priority')
        .lean() as any;
      if (wf) {
        (userContext as any).currentlyViewing = {
          kind: 'workflow',
          name: wf.clientName,
          health: wf.health,
          blockerType: wf.blockerType,
          blockerReason: wf.blockerReason,
          eta: wf.eta,
          riskScore: wf.riskScore,
          delayCause: wf.delayCause,
          nextBestAction: wf.nextBestAction,
          priority: wf.priority,
          lastActivity: wf.lastActivitySummary,
          services: (wf.services || []).map((s: any) => ({
            type: s.serviceType,
            label: s.label,
            status: s.status,
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
        (userContext as any).currentlyViewing = {
          kind: 'lead',
          name: lead.name,
          company: lead.company,
          stage: lead.stage,
          estimatedValue: lead.estimatedValue,
          aiScore: lead.aiScore,
          aiNextAction: lead.aiNextAction,
        };
      }
    }

    // ── 3. Thread persistence ───────────────────────────────────────
    // Load (or create) THIS user's persistent conversation. Append
    // their question now so concurrent reads see the latest message;
    // append the assistant reply after Gemini returns.
    const thread = await getOrCreateThread(orgId, userId);

    // Cache key now includes a short hash of the last assistant turn
    // so we DON'T cache across different conversation states (which
    // would make the AI "forget" the latest user message).
    const lastAssistant = [...thread.turns].reverse().find((t: any) => t.role === 'assistant');
    const lastKey = lastAssistant ? String(lastAssistant.text).slice(-40) : 'empty';
    const ctxKey  = wfId ? `wf:${wfId}` : leadId ? `lead:${leadId}` : route;
    const cacheKey = `copilot:${userId}:${ctxKey}:${lastKey}:${question.toLowerCase().slice(0, 120)}`;

    const history = recentTurnsForPrompt(thread);
    const persona = rolePersona(me?.role || role, me?.teams || []);

    const result = await withRateLimit(userId, () =>
      withAICache(cacheKey, 60_000, () => askRobinThread({
        persona,
        userContext,
        history,
        pinnedNote: thread.pinnedNote,
        question,
        route,
      }))
    );

    // Persist user + assistant turns. Best-effort — if save fails we
    // still return the answer so the UX doesn't break on a transient
    // Mongo blip.
    try {
      await appendTurn(orgId, userId, { role: 'user', text: question, route, aiUsed: false });
      await appendTurn(orgId, userId, { role: 'assistant', text: result.answer, route, aiUsed: result.aiUsed });
    } catch (saveErr) {
      console.warn('[copilot] thread save failed:', (saveErr as Error).message);
    }

    res.json({
      answer:    result.answer,
      aiUsed:    result.aiUsed,
      threadId:  String(thread._id),
      // Lightweight stats for the drawer header.
      turnCount: thread.turns.length + 2,
    });
  } catch (err: any) {
    if (err?.status === 429) {
      res.status(429).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/ai-automation/copilot/thread
 * Returns this user's persistent conversation. Used by the drawer on open
 * so they pick up where they left off.
 */
export async function getCopilotThread(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const t = await getOrCreateThread(orgId, userId);
    res.json({
      _id:        String(t._id),
      pinnedNote: t.pinnedNote,
      turns: (t.turns || []).map((tr: any) => ({
        _id:    String(tr._id),
        role:   tr.role,
        text:   tr.text,
        route:  tr.route,
        aiUsed: tr.aiUsed,
        at:     tr.at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * DELETE /api/ai-automation/copilot/thread
 * Wipes the conversation history (keeps the thread doc + pinnedNote).
 * Used by the "Start fresh" button in the drawer.
 */
export async function deleteCopilotThread(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const t = await resetThread(orgId, userId);
    res.json({ ok: true, threadId: String(t._id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * PATCH /api/ai-automation/copilot/thread/pin
 * Body: { note: string }
 * Updates the "always remember this" note the user has pinned to their
 * thread. Injected into every system prompt thereafter.
 */
export async function updateCopilotPin(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrgId(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const note = String(req.body?.note || '').slice(0, 1000);
    const t = await getOrCreateThread(orgId, userId);
    t.pinnedNote = note;
    await t.save();
    res.json({ ok: true, pinnedNote: t.pinnedNote });
  } catch (err) {
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
 * GET /api/ai-automation/focus?limit=5
 * Returns the calling user's tasks ranked by what they should do RIGHT
 * NOW. Heuristic — no LLM call. Each task carries focusScore (0-100),
 * a one-line reason, and a bucket (overdue / today / unblock / next)
 * so the UI can group them.
 */
export async function focusEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const limit  = Math.min(Math.max(parseInt(String(req.query.limit || '5'), 10) || 5, 1), 20);

    const open = await ProjectTask.find({
      assignedTo: userId,
      status: { $in: ['pending', 'ongoing'] },
    }).select('title priority dueDate status taskType createdAt projectId').sort({ dueDate: 1 }).limit(100).lean();

    // Join project names so the UI can show "Acme Corp · ad creative"
    const projectIds = Array.from(new Set((open as any[]).map(t => t.projectId).filter(Boolean).map(String)));
    let projectMap: Record<string, string> = {};
    if (projectIds.length) {
      const Project = (await import('../models/Project')).default as any;
      const projects = await Project.find({ _id: { $in: projectIds } }).select('name').lean();
      for (const p of projects as any[]) projectMap[String(p._id)] = p.name || '';
    }

    const ranked = computeTaskFocus(open as any[]);
    // Splice project name in. computeTaskFocus is pure / doesn't know about projects.
    const enriched = ranked.map(r => {
      const orig = (open as any[]).find(t => String(t._id) === r._id);
      return { ...r, projectName: orig?.projectId ? projectMap[String(orig.projectId)] : undefined };
    });

    res.json({
      items:     enriched.slice(0, limit),
      totalOpen: open.length,
      generatedAt: new Date(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

// ─── Employee report — admin one-click AI summary ─────────────────────
/**
 * POST /api/ai-automation/employee-report/:userId
 * Body: { periodDays?: number }   // default 7
 *
 * Builds a per-day snapshot of one employee's recent work (sessions,
 * breaks, on-call, huddle, tasks) using the same sessionTotals() helper
 * the dashboard timer uses, then asks Gemini for a short admin-facing
 * narrative. The "break credit" rule (≤1h break is free) is honoured
 * everywhere: the snapshot reports effective working hours, and the
 * pattern flags call out "short break" days as a positive.
 *
 * Admin-only. Rate-limited like the rest of the AI surface.
 */
export async function employeeReportEndpoint(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const userId     = String(req.params.userId);
    const periodDays = Math.max(1, Math.min(30, parseInt(String(req.body?.periodDays || '7'), 10) || 7));

    const emp = await User.findOne({ _id: userId, organizationId: orgId }).select('name email role teams').lean() as any;
    if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

    // Window — last `periodDays` calendar days ending today.
    const now      = Date.now();
    const dayMs    = 24 * 3600 * 1000;
    const startMs  = now - (periodDays * dayMs);

    const sessions = await Session.find({
      organizationId: orgId,
      userId,
      startTime: { $gte: new Date(startMs) },
    }).select('startTime endTime breakEvents lastHeartbeatAt awayMs status huddleMs huddleJoinedAt onCallSince').lean() as any[];

    // Group sessions by local date (IST). For simplicity we bucket by the
    // UTC date of startTime — fine for a 7-day report; precision-by-tz can
    // be refined later if the org goes multi-timezone.
    const byDate: Record<string, any[]> = {};
    for (const s of sessions) {
      const d = new Date(s.startTime);
      const key = d.toISOString().split('T')[0];
      (byDate[key] = byDate[key] || []).push(s);
    }

    const days: EmployeeReportInput['days'] = [];
    for (let i = periodDays - 1; i >= 0; i--) {
      const date = new Date(now - i * dayMs);
      const key  = date.toISOString().split('T')[0];
      const ss   = byDate[key] || [];

      let workedMin = 0, grossMin = 0, breakMin = 0, awayMin = 0, huddleMin = 0, onCallMin = 0;
      let firstStart: string | undefined;
      let lastEnd:    string | undefined;
      const dayStart = new Date(`${key}T00:00:00.000Z`).getTime();
      const dayEnd   = dayStart + dayMs;

      for (const s of ss) {
        const t = sessionTotals(s, dayStart, dayEnd);
        workedMin += Math.round(t.activeMs / 60_000);
        grossMin  += Math.round(t.workedMs / 60_000);
        breakMin  += Math.round(t.breakMs  / 60_000);
        awayMin   += Math.round(t.awayMs   / 60_000);
        huddleMin += Math.round(huddleTotalMs(s, dayEnd) / 60_000);

        const ts = new Date(s.startTime);
        const tsHM = ts.toISOString().substring(11, 16); // HH:mm UTC — good enough
        if (!firstStart || tsHM < firstStart) firstStart = tsHM;
        if (s.endTime) {
          const te = new Date(s.endTime).toISOString().substring(11, 16);
          if (!lastEnd || te > lastEnd) lastEnd = te;
        }
      }

      days.push({
        date: key,
        workedMin, grossMin, breakMin, onCallMin, huddleMin, awayMin,
        firstStart, lastEnd,
        sessionCount: ss.length,
      });
    }

    // Pattern flags — let the model focus on narrative, not arithmetic.
    const workedDays = days.filter(d => d.workedMin > 30);
    const avgWorkedHoursPerDay = workedDays.length
      ? +(workedDays.reduce((a, d) => a + d.workedMin, 0) / workedDays.length / 60).toFixed(1)
      : 0;
    const avgBreakMin = workedDays.length
      ? Math.round(workedDays.reduce((a, d) => a + d.breakMin, 0) / workedDays.length)
      : 0;

    // Tasks — completed / assigned / ongoing / overdue inside the window.
    const tasksOngoing  = await ProjectTask.countDocuments({ assignedTo: userId, status: { $in: ['pending', 'ongoing'] } });
    const tasksDone     = await ProjectTask.countDocuments({ assignedTo: userId, status: 'done', updatedAt: { $gte: new Date(startMs) } });
    const tasksAssigned = await ProjectTask.countDocuments({ assignedTo: userId, createdAt:  { $gte: new Date(startMs) } });
    const tasksOverdue  = await ProjectTask.countDocuments({
      assignedTo: userId, status: { $in: ['pending', 'ongoing'] },
      dueDate: { $lt: new Date() },
    });

    const snap: EmployeeReportInput = {
      name: emp.name || emp.email || 'Unknown',
      role: emp.role,
      team: (emp.teams || [])[0],
      periodDays,
      days,
      patterns: {
        avgWorkedHoursPerDay,
        avgBreakMin,
        shortBreakDays: workedDays.filter(d => d.breakMin > 0 && d.breakMin <= 30).length,
        longBreakDays:  workedDays.filter(d => d.breakMin > 75).length,
        noBreakDays:    workedDays.filter(d => d.breakMin === 0).length,
        lateStartDays:  workedDays.filter(d => d.firstStart && d.firstStart > '10:30').length,
        onCallDays:     workedDays.filter(d => d.onCallMin > 0).length,
        huddleDayPct:   workedDays.length
          ? Math.round(100 * workedDays.filter(d => d.huddleMin > 60).length / workedDays.length)
          : 0,
      },
      tasks: {
        completed: tasksDone,
        assigned:  tasksAssigned,
        ongoing:   tasksOngoing,
        overdue:   tasksOverdue,
      },
    };

    const cacheKey = `emp-report:${userId}:${periodDays}d:${days[days.length-1]?.workedMin || 0}`;
    const result = await withRateLimit(req.user!.id, () =>
      withAICache(cacheKey, 5 * 60_000, () => generateEmployeeReport(snap))
    );

    res.json({ ...result, snapshot: snap });
  } catch (err: any) {
    if (err?.status === 429) { res.status(429).json({ error: err.message }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
}
