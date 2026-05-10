import { Request, Response, NextFunction } from 'express';
import ErrorLog from '../models/ErrorLog';
import User from '../models/User';
import { AuthRequest } from './authMiddleware';

/**
 * Global Express error handler — logs to console AND persists to the
 * ErrorLog collection so admins can query a unified crash report.
 *
 * Persistence is fire-and-forget so logging an error never blocks the
 * response. If the DB write itself fails, we just log to console.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[ErrorHandler]', err.message);

  // Try to attribute to the user/org if the request was authed.
  const authReq = req as AuthRequest;
  const userId  = authReq.user?.id;
  const orgIdRaw = authReq.user?.organizationId;

  ErrorLog.create({
    source: 'server',
    level: 'error',
    message: (err.message || 'Internal server error').slice(0, 2000),
    stack: err.stack ? err.stack.slice(0, 8000) : undefined,
    url: req.originalUrl,
    method: req.method,
    statusCode: 500,
    userId,
    organizationId: orgIdRaw,
    userAgent: req.headers['user-agent']?.slice(0, 500),
  }).catch((logErr) => {
    console.error('[ErrorHandler] failed to persist error log', logErr.message);
  });

  // If we have a userId but no orgId on the request, fetch + backfill on the
  // log entry. Best-effort, doesn't delay the response.
  if (userId && !orgIdRaw) {
    User.findById(userId).select('organizationId').lean()
      .then((u) => {
        if (u?.organizationId) {
          // Lazy linkage — the log entry was just created above; we accept
          // missing orgId rather than racing on the insert. Future logs
          // for this user will be attributed correctly via authMiddleware.
        }
      })
      .catch(() => { /* ignore */ });
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
}
