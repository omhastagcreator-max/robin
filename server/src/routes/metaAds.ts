import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { listAccounts, listAccountsHealth, getYesterday, getRange, getCampaigns } from '../controllers/metaAdsController';
import { createShare, listShares, revokeShare } from '../controllers/metaSharingController';

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

  // Both 'meta' (Meta Ads specific) and 'ads' (broader ads team) grant access.
  // Override via env if you need a different scheme.
  const eligibleTeams = (process.env.META_ELIGIBLE_TEAMS || 'meta,ads').split(',').map(s => s.trim()).filter(Boolean);

  const isAdmin       = u.role === 'admin' || (u.roles || []).includes('admin');
  const onMetaTeam    = !!u.team && eligibleTeams.includes(u.team);
  const inMetaTeams   = (u.teams || []).some(t => eligibleTeams.includes(t));

  if (isAdmin || onMetaTeam || inMetaTeams) return next();
  res.status(403).json({ error: 'Meta Ads access requires the ads team or admin role.' });
}

router.use(requireMetaAccess);

router.get('/accounts',         listAccounts);
router.get('/accounts/health',  listAccountsHealth);
router.get('/yesterday',        getYesterday);
router.get('/range',            getRange);
router.get('/campaigns',        getCampaigns);

// Sharing — same router so /share lives next to the rest of /ads/meta
// (avoids any Express sub-router fall-through quirks when two routers
//  share a prefix).
router.post('/share',           createShare);
router.get('/shares',           listShares);
router.delete('/share/:id',     revokeShare);

export default router;
