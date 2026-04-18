import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Organization from '../models/Organization';

const JWT_SECRET  = process.env.JWT_SECRET!;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(userId: string) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES as any });
}

// ── Register ─────────────────────────────────────────────────────────────────
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, organizationName, role = 'employee' } = req.body;
    if (!email || !password || !name) { res.status(400).json({ error: 'email, password, name required' }); return; }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) { res.status(409).json({ error: 'Email already registered' }); return; }

    let org = await Organization.findOne({ name: organizationName || 'Default Agency' });
    if (!org) org = await Organization.create({ name: organizationName || 'Default Agency' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ email: email.toLowerCase(), passwordHash: hashed, name, role, organizationId: org._id });
    const token = signToken(String(user._id));

    res.status(201).json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role, team: user.team },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || !user.passwordHash) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const token = signToken(String(user._id));
    res.json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role, team: user.team },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Google OAuth ───────────────────────────────────────────────────────────────
export async function googleAuth(req: Request, res: Response): Promise<void> {
  try {
    const { credential, clientId } = req.body;
    if (!credential) { res.status(400).json({ error: 'Google credential token required' }); return; }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) { res.status(501).json({ error: 'Google OAuth not configured on server. Add GOOGLE_CLIENT_ID env var.' }); return; }

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) { res.status(400).json({ error: 'Invalid Google token' }); return; }

    const email  = payload.email.toLowerCase();
    const name   = payload.name || email.split('@')[0];
    const avatar = payload.picture;

    // Find or auto-create the user (Google users start as employee by default)
    let user = await User.findOne({ email });
    if (!user) {
      let org = await Organization.findOne({}) || await Organization.create({ name: 'Default Agency' });
      user = await User.create({
        email, name, role: 'employee',
        organizationId: org._id,
        googleId: payload.sub,
        avatarUrl: avatar,
        passwordHash: await bcrypt.hash(Math.random().toString(36), 10), // placeholder
      });
    } else {
      // Update Google info if missing
      if (!user.googleId) {
        user.googleId = payload.sub;
        if (avatar) user.avatarUrl = avatar;
        await user.save();
      }
    }

    const token = signToken(String(user._id));
    res.json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role, team: user.team, avatarUrl: user.avatarUrl },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Token used too late') || msg.includes('Invalid token')) {
      res.status(401).json({ error: 'Google token expired or invalid' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
}

// ── Get Me ────────────────────────────────────────────────────────────────────
export async function getMe(req: any, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user: { _id: user._id, email: user.email, name: user.name, role: user.role, team: user.team, avatarUrl: user.avatarUrl } });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Update Me / Password ──────────────────────────────────────────────────────
export async function updateMe(req: any, res: Response): Promise<void> {
  try {
    const { name, team, avatarUrl } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { name, team, avatarUrl }, { new: true });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function changePassword(req: any, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user || !user.passwordHash) { res.status(404).json({ error: 'User not found' }); return; }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) { res.status(400).json({ error: 'Current password incorrect' }); return; }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
