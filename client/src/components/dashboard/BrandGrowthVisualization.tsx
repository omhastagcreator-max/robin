import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Eye, MousePointerClick, Target, ShoppingCart, IndianRupee, Award,
  TrendingUp, TrendingDown, AlertTriangle, Sparkles, Flame, Snowflake,
  PlayCircle, Zap, ArrowUpRight, ArrowDownRight, Megaphone, Users,
  Layers, Activity, BadgeCheck, Lightbulb,
} from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/**
 * BrandGrowthVisualization
 *
 * One-screen, executive-style read on a Meta Ads account focused on the
 * metrics that matter for brand-stage decisions:
 *
 *   START   →   GROW   →   SCALE
 *   awareness  attention  intent → action
 *
 * Built from the same { totals, daily, campaigns } that the existing
 * MetaAdsReport drill-down already fetches — no new API calls. The viewer
 * just gets a dramatically more useful summary.
 *
 * Layout:
 *   1. Health score (composite of CTR, ROAS, frequency, CPA against
 *      industry benchmarks)
 *   2. Funnel — Reach → Clicks → LPV → ATC → Checkout → Purchase, each
 *      step with absolute count + % of previous (drop-off rate)
 *   3. Five stage cards: Awareness / Attention / Interest / Intent / Action
 *      with the leading metric, benchmark band, and trend arrow
 *   4. Spend + ROAS trend (twin axes) over the selected window
 *   5. Top 3 winners and top 3 to review (campaigns ranked by ROAS / CPA)
 *   6. Smart insights — rule-based callouts (frequency fatigue, hook rate,
 *      conversion drop-off) so the user doesn't have to interpret numbers
 */

// ─────────────────────────────────────────────────────────────────────────
// Types — match server Metrics shape but everything optional / safe.
// ─────────────────────────────────────────────────────────────────────────
export interface MetricsLike {
  spend?: number; impressions?: number; reach?: number; frequency?: number;
  cpm?: number; clicks?: number; ctr?: number; cpc?: number;
  inlineLinkClicks?: number; outboundClicks?: number;
  landingPageViews?: number; costPerLandingPageView?: number;
  videoViews?: number; videoThruplays?: number; videoP50?: number; videoP75?: number; videoP100?: number;
  viewContent?: number; addToCart?: number; initiateCheckout?: number; addPaymentInfo?: number;
  purchases?: number; leads?: number; conversions?: number;
  conversionValue?: number; costPerPurchase?: number; costPerLead?: number;
  roas?: number;
  qualityRanking?: string; engagementRateRanking?: string; conversionRateRanking?: string;
  dateStart?: string; dateStop?: string;
}

export interface DailyPoint extends MetricsLike { dateStart?: string; }

export interface CampaignLike extends MetricsLike {
  campaignId: string;
  campaignName: string;
}

