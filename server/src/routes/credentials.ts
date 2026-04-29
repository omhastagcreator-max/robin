import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  listCredentials, createCredential, updateCredential, deleteCredential, logCredentialAccess,
} from '../controllers/credentialsController';

const router = Router();
router.use(authMiddleware);

// Internal staff only — clients never hit this stack.
const staff = requireRole('admin', 'employee', 'sales');

router.get('/',              staff, listCredentials);
router.post('/',             staff, createCredential);
router.put('/:id',           staff, updateCredential);
router.delete('/:id',        staff, deleteCredential);
// Per-credential audit: client pings this when password is copied/revealed
router.post('/:id/access',   staff, logCredentialAccess);

export default router;
