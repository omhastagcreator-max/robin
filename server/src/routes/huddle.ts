import { Router, Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';

const router = Router();
router.use(authMiddleware);

/**
 * POST /api/huddle/token
 *
 * Mints a LiveKit access token for the calling internal-staff user, scoped
 * to the agency-wide huddle room. The client uses this token (plus the
 * VITE_LIVEKIT_URL) to connect via livekit-client.
 *
 * The LiveKit API key + secret stay on the server — the client never sees
 * them. Tokens are short-lived (10 minutes) and minted on demand.
 */
router.post('/token', requireRole('admin', 'employee', 'sales'), async (req: AuthRequest, res: Response) => {
  try {
    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      res.status(500).json({
        error: 'LiveKit not configured. Set LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET on the server (Render env).',
      });
      return;
    }

    const u = req.user!;
    // One huddle per organisation. Falls back to a global room if the user
    // somehow has no organisationId attached (shouldn't happen for staff).
    const orgId = u.organizationId || 'global';
    const roomName = `robin-huddle-${orgId}`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: u.id,
      name:     u.name || u.email,
      ttl:      10 * 60, // 10 min — client reconnects with a fresh token if needed
      metadata: JSON.stringify({ role: u.role, email: u.email }),
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // No video publishing — we don't want cameras. Audio + screen only.
      canPublishSources: ['microphone' as any, 'screen_share' as any, 'screen_share_audio' as any],
    });

    const token = await at.toJwt();
    res.json({ token, url: livekitUrl, room: roomName, identity: u.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
