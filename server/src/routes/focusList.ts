import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listFocusLists,
  getOrCreateMyFocusList,
  addFocusItem,
  updateFocusItem,
  assignFocusItem,
  removeFocusItem,
} from '../controllers/focusListController';

/**
 * Focus This Week — sales reps mark a small set of leads/clients that need
 * extra attention this week and (optionally) assign teammates to help. All
 * endpoints require sales/admin role.
 */
const router = Router();
router.use(authMiddleware);

router.get('/',                                  requireRole('admin', 'sales'), listFocusLists);
router.post('/',                                 requireRole('admin', 'sales'), getOrCreateMyFocusList);
router.post('/:id/items',                        requireRole('admin', 'sales'), addFocusItem);
router.put('/:id/items/:itemId',                 requireRole('admin', 'sales'), updateFocusItem);
router.post('/:id/items/:itemId/assign',         requireRole('admin', 'sales'), assignFocusItem);
router.delete('/:id/items/:itemId',              requireRole('admin', 'sales'), removeFocusItem);

export default router;
