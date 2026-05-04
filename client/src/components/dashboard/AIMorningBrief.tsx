import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import * as api from '@/api';

/**
 * AIMorningBrief
 *
 * Renders today's AI-generated briefing for the current user. Calls
 * GET /api/ai/morning-brief on mount; the server handles caching, so the
 * first load of the day pays the AI cost and every subsequent load is
 * instant.
 *
 * UI states:
 *   - loading      → skeleton lines (so layout doesn't jump)
 *   - error        → friendly message + retry button
 *   - configured?  → if backend says ANTHROPIC_API_KEY is missing, show
 *                    a setup hint instead of a generic error
 *   - success      → animated reveal of the brief content
 */
export function AIMorningBrief() {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    setError(null);
    setNeedsSetup(false);
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const data = await api.aiMorningBrief(refresh);
      setContent(data.content);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Could not load briefing';
      if (msg.includes('ANTHROPIC_API_KEY')) {
        setNeedsSetup(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(false);
    // We intentionally don't put `load` in deps — useEffect only fires once
    // per mount. If we ever want auto-refresh on the hour, that's a separate
    // setInterval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5"
    >
      {/* Decorative sparkle */}
      <div className="absolute top-3 right-3 opacity-30">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Robin AI</p>
          <p className="text-[11px] text-muted-foreground">Your morning briefing</p>
        </div>
        {!loading && !needsSetup && (
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="ml-auto h-7 px-2 text-[11px] flex items-center gap-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            title="Regenerate today's briefing"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* States */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-primary/15 rounded w-11/12" />
          <div className="h-3 bg-primary/15 rounded w-9/12" />
          <div className="h-3 bg-primary/15 rounded w-10/12" />
        </div>
      )}

      {needsSetup && (
        <div className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">AI not yet configured</p>
            <p className="text-xs mt-0.5 text-muted-foreground">
              Add <code className="bg-muted px-1 rounded">ANTHROPIC_API_KEY</code> on Render → robin-api → Environment, then redeploy.
            </p>
          </div>
        </div>
      )}

      {error && !needsSetup && (
        <div className="text-sm text-red-500 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              onClick={() => load(false)}
              className="text-xs underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && !needsSetup && content && (
        <motion.p
          key={content}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="text-sm leading-relaxed text-foreground/90"
        >
          {content}
        </motion.p>
      )}
    </motion.div>
  );
}
