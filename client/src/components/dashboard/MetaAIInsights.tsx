import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, RefreshCw, AlertCircle, Check, X as XIcon, Activity } from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';

/**
 * MetaAIInsights — Robin's "what should we do with THIS ad account?" panel.
 *
 * Mounts at the top of MetaAdsReport. Re-fetches whenever `adAccountId`
 * changes. Three rails:
 *   • Data says — concrete numerical observations
 *   • Karna hai — concrete next actions
 *   • Mat karo — common mistakes to avoid for this specific account
 *
 * Backend caches 30 min per account per day, so account-switching is
 * free after the first hit. Refresh button passes refresh=1 to bust.
 *
 * Hidden when there's no selected account — nothing to advise about.
 */
interface AIInsightsResp {
  adAccountId: string;
  dataSays: string[];
  toDo:     string[];
  toAvoid:  string[];
  headline: string;
  generatedAt: string;
  error?: string;
}

interface Props {
  adAccountId: string;
  accountName?: string;
}

export function MetaAIInsights({ adAccountId, accountName }: Props) {
  const [data, setData] = useState<AIInsightsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    if (!adAccountId) return;
    setError(null);
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const out = await api.metaAdsAIInsights(adAccountId, refresh);
      setData(out);
      if (refresh) toast.success('Robin ne new insights bana diye.');
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.error || e?.message || 'AI insights load nahi ho paye';
      if (status === 503) {
        setError('AI temporarily unavailable. Add GEMINI_API_KEY on Render → robin-api → Environment, then redeploy.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Refetch on account change. Deliberate empty array case → don't fire
  // for the brief "loading accounts" moment.
  useEffect(() => {
    if (!adAccountId) return;
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountId]);

  if (!adAccountId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 sm:p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-primary uppercase tracking-wide">Robin AI</p>
          <p className="text-[12px] text-muted-foreground truncate">
            {accountName ? `${accountName} — what to do next` : 'What to do next'}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="ml-auto h-7 px-2 text-[11px] flex items-center gap-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          title="Force a fresh AI take on this account"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-primary/15 rounded w-11/12" />
          <div className="h-3 bg-primary/15 rounded w-9/12" />
          <div className="h-3 bg-primary/15 rounded w-10/12" />
          <div className="h-3 bg-primary/15 rounded w-8/12" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {/* Headline — bold one-liner */}
          {data.headline && (
            <p className="text-[13px] sm:text-sm font-semibold text-foreground/90 mb-4 leading-snug">
              {data.headline}
            </p>
          )}

          {/* Three-column rails */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Rail
              icon={<Activity className="h-3.5 w-3.5" />}
              tone="info"
              title="Data kya keh raha hai"
              items={data.dataSays}
            />
            <Rail
              icon={<Check className="h-3.5 w-3.5" />}
              tone="success"
              title="Karna hai"
              items={data.toDo}
            />
            <Rail
              icon={<XIcon className="h-3.5 w-3.5" />}
              tone="danger"
              title="Mat karo"
              items={data.toAvoid}
            />
          </div>

          {/* Footer — when was this generated */}
          <p className="text-[10px] text-muted-foreground/70 mt-3">
            Generated{' '}
            {data.generatedAt
              ? new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
              : 'just now'}
            {' · cached 30 min per account · click Refresh for a new take'}
          </p>
        </>
      )}
    </motion.div>
  );
}

// ── Rail — one of the three column lists ──────────────────────────────
function Rail({ icon, tone, title, items }: {
  icon: React.ReactNode;
  tone: 'info' | 'success' | 'danger';
  title: string;
  items: string[];
}) {
  const toneCls =
    tone === 'success' ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700' :
    tone === 'danger'  ? 'border-rose-500/25 bg-rose-500/[0.06] text-rose-700' :
                          'border-blue-500/25 bg-blue-500/[0.06] text-blue-700';
  return (
    <div className={`rounded-xl border ${toneCls} p-3`}>
      <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 mb-2">
        {icon}
        {title}
      </p>
      {items && items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((s, i) => (
            <li key={i} className="text-[12px] text-foreground/85 leading-snug flex items-start gap-1.5">
              <span className="mt-1 h-1 w-1 rounded-full bg-current opacity-60 shrink-0" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground italic">—</p>
      )}
    </div>
  );
}

export default MetaAIInsights;
