import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as meta from '../services/metaAdsService';

/**
 * Meta Ads controller — exposes Marketing API insights to the dashboard.
 *
 * Read-only by design. Every endpoint just calls metaAdsService and
 * returns the result. Server-side in-memory cache (60s) so dashboard
 * refreshes don't hammer Graph API or burn through rate limits.
 *
 * Access gate: admin role OR a user whose primary team / additional
 * teams include 'ads'. Enforced in the route file.
 */

const cache = new Map<string, { at: number; data: any }>();
const TTL_MS = 60_000; // 60s
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(data => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

function ensureConfigured(res: Response): boolean {
  if (!meta.isConfigured()) {
    res.status(503).json({
      error: 'Meta Ads not configured. Set META_APP_ID, META_APP_SECRET, META_USER_TOKEN on the server (Render → robin-api → Environment).',
    });
    return false;
  }
  return true;
}

/** GET /api/ads/meta/accounts — list every ad account the token can see. */
export async function listAccounts(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const data = await cached('accounts', () => meta.listAdAccounts());
    res.json({ defaultAccountId: process.env.META_DEFAULT_AD_ACCOUNT_ID || data[0]?.id || null, accounts: data });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/**
 * GET /api/ads/meta/accounts/health
 *
 * Same list as /accounts but each account also includes a status —
 * 'live' (has spend last 7d), 'idle' (no recent spend), 'no_access'
 * (permissions error), 'error' (other API failure). Cached 5 min
 * because it does N parallel API calls.
 */
const HEALTH_TTL_MS = 5 * 60_000;
let healthCache: { at: number; data: any } | null = null;
export async function listAccountsHealth(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) {
      res.json(healthCache.data);
      return;
    }
    const accounts = await meta.getAccountsHealth();
    const payload = {
      defaultAccountId: process.env.META_DEFAULT_AD_ACCOUNT_ID || accounts[0]?.id || null,
      accounts,
      checkedAt: new Date(),
    };
    healthCache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/** GET /api/ads/meta/yesterday?adAccountId=act_... */
export async function getYesterday(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const adAccountId = (req.query.adAccountId as string) || process.env.META_DEFAULT_AD_ACCOUNT_ID;
    if (!adAccountId) { res.status(400).json({ error: 'adAccountId required' }); return; }

    const data = await cached(`yest:${adAccountId}`, () =>
      meta.getInsights({ adAccountId, datePreset: 'yesterday' })
    );
    res.json({ adAccountId, metrics: data });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/** GET /api/ads/meta/range?adAccountId=...&from=YYYY-MM-DD&to=YYYY-MM-DD&daily=1 */
export async function getRange(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const adAccountId = (req.query.adAccountId as string) || process.env.META_DEFAULT_AD_ACCOUNT_ID;
    const from = req.query.from as string;
    const to   = req.query.to   as string;
    const daily = req.query.daily === '1';
    if (!adAccountId || !from || !to) {
      res.status(400).json({ error: 'adAccountId, from, to required' });
      return;
    }

    const key = `${daily ? 'daily' : 'range'}:${adAccountId}:${from}:${to}`;
    if (daily) {
      const data = await cached(key, () => meta.getInsightsDaily({ adAccountId, timeRange: { since: from, until: to } }));
      res.json({ adAccountId, daily: data });
    } else {
      const data = await cached(key, () => meta.getInsights({ adAccountId, timeRange: { since: from, until: to } }));
      res.json({ adAccountId, metrics: data });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/** GET /api/ads/meta/campaigns?adAccountId=...&datePreset=last_7d (or from/to) */
export async function getCampaigns(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const adAccountId = (req.query.adAccountId as string) || process.env.META_DEFAULT_AD_ACCOUNT_ID;
    if (!adAccountId) { res.status(400).json({ error: 'adAccountId required' }); return; }

    const from = req.query.from as string | undefined;
    const to   = req.query.to   as string | undefined;
    const datePreset = (req.query.datePreset as string) || 'last_7d';

    const key = `camps:${adAccountId}:${from || datePreset}:${to || ''}`;
    const data = await cached(key, () => meta.getCampaignBreakdown({
      adAccountId,
      datePreset: from && to ? undefined : datePreset,
      timeRange: from && to ? { since: from, until: to } : undefined,
    }));
    res.json({ adAccountId, campaigns: data });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}
