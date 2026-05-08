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

interface ActionEntry { action_type: string; value: string }

interface InsightsResponse {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  // Click breakdown
  inline_link_clicks?: string;
  outbound_clicks?: ActionEntry[];
  outbound_clicks_ctr?: ActionEntry[];
  cost_per_inline_link_click?: string;
  cost_per_outbound_click?: ActionEntry[];
  unique_clicks?: string;
  unique_ctr?: string;
  // Video
  video_play_actions?: ActionEntry[];                    // 3-sec plays
  video_thruplay_watched_actions?: ActionEntry[];        // 15-sec / 97% (whichever is shorter)
  video_p50_watched_actions?: ActionEntry[];
  video_p75_watched_actions?: ActionEntry[];
  video_p100_watched_actions?: ActionEntry[];
  cost_per_thruplay?: ActionEntry[];
  // Quality rankings — 'above_average', 'average', 'below_average', 'unknown'
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  // Funnel actions
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  cost_per_action_type?: ActionEntry[];
  date_start?: string;
  date_stop?: string;
}

export interface MetaAdsMetrics {
  dateStart: string;
  dateStop: string;

  // Core spend + reach
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  cpm: number;

  // Clicks (multiple flavours — outbound is the most useful)
  clicks: number;                  // total clicks (incl. likes, profile, etc.)
  ctr: number;                     // total CTR
  cpc: number;                     // cost per total click
  inlineLinkClicks: number;        // clicks on the destination link only
  outboundClicks: number;          // clicks that LEFT Meta to your site
  outboundCtr: number;
  costPerOutboundClick: number;
  uniqueClicks: number;            // distinct people who clicked
  uniqueCtr: number;

  // Landing page reality check — people who waited for the page to load
  landingPageViews: number;
  costPerLandingPageView: number;

  // Funnel actions (e-commerce / lead gen)
  pageEngagements: number;         // likes + comments + shares + clicks on page
  postEngagements: number;
  videoViews: number;              // 3-second plays
  videoThruplays: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
  costPerThruplay: number;

  viewContent: number;             // pixel: ViewContent
  addPaymentInfo: number;          // pixel: AddPaymentInfo
  addToCart: number;
  initiateCheckout: number;
  purchases: number;
  leads: number;
  costPerAddPaymentInfo: number;
  costPerAddToCart: number;
  costPerInitiateCheckout: number;
  costPerPurchase: number;
  costPerLead: number;

  // Headline conversion (the action_type chosen by env)
  conversions: number;
  conversionValue: number;
  costPerConversion: number;
  roas: number;

  // Quality scores (only for accounts with enough volume)
  qualityRanking: string;          // 'above_average' | 'average' | 'below_average' | 'unknown'
  engagementRateRanking: string;
  conversionRateRanking: string;

  raw: InsightsResponse;
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
    fields: [
      'spend','impressions','clicks','ctr','cpm','cpc','reach','frequency',
      'inline_link_clicks','outbound_clicks','outbound_clicks_ctr',
      'cost_per_inline_link_click','cost_per_outbound_click',
      'unique_clicks','unique_ctr',
      'video_play_actions','video_thruplay_watched_actions',
      'video_p50_watched_actions','video_p75_watched_actions','video_p100_watched_actions',
      'cost_per_thruplay',
      'quality_ranking','engagement_rate_ranking','conversion_rate_ranking',
      'actions','action_values','cost_per_action_type',
      'date_start','date_stop',
    ].join(','),
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
    fields: [
      'spend','impressions','clicks','ctr','cpm','cpc','reach','frequency',
      'inline_link_clicks','outbound_clicks','outbound_clicks_ctr',
      'cost_per_inline_link_click','cost_per_outbound_click',
      'unique_clicks','unique_ctr',
      'video_play_actions','video_thruplay_watched_actions',
      'video_p50_watched_actions','video_p75_watched_actions','video_p100_watched_actions',
      'cost_per_thruplay',
      'quality_ranking','engagement_rate_ranking','conversion_rate_ranking',
      'actions','action_values','cost_per_action_type',
      'date_start','date_stop',
    ].join(','),
    time_range: JSON.stringify(opts.timeRange),
    time_increment: '1', // 1 = daily
  };
  const res = await graphGet<{ data: InsightsResponse[] }>(`/${opts.adAccountId}/insights`, params);
  return (res.data || []).map(parseInsights);
}

