/**
 * aiInsights — centralised AI/heuristic insight service.
 *
 * This file has two responsibilities:
 *
 *   1.  `computeInsights(workflow)` — pure, synchronous, deterministic.
 *       Given a workflow document it returns the four operational insight
 *       fields (riskScore / delayCause / nextBestAction / predictedCompletionAt)
 *       WITHOUT calling any LLM. This is what the 15-min `healthInference`
 *       cron uses to keep every workflow's insights fresh. Free, fast,
 *       always available — no quota, no flake.
 *
 *   2.  `withAICache(key, ttlMs, fn)` + `withRateLimit(userId, fn)` —
 *       thin utility wrappers the other AI controllers (clientSummary,
 *       morning brief, all-projects brief, copilot, etc.) can wrap their
 *       expensive Gemini calls with. In-memory caching is per-process —
 *       fine for our single-Render-dyno setup; multi-instance would need
 *       Redis but we're not there.
 *
 * AI design rule for Robin: cheap heuristics first, AI only when the
 * heuristic genuinely can't answer. The pipeline-card insights are
 * heuristic. The client-facing paragraph summaries call Gemini because
 * natural language is the only way to express that information well.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface InsightsResult {
  /** 0–100 — 0 = perfectly on track, 100 = on fire. Visible as a small
   *  number / coloured chip on the pipeline card. */
  riskScore: number;
  /** Short plain-English reason — "Past ETA by 3 days", "No activity 5d".
   *  Empty when no risk. */
  delayCause: string;
  /** The literal next thing a human should do — first un-ticked checklist
   *  item on the first non-done service. Empty when nothing's left. */
  nextBestAction: string;
  /** Linear extrapolation of the project's finish date, OR `eta` when that
   *  is later. Null when not enough signal to predict (no progress yet
   *  OR fully done). */
  predictedCompletionAt: Date | null;
}

interface MinimalServiceForInsight {
  status: string;
  serviceType?: string;
  label?: string;
  checklist?: Array<{ done: boolean; text?: string; title?: string }>;
}

