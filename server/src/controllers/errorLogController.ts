import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ErrorLog from '../models/ErrorLog';
import User from '../models/User';

/**
 * Receives client-side error reports from the browser (window.onerror,
 * unhandled promise rejections, axios failures). The actor must be
 * authenticated so we can attribute and org-scope the report.
 */
export async function reportClientError(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { message, stack, url, userAgent, meta } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message required' });
      return;
    }
    // Look up the user's org for attribution
    const u = await User.findById(req.user!.id).select('organizationId email').lean();
    await ErrorLog.create({
      source: 'client',
      level: 'error',
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : undefined,
      url: url ? String(url).slice(0, 1000) : undefined,
      userId: req.user!.id,
      userEmail: u?.email,
      organizationId: u?.organizationId,
      userAgent: userAgent ? String(userAgent).slice(0, 500) : undefined,
      meta,
    });
    res.json({ ok: true });
  } catch (err) {
    // We don't want logging the error to itself error out — fail silently.
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Admin: list recent error logs. Org-scoped — admins only see their own
 * agency's errors, never another agency's.
 */
export async function listErrorLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const u = await User.findById(req.user!.id).select('organizationId').lean();
    const orgId = u?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const source = req.query.source as string | undefined;

    const filter: any = { organizationId: orgId };
    if (source === 'server' || source === 'client') filter.source = source;

    const logs = await ErrorLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