/**
 * Sum of daily budgets across active campaigns for an ad account.
 * Returns 0 if no campaigns are active. Meta returns budgets in the
 * account's currency minor unit (paise/cents), so we divide by 100.
 *
 * NOTE: this is a "what's CURRENTLY budgeted per day" — different from
 * "what was spent today". Useful for dashboards that want to show
 * pacing (spend vs budget).
 */
export async function getActiveDailyBudget(adAccountId: string): Promise<number> {
  const res = await graphGet<{ data: any[] }>(`/${adAccountId}/campaigns`, {
    fields: 'daily_budget,lifetime_budget,status,effective_status',
    limit: '200',
  });
  let totalDaily = 0;
  for (const c of res.data || []) {
    if (c.effective_status !== 'ACTIVE') continue;
    if (c.daily_budget) totalDaily += Number(c.daily_budget) / 100;
  }
  return totalDaily;
}

/**
 * Account health check — returns each account's last-7d spend so the UI
 * can show a green tick / red cross next to each in the dropdown.
 *
 * We hit /insights for every account in PARALLEL via Promise.allSettled so
 * a permissions error on one account doesn't break the whole call.
 *
 * Status taxonomy:
 *   - 'live'         — has spend in last 7 days
 *   - 'idle'         — visible to us, no spend last 7 days (paused/old)
 *   - 'no_access'    — Meta returned a permissions error for this account
 *   - 'error'        — any other API failure
 */
export type AccountHealth = AdAccountInfo & {
  recentSpend: number;
  status: 'live' | 'idle' | 'no_access' | 'error';
  errorMessage?: string;
};

export async function getAccountsHealth(): Promise<AccountHealth[]> {
  const accounts = await listAdAccounts();

  const probes = accounts.map(async (a): Promise<AccountHealth> => {
    try {
      const insights = await getInsights({ adAccountId: a.id, datePreset: 'last_7d' });
      const recentSpend = insights?.spend || 0;
      return { ...a, recentSpend, status: recentSpend > 0 ? 'live' : 'idle' };
    } catch (e) {
      const msg = (e as Error).message || '';
      // Permissions errors typically include "permission" or code 100/200
      const isPerm = /permission|code 100|code 200|code 10\b/i.test(msg);
      return {
        ...a,
        recentSpend: 0,
        status: isPerm ? 'no_access' : 'error',
        errorMessage: msg,
      };
    }
  });

  const results = await Promise.all(probes);
  return results;
}