interface MinimalWorkflowForInsight {
  _id?: any;
  services?: MinimalServiceForInsight[];
  health?: string;
  healthReason?: string;
  blockerType?: string;
  blockerReason?: string;
  eta?: Date | string | null;
  lastActivityAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// ─── The heuristic engine ─────────────────────────────────────────────

/**
 * computeInsights — given a workflow doc, derive the four operational
 * insight fields with NO LLM call. Pure function, deterministic.
 *
 * The pipeline card renders these inline so the user gets the answer
 * before they finish reading the row. No "click to load AI suggestion"
 * spinners — operational visibility shouldn't be paywalled by quota.
 */
export function computeInsights(wf: MinimalWorkflowForInsight): InsightsResult {
  const services = Array.isArray(wf.services) ? wf.services : [];

  // ── nextBestAction ────────────────────────────────────────────────
  // Walk services in their declared order, find the first non-done one,
  // then the first un-ticked checklist item on that service. That's
  // literally what the human should do next.
  let nextBestAction = '';
  outer: for (const s of services) {
    if (s.status === 'done') continue;
    for (const c of (s.checklist || [])) {
      if (!c.done) {
        const stepText = (c.text || c.title || '').trim();
        if (stepText) {
          nextBestAction = stepText;
          break outer;
        }
      }
    }
    // No un-ticked steps on this active service but it's not marked done.
    // The next action is "mark the service done".
    if ((s.checklist || []).every(c => c.done) && (s.checklist || []).length > 0) {
      nextBestAction = `Mark ${s.label || s.serviceType || 'service'} done`;
      break;
    }
  }

  // ── delayCause ────────────────────────────────────────────────────
  // Translate the health state + blocker into a one-line cause.
  let delayCause = '';
  if (wf.blockerType) {
    if (wf.blockerType === 'waiting_client_input')      delayCause = 'Waiting on client input';
    else if (wf.blockerType === 'waiting_internal_approval') delayCause = 'Waiting on internal approval';
    else if (wf.blockerReason)                          delayCause = wf.blockerReason;
    else                                                delayCause = `Blocked: ${wf.blockerType.replace(/_/g, ' ')}`;
  } else if (wf.health === 'delayed' || wf.health === 'at_risk') {
    delayCause = wf.healthReason || '';
  } else if (wf.health === 'revision') {
    delayCause = wf.healthReason || 'Recent rework';
  } else if (wf.health === 'final_qa') {
    delayCause = 'In final QA';
  }

  // ── predictedCompletionAt ─────────────────────────────────────────
  // Two paths:
  //   1. We have a project `eta` set → trust it.
  //   2. Otherwise extrapolate linearly from progress so far.
  //      If 50% done after 10 elapsed days → predict 20 days from start.
  //      Fall back to null when there's not enough signal (no progress
  //      at all, or workflow is fully done).
  let predictedCompletionAt: Date | null = null;
  const total = services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const done  = services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const allServicesDone = services.length > 0 && services.every(s => s.status === 'done');

  if (allServicesDone) {
    predictedCompletionAt = null;
  } else if (wf.eta) {
    predictedCompletionAt = new Date(wf.eta);
  } else if (total > 0 && done > 0 && wf.createdAt) {
    const startMs = new Date(wf.createdAt).getTime();
    const elapsed = Math.max(1, Date.now() - startMs);  // avoid div-by-zero
    const pct = done / total;
    const projectedTotal = elapsed / pct;
    predictedCompletionAt = new Date(startMs + projectedTotal);
  }

  // ── riskScore (0-100) ─────────────────────────────────────────────
  // Composite of independent risk sources, capped at 100.
  let risk = 0;
  const now = Date.now();

  // Blocker → big chunk of risk.
  if (wf.blockerType) risk += 40;

  // Past or approaching ETA.
  if (wf.eta) {
    const etaMs = new Date(wf.eta).getTime();
    const daysPast = (now - etaMs) / (24 * 3600 * 1000);
    if (daysPast > 0) {
      // Past ETA: 20 base + 5 per day, cap at 35.
      risk += Math.min(35, 20 + daysPast * 5);
    } else if (daysPast > -3) {
      // ETA within 3 days but not enough progress.
      const pct = total > 0 ? done / total : 0;
      if (pct < 0.6) risk += 15;
    }
  }

  // Inactivity-based.
  if (wf.lastActivityAt) {
    const idleH = (now - new Date(wf.lastActivityAt).getTime()) / (3600 * 1000);
    if (idleH > 72)      risk += 20;
    else if (idleH > 24) risk += 10;
  }

  // Health enum tilts the score.
  if (wf.health === 'delayed') risk += 10;
  if (wf.health === 'revision') risk += 5;

  // Cap at 100.
  const riskScore = Math.max(0, Math.min(100, Math.round(risk)));

  return { riskScore, delayCause, nextBestAction, predictedCompletionAt };
}

// ─── In-memory cache (per-process, TTL) ───────────────────────────────

interface CacheEntry<T> { value: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<any>>();

/**
 * withAICache — wrap an expensive async call with an in-memory TTL cache.
 *
 *   const summary = await withAICache(
 *     `wf-summary:${workflowId}`,
 *     5 * 60_000,
 *     () => callGeminiForSummary(workflow),
 *   );
 *
 * Same key returned within ttlMs gets the cached value. Stale entries are
 * evicted on the next read or by the housekeep tick below. Per-process,
 * so an /api/health restart blows the cache — fine for our scale.
 */
export async function withAICache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await fn();
  _cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Invalidate a cached AI value — call after a mutation that would have
 *  changed the cached output (e.g. completing a service should bust the
 *  cached workflow summary). */
export function bustAICache(key: string): void {
  _cache.delete(key);
}

/** Bust every entry whose key starts with the given prefix. */
export function bustAICachePrefix(prefix: string): void {
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

// Housekeep: drop expired entries every minute so the Map doesn't grow.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) {
    if (v.expiresAt <= now) _cache.delete(k);
  }
}, 60_000).unref?.();

// ─── Per-user rate limit (in-memory token bucket) ─────────────────────

interface Bucket { tokens: number; refilledAt: number }
const _buckets = new Map<string, Bucket>();
const RATE_REQS_PER_MIN = 30;     // generous default — covers 1 call every 2s

/**
 * withRateLimit — guard expensive AI endpoints from a single user spamming
 * them in a loop. Token bucket: 30 tokens, refills 30/min.
 *
 * Throws an error with status=429 attached if the user has exhausted their
 * bucket. Caller can `try/catch` and return 429 → caller toasts the
 * "slow down" message.
 *
 *   try {
 *     const out = await withRateLimit(req.user.id, () => generateSummary());
 *     res.json(out);
 *   } catch (e) {
 *     if ((e as any).status === 429) return res.status(429).json({ error: 'AI rate limit' });
 *     throw e;
 *   }
 */
export async function withRateLimit<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const b = _buckets.get(userId) || { tokens: RATE_REQS_PER_MIN, refilledAt: now };
  // Refill — linear over the last minute.
  const elapsed = (now - b.refilledAt) / 60_000;
  b.tokens = Math.min(RATE_REQS_PER_MIN, b.tokens + elapsed * RATE_REQS_PER_MIN);
  b.refilledAt = now;
  if (b.tokens < 1) {
    _buckets.set(userId, b);
    const err: any = new Error('AI rate limit — try again in a few seconds.');
    err.status = 429;
    throw err;
  }
  b.tokens -= 1;
  _buckets.set(userId, b);
  return fn();
}

// ─── Test helper export ───────────────────────────────────────────────

export const _internal = {
  cacheSize: () => _cache.size,
  bucketSize: () => _buckets.size,
};
