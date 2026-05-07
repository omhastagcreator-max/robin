import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { TrendingUp, IndianRupee, Eye, MousePointerClick, Target, AlertCircle, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import * as api from '@/api';

/**
 * MetaAdsCard
 *
 * Compact dashboard card for ads-team employees and admins. Shows
 * yesterday's headline numbers for the default ad account: spend,
 * impressions, clicks, CTR, conversions, ROAS. Server caches so
 * dashboard refreshes don't spam Meta's API.
 *
 * Visible only to: admin role / ads team primary / ads in teams[] —
 * the server's role gate (requireMetaAccess) returns 403 to anyone
 * else and we show nothing.
 */

interface Metrics {
  dateStart: string;
  dateStop: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  conversions: number;
  conversionValue: number;
  costPerConversion: number;
  roas: number;
}

const fmtNum = (n: number) => n.toLocaleString('en-IN');
const fmtINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export function MetaAdsCard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [accountName, setAccountName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch default account name + yesterday metrics in parallel
        const [accounts, yest] = await Promise.all([
          api.metaAdsAccounts().catch(() => null),
          api.metaAdsYesterday(),
        ]);
        if (cancelled) return;
        if (accounts) {
          const def = accounts.accounts.find((a: any) => a.id === accounts.defaultAccountId);
          setAccountName(def?.name || '');
        }
        setMetrics(yest.metrics);
      } catch (e: any) {
        if (cancelled) return;
        const status = e?.response?.status;
        if (status === 403) setForbidden(true);
        else setError(e?.response?.data?.error || 'Could not load Meta Ads');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Don't render anything if user doesn't have access (cleaner than showing
  // a "you can't see this" card on every dashboard for non-ads users).
  if (forbidden) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-9 w-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-blue-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Meta Ads · Yesterday</p>
          <p className="text-[11px] text-muted-foreground">{accountName || 'Default account'}</p>
        </div>
        <Link
          to="/ads/meta"
          className="ml-auto text-[11px] text-primary flex items-center gap-0.5 hover:underline"
        >
          Full report <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading && (
        <div className="grid grid-cols-3 gap-3 animate-pulse">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-14 bg-blue-500/10 rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Couldn't load Meta data</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && !metrics && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No spend yesterday on this account. Try a different account from the full report.
        </p>
      )}

      {!loading && !error && metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat icon={IndianRupee}        label="Spend"        value={fmtINR(metrics.spend)} />
          <Stat icon={Eye}                label="Impressions"  value={fmtNum(metrics.impressions)} />
          <Stat icon={MousePointerClick}  label="Clicks"       value={fmtNum(metrics.clicks)}    sub={`CTR ${fmtPct(metrics.ctr)}`} />
          <Stat icon={Target}             label="Conversions"  value={fmtNum(metrics.conversions)} sub={metrics.conversions > 0 ? `${fmtINR(metrics.costPerConversion)} / conv` : ''} />
          <Stat icon={TrendingUp}         label="ROAS"         value={metrics.roas > 0 ? `${metrics.roas.toFixed(2)}x` : '—'} accent={metrics.roas >= 2 ? 'green' : metrics.roas >= 1 ? 'amber' : metrics.roas > 0 ? 'red' : undefined} />
          <Stat icon={IndianRupee}        label="Avg CPC"      value={metrics.cpc > 0 ? fmtINR(metrics.cpc) : '—'} />
        </div>
      )}
    </motion.div>
  );
}

function Stat({ icon: Icon, label, value, sub, accent }: {
  icon: any; label: string; value: string; sub?: string; accent?: 'green' | 'amber' | 'red';
}) {
  const accentColor = accent === 'green' ? 'text-green-600' : accent === 'amber' ? 'text-amber-600' : accent === 'red' ? 'text-red-600' : '';
  return (
    <div className="bg-card/60 border border-border/40 rounded-lg p-2.5 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">{label}</span>
      </div>
      <p className={`text-lg font-bold tabular-nums leading-none ${accentColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default MetaAdsCard;
