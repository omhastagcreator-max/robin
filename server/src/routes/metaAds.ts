import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { listAccounts, getYesterday, getRange, getCampaigns } from '../controllers/metaAdsController';

const router = Router();
router.use(authMiddleware);

/**
 * Meta Ads access gate.
 *
 * Allowed:
 *   - admin role (always)
 *   - any user whose primary `team` equals one of the meta-eligible teams
 *   - any user whose `teams[]` array contains one of those teams
 *   - any user whose `roles[]` array contains 'admin' (multi-role support)
 *
 * "Meta-eligible teams" defaults to ['ads'] but can be overridden via
 * env META_ELIGIBLE_TEAMS (comma-separated) without a code change.
 */
function requireMetaAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  const u = req.user;
  if (!u) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const eligibleTeams = (process.env.META_ELIGIBLE_TEAMS || 'ads').split(',').map(s => s.trim()).filter(Boolean);

  const isAdmin       = u.role === 'admin' || (u.roles || []).includes('admin');
  const onMetaTeam    = !!u.team && eligibleTeams.includes(u.team);
  const inMetaTeams   = (u.teams || []).some(t => eligibleTeams.includes(t));

  if (isAdmin || onMetaTeam || inMetaTeams) return next();
  res.status(403).json({ error: 'Meta Ads access requires the ads team or admin role.' });
}

router.use(requireMetaAccess);

router.get('/accounts',  listAccounts);
router.get('/yesterday', getYesterday);
router.get('/range',     getRange);
router.get('/campaigns', getCampaigns);

export default router;