/** Per-campaign breakdown for a given account + window — for the drill-down page. */
export async function getCampaignBreakdown(opts: {
  adAccountId: string;
  datePreset?: string;
  timeRange?: { since: string; until: string };
}): Promise<Array<MetaAdsMetrics & { campaignId: string; campaignName: string }>> {
  const params: Record<string, string> = {
    fields: [
      'campaign_id','campaign_name',
      'spend','impressions','clicks','ctr','cpm','cpc','reach','frequency',
      'inline_link_clicks','outbound_clicks','outbound_clicks_ctr',
      'unique_clicks','unique_ctr',
      'video_play_actions','video_thruplay_watched_actions','video_p50_watched_actions','video_p100_watched_actions',
      'quality_ranking','engagement_rate_ranking','conversion_rate_ranking',
      'actions','action_values',
    ].join(','),
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

// Helper — sum every numeric value in an action-array, or filter by type.
function sumActions(arr: ActionEntry[] | undefined, typeFilter?: (t: string) => boolean): number {
  if (!arr) return 0;
  return arr.reduce((s, a) => {
    if (typeFilter && !typeFilter(a.action_type)) return s;
    const n = Number(a.value);
    return s + (isFinite(n) ? n : 0);
  }, 0);
}
function findAction(arr: ActionEntry[] | undefined, type: string): number {
  const e = (arr || []).find(a => a.action_type === type);
  return e ? Number(e.value) || 0 : 0;
}
// Match either the bare action OR the offsite_conversion variant of the same.
// Meta returns BOTH "purchase" and "offsite_conversion.fb_pixel_purchase" for
// the same event sometimes; offsite_conversion is more accurate (pixel-fired).
function findActionByVariants(arr: ActionEntry[] | undefined, ...types: string[]): number {
  for (const t of types) {
    const v = findAction(arr, t);
    if (v > 0) return v;
  }
  return 0;
}

function parseInsights(r: InsightsResponse): MetaAdsMetrics {
  const num = (s?: string) => (s ? Number(s) : 0);
  const wanted = conversionActionType();

  // Configured conversion action
  const conversions      = findAction(r.actions, wanted);
  const conversionValue  = findAction(r.action_values, wanted);

  // Outbound clicks — Meta returns as an action-array with type 'outbound_click'.
  const outboundClicks   = sumActions(r.outbound_clicks, t => t === 'outbound_click');
  const outboundCtrEntry = (r.outbound_clicks_ctr || []).find(a => a.action_type === 'outbound_click');
  const outboundCtr      = outboundCtrEntry ? Number(outboundCtrEntry.value) || 0 : 0;
  const costPerOutboundClickEntry = (r.cost_per_outbound_click || []).find(a => a.action_type === 'outbound_click');
  const costPerOutboundClick = costPerOutboundClickEntry ? Number(costPerOutboundClickEntry.value) || 0 : 0;

  // Funnel events — pixel-prefixed variants are more reliable
  const landingPageViews   = findActionByVariants(r.actions, 'landing_page_view');
  const viewContent        = findActionByVariants(r.actions, 'offsite_conversion.fb_pixel_view_content', 'view_content');
  const addPaymentInfo     = findActionByVariants(r.actions, 'offsite_conversion.fb_pixel_add_payment_info', 'add_payment_info');
  const addToCart          = findActionByVariants(r.actions, 'offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart');
  const initiateCheckout   = findActionByVariants(r.actions, 'offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout');
  const purchases          = findActionByVariants(r.actions, 'offsite_conversion.fb_pixel_purchase', 'purchase');
  const leads              = findActionByVariants(r.actions, 'lead', 'offsite_conversion.fb_pixel_lead');
  const pageEngagements    = findAction(r.actions, 'page_engagement');
  const postEngagements    = findAction(r.actions, 'post_engagement');

  // Cost per action — pull from cost_per_action_type when available
  const costPerLandingPageView  = findActionByVariants(r.cost_per_action_type, 'landing_page_view');
  const costPerAddPaymentInfo   = findActionByVariants(r.cost_per_action_type, 'offsite_conversion.fb_pixel_add_payment_info', 'add_payment_info');
  const costPerAddToCart        = findActionByVariants(r.cost_per_action_type, 'offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart');
  const costPerInitiateCheckout = findActionByVariants(r.cost_per_action_type, 'offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout');
  const costPerPurchase         = findActionByVariants(r.cost_per_action_type, 'offsite_conversion.fb_pixel_purchase', 'purchase');
  const costPerLead             = findActionByVariants(r.cost_per_action_type, 'lead');

  // Video
  const videoViews     = sumActions(r.video_play_actions, t => t === 'video_view');
  const videoThruplays = sumActions(r.video_thruplay_watched_actions, t => t === 'video_view');
  const videoP50       = sumActions(r.video_p50_watched_actions, t => t === 'video_view');
  const videoP75       = sumActions(r.video_p75_watched_actions, t => t === 'video_view');
  const videoP100      = sumActions(r.video_p100_watched_actions, t => t === 'video_view');
  const costPerThruplayEntry = (r.cost_per_thruplay || []).find(a => a.action_type === 'video_view');
  const costPerThruplay      = costPerThruplayEntry ? Number(costPerThruplayEntry.value) || 0 : 0;

  const spend = num(r.spend);
  return {
    dateStart: r.date_start || '',
    dateStop:  r.date_stop  || '',

    spend,
    impressions: num(r.impressions),
    reach:       num(r.reach),
    frequency:   num(r.frequency),
    cpm:         num(r.cpm),

    clicks:           num(r.clicks),
    ctr:              num(r.ctr),
    cpc:              num(r.cpc),
    inlineLinkClicks: num(r.inline_link_clicks),
    outboundClicks,
    outboundCtr,
    costPerOutboundClick,
    uniqueClicks: num(r.unique_clicks),
    uniqueCtr:    num(r.unique_ctr),

    landingPageViews,
    costPerLandingPageView,

    pageEngagements,
    postEngagements,
    videoViews,
    videoThruplays,
    videoP50,
    videoP75,
    videoP100,
    costPerThruplay,

    viewContent,
    addPaymentInfo,
    addToCart,
    initiateCheckout,
    purchases,
    leads,
    costPerAddPaymentInfo,
    costPerAddToCart,
    costPerInitiateCheckout,
    costPerPurchase,
    costPerLead,

    conversions,
    conversionValue,
    costPerConversion: conversions > 0 ? spend / conversions : 0,
    roas:              spend > 0 ? conversionValue / spend : 0,

    qualityRanking:        r.quality_ranking || 'unknown',
    engagementRateRanking: r.engagement_rate_ranking || 'unknown',
    conversionRateRanking: r.conversion_rate_ranking || 'unknown',

    raw: r,
  };
}