interface Props {
  totals: MetricsLike | null;
  daily:  DailyPoint[];
  campaigns: CampaignLike[];
  currency?: string;            // 'INR' default
  accountName?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
const safe = (n: any): number => (Number.isFinite(Number(n)) ? Number(n) : 0);
const fmtINR = (n?: number, currency = 'INR') => {
  const v = safe(n);
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const fmtNum = (n?: number) => {
  const v = safe(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('en-IN');
};
const fmtPct = (n?: number, digits = 2) => `${safe(n).toFixed(digits)}%`;
const fmtMul = (n?: number) => `${safe(n).toFixed(2)}x`;

// Industry benchmarks for D2C / e-commerce (India). These aren't
// gospel — they're rough guideposts so the viewer can tell "good vs bad"
// at a glance instead of having to remember what a 1.4% CTR means.
const BENCHMARKS = {
  ctr:        { poor: 0.5,  ok: 1.0,  good: 1.5,  great: 2.5 },   // %
  cpm:        { great: 100, good: 200, ok: 350, poor: 500 },       // ₹ — lower is better
  frequency:  { great: 1.5, good: 2.0, ok: 2.5, poor: 3.0 },       // higher = fatigue
  hookRate:   { poor: 15,   ok: 25,   good: 35,   great: 50 },     // % — 3-sec views / impressions
  holdRate:   { poor: 10,   ok: 20,   good: 30,   great: 40 },     // % — P75 / 3-sec views
  lpvRate:    { poor: 30,   ok: 50,   good: 70,   great: 85 },     // % — landing-page-views / link-clicks
  ctrToCart:  { poor: 1.0,  ok: 3.0,  good: 6.0,  great: 10.0 },   // % — atc / lpv
  cartToBuy:  { poor: 1.0,  ok: 3.0,  good: 5.0,  great: 8.0 },    // % — purchase / atc
  roas:       { poor: 1.0,  ok: 2.0,  good: 3.5,  great: 5.0 },    // x
};

type Tier = 'poor' | 'ok' | 'good' | 'great';

function tierFor(value: number, key: keyof typeof BENCHMARKS, lowerIsBetter = false): Tier {
  const b = BENCHMARKS[key] as any;
  if (lowerIsBetter) {
    if (value <= b.great) return 'great';
    if (value <= b.good)  return 'good';
    if (value <= b.ok)    return 'ok';
    return 'poor';
  }
  if (value >= b.great) return 'great';
  if (value >= b.good)  return 'good';
  if (value >= b.ok)    return 'ok';
  return 'poor';
}

const TIER_TONE: Record<Tier, string> = {
  great: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  good:  'bg-blue-500/15 text-blue-700 border-blue-500/30',
  ok:    'bg-amber-500/15 text-amber-700 border-amber-500/30',
  poor:  'bg-red-500/15 text-red-700 border-red-500/30',
};
const TIER_LABEL: Record<Tier, string> = {
  great: 'Crushing it', good: 'Healthy', ok: 'Watch', poor: 'Fix this',
};

// ─────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────
export function BrandGrowthVisualization({ totals, daily, campaigns, accountName }: Props) {
  // Defensive — render an empty-state if no data yet.
  if (!totals || (!daily.length && !campaigns.length)) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
        Pick an account and a date window to see the brand-growth view.
      </div>
    );
  }

  // ── Derived metrics ────────────────────────────────────────────────────
  const t = totals;
  const reach        = safe(t.reach);
  const impressions  = safe(t.impressions);
  const clicks       = safe(t.inlineLinkClicks || t.clicks);
  const lpv          = safe(t.landingPageViews);
  const atc          = safe(t.addToCart);
  const checkout     = safe(t.initiateCheckout);
  const purchases    = safe(t.purchases || t.conversions);
  const spend        = safe(t.spend);
  const revenue      = safe(t.conversionValue);
  const roas         = safe(t.roas) || (spend ? revenue / spend : 0);

  const ctr          = safe(t.ctr);
  const cpm          = safe(t.cpm);
  const frequency    = safe(t.frequency) || (reach ? impressions / reach : 0);
  const hookRate     = impressions ? (safe(t.videoViews) / impressions) * 100 : 0;
  const holdRate     = safe(t.videoViews) ? (safe(t.videoP75) / safe(t.videoViews)) * 100 : 0;
  const lpvRate      = clicks ? (lpv / clicks) * 100 : 0;
  const ctrToCart    = lpv ? (atc / lpv) * 100 : 0;
  const cartToBuy    = atc ? (purchases / atc) * 100 : 0;
  const cpa          = purchases ? spend / purchases : safe(t.costPerPurchase);
  const cpl          = safe(t.leads) ? spend / safe(t.leads) : safe(t.costPerLead);
  const aov          = purchases ? revenue / purchases : 0;

  // ── Health score (0–100) — weighted blend of the headline KPIs ────────
  const healthScore = useMemo(() => {
    const tierToScore: Record<Tier, number> = { poor: 25, ok: 55, good: 80, great: 95 };
    const parts: Array<{ weight: number; tier: Tier }> = [];
    if (ctr)        parts.push({ weight: 1.0, tier: tierFor(ctr, 'ctr') });
    if (cpm)        parts.push({ weight: 0.8, tier: tierFor(cpm, 'cpm', true) });
    if (frequency)  parts.push({ weight: 0.7, tier: tierFor(frequency, 'frequency', true) });
    if (lpvRate)    parts.push({ weight: 1.0, tier: tierFor(lpvRate, 'lpvRate') });
    if (roas)       parts.push({ weight: 1.5, tier: tierFor(roas, 'roas') });
    if (parts.length === 0) return null;
    const num = parts.reduce((s, p) => s + p.weight * tierToScore[p.tier], 0);
    const den = parts.reduce((s, p) => s + p.weight, 0);
    return Math.round(num / den);
  }, [ctr, cpm, frequency, lpvRate, roas]);

  // ── Funnel rows (drop-off visualization) ──────────────────────────────
  const funnel = [
    { label: 'Reach',          value: reach,       icon: Users,             tone: 'bg-violet-500'  },
    { label: 'Impressions',    value: impressions, icon: Eye,                tone: 'bg-indigo-500'  },
    { label: 'Link clicks',    value: clicks,      icon: MousePointerClick,  tone: 'bg-blue-500'    },
    { label: 'Landing-page views', value: lpv,     icon: Layers,             tone: 'bg-cyan-500'    },
    { label: 'Add to cart',    value: atc,         icon: ShoppingCart,       tone: 'bg-amber-500'   },
    { label: 'Checkout',       value: checkout,    icon: Activity,           tone: 'bg-orange-500'  },
    { label: 'Purchase',       value: purchases,   icon: Award,              tone: 'bg-emerald-600' },
  ].filter(f => f.value > 0);

  const funnelMax = funnel[0]?.value || 1;

  // ── Daily series (spend, ROAS, purchases) ─────────────────────────────
  const series = useMemo(() => {
    return [...daily]
      .filter(d => d.dateStart)
      .map(d => {
        const sp  = safe(d.spend);
        const rev = safe(d.conversionValue);
        return {
          date: (d.dateStart || '').slice(5),  // MM-DD
          spend: sp,
          revenue: rev,
          roas: sp ? rev / sp : 0,
          purchases: safe(d.purchases || d.conversions),
        };
      });
  }, [daily]);

  // ── Top winners + needs-review (campaigns) ────────────────────────────
  const ranked = useMemo(() => {
    const valid = campaigns.filter(c => safe(c.spend) > 0);
    const winners = [...valid]
      .sort((a, b) => safe(b.roas) - safe(a.roas))
      .slice(0, 3);
    const review = [...valid]
      .filter(c => safe(c.spend) > 100)
      .sort((a, b) => safe(a.roas) - safe(b.roas))
      .slice(0, 3);
    return { winners, review };
  }, [campaigns]);

  // ── Smart insights — rule-based "what to do" callouts ─────────────────
  const insights = useMemo(() => {
    const out: { tone: Tier; icon: any; title: string; body: string }[] = [];

    if (frequency >= 3.0)  out.push({ tone: 'poor', icon: Flame,  title: 'Creative fatigue setting in', body: `Your average user has now seen these ads ${frequency.toFixed(1)} times. Refresh creative or rotate placements before performance dips further.` });
    else if (frequency >= 2.5) out.push({ tone: 'ok', icon: AlertTriangle, title: 'Frequency creeping up', body: `Average frequency is ${frequency.toFixed(1)}. Plan a creative refresh in the next 7–10 days.` });

    if (ctr && tierFor(ctr, 'ctr') === 'poor') out.push({ tone: 'poor', icon: Snowflake, title: 'CTR is below industry average', body: `CTR of ${ctr.toFixed(2)}% suggests the creative isn't stopping the scroll. Test new hooks: pattern interrupts, bold first frames, surprising claims.` });
    if (ctr && tierFor(ctr, 'ctr') === 'great') out.push({ tone: 'great', icon: Sparkles, title: 'Creative is doing the work', body: `${ctr.toFixed(2)}% CTR is well above benchmark. Document what's working in this creative and brief the next batch around the same hook.` });

    if (hookRate && tierFor(hookRate, 'hookRate') === 'poor') out.push({ tone: 'poor', icon: PlayCircle, title: 'First 3 seconds aren't landing', body: `Only ${hookRate.toFixed(1)}% of viewers stay past 3 seconds. The hook frame, sound, or visual isn't earning attention. Re-cut with a faster hook.` });

    if (lpvRate && tierFor(lpvRate, 'lpvRate') === 'poor') out.push({ tone: 'poor', icon: Layers, title: 'Big drop between click and landing', body: `Only ${lpvRate.toFixed(0)}% of clickers actually load the page. Check load speed (LCP < 2.5s), broken redirects, or ad → page mismatch.` });

    if (cartToBuy && tierFor(cartToBuy, 'cartToBuy') === 'poor' && atc > 10) out.push({ tone: 'poor', icon: ShoppingCart, title: 'Carts not converting to orders', body: `${cartToBuy.toFixed(1)}% of add-to-carts become purchases. Common fixes: cheaper shipping, COD option, more trust badges, faster checkout.` });

    if (roas && tierFor(roas, 'roas') === 'great') out.push({ tone: 'great', icon: TrendingUp, title: `ROAS of ${roas.toFixed(2)}x — scale this`, body: `Strong economics. Increase daily budget by 20% on the winning campaigns and watch CPA over the next 3–5 days.` });
    if (roas && tierFor(roas, 'roas') === 'poor' && spend > 1000) out.push({ tone: 'poor', icon: TrendingDown, title: 'ROAS below break-even', body: `${roas.toFixed(2)}x ROAS is below 1.5x break-even territory. Pause the bottom-quartile campaigns + audit whether you're tracking purchase events correctly.` });

    if (cpm && tierFor(cpm, 'cpm', true) === 'poor') out.push({ tone: 'ok', icon: IndianRupee, title: 'CPM is on the high side', body: `Reaching 1000 people costs ₹${cpm.toFixed(0)}. Either the audience is too narrow or auction competition is high — broaden interests or test new placements.` });

    if (spend > 0 && purchases === 0 && lpv > 50) out.push({ tone: 'poor', icon: AlertTriangle, title: 'Spending without conversions', body: `${fmtNum(lpv)} landing-page views but 0 purchases. Either purchase tracking is broken (check Pixel) or the offer isn't compelling enough.` });

    if (out.length === 0) out.push({ tone: 'good', icon: BadgeCheck, title: 'No alerts — keep monitoring', body: 'No urgent flags right now. Watch frequency and CPA trends daily; refresh creative every 2–3 weeks regardless.' });

    return out;
  }, [frequency, ctr, hookRate, lpvRate, cartToBuy, atc, roas, spend, cpm, purchases, lpv]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* ── 1. HEALTH SCORE BANNER ─────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="relative h-24 w-24 shrink-0">
              <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
                <circle cx="50" cy="50" r="44" fill="none" className="stroke-muted/40" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="44" fill="none" strokeWidth="8" strokeLinecap="round"
                  className={
                    !healthScore ? 'stroke-muted-foreground'
                    : healthScore >= 80 ? 'stroke-emerald-500'
                    : healthScore >= 60 ? 'stroke-blue-500'
                    : healthScore >= 40 ? 'stroke-amber-500'
                    : 'stroke-red-500'
                  }
                  strokeDasharray={`${(healthScore || 0) * 2.76} 276`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black tabular-nums">{healthScore ?? '—'}</span>
                <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Score</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{accountName || 'Brand growth view'}</p>
              <h2 className="text-xl font-bold mt-0.5">
                {healthScore && healthScore >= 80 ? 'Ready to scale.' :
                 healthScore && healthScore >= 60 ? 'Growing — keep iterating.' :
                 healthScore && healthScore >= 40 ? 'Foundation needs work.' :
                 healthScore ? 'Pause and fix the basics.' : 'Not enough data yet.'}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                Composite of CTR, CPM, frequency, landing-page rate and ROAS vs D2C benchmarks. 80+ means scale, 60–79 means optimize, below 40 means stop scaling and fix the bottleneck.
              </p>
            </div>
          </div>

          {/* Right side — top-line numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
            <Stat label="Spend"     value={fmtINR(spend)}    sub={`${fmtNum(daily.length)} days`} />
            <Stat label="Revenue"   value={fmtINR(revenue)}  sub={purchases ? `${fmtNum(purchases)} purchases` : 'no purchases'} tone="emerald" />
            <Stat label="ROAS"      value={fmtMul(roas)}     sub={roas >= 2 ? 'profitable' : 'below break-even'} tone={roas >= 2 ? 'emerald' : 'amber'} />
            <Stat label="Avg order" value={fmtINR(aov)}      sub={cpa ? `CPA ${fmtINR(cpa)}` : '—'} />
          </div>
        </div>
      </div>

      {/* ── 2. THE BRAND-GROWTH FUNNEL ──────────────────────────────── */}
      <Section title="The funnel" subtitle="Where your audience drops off — fix the biggest drop first">
        <div className="space-y-2">
          {funnel.map((row, i) => {
            const prev = funnel[i - 1]?.value;
            const pctOfPrev = prev ? (row.value / prev) * 100 : null;
            const pctOfMax  = (row.value / funnelMax) * 100;
            const Icon = row.icon;
            const dropOff = pctOfPrev !== null && pctOfPrev < 50;
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center gap-3 text-xs">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-semibold flex-1">{row.label}</span>
                  <span className="font-bold tabular-nums">{fmtNum(row.value)}</span>
                  {pctOfPrev !== null && (
                    <span className={`tabular-nums w-16 text-right text-[11px] ${dropOff ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                      {pctOfPrev.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div className={`h-full ${row.tone} transition-all`} style={{ width: `${Math.max(pctOfMax, 2)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── 3. THE FIVE STAGES ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <StageCard
          stage="START"
          title="Awareness"
          icon={Eye}
          metric={fmtNum(reach)}
          metricLabel="Reach"
          benchmark={`Frequency ${frequency.toFixed(2)}x`}
          tier={frequency ? tierFor(frequency, 'frequency', true) : 'ok'}
          help="Are enough new people seeing this? Frequency above 2.5 means you're hitting the same person too often."
        />
        <StageCard
          stage="GROW"
          title="Attention"
          icon={Megaphone}
          metric={fmtPct(ctr)}
          metricLabel="CTR"
          benchmark={hookRate > 0 ? `Hook ${hookRate.toFixed(0)}%` : `CPM ${fmtINR(cpm)}`}
          tier={ctr ? tierFor(ctr, 'ctr') : 'ok'}
          help="Is the creative stopping the scroll? CTR above 1.5% is healthy, above 2.5% is great."
        />
        <StageCard
          stage="GROW"
          title="Interest"
          icon={MousePointerClick}
          metric={fmtNum(lpv)}
          metricLabel="Landing-page views"
          benchmark={lpvRate ? `${lpvRate.toFixed(0)}% of clicks` : '—'}
          tier={lpvRate ? tierFor(lpvRate, 'lpvRate') : 'ok'}
          help="Are clickers actually landing on your site? <50% means a broken link or slow page."
        />
        <StageCard
          stage="SCALE"
          title="Intent"
          icon={ShoppingCart}
          metric={fmtNum(atc)}
          metricLabel="Add to cart"
          benchmark={ctrToCart ? `${ctrToCart.toFixed(1)}% of LPV` : '—'}
          tier={ctrToCart ? tierFor(ctrToCart, 'ctrToCart') : 'ok'}
          help="Are visitors showing buying intent? Below 3% means weak product-market fit on this audience."
        />
        <StageCard
          stage="SCALE"
          title="Action"
          icon={Award}
          metric={fmtMul(roas)}
          metricLabel="ROAS"
          benchmark={`CPA ${fmtINR(cpa)}`}
          tier={roas ? tierFor(roas, 'roas') : 'ok'}
          help="Every rupee in, how many out? 2x is break-even territory, 3.5x+ is genuinely scalable."
        />
      </div>

      {/* ── 4. SPEND vs ROAS TREND ──────────────────────────────────── */}
      {series.length > 1 && (
        <Section title="Spend vs ROAS over time" subtitle="When ROAS dips while spend stays flat → scale paused">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                <YAxis yAxisId="left"  tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                <YAxis yAxisId="right" tick={{ fontSize: 10 }} orientation="right" stroke="currentColor" className="text-muted-foreground" />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, n: any) => n === 'spend' ? fmtINR(Number(v)) : Number(v).toFixed(2) + 'x'}
                />
                <Line yAxisId="left"  type="monotone" dataKey="spend" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="spend" />
                <Line yAxisId="right" type="monotone" dataKey="roas"  stroke="#10b981" strokeWidth={2} dot={false} name="roas" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ── 5. WINNERS + REVIEW (campaigns ranked) ─────────────────── */}
      {(ranked.winners.length > 0 || ranked.review.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RankedList
            title="Top performers — scale these"
            tone="emerald"
            icon={Sparkles}
            items={ranked.winners}
            valueRender={(c) => `${fmtMul(safe(c.roas))} ROAS`}
            subRender={(c) => `${fmtINR(safe(c.spend))} spent · ${fmtNum(safe(c.purchases || c.conversions))} sales`}
          />
          <RankedList
            title="Needs review — biggest spenders, lowest ROAS"
            tone="red"
            icon={AlertTriangle}
            items={ranked.review}
            valueRender={(c) => `${fmtMul(safe(c.roas))} ROAS`}
            subRender={(c) => `${fmtINR(safe(c.spend))} spent · CPA ${fmtINR(safe(c.costPerPurchase))}`}
          />
        </div>
      )}

      {/* ── 6. SMART INSIGHTS ───────────────────────────────────────── */}
      <Section title="What to do next" subtitle="Rule-based callouts based on your numbers vs D2C benchmarks">
        <div className="space-y-2">
          {insights.map((ins, i) => {
            const Icon = ins.icon;
            return (
              <div key={i} className={`rounded-xl border p-3 flex items-start gap-3 ${TIER_TONE[ins.tone]}`}>
                <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{ins.title}</p>
                  <p className="text-xs mt-0.5 opacity-90">{ins.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Quality rankings (if Meta returned them) */}
      {(t.qualityRanking || t.engagementRateRanking || t.conversionRateRanking) && (
        <Section title="Meta's own quality ratings" subtitle="What the auction algorithm thinks of your ads">
          <div className="grid grid-cols-3 gap-3">
            <RankingPill label="Quality"       value={t.qualityRanking} />
            <RankingPill label="Engagement"    value={t.engagementRateRanking} />
            <RankingPill label="Conversion"    value={t.conversionRateRanking} />
          </div>
        </Section>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components (tiny, file-scoped)
// ─────────────────────────────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-bold">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'amber' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700' :
    'text-foreground';
  return (
    <div className="bg-card/50 rounded-xl border border-border/60 p-2.5">
      <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className={`text-lg font-black tabular-nums leading-tight mt-0.5 ${toneClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function StageCard({ stage, title, icon: Icon, metric, metricLabel, benchmark, tier, help }: {
  stage: 'START' | 'GROW' | 'SCALE';
  title: string;
  icon: any;
  metric: string;
  metricLabel: string;
  benchmark: string;
  tier: Tier;
  help: string;
}) {
  const stageTone = stage === 'START' ? 'text-violet-600' : stage === 'GROW' ? 'text-blue-600' : 'text-emerald-600';
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-4 group hover:shadow-md hover:border-primary/30 transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <p className={`text-[9px] uppercase tracking-wider font-bold ${stageTone}`}>{stage}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <p className="text-sm font-bold">{title}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{metric}</p>
      <p className="text-[10px] text-muted-foreground">{metricLabel}</p>
      <div className={`mt-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIER_TONE[tier]}`}>
        {TIER_LABEL[tier]} · {benchmark}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 leading-snug">{help}</p>
    </motion.div>
  );
}

function RankedList({ title, tone, icon: Icon, items, valueRender, subRender }: {
  title: string;
  tone: 'emerald' | 'red';
  icon: any;
  items: CampaignLike[];
  valueRender: (c: CampaignLike) => string;
  subRender: (c: CampaignLike) => string;
}) {
  if (items.length === 0) return null;
  const accent = tone === 'emerald'
    ? 'text-emerald-600 bg-emerald-500/10'
    : 'text-red-600 bg-red-500/10';
  return (
    <Section title={title}>
      <div className="space-y-2">
        {items.map((c, i) => (
          <div key={c.campaignId || i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{c.campaignName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{subRender(c)}</p>
            </div>
            <p className={`text-sm font-bold tabular-nums ${tone === 'emerald' ? 'text-emerald-700' : 'text-red-700'}`}>
              {valueRender(c)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function RankingPill({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  const tone =
    v.includes('above')        ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' :
    v.includes('average')      ? 'bg-blue-500/15 text-blue-700 border-blue-500/30' :
    v.includes('below') || v.includes('bottom') ? 'bg-red-500/15 text-red-700 border-red-500/30' :
    'bg-muted text-muted-foreground border-border';
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
      <p className="text-sm font-bold capitalize mt-0.5">{value.replace(/_/g, ' ').toLowerCase()}</p>
    </div>
  );
}

export default BrandGrowthVisualization;
