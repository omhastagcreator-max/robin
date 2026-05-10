import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { TrendingUp, IndianRupee, Eye, MousePointerClick, Target, AlertCircle, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * MetaAdsCard
 *
 * Compact dashboard card for ads-team employees and admins. Shows
 * yesterday's headline numbers for the default ad account: spend,
 * impressions, clicks, CTR, conversions, ROAS. Server caches so
 * dashboard refreshes don't spam Meta's API.
 *
 * Visible ONLY to:
 *   - admin role (primary or in roles[])
 *   - users whose primary team is 'meta' or 'ads'
 *   - users whose teams[] includes 'meta' or 'ads'
 *
 * We gate this CLIENT-SIDE before making any API call so non-eligible
 * users (sales, client, plain employees) don't even see the empty state
 * flash, don't waste a Render request, and the card simply doesn't exist
 * for them. The server's requireMetaAccess gate is still the source of
 * truth — this is just a UI guard that mirrors it.
 */
const ELIGIBLE_TEAMS = ['meta', 'ads'];

function userHasMetaAccess(user: any): boolean {
  if (!user) return false;
  // Admin always wins
  if (user.role === 'admin' || (user.roles || []).includes('admin')) return true;
  // Primary team match
  if (user.team && ELIGIBLE_TEAMS.includes(user.team)) return true;
  // Multi-team match
  if (Array.isArray(user.teams) && user.teams.some((t: string) => ELIGIBLE_TEAMS.includes(t))) return true;
  return false;
}

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

const safe = (n: any): number => (Number.isFinite(Number(n)) ? Number(n) : 0);
const fmtNum = (n?: number | null) => safe(n).toLocaleString('en-IN');
const fmtINR = (n?: number | null) => `₹${safe(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtPct = (n?: number | null) => `${safe(n).toFixed(2)}%`;

type Window = 'today' | 'yesterday';

export function MetaAdsCard() {
  const { user } = useAuth();
  const hasAccess = userHasMetaAccess(user);

  const [view, setView] = useState<Window>('today');
  const [today, setToday] = useState<Metrics | null>(null);
  const [yesterday, setYesterday] = useState<Metrics | null>(null);
  const [accountName, setAccountName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // Pull both today + yesterday so the toggle is instant. Today auto-refreshes
  // every 60s — Meta surfaces in-day stats with a small lag (5–15 min).
  useEffect(() => {
    // Don't even hit the API if the user can't see this card.
    if (!hasAccess) { setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const [accounts, todayRes, yestRes] = await Promise.all([
          api.metaAdsAccounts().catch(() => null),
          api.metaAdsToday().catch(() => null),
          api.metaAdsYesterday().catch(() => null),
        ]);
        if (cancelled) return;
        if (accounts) {
          const def = accounts.accounts.find((a: any) => a.id === accounts.defaultAccountId);
          setAccountName(def?.name || '');
        }
        setToday(todayRes?.metrics ?? null);
        setYesterday(yestRes?.metrics ?? null);
        setRefreshedAt(new Date());
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.error || 'Could not load Meta Ads');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hasAccess]);

  const metrics = view === 'today' ? today : yesterday;

  // No access → render nothing at all. No flash, no empty state, no card.
  if (!hasAccess) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-5"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="h-9 w-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-blue-500" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide flex items-center gap-1.5">
            Meta Ads
            {view === 'today' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded bg-red-500/15 text-red-600 text-[9px] font-bold">
                <span className="h-1 w-1 rounded-full bg-red-500 animate-pulse" /> LIVE
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {accountName || 'Default account'}
            {refreshedAt && view === 'today' && (
              <span className="ml-1.5 text-muted-foreground/70">· refreshed {refreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Today / Yesterday toggle */}
          <div className="inline-flex items-center bg-background/60 border border-blue-500/20 rounded-full p-0.5 text-[11px] font-semibold">
            <button
              onClick={() => setView('today')}
              className={`px-2.5 py-0.5 rounded-full transition-colors ${view === 'today' ? 'bg-blue-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Today
            </button>
            <button
              onClick={() => setView('yesterday')}
              className={`px-2.5 py-0.5 rounded-full transition-colors ${view === 'yesterday' ? 'bg-blue-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Yesterday
            </button>
          </div>
          <Link
            to="/ads/meta"
            className="text-[11px] text-primary flex items-center gap-0.5 hover:underline"
          >
            Full report <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
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
          {view === 'today'
            ? 'No spend yet today on this account. Numbers appear once campaigns start delivering.'
            : 'No spend yesterday on this account. Try a different account from the full report.'}
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
