import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listProjects, createProject, getProject, updateProject, deleteProject, addMember, removeMember } from '../controllers/projectsController';

const router = Router();
router.use(authMiddleware);

router.get('/',                             listProjects);
router.post('/',                            requireRole('admin', 'sales'), createProject);
router.get('/:id',                          getProject);
router.put('/:id',                          requireRole('admin', 'employee'), updateProject);
router.delete('/:id',                       requireRole('admin'), deleteProject);
router.post('/:id/members',                 requireRole('admin', 'employee'), addMember);
router.delete('/:id/members/:userId',       requireRole('admin', 'employee'), removeMember);

export default router;
