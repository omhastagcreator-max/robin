import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Issue from '../models/Issue';
import User from '../models/User';
import { triageIssue, askRobin } from '../services/aiTriage';

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;  // ~2 MB cap on inline screenshots

/**
 * POST /api/issues
 * Any authenticated user — submit a bug / question. Calls Claude for an
 * immediate suggested-fix that's returned in the response.
 */
export async function createIssue(req: AuthRequest, res: Response): Promise<void> {
  try {
    const caller = req.user!;
    const description    = String(req.body.description || '').trim();
    const screenshotData = typeof req.body.screenshotData === 'string' ? req.body.screenshotData : '';
    const context        = req.body.context && typeof req.body.context === 'object' ? req.body.context : {};

    if (!description) { res.status(400).json({ error: 'Please describe the issue (or your question).' }); return; }
    if (description.length > 4000) { res.status(400).json({ error: 'Description too long — please trim under 4000 characters.' }); return; }
    if (screenshotData && screenshotData.length > MAX_SCREENSHOT_BYTES) {
      res.status(413).json({ error: 'Screenshot is too large (>2 MB). Try a smaller crop or skip the screenshot.' });
      return;
    }

    // Enrich author info from the DB rather than trusting the JWT alone.
    const userDoc = await User.findById(caller.id).select('name email role organizationId').lean();

    // Hit Claude for triage — graceful fallback if no key / API hiccup.
    const ai = await triageIssue(description, {
      url:           context.url,
      userRole:      userDoc?.role || caller.role,
      userAgent:     context.userAgent,
      recentErrors:  Array.isArray(context.recentErrors)  ? context.recentErrors.slice(0, 10)  : [],
      recentNetwork: Array.isArray(context.recentNetwork) ? context.recentNetwork.slice(0, 10) : [],
    });

    const issue = await Issue.create({
      userId:         caller.id,
      userName:       userDoc?.name  || '',
      userEmail:      userDoc?.email || '',
      userRole:       userDoc?.role  || caller.role,
      organizationId: userDoc?.organizationId,
      description,
      screenshotData,
      context: {
        url:           String(context.url || '').slice(0, 500),
        userAgent:     String(context.userAgent || '').slice(0, 500),
        viewport:      String(context.viewport || '').slice(0, 50),
        recentErrors:  (Array.isArray(context.recentErrors)  ? context.recentErrors  : []).slice(0, 10).map(String),
        recentNetwork: (Array.isArray(context.recentNetwork) ? context.recentNetwork : []).slice(0, 10).map(String),
      },
      ai: {
        category:       ai.category,
        severity:       ai.severity,
        area:           ai.area,
        suspectedCause: ai.suspectedCause,
        suggestedFix:   ai.suggestedFix,
        adminNote:      ai.adminNote,
      },
    });

    res.status(201).json({
      issueId:      String(issue._id),
      suggestedFix: ai.suggestedFix,
      area:         ai.area,
      severity:     ai.severity,
      aiUsed:       ai.aiUsed,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/issues  (admin-only)
 * Paginated, sortable list. Default: open + investigating first, newest.
 */
export async function listIssues(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const status = req.query.status as string | undefined;
    const area   = req.query.area   as string | undefined;
    const limit  = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

    const q: any = {};
    if (status) q.status = status;
    if (area)   q['ai.area'] = area;

    const list = await Issue.find(q)
      // Don't return huge screenshot dataURLs in the list — fetch via getIssue.
      .select('-screenshotData')
      .sort({ status: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/issues/clusters  (admin-only)
 * Returns issues grouped by ai.area + status so admin can see "what's
 * broken most often" at a glance.
 */
export async function clusterIssues(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const clusters = await Issue.aggregate([
      { $match: { status: { $in: ['open', 'investigating'] } } },
      { $group: {
          _id:        { area: '$ai.area', severity: '$ai.severity' },
          count:      { $sum: 1 },
          latest:     { $max: '$createdAt' },
          example:    { $first: '$description' },
          suggestion: { $first: '$ai.suggestedFix' },
        } },
      { $sort: { count: -1, latest: -1 } },
      { $limit: 40 },
    ]);
    res.json(clusters);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/issues/:id  (admin or the reporter)
 */
export async function getIssue(req: AuthRequest, res: Response): Promise<void> {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) { res.status(404).json({ error: 'Not found' }); return; }
    const isAdmin = req.user!.role === 'admin';
    const isOwner = String(issue.userId) === req.user!.id;
    if (!isAdmin && !isOwner) { res.status(403).json({ error: 'Not allowed' }); return; }
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * PUT /api/issues/:id  (admin-only)
 * Update status / resolution / admin note.
 */
export async function updateIssue(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const patch: any = {};
    const allowed = ['status', 'resolution'] as const;
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.status === 'resolved' || patch.status === 'wont_fix') {
      patch.resolvedBy = req.user!.id;
      patch.resolvedAt = new Date();
    }
    const issue = await Issue.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!issue) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * POST /api/issues/ask  (any authenticated user)
 * Stateless Q&A — used by the "Ask Robin" chat tab.
 */
export async function ask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const question = String(req.body.question || '').trim();
    if (!question) { res.status(400).json({ error: 'Please type a question.' }); return; }
    if (question.length > 2000) { res.status(400).json({ error: 'Question too long — keep it under 2000 chars.' }); return; }
    const userDoc = await User.findById(req.user!.id).select('role').lean();
    const result = await askRobin(question, {
      url:      req.body.context?.url || '',
      userRole: userDoc?.role || req.user!.role,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
