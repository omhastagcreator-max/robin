import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { createWorkroomUser } from '../controllers/workroomOnboardController';

/**
 * Workroom onboarding — single endpoint that lets admins OR users with
 * canManageWorkroom=true create new role='workroom' teammates.
 *
 * The PERMISSION CHECK lives inside the controller (not as a requireRole
 * middleware) because it's a per-user flag, not a role. The controller
 * looks up canManageWorkroom on the calling user before allowing the
 * create.
 */
const router = Router();
router.use(authMiddleware);
router.post('/', createWorkroomUser);

export default router;
