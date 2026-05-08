import { Request, Response } from 'express';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientMeeting from '../models/ClientMeeting';
import User from '../models/User';
import Organization from '../models/Organization';

/**
 * Client meeting controller — instant meetings with external guests via
 * a public link, no Robin login required.
 *
 * Endpoint flavours:
 *   AUTHED (host) — create, list-mine, end, info-by-id, host-token
 *   PUBLIC (guest) — info-by-slug (just enough to render join page),
 *                    guest-token (mints a LiveKit token bound to the room)
 */

const HUDDLE_ROOM_PREFIX = 'robin-clientmeet-';

function buildJoinUrl(slug: string): string {
  const front = process.env.FRONTEND_URL || 'https://robin.hastagcreator.com';
  return `${front.replace(/\/$/, '')}/meet/${slug}`;
}

function ensureLivekitConfigured(res: Response): boolean {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    res.status(503).json({ error: 'LiveKit not configured on server' });
    return false;
  }
  return true;
}

// ── Authed: create a new client meeting ─────────────────────────────────
export async function createClientMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const u = await User.findById(req.user!.id).select('organizationId');
    const orgId = u?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { clientName, note, durationMinutes } = req.body || {};
    const minutes = Math.min(Math.max(Number(durationMinutes) || 120, 15), 480); // 15 min – 8h

    // Pull agency name to use as the public label on the guest page
    const org = await Organization.findById(orgId).select('name');
    const agencyLabel = org?.name || 'Robin Agency';

    const expiresAt = new Date(Date.now() + 24 * 3600_000); // 24h hard cap

    const doc = await ClientMeeting.create({
      organizationId: orgId,
      hostUserId:     req.user!.id,
      clientName:     clientName || '',
      note:           note || '',
      agencyLabel,
      maxDurationMinutes: minutes,
      expiresAt,
    });

    res.status(201).json({
      _id: doc._id,
      slug: doc.slug,
      url: buildJoinUrl(doc.slug),
      hostUrl: `${(process.env.FRONTEND_URL || 'https://robin.hastagcreator.com').replace(/\/$/, '')}/meet/host/${doc.slug}`,
      expiresAt: doc.expiresAt,
      maxDurationMinutes: doc.maxDurationMinutes,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Authed: list my client meetings ─────────────────────────────────────
export async function listMyClientMeetings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const list = await ClientMeeting.find({ hostUserId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(list.map(m => ({
      ...m,
      url: buildJoinUrl((m as any).slug),
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Authed: end a meeting ───────────────────────────────────────────────
export async function endClientMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const m = await ClientMeeting.findOne({ slug: req.params.slug });
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    if (String(m.hostUserId) !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only the host can end this meeting' });
      return;
    }
    if (m.status === 'ended' || m.status === 'expired') {
      res.json({ ok: true, alreadyEnded: true });
      return;
    }
    m.status = 'ended';
    m.endedAt = new Date();
    m.endReason = 'host_ended';
    await m.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Authed: extend duration by 30 min ──────────────────────────────────
export async function extendClientMeeting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const m = await ClientMeeting.findOne({ slug: req.params.slug });
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    if (String(m.hostUserId) !== req.user!.id) {
      res.status(403).json({ error: 'Only the host can extend' });
      return;
    }
    m.maxDurationMinutes = Math.min(m.maxDurationMinutes + 30, 480);
    await m.save();
    res.json({ ok: true, maxDurationMinutes: m.maxDurationMinutes });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Authed: host gets a LiveKit token for their room ────────────────────
export async function getHostToken(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureLivekitConfigured(res)) return;
    const m = await ClientMeeting.findOne({ slug: req.params.slug });
    if (!m) { res.status(404).json({ error: 'Not found' }); return; }
    if (String(m.hostUserId) !== req.user!.id) {
      res.status(403).json({ error: 'Only the host can get a host token' });
      return;
    }
    if (m.status === 'ended' || m.status === 'expired') {
      res.status(410).json({ error: `Meeting ${m.status}` });
      return;
    }
    const u = await User.findById(req.user!.id).select('name email');
    const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
      identity: req.user!.id,
      name:     u?.name || u?.email || 'Host',
      ttl:      30 * 60,
      metadata: JSON.stringify({ role: 'host' }),
    });
    at.addGrant({
      room: HUDDLE_ROOM_PREFIX + m.slug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    });
    const token = await at.toJwt();
    res.json({ token, url: process.env.LIVEKIT_URL, room: HUDDLE_ROOM_PREFIX + m.slug });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── PUBLIC: guest fetches meeting info to render the join page ─────────
export async function publicMeetingInfo(req: Request, res: Response): Promise<void> {
  try {
    const m = await ClientMeeting.findOne({ slug: req.params.slug });
    if (!m) { res.status(404).json({ error: 'Meeting not found' }); return; }
    if (m.status === 'ended')   { res.status(410).json({ error: 'This meeting has ended.' }); return; }
    if (m.status === 'expired') { res.status(410).json({ error: 'This meeting link has expired.' }); return; }
    if (new Date(m.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: 'This meeting link has expired.' });
      return;
    }
    res.json({
      slug: m.slug,
      agencyLabel: m.agencyLabel,
      clientName:  m.clientName,
      status:      m.status,
      expiresAt:   m.expiresAt,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── PUBLIC: guest gets a LiveKit token to join ─────────────────────────
export async function getGuestToken(req: Request, res: Response): Promise<void> {
  try {
    if (!ensureLivekitConfigured(res)) return;
    const m = await ClientMeeting.findOne({ slug: req.params.slug });
    if (!m) { res.status(404).json({ error: 'Meeting not found' }); return; }
    if (m.status === 'ended' || m.status === 'expired') { res.status(410).json({ error: 'Meeting unavailable' }); return; }
    if (new Date(m.expiresAt).getTime() < Date.now()) { res.status(410).json({ error: 'Meeting expired' }); return; }

    const guestName = String(req.body?.name || '').trim().slice(0, 60) || 'Guest';
    const guestId   = `guest-${Math.random().toString(36).slice(2, 10)}`;

    // First guest join → flip status to 'active' and stamp startedAt
    if (m.status === 'scheduled') {
      m.status = 'active';
      m.startedAt = new Date();
    }
    m.guestJoins.push({
      name: guestName,
      joinedAt: new Date(),
      ip: (req.headers['x-forwarded-for'] as string) || req.ip || '',
    } as any);
    await m.save();

    const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
      identity: guestId,
      name:     guestName,
      ttl:      30 * 60,
      metadata: JSON.stringify({ role: 'guest' }),
    });
    at.addGrant({
      room: HUDDLE_ROOM_PREFIX + m.slug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false, // guest can't piggyback on data channels
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    });
    const token = await at.toJwt();
    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      room: HUDDLE_ROOM_PREFIX + m.slug,
      identity: guestId,
      agencyLabel: m.agencyLabel,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
