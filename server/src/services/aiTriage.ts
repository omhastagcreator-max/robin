/**
 * AI-backed triage for user-reported issues.
 *
 * Provider: Google Gemini 1.5 Flash via the REST API. Chosen because:
 *   - Generous **free tier** (15 RPM, ~1M tokens/day) — no card required.
 *   - Quality is fine for classification + short user-facing suggestions.
 *   - Free-tier prompts may be used to improve Google's models; we send
 *     only the user's own bug description, not customer data, so that's
 *     acceptable for an internal agency support tool.
 *
 * We deliberately use raw `fetch` instead of @google/generative-ai so we
 * don't add another npm dependency that could fail Render builds. The
 * provider is swappable — just rewrite the two functions below.
 *
 * Two public functions:
 *
 *   triageIssue(description, context)
 *     → structured classification + user-facing workaround.
 *
 *   askRobin(question, context)
 *     → free-form helpful answer for the "Ask Robin" chat tab.
 *
 * If GEMINI_API_KEY (or GOOGLE_API_KEY) is missing, both return a graceful
 * fallback — the feature still works end-to-end without the key.
 */

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY  ||
  process.env.GOOGLE_GENERATIVE_AI_KEY ||
  '';

// Model name is configurable so we don't have to redeploy when Google
// renames or deprecates a model. We try the env override first, then
// fall back through a list of names that have been valid at various
// points so a stale 1.5-flash deployment auto-heals onto a newer model.
const PREFERRED_MODELS = [
  process.env.GEMINI_MODEL || '',          // explicit override wins
  'gemini-2.5-flash',                      // newest free-tier as of mid-2026
  'gemini-2.0-flash',                      // older but still supported
  'gemini-1.5-flash',                      // legacy fallback
  'gemini-1.5-flash-latest',               // last resort
].filter(Boolean);

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// We remember which model was last known to work and try it first on
// subsequent calls — cuts the latency of the auto-recovery to a single
// attempt after the very first probe.
let stickyModel: string | null = null;

const TRIAGE_SYSTEM = `You are Robin's in-app issue triage assistant for a digital marketing agency tool.

Robin is a MERN web app at robin.hastagcreator.com used by an agency's staff:
- "admin"    — Rahul (owner/manager). Sees everything.
- "employee" — devs and team leads (e.g. Om). Sees tasks, projects, clients, huddle.
- "sales"    — Rishi. Sees the sales kanban + lead pipeline.
- "workroom" — Janvi / Bhavna. ONLY sees a small dashboard + the agency huddle.
- "client"   — external clients of the agency. See their own ad reports.

Known features (this list is what users may complain about):
- Huddle: agency-wide audio/screenshare room (LiveKit). Mic permission required.
- Sales CRM: kanban of leads, drag between stages.
- Client Pipeline: per-client workflow with services (Shopify, Meta Ads, Influencer).
- Tasks, Leaves, Team Calendar, Client Schedule, Vault, Meta Ads reports.
- Cmd-K command palette.

Common known issues + workarounds:
- "Join huddle popup doesn't show on Safari" → Safari settings → Settings for This Website → Microphone, ensure not Deny.
- "Huddle stuck at Connecting" → likely network firewall blocking WebRTC. Suggest mobile hotspot. If persistent, admin should check Render env vars (LIVEKIT_URL/API_KEY/API_SECRET).
- "Logged out unexpectedly" → 401 chain. Log in once more; we have a 2-strike guard.
- "Meta Ads visible to wrong person" → admin granted them the 'meta' team. Admin → Employees → un-tick.
- "Dashboard refreshing every second" → fixed via presence:update throttle. Ask user to hard-refresh.
- "Can't access X page" → role mismatch. Tell them to check with admin.

Reply with ONLY valid JSON in this exact shape, no markdown, no commentary:
{
  "category":       "permission" | "network" | "bug" | "usage" | "other",
  "severity":       "low" | "medium" | "high" | "blocking",
  "area":           short string (e.g. "huddle", "sales", "admin", "pipeline", "auth", "general"),
  "suspectedCause": one sentence in plain English,
  "suggestedFix":   short actionable text shown to the user (1-3 sentences, friendly, second-person),
  "adminNote":      one-line note for the engineer triaging later
}

If you don't know, category="other" and suggestedFix should politely tell the user an admin will look at it. Never invent features that aren't in the list above.`;

