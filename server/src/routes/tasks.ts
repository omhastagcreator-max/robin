import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import { listTasks, createTask, getTask, updateTask, deleteTask, getProjectTasks, addComment } from '../controllers/tasksController';

const router = Router();
router.use(authMiddleware);
router.get('/project/:projectId', getProjectTasks);
router.get('/', listTasks);
router.post('/', requireRole('admin', 'employee', 'sales'), createTask);
router.get('/:id', getTask);
router.put('/:id', requireRole('admin', 'employee'), updateTask);
router.delete('/:id', requireRole('admin', 'employee'), deleteTask);
router.post('/:id/comments', addComment);
export default router;
