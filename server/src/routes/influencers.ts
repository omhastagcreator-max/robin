import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listInfluencers, createInfluencer, updateInfluencer,
  deleteInfluencer, influencerStats,
} from '../controllers/influencerController';

// RBAC fix: previously authenticated-only — a `client` account could
// CRUD the agency's influencer roster. Restricted to internal staff;
// mutations gated to admin/employee/sales; deletes admin-only.
const router = Router();

router.use(authMiddleware);
router.get('/',        requireRole('admin', 'employee', 'sales', 'workroom'), listInfluencers);
router.get('/stats',   requireRole('admin', 'employee', 'sales'),              influencerStats);
router.post('/',       requireRole('admin', 'employee', 'sales'),              createInfluencer);
router.put('/:id',     requireRole('admin', 'employee', 'sales'),              updateInfluencer);
router.delete('/:id',  requireRole('admin'),                                    deleteInfluencer);

export default router;