const ASK_SYSTEM = `You are Robin's helpful in-app assistant, embedded at robin.hastagcreator.com.

You answer questions from agency staff about how to use Robin. Robin is a MERN web app used by:
- admin (Rahul), employee (Om), sales (Rishi), workroom (Janvi/Bhavna — huddle-only), client.

Features: Huddle (LiveKit), Sales CRM kanban, Client Pipeline, Tasks, Leaves, Team Calendar, Client Schedule, Vault, Meta Ads, Cmd-K palette.

Answer in 1-3 short paragraphs. No markdown headers, no code blocks unless absolutely required, no emojis. Address the user as "you".

If the question is asking for something Robin can't do, say so honestly and suggest contacting their admin. If the question seems like a bug report rather than a how-to, tell them to use the Report Issue tab instead.`;

export interface TriageResult {
  category:       string;
  severity:       string;
  area:           string;
  suspectedCause: string;
  suggestedFix:   string;
  adminNote:      string;
  /** True when Gemini was actually called. False when we fell back. */
  aiUsed:         boolean;
}

async function tryGeminiOnce(model: string, systemPrompt: string, userPayload: string, maxOutputTokens: number): Promise<string> {
  const url = `${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    // Gemini doesn't have a dedicated "system" role; we wire it as system_instruction.
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPayload }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens,
      responseMimeType: 'text/plain',
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`gemini_http_${r.status} (${model}): ${errText.slice(0, 300)}`);
  }

  const json: any = await r.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('').trim();
  if (!text) throw new Error(`gemini_empty_response (${model})`);
  return text;
}

async function callGemini(systemPrompt: string, userPayload: string, maxOutputTokens: number): Promise<string> {
  if (!apiKey) throw new Error('no_api_key');

  // Try the sticky model first — if it worked last time, it'll probably
  // work this time too. Otherwise walk the preferred list.
  const order = stickyModel
    ? [stickyModel, ...PREFERRED_MODELS.filter(m => m !== stickyModel)]
    : PREFERRED_MODELS;

  let lastErr: Error | null = null;
  for (const model of order) {
    try {
      const text = await tryGeminiOnce(model, systemPrompt, userPayload, maxOutputTokens);
      // Lock onto whichever model worked so subsequent calls don't re-walk
      // the list. The list is re-walked on any failure (process restart
      // also resets stickyModel to null).
      if (stickyModel !== model) {
        console.log(`[aiTriage] locked onto model: ${model}`);
        stickyModel = model;
      }
      return text;
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message || '';
      // 404 = "model not found" → try the next one. Same for 400 with a
      // model-not-supported body. Other errors (403 = bad key, 429 =
      // rate limit) shouldn't trigger a fallback — they'd fail on every
      // model.
      const shouldFallback =
        msg.includes('gemini_http_404') ||
        msg.includes('gemini_http_400') ||
        msg.includes('not found') ||
        msg.toLowerCase().includes('not supported');
      if (!shouldFallback) {
        console.error('[aiTriage] hard error, not falling back:', msg);
        throw lastErr;
      }
      console.warn('[aiTriage] model failed, trying next:', msg);
      // Reset sticky model so a permanently-dead one doesn't stay pinned.
      if (stickyModel === model) stickyModel = null;
    }
  }
  throw lastErr || new Error('all_gemini_models_failed');
}

/**
 * Health probe — used by /api/ai-automation/health to surface the exact
 * status (no key / which model is working / what error). Returns a small
 * structured payload, never throws.
 */
export async function aiHealth(): Promise<{
  configured: boolean;
  workingModel: string | null;
  lastError: string | null;
  modelsTried: string[];
}> {
  if (!apiKey) return { configured: false, workingModel: null, lastError: null, modelsTried: PREFERRED_MODELS };
  // Cheap probe: ask for one word.
  try {
    await callGemini('Respond with the single word OK.', 'health-check', 16);
    return { configured: true, workingModel: stickyModel, lastError: null, modelsTried: PREFERRED_MODELS };
  } catch (err) {
    return { configured: true, workingModel: null, lastError: (err as Error).message, modelsTried: PREFERRED_MODELS };
  }
}

export async function triageIssue(description: string, context: any): Promise<TriageResult> {
  if (!apiKey) {
    return {
      category:       'other',
      severity:       'medium',
      area:           'general',
      suspectedCause: '',
      suggestedFix:   "Thanks — we've logged this. An admin will take a look shortly.",
      adminNote:      'AI triage skipped (set GEMINI_API_KEY on the server to enable).',
      aiUsed:         false,
    };
  }

  try {
    const userPayload = JSON.stringify({
      description,
      url:           context?.url           || '',
      userRole:      context?.userRole      || '',
      userAgent:     context?.userAgent     || '',
      recentErrors:  context?.recentErrors  || [],
      recentNetwork: context?.recentNetwork || [],
    });

    let raw = await callGemini(TRIAGE_SYSTEM, userPayload, 600);
    // Strip markdown fences Gemini sometimes adds despite our instructions.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);

    return {
      category:       String(parsed.category       || 'other'),
      severity:       String(parsed.severity       || 'medium'),
      area:           String(parsed.area           || 'general'),
      suspectedCause: String(parsed.suspectedCause || ''),
      suggestedFix:   String(parsed.suggestedFix   || "Thanks — we've logged this."),
      adminNote:      String(parsed.adminNote      || ''),
      aiUsed:         true,
    };
  } catch (err) {
    console.error('[aiTriage] failed:', (err as Error).message);
    return {
      category:       'other',
      severity:       'medium',
      area:           'general',
      suspectedCause: '',
      suggestedFix:   "Thanks — we've logged this. An admin will take a look shortly.",
      adminNote:      `AI triage failed: ${(err as Error).message}`,
      aiUsed:         false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Lead scoring — runs automatically on every new lead so Rishi opens the
// kanban and instantly sees which leads to call first.
// ─────────────────────────────────────────────────────────────────────────
const LEAD_SCORE_SYSTEM = `You are a B2B sales lead-scoring assistant for a digital marketing agency.

Your job: given a lead, rate how hot it is and recommend a single next action.

Score scale (HARD rules):
- "hot"  — clear buying intent: budget mentioned, timeline mentioned, decision-maker, asked for proposal/demo, urgent language ("ASAP", "this week").
- "warm" — interested but not committed: asking questions, comparing options, exploring services.
- "cold" — early or weak signal: just signed up, no clear need, low engagement, ghost likely.

Reply with ONLY valid JSON, no markdown, in this exact shape:
{
  "score":      "hot" | "warm" | "cold",
  "reason":     one short sentence why (under 80 chars),
  "nextAction": one imperative sentence telling the salesperson what to do next (under 100 chars; e.g. "Call today and ask about budget" or "Send the Shopify pricing PDF")
}

If you genuinely can't tell, return "warm" with a sensible exploratory next action.`;

export interface LeadScoreResult {
  score:      'hot' | 'warm' | 'cold';
  reason:     string;
  nextAction: string;
  aiUsed:     boolean;
}

export async function scoreLead(lead: {
  name?: string; email?: string; phone?: string; source?: string;
  stage?: string; estimatedValue?: number; notes?: string; description?: string;
  createdAt?: Date | string;
}): Promise<LeadScoreResult> {
  if (!apiKey) {
    return { score: 'warm', reason: '', nextAction: '', aiUsed: false };
  }
  try {
    const payload = JSON.stringify({
      name:           lead.name           || '',
      email:          lead.email          || '',
      phone:          lead.phone          || '',
      source:         lead.source         || '',
      stage:          lead.stage          || 'new_lead',
      estimatedValue: lead.estimatedValue || 0,
      notes:          (lead.notes || lead.description || '').slice(0, 1200),
      ageHours:       lead.createdAt ? Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 3_600_000) : 0,
    });
    let raw = await callGemini(LEAD_SCORE_SYSTEM, payload, 200);
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);
    const score = ['hot', 'warm', 'cold'].includes(parsed.score) ? parsed.score : 'warm';
    return {
      score,
      reason:     String(parsed.reason     || '').slice(0, 120),
      nextAction: String(parsed.nextAction || '').slice(0, 140),
      aiUsed:     true,
    };
  } catch (err) {
    console.error('[scoreLead] failed:', (err as Error).message);
    return { score: 'warm', reason: '', nextAction: '', aiUsed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Daily morning brief — fires at 8 AM IST as a scheduled job. Reads
// yesterday's activity and writes a concise digest for the admin.
// ─────────────────────────────────────────────────────────────────────────
const BRIEF_SYSTEM = `You write a daily morning briefing for the admin/manager of a digital marketing agency.

Tone: punchy, executive-summary, no hype, no markdown headers, no emojis. 5-7 bullet points max.

Lead with what they MUST act on today (hot leads, blocked clients, open issues). End with light positive context if there is any (closed deals, completed tasks).

Reply with ONLY plain text. No JSON. No code blocks. Use simple bullets starting with "• ".`;

export async function generateMorningBrief(snapshot: {
  date: string;
  leadsCreated: number;
  hotLeads: Array<{ name: string; estimatedValue?: number; nextAction?: string }>;
  blockedWorkflows: Array<{ clientName: string; serviceLabel: string }>;
  openIssues: Array<{ description: string; area: string; severity: string }>;
  sessionsClosed: number;
  tasksCompletedYesterday: number;
  dealsClosed: number;
}): Promise<{ text: string; aiUsed: boolean }> {
  if (!apiKey) {
    // No AI — return a deterministic fallback brief.
    const parts: string[] = [];
    parts.push(`• ${snapshot.leadsCreated} new lead${snapshot.leadsCreated === 1 ? '' : 's'} yesterday`);
    if (snapshot.hotLeads.length) parts.push(`• ${snapshot.hotLeads.length} HOT lead${snapshot.hotLeads.length === 1 ? '' : 's'} to call today`);
    if (snapshot.blockedWorkflows.length) parts.push(`• ${snapshot.blockedWorkflows.length} client workflow${snapshot.blockedWorkflows.length === 1 ? '' : 's'} stuck`);
    if (snapshot.openIssues.length) parts.push(`• ${snapshot.openIssues.length} open issue${snapshot.openIssues.length === 1 ? '' : 's'}`);
    parts.push(`• ${snapshot.tasksCompletedYesterday} tasks completed yesterday`);
    if (snapshot.dealsClosed) parts.push(`• ${snapshot.dealsClosed} deal${snapshot.dealsClosed === 1 ? '' : 's'} closed`);
    return { text: parts.join('\n'), aiUsed: false };
  }
  try {
    const text = await callGemini(BRIEF_SYSTEM, JSON.stringify(snapshot), 600);
    return { text: text.trim(), aiUsed: true };
  } catch (err) {
    console.error('[morningBrief] failed:', (err as Error).message);
    return { text: 'Brief generation failed; see admin dashboard for raw counts.', aiUsed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline workflow summarizer — on-demand "where is this client?" answer.
// ─────────────────────────────────────────────────────────────────────────
const WORKFLOW_SYSTEM = `You summarize the current state of a client onboarding workflow for an agency.

Output: one short paragraph (40-90 words), plain text, no markdown, no bullets. Tell the reader:
1) which service(s) are in progress and how far along
2) what's blocking, if anything
3) the single most useful next action for the team
4) optional: how to phrase it to the client if asked

Tone: factual, concise, no hype.`;

export async function summarizeWorkflow(wf: {
  clientName?: string;
  services: Array<{
    label?: string;
    serviceType: string;
    status: string;
    checklist?: Array<{ done: boolean; title?: string }>;
  }>;
  activity?: Array<{ at?: Date | string; type?: string; detail?: string }>;
}): Promise<{ text: string; aiUsed: boolean }> {
  if (!apiKey) {
    return { text: 'AI summary not configured. Add GEMINI_API_KEY to enable.', aiUsed: false };
  }
  try {
    const payload = JSON.stringify({
      clientName: wf.clientName || 'Unnamed client',
      services: (wf.services || []).map(s => ({
        label:  s.label || s.serviceType,
        status: s.status,
        done:   s.checklist?.filter(c => c.done).length || 0,
        total:  s.checklist?.length || 0,
        remaining: (s.checklist || []).filter(c => !c.done).slice(0, 5).map(c => c.title || ''),
      })),
      recentActivity: (wf.activity || []).slice(-8).map(a => `${a.type || ''}: ${a.detail || ''}`),
    });
    const text = await callGemini(WORKFLOW_SYSTEM, payload, 300);
    return { text: text.trim(), aiUsed: true };
  } catch (err) {
    console.error('[summarizeWorkflow] failed:', (err as Error).message);
    return { text: 'Summary generation failed. Try again in a moment.', aiUsed: false };
  }
}

export async function askRobin(question: string, context: any): Promise<{ answer: string; aiUsed: boolean }> {
  if (!apiKey) {
    return {
      answer: "The AI assistant isn't configured yet. Ask your admin to set GEMINI_API_KEY on the server (free at https://aistudio.google.com/app/apikey). In the meantime you can use the Report Issue tab.",
      aiUsed: false,
    };
  }

  try {
    const userPayload = JSON.stringify({
      question,
      url:      context?.url || '',
      userRole: context?.userRole || '',
    });

    const answer = await callGemini(ASK_SYSTEM, userPayload, 800);
    return { answer: answer.trim(), aiUsed: true };
  } catch (err) {
    console.error('[askRobin] failed:', (err as Error).message);
    return {
      answer: "I couldn't reach the AI service just now. Please try again in a moment, or use the Report Issue tab.",
      aiUsed: false,
    };
  }
}
