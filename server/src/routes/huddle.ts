import { Router, Response } from 'express';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';

const router = Router();

/**
 * GET /api/huddle/health  (PUBLIC — intentionally)
 *
 * Diagnostic endpoint the owner can hit in any browser without juggling
 * JWTs to verify the LiveKit env config the server is ACTUALLY using.
 * Returns the URL (so the project subdomain is visible) + whether the
 * key and secret are non-empty. NEVER returns the secret value itself.
 *
 * Common debugging pattern: you updated LIVEKIT_API_KEY + SECRET to a
 * new project on Render but forgot to update LIVEKIT_URL — then every
 * huddle attempt still 429s because we're talking to the OLD project
 * with the NEW credentials (which it rejects). This endpoint shows
 * the URL the server is currently using so the mismatch is obvious.
 */
router.get('/health', (_req, res) => {
  const url = process.env.LIVEKIT_URL || '';
  res.json({
    livekitUrl: url || null,
    livekitUrlSubdomain: url ? (url.match(/^wss?:\/\/([^./]+)/i)?.[1] || null) : null,
    apiKeySet:    !!process.env.LIVEKIT_API_KEY,
    apiSecretSet: !!process.env.LIVEKIT_API_SECRET,
    // Hint to the admin: if the subdomain here doesn't match the project
    // they meant to use on cloud.livekit.io, the URL env var is stale.
    instruction: 'If livekitUrlSubdomain does not match the project you opened on cloud.livekit.io, update LIVEKIT_URL on Render → robin-api → Environment to wss://<your-project>.livekit.cloud.',
  });
});

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
router.post('/token', requireRole('admin', 'employee', 'sales', 'workroom'), async (req: AuthRequest, res: Response) => {
  try {
    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    const missing: string[] = [];
    if (!livekitUrl) missing.push('LIVEKIT_URL');
    if (!apiKey)     missing.push('LIVEKIT_API_KEY');
    if (!apiSecret)  missing.push('LIVEKIT_API_SECRET');
    if (missing.length > 0) {
      res.status(500).json({
        error: `Missing env on Render: ${missing.join(', ')}. Render → robin-api → Environment → add the missing variable(s), Save, wait for redeploy.`,
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
      // Avatar piggy-backs on the participant metadata so other tabs
      // in the same huddle can render the user's profile pic on their
      // tile (Owner ask May 2026 — rounded-square avatars when no
      // camera). `u` is the JWT payload, populated by authMiddleware
      // — see User model for what's available.
      metadata: JSON.stringify({ role: u.role, email: u.email, avatarUrl: (u as any).avatarUrl || null }),
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // No video publishing — we don't want cameras. Audio + screen only.
      // Use the enum values from livekit-server-sdk; recent versions reject
      // raw strings here ("Cannot convert TrackSource microphone to string").
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    });

    const token = await at.toJwt();
    res.json({ token, url: livekitUrl, room: roomName, identity: u.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
