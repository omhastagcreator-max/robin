import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  createIssue, listIssues, getIssue, updateIssue, ask, clusterIssues,
} from '../controllers/issuesController';

const router = Router();
router.use(authMiddleware);

// Any authenticated user can report an issue or ask a question.
router.post('/',        createIssue);
router.post('/ask',     ask);

// Admin-only triage views.
router.get('/clusters', clusterIssues);
router.get('/',         listIssues);
router.get('/:id',      getIssue);
router.put('/:id',      updateIssue);

export default router;
