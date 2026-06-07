import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { search } from '../controllers/searchController';

const router = Router();
router.use(authMiddleware);
router.get('/', search);
export default router;
