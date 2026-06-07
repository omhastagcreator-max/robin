import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listTasks, createTask, getTask, updateTask, deleteTask,
  getProjectTasks, addComment, inbox, listForWorkflow,
  setDependencies, getGraph,
} from '../controllers/tasksController';

const router = Router();
router.use(authMiddleware);

// IMPORTANT — define specific routes BEFORE /:id so Express doesn't
// treat 'inbox' or 'workflow' as an id and 404 with "Task not found".
router.get('/inbox', inbox);
router.get('/workflow/:workflowId', listForWorkflow);
router.get('/project/:projectId', getProjectTasks);

// Dependency engine — set + traverse the graph.
router.put('/:id/dependencies', requireRole('admin', 'employee', 'sales'), setDependencies);
router.get('/:id/graph', getGraph);

router.get('/', listTasks);
router.post('/', requireRole('admin', 'employee', 'sales'), createTask);
router.get('/:id', getTask);
router.put('/:id', requireRole('admin', 'employee', 'sales'), updateTask);
router.delete('/:id', requireRole('admin', 'employee', 'sales'), deleteTask);
router.post('/:id/comments', addComment);
export default router;
