import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import MetaShareLink from '../models/MetaShareLink';
import User from '../models/User';
import * as meta from '../services/metaAdsService';

/**
 * Sharing controller for Meta Ads reports.
 *
 * Two endpoint flavours:
 *   - Authed (Meta-team / admin): create / list / revoke share links
 *   - Public (no auth): view a shared report by token
 *
 * The public view is the whole reason this exists. It lets agencies send
 * a one-click link to a client who has no Robin account.
 */

const DEFAULT_TTL_DAYS = 14;

/** POST /api/ads/meta/share — create a public share link. */
export async function createShare(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!meta.isConfigured()) { res.status(503).json({ error: 'Meta not configured' }); return; }

    const u = await User.findById(req.user!.id).select('organizationId');
    const orgId = u?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const {
      adAccountId,
      datePreset,
      fromDate,
      toDate,
      clientUserId,
      clientLabel,
      note,
      expiresInDays,
    } = req.body || {};
    if (!adAccountId) { res.status(400).json({ error: 'adAccountId required' }); return; }
    if (!datePreset && !(fromDate && toDate)) {
      res.status(400).json({ error: 'datePreset or {fromDate,toDate} required' });
      return;
    }

    const ttlDays = Math.min(Math.max(Number(expiresInDays) || DEFAULT_TTL_DAYS, 1), 90);
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000);

    const doc = await MetaShareLink.create({
      organizationId: orgId,
      adAccountId,
      datePreset,
      fromDate,
      toDate,
      clientUserId: clientUserId || undefined,
      clientLabel:  clientLabel  || undefined,
      note:         note         || undefined,
      createdBy:    req.user!.id,
      expiresAt,
    });

    res.status(201).json({
      _id: doc._id,
      token: doc.token,
      url: buildShareUrl(req, doc.token),
      expiresAt: doc.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** GET /api/ads/meta/shares?adAccountId=... — list links the caller created. */
export async function listShares(req: AuthRequest, res: Response): Promise<void> {
  try {
    const filter: any = { createdBy: req.user!.id };
    if (req.query.adAccountId) filter.adAccountId = req.query.adAccountId;
    const list = await MetaShareLink.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(list.map(l => ({
      ...l,
      url: buildShareUrl(req, (l as any).token),
      isExpired: new Date((l as any).expiresAt).getTime() < Date.now(),
      isRevoked: !!(l as any).revokedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** DELETE /api/ads/meta/share/:id — revoke a link. */
export async function revokeShare(req: AuthRequest, res: Response): Promise<void> {
  try {
    const doc = await MetaShareLink.findById(req.params.id);
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    // Only the creator OR admin can revoke
    if (String(doc.createdBy) !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Not allowed' }); return;
    }
    doc.revokedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/ads/meta/share/:token — PUBLIC. Returns the report data.
 *
 * No auth required — the unguessable token IS the auth.
 * Returns a 410 (Gone) if expired or revoked, so the client UI can
 * show a friendly "this link is no longer valid" page.
 */
export async function viewShare(req: Request, res: Response): Promise<void> {
  try {
    if (!meta.isConfigured()) { res.status(503).json({ error: 'Meta not configured' }); return; }
    const link = await MetaShareLink.findOne({ token: req.params.token });
    if (!link) { res.status(404).json({ error: 'Link not found' }); return; }
    if (link.revokedAt) { res.status(410).json({ error: 'This link has been revoked.' }); return; }
    if (new Date(link.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }

    // Fetch report data from Meta (cache key = token-specific so freshness
    // tracks the link, not the underlying account).
    const useRange = link.fromDate && link.toDate;
    const [totals, daily, campaigns] = await Promise.all([
      meta.getInsights({
        adAccountId: link.adAccountId,
        datePreset:  useRange ? undefined : (link.datePreset || 'last_7d'),
        timeRange:   useRange ? { since: link.fromDate!, until: link.toDate! } : undefined,
      }),
      useRange ? meta.getInsightsDaily({
        adAccountId: link.adAccountId,
        timeRange: { since: link.fromDate!, until: link.toDate! },
      }) : meta.getInsightsDaily({
        adAccountId: link.adAccountId,
        timeRange: presetToRange(link.datePreset || 'last_7d'),
      }),
      meta.getCampaignBreakdown({
        adAccountId: link.adAccountId,
        datePreset: useRange ? undefined : (link.datePreset || 'last_7d'),
        timeRange:  useRange ? { since: link.fromDate!, until: link.toDate! } : undefined,
      }),
    ]);

    // Fire-and-forget audit update — don't block the response.
    MetaShareLink.updateOne({ _id: link._id }, {
      $inc: { viewCount: 1 },
      $set: { lastViewedAt: new Date(), lastViewerIp: (req.headers['x-forwarded-for'] as string) || req.ip || '' },
    }).catch(() => { /* ignore */ });

    res.json({
      adAccountId: link.adAccountId,
      label: link.clientLabel || link.adAccountId,
      datePreset: link.datePreset,
      fromDate: link.fromDate,
      toDate:   link.toDate,
      expiresAt: link.expiresAt,
      generatedAt: new Date(),
      totals,
      daily,
      campaigns,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function buildShareUrl(req: Request, token: string): string {
  const front = process.env.FRONTEND_URL || 'https://robin.hastagcreator.com';
  return `${front.replace(/\/$/, '')}/share/meta/${token}`;
}

function presetToRange(preset: string): { since: string; until: string } {
  const today = new Date();
  const ist = new Date(today.getTime() + 330 * 60_000);
  const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
  const yesterday = new Date(ist.getTime() - 86400_000);
  const minus = (days: number) => yyyymmdd(new Date(ist.getTime() - days * 86400_000));
  if (preset === 'yesterday')  return { since: yyyymmdd(yesterday), until: yyyymmdd(yesterday) };
  if (preset === 'last_7d')    return { since: minus(7),  until: yyyymmdd(yesterday) };
  if (preset === 'last_30d')   return { since: minus(30), until: yyyymmdd(yesterday) };
  if (preset === 'this_month') {
    const first = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
    return { since: yyyymmdd(first), until: yyyymmdd(yesterday) };
  }
  return { since: minus(7), until: yyyymmdd(yesterday) };
}
