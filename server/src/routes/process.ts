import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  listProcessDocs, getProcessDoc, createProcessDoc, updateProcessDoc,
  acknowledgeProcessDoc, deleteProcessDoc,
  listTests, getTest, createTest, updateTest, deleteTest,
  submitAttempt, listAttempts,
} from '../controllers/processController';

const router = Router();
router.use(authMiddleware);

const staff = requireRole('admin', 'employee', 'sales', 'workroom');
const adminOnly = requireRole('admin');

/* ── Process Updates (SOPs) ───────────────────────────────────────────
 * Everyone reads and acknowledges; only admins publish or archive. */
router.get('/docs',              staff,     listProcessDocs);
router.get('/docs/:id',          staff,     getProcessDoc);
router.post('/docs/:id/ack',     staff,     acknowledgeProcessDoc);
router.post('/docs',             adminOnly, createProcessDoc);
router.put('/docs/:id',          adminOnly, updateProcessDoc);
router.delete('/docs/:id',       adminOnly, deleteProcessDoc);

/* ── Process Tests ────────────────────────────────────────────────────
 * Everyone takes tests and sees their own history; only admins author
 * them. Correct answers are stripped server-side for non-admins. */
router.get('/tests',             staff,     listTests);
router.get('/tests/attempts',    staff,     listAttempts);   // before /:id so it isn't swallowed
router.get('/tests/:id',         staff,     getTest);
router.post('/tests/:id/attempt', staff,    submitAttempt);
router.post('/tests',            adminOnly, createTest);
router.put('/tests/:id',         adminOnly, updateTest);
router.delete('/tests/:id',      adminOnly, deleteTest);

export default router;
