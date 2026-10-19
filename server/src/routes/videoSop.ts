import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  getSopMeta, listRuns, getRun, getRunByWorkflow, saveBrief, toggleItem, completeStep,
  startRunManually, assignRun, reopenStep, cancelRun, myToday, postDailyUpdate, listSopTeam, updateProgressCounts,
} from '../controllers/videoSopController';

/** Video SOP — Oct 2026. See lib/videoSop.ts for the rules. */
const router = Router();
router.use(authMiddleware);
const STAFF = requireRole('admin', 'employee', 'sales', 'workroom');

router.get('/meta',                         STAFF, getSopMeta);
router.get('/',                             STAFF, listRuns);
router.get('/team',                         STAFF, listSopTeam);
router.get('/my-today',                     STAFF, myToday);
router.get('/by-workflow/:workflowId',      STAFF, getRunByWorkflow);
router.post('/start',                       STAFF, startRunManually);   // manager check inside
router.get('/:id',                          STAFF, getRun);
router.put('/:id/progress',                 STAFF, updateProgressCounts); // owner or helper
router.put('/:id/daily-update',             STAFF, postDailyUpdate);    // assignee only
router.put('/:id/brief',                    STAFF, saveBrief);          // assignee only
router.put('/:id/steps/:key/items/:idx',    STAFF, toggleItem);         // assignee only
router.put('/:id/steps/:key/complete',      STAFF, completeStep);       // assignee only
router.put('/:id/steps/:key/reopen',        STAFF, reopenStep);         // manager
router.put('/:id/assign',                   STAFF, assignRun);          // manager
router.put('/:id/cancel',                   STAFF, cancelRun);          // manager

export default router;
