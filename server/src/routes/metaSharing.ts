import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { createShare, listShares, revokeShare, viewShare } from '../controllers/metaSharingController';

/**
 * Routes for Meta Ads sharing — split into PUBLIC and AUTHED.
 *
 * Public router exposes ONLY the share-view endpoint, mounted at
 *   GET /api/share/meta/:token
 * No auth — the token IS the auth.
 *
 * Authed router exposes create / list / revoke under /api/ads/meta/share*
 * gated by Meta access.
 */

export const publicMetaShareRouter = Router();
publicMetaShareRouter.get('/share/meta/:token', viewShare);

export const authedMetaShareRouter = Router();
authedMetaShareRouter.use(authMiddleware);
// We re-use requireMetaAccess from the main metaAds router.
// Importing it here would cause a circular dep, so we import inline:
import('./metaAds').then(() => { /* warm import to ensure middleware exists */ });
// Cleanest: re-declare the gate locally — small duplication, no cycle.
authedMetaShareRouter.use((req: any, res, next) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Not authenticated' });
  const eligibleTeams = (process.env.META_ELIGIBLE_TEAMS || 'meta,ads').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isAdmin     = u.role === 'admin' || (u.roles || []).includes('admin');
  const onMetaTeam  = !!u.team && eligibleTeams.includes(u.team);
  const inMetaTeams = (u.teams || []).some((t: string) => eligibleTeams.includes(t));
  if (isAdmin || onMetaTeam || inMetaTeams) return next();
  res.status(403).json({ error: 'Meta access required' });
});

authedMetaShareRouter.post('/share',          createShare);
authedMetaShareRouter.get('/shares',          listShares);
authedMetaShareRouter.delete('/share/:id',    revokeShare);

export default authedMetaShareRouter;
