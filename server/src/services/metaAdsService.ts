/**
 * metaAdsService — wraps Meta's Marketing API (Graph API) for ad insights.
 *
 * Auth: a single long-lived USER access token (60 days) plus the agency's
 * App ID/Secret, all from server env. We do NOT expose them to the
 * client. The token sees every ad account the agency person is admin of.
 *
 * Why a service: every Graph API call lives in one file, so when the
 * token rotates or Meta changes the endpoint shape, we touch one place.
 *
 * Important: all numeric fields come back from Meta as STRINGS (yes,
 * "spend": "1234.56" not 1234.56). We cast at the parse layer so the
 * controller and UI never deal with that quirk.
 */
import https from 'https';

const GRAPH_VERSION = 'v19.0';

function env(key: string): string | undefined {
  return process.env[key];
}

export function isConfigured(): boolean {
  return !!(env('META_USER_TOKEN') && env('META_APP_ID') && env('META_APP_SECRET'));
}

interface InsightsResponse {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  date_start?: string;
  date_stop?: string;
}

export interface MetaAdsMetrics {
  dateStart: string;
  dateStop: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;          // percent (Meta returns as percentage already)
  cpm: number;          // cost per 1000 impressions
  cpc: number;          // cost per click
  reach: number;
  frequency: number;
  conversions: number;       // count of the configured conversion action
  conversionValue: number;   // revenue from those conversions
  costPerConversion: number; // spend / conversions, 0 if no conversions
  roas: number;              // conversionValue / spend, 0 if no spend
  raw: InsightsResponse;     // keep around for debugging / future fields
}

export interface AdAccountInfo {
  id: string;       // "act_..."
  name: string;
  currency?: string;
  accountStatus?: number;
}

/**
 * Which `action_type` from the actions[] array we count as a "conversion".
 * Per-account override could come later from a Mongo settings collection;
 * for now it's a single env var. Most common values:
 *   - offsite_conversion.fb_pixel_purchase   (e-commerce purchases)
 *   - lead                                    (lead-gen forms / lead ads)
 *   - link_click                              (clicks — for awareness only)
 */
function conversionActionType(): string {
  return env('META_CONVERSION_ACTION_TYPE') || 'lead';
}

// ── Graph API HTTP helper ────────────────────────────────────────────────
//
// Why hand-rolled https instead of axios: zero extra dependencies in the
// server bundle. Meta's responses are tiny JSON; a 30-line wrapper is
// fine. Also gives us tight control over error parsing.
function graphGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const token = env('META_USER_TOKEN');
  if (!token) return Promise.reject(new Error('META_USER_TOKEN not set on server'));

  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const url = `https://graph.facebook.com/${GRAPH_VERSION}${path}?${qs}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            // Meta error shape: { error: { message, type, code, fbtrace_id } }
            reject(new Error(`Meta API: ${json.error.message || 'unknown error'} (code ${json.error.code || '?'})`));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error('Meta API returned non-JSON: ' + body.slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

// ── Public API ───────────────────────────────────────────────────────────

/** List every ad account this token can see. Used to populate the picker. */
export async function listAdAccounts(): Promise<AdAccountInfo[]> {
  const res = await graphGet<{ data: any[] }>('/me/adaccounts', {
    fields: 'id,name,currency,account_status',
  });
  return (res.data || []).map((a: any) => ({
    id: a.id,
    name: a.name || a.id,
    currency: a.currency,
    accountStatus: a.account_status,
  }));
}

/**
 * Pull ad insights for one account, one date window.
 * `datePreset` shortcuts: yesterday, today, last_7d, last_30d, this_month
 * OR pass an explicit `timeRange = { since, until }` (YYYY-MM-DD).
 */
export async function getInsights(opts: {
  adAccountId: string;
  datePreset?: string;
  timeRange?: { since: string; until: string };
}): Promise<MetaAdsMetrics | null> {
  const params: Record<string, string> = {
    fields: 'spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values,date_start,date_stop',
  };
  if (opts.timeRange) {
    params.time_range = JSON.stringify(opts.timeRange);
  } else {
    params.date_preset = opts.datePreset || 'yesterday';
  }

  const res = await graphGet<{ data: InsightsResponse[] }>(`/${opts.adAccountId}/insights`, params);
  const row = (res.data || [])[0];
  if (!row) return null; // no spend / no data for this window
  return parseInsights(row);
}

/** Daily-broken-down insights — one row per day inside the range. */
export async function getInsightsDaily(opts: {
  adAccountId: string;
  timeRange: { since: string; until: string };
}): Promise<MetaAdsMetrics[]> {
  const params: Record<string, string> = {
    fields: 'spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values,date_start,date_stop',
    time_range: JSON.stringify(opts.timeRange),
    time_increment: '1', // 1 = daily
  };
  const res = await graphGet<{ data: InsightsResponse[] }>(`/${opts.adAccountId}/insights`, params);
  return (res.data || []).map(parseInsights);
}

/** Per-campaign breakdown for a given account + window — for the drill-down page. */
export async function getCampaignBreakdown(opts: {
  adAccountId: string;
  datePreset?: string;
  timeRange?: { since: string; until: string };
}): Promise<Array<MetaAdsMetrics & { campaignId: string; campaignName: string }>> {
  const params: Record<string, string> = {
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values',
    level: 'campaign',
  };
  if (opts.timeRange) params.time_range = JSON.stringify(opts.timeRange);
  else                params.date_preset = opts.datePreset || 'last_7d';

  const res = await graphGet<{ data: any[] }>(`/${opts.adAccountId}/insights`, params);
  return (res.data || []).map(r => ({
    campaignId:   r.campaign_id,
    campaignName: r.campaign_name,
    ...parseInsights(r),
  }));
}

// ── Parsing ──────────────────────────────────────────────────────────────

function parseInsights(r: InsightsResponse): MetaAdsMetrics {
  const num = (s?: string) => (s ? Number(s) : 0);
  const wanted = conversionActionType();

  // Pull the configured conversion action's count + value.
  const conversionAction = (r.actions || []).find(a => a.action_type === wanted);
  const conversionValueAction = (r.action_values || []).find(a => a.action_type === wanted);
  const conversions = conversionAction ? num(conversionAction.value) : 0;
  const conversionValue = conversionValueAction ? num(conversionValueAction.value) : 0;

  const spend = num(r.spend);
  return {
    dateStart: r.date_start || '',
    dateStop:  r.date_stop  || '',
    spend,
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr:    num(r.ctr),
    cpm:    num(r.cpm),
    cpc:    num(r.cpc),
    reach:  num(r.reach),
    frequency: num(r.frequency),
    conversions,
    conversionValue,
    costPerConversion: conversions > 0 ? spend / conversions : 0,
    roas:              spend > 0 ? conversionValue / spend : 0,
    raw: r,
  };
}
