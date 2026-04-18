import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  listInfluencers, createInfluencer, updateInfluencer,
  deleteInfluencer, influencerStats,
} from '../controllers/influencerController';

const router = Router();

router.use(authMiddleware);
router.get('/',        listInfluencers);
router.post('/',       createInfluencer);
router.get('/stats',   influencerStats);
router.put('/:id',     updateInfluencer);
router.delete('/:id',  deleteInfluencer);

export default router;
