import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as meta from '../services/metaAdsService';
import { callGemini } from '../services/aiTriage';
import { withAICache, bustAICachePrefix } from '../services/aiInsights';

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

    // Fetch yesterday metrics + current daily budget in parallel.
    const [data, dailyBudget] = await Promise.all([
      cached(`yest:${adAccountId}`,   () => meta.getInsights({ adAccountId, datePreset: 'yesterday' })),
      cached(`budget:${adAccountId}`, () => meta.getActiveDailyBudget(adAccountId).catch(() => 0)),
    ]);
    res.json({ adAccountId, metrics: data, dailyBudget });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/**
 * GET /api/ads/meta/today?adAccountId=act_...
 *
 * Returns the running stats for the CURRENT day. Meta's API exposes this
 * via date_preset=today; numbers update every few minutes throughout the
 * day. We keep the cache short (30s) because users want to see live spend.
 */
const TODAY_TTL_MS = 30_000;
const todayCache = new Map<string, { at: number; data: any }>();
function cachedToday<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = todayCache.get(key);
  if (hit && Date.now() - hit.at < TODAY_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(data => { todayCache.set(key, { at: Date.now(), data }); return data; });
}

export async function getToday(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const adAccountId = (req.query.adAccountId as string) || process.env.META_DEFAULT_AD_ACCOUNT_ID;
    if (!adAccountId) { res.status(400).json({ error: 'adAccountId required' }); return; }
    const [data, dailyBudget] = await Promise.all([
      cachedToday(`today:${adAccountId}`, () => meta.getInsights({ adAccountId, datePreset: 'today' })),
      cached(`budget:${adAccountId}`,     () => meta.getActiveDailyBudget(adAccountId).catch(() => 0)),
    ]);
    res.json({ adAccountId, metrics: data, dailyBudget, freshAt: new Date().toISOString() });
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
      const [data, dailyBudget] = await Promise.all([
        cached(key, () => meta.getInsights({ adAccountId, timeRange: { since: from, until: to } })),
        cached(`budget:${adAccountId}`, () => meta.getActiveDailyBudget(adAccountId).catch(() => 0)),
      ]);
      res.json({ adAccountId, metrics: data, dailyBudget });
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

/**
 * GET /api/ads/meta/ai-insights?adAccountId=...&refresh=1
 *
 * Robin's per-account "what should I do next?" panel. Pulls the same
 * three slices the dashboard already shows (yesterday, last-7d totals,
 * per-campaign breakdown) and asks Gemini to read them holistically.
 *
 * Returns:
 *   {
 *     adAccountId,
 *     dataSays:  string[]   — short bullet observations from the numbers
 *     toDo:      string[]   — concrete next actions (scale, test creative…)
 *     toAvoid:   string[]   — what NOT to do (e.g. don't kill the only winner)
 *     headline:  string     — one-line gist for the panel header
 *     generatedAt: ISO
 *   }
 *
 * Cached for 30 min per account so account-switching in the UI doesn't
 * burn Gemini quota; `?refresh=1` busts the cache for the admin who's
 * iterating on prompts or wants a fresh take after a creative push.
 *
 * Tone: Hinglish + no jargon — these go to internal users who want
 * "scale karo / band karo" copy, not McKinsey paragraphs.
 */
const META_AI_TTL_MS = 30 * 60_000;
export async function getAIInsights(req: AuthRequest, res: Response): Promise<void> {
  if (!ensureConfigured(res)) return;
  try {
    const adAccountId = (req.query.adAccountId as string) || process.env.META_DEFAULT_AD_ACCOUNT_ID;
    if (!adAccountId) { res.status(400).json({ error: 'adAccountId required' }); return; }

    if (req.query.refresh === '1') {
      bustAICachePrefix(`meta-ai:${adAccountId}`);
    }

    const cacheKey = `meta-ai:${adAccountId}:${new Date().toISOString().slice(0, 10)}`; // per-day key — fresh each calendar day
    const result = await withAICache(cacheKey, META_AI_TTL_MS, async () => {
      // ── Gather: same data the dashboard already shows ───────────────
      const [yesterday, last7d, daily7d, campaigns, dailyBudget, accountName] = await Promise.all([
        meta.getInsights({ adAccountId, datePreset: 'yesterday' }).catch(() => null),
        meta.getInsights({ adAccountId, datePreset: 'last_7d' }).catch(() => null),
        meta.getInsightsDaily({ adAccountId, datePreset: 'last_7d' }).catch(() => []),
        meta.getCampaignBreakdown({ adAccountId, datePreset: 'last_7d' }).catch(() => []),
        meta.getActiveDailyBudget(adAccountId).catch(() => 0),
        meta.listAdAccounts().then(list => list.find(a => a.id === adAccountId)?.name || adAccountId).catch(() => adAccountId),
      ]);

      // ── Compact payload — Gemini gets just the numbers it needs ─────
      // Trim long campaign lists; keep top 8 by spend so the prompt
      // doesn't balloon for accounts with 50+ campaigns. (Gemini Flash
      // is generous but a 30 KB prompt for every panel open is wasteful.)
      const topCampaigns = (campaigns as any[])
        .slice()
        .sort((a, b) => (b?.spend || 0) - (a?.spend || 0))
        .slice(0, 8)
        .map(c => ({
          name: c.name,
          status: c.status,
          spend: round(c.spend),
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: round(c.ctr, 3),
          cpc: round(c.cpc),
          purchases: c.purchases,
          costPerPurchase: round(c.costPerPurchase),
          roas: round(c.roas, 2),
          leads: c.leads,
          costPerLead: round(c.costPerLead),
        }));

      const dailySeries = (daily7d as any[]).map(d => ({
        date: d.dateStart,
        spend: round(d.spend),
        purchases: d.purchases,
        roas: round(d.roas, 2),
      }));

      const payload = {
        account: { id: adAccountId, name: accountName, dailyBudget },
        yesterday: yesterday ? compactMetrics(yesterday) : null,
        last7d:    last7d    ? compactMetrics(last7d)    : null,
        dailyTrend: dailySeries,
        topCampaigns,
      };

      // ── Gemini prompt — Hinglish, structured JSON ───────────────────
      const systemPrompt = `Tum Robin ho, Hastag Creator agency ka in-house Meta Ads strategist.
Tumhe ek ad account ka yesterday + last 7 days ka data milega + top campaigns ki breakdown.

Tumhe 3 cheezein nikalni hain — chhote, action-oriented bullets, Hinglish mein:

1) "dataSays"   — 3 to 5 short observations jo numbers se obvious hain.
                  E.g. "Last 7 din mein ₹12,400 spend, 8 purchases, ROAS 1.8x — okay-okay."
                  Concrete numbers do. No vague stuff like "performance has been variable".

2) "toDo"       — 3 to 4 concrete next actions for the team to take TODAY/THIS WEEK.
                  Imperative voice. E.g. "Campaign 'Diwali Sale Lookalike' ka budget 30% badhao —
                  yahi sirf 3.2x ROAS de raha hai."
                  Reference actual campaign names + numbers when you can.

3) "toAvoid"    — 2 to 3 things NOT to do (common mistakes given THIS account's data).
                  E.g. "'Awareness Campaign Q4' ko abhi mat band karo — frequency 1.2 hai,
                  reach build ho rahi hai. Aur 2 din do."

4) "headline"   — One sentence (max 12 words) summarising the account state.
                  Hinglish. E.g. "ROAS solid hai 7 din se, scale karne ka time hai."

RULES:
- Use plain Hinglish (Roman script). NO big English words: avoid "leverage / optimize /
  cadence / synergy / ideation". Use "use karo / sahi karo / chalu rakho / ideas nikalo".
- If data is null / empty for a slice, mention "Yesterday data nahi mila — last 7d se chal rahe hain".
- NEVER make up campaign names — only reference what's in topCampaigns.
- Numbers: prefix ₹ for spend / CPP / CPL / CPC. Round nicely (no 6 decimal places).
- ROAS as "2.3x" format, CTR as percentages.
- If account is essentially dead (spend < ₹500 last 7d), say so and recommend reviving or pausing.

OUTPUT FORMAT (STRICT JSON, nothing else, no markdown, no \`\`\`):
{ "dataSays": [...], "toDo": [...], "toAvoid": [...], "headline": "..." }`;

      const userPayload = JSON.stringify(payload);

      let raw = '';
      try {
        raw = await callGemini(systemPrompt, userPayload, 900);
      } catch (e: any) {
        // Surface a CLEAN structured fallback so the panel still renders
        // even when Gemini is down / key missing — easier on the user
        // than a generic error screen.
        return {
          adAccountId,
          dataSays: ['AI temporarily unavailable. Check Render → GEMINI_API_KEY.'],
          toDo:     ['Numbers manually dekho aur team ko brief karo.'],
          toAvoid:  [],
          headline: 'AI insights paused — using raw numbers',
          generatedAt: new Date().toISOString(),
          error: e?.message || 'Gemini call failed',
        };
      }

      // Gemini sometimes wraps in ```json ... ``` despite asking not to.
      // Strip fences defensively.
      const cleaned = raw.trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```\s*$/, '')
        .trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Last resort: return as raw text in dataSays so something shows.
        parsed = {
          dataSays: [cleaned.slice(0, 400)],
          toDo: [],
          toAvoid: [],
          headline: '',
        };
      }

      return {
        adAccountId,
        dataSays: Array.isArray(parsed.dataSays) ? parsed.dataSays.slice(0, 6) : [],
        toDo:     Array.isArray(parsed.toDo)     ? parsed.toDo.slice(0, 6)     : [],
        toAvoid:  Array.isArray(parsed.toAvoid)  ? parsed.toAvoid.slice(0, 6)  : [],
        headline: typeof parsed.headline === 'string' ? parsed.headline.slice(0, 140) : '',
        generatedAt: new Date().toISOString(),
      };
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────
function round(n: any, decimals = 0): number {
  const v = Number(n) || 0;
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

function compactMetrics(m: any): any {
  // Strip the dozens of meta fields down to what an AI strategist actually
  // needs. Saves prompt size + keeps the model focused on signal not noise.
  return {
    spend:        round(m.spend),
    impressions:  m.impressions,
    reach:        m.reach,
    frequency:    round(m.frequency, 2),
    clicks:       m.clicks,
    ctr:          round(m.ctr, 2),
    cpc:          round(m.cpc),
    cpm:          round(m.cpm),
    purchases:    m.purchases,
    costPerPurchase: round(m.costPerPurchase),
    roas:         round(m.roas, 2),
    leads:        m.leads,
    costPerLead:  round(m.costPerLead),
    landingPageViews: m.landingPageViews,
    addToCart:    m.addToCart,
    initiateCheckout: m.initiateCheckout,
    qualityRanking: m.qualityRanking,
    engagementRateRanking: m.engagementRateRanking,
    conversionRateRanking: m.conversionRateRanking,
  };
}
