import { Router } from 'express';
import { register, login, googleAuth, getMe, updateMe, changePassword } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/register',  register);
router.post('/login',     login);
router.post('/google',    googleAuth);          // ← Google OAuth
router.get('/me',         authMiddleware, getMe);
router.put('/me',         authMiddleware, updateMe);
router.put('/password',   authMiddleware, changePassword);

export default router;
