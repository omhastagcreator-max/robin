import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { getMyTargets, getTeamTargets, setUserTargets } from '../controllers/targetsController';

const router = Router();
router.use(authMiddleware);

// Self — any internal role can see their own targets.
router.get('/me', getMyTargets);

// Team-wide — admin + sales (sales also drives certain target lines).
router.get('/team', requireRole('admin', 'sales'), getTeamTargets);

// Set/upsert someone's targets — admin only (sales can read, not write).
router.put('/user/:userId', requireRole('admin'), setUserTargets);

export default router;
