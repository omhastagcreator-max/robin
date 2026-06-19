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

// ─── Robin product knowledge ─ used by the Ask-Robin chat. We pre-bake
// the full feature list + role matrix so Gemini doesn't hallucinate
// features that don't exist. Update this when shipping new features.
const ROBIN_DOCS = `
ROBIN — AGENCY MANAGEMENT TOOL
URL: robin.hastagcreator.com

ROLES & WHO USES WHAT:
- admin (e.g. Rahul) — full access. Owns Admin → Dashboard / Employees / Clients /
  Projects / Reports / Leave Approvals / Attendance / Crash Logs / Issues + AI.
- employee (e.g. Om, devs) — Dashboard, Tasks, Workroom, Team Calendar,
  Client Schedule, Project Pipeline, Vault, Group Chat, Leaves, Profile.
- sales (e.g. Rishi) — same as employee PLUS the Sales CRM kanban
  ("/sales") with lead scoring; can create new project pipelines.
- workroom (e.g. Janvi, Bhavna) — MINIMAL access: a tiny WorkroomHome
  dashboard + the Work Room (huddle). They can clock in / take breaks,
  but no tasks, no clients, no pipeline.
- client — external. Sees their own dashboard with project status + ad
  reports. No internal pages.

KEY FEATURES (top-level):
1. Work Room — agency-wide audio + screen-share huddle via LiveKit. Mic
   permission required. Click anywhere to resume sharing if it dies.
2. Project Pipeline (formerly Client Pipeline) — kanban of every client
   project, columns Website / Meta / Influencer / All Done. Each card
   shows last-update comment and a stage dropdown. Every checklist tick
   REQUIRES a 3+ char comment for the audit log. AI status snapshot
   per workflow and a "Brief all projects" button summarize state.
3. Sales CRM — leads kanban. New leads auto-get an AI hot/warm/cold
   score with a next-action suggestion (one-click "call today and ask
   about budget" style). Drag leads between 11 stages.
4. Tasks — assign, prioritize, status pending/ongoing/done.
5. Team Calendar — who's on what when.
6. Client Schedule — daily list of which clients each teammate serves.
7. Vault — encrypted client credentials.
8. Meta Ads — daily ad reports, public share links, summaries.
9. Issues + AI — admin clusters of user-reported bugs/questions with
   Gemini-suggested workarounds.
10. Onboard Workroom — admin or anyone flagged canManageWorkroom (Om
    has this by default) can create huddle-only employees.
11. Cmd-K command palette — jump anywhere.

DAILY HABITS / QUICK ANSWERS:
- "Where's my screen sharing button?" — Work Room. Click Share Screen.
- "How do I take a break?" — top bar of every page has Start/Break/End.
- "Why can't I see X?" — usually a role mismatch. Check with admin.
- "Mark stage done?" — open the Project Pipeline card, click the stage
  dropdown, add a short comment, confirm.
- "Auto-resume sharing?" — yes; if your share dies, the red bar at the
  top tells you and any click re-pops the picker.

KNOWN ISSUES / WORKAROUNDS:
- Safari mic prompt → check Safari Settings for This Website → Microphone.
- Huddle stuck connecting → likely WebRTC firewall; try mobile hotspot.
- Logged out unexpectedly → 2-strike 401 guard now in place; usually
  caused by a stale token. Log in once more.
- Meta Ads showing for wrong person → admin granted them the 'meta'
  team; admin can un-tick in Admin → Employees.
`;

function askSystemPrompt(role: string): string {
  const roleHints: Record<string, string> = {
    admin: 'The user is the AGENCY OWNER / ADMIN. Default to operational answers (who, when, how to spot a problem early) over how-to navigation help.',
    employee: 'The user is an EMPLOYEE (likely a developer or team lead). Default to "where in Robin do I do X" answers with concrete clicks.',
    sales: 'The user is in SALES. They live in the Sales kanban and the Project Pipeline. Default to lead-management and pipeline workflow answers.',
    workroom: 'The user is a WORKROOM-ONLY teammate (huddle + tiny dashboard, nothing else). Tell them honestly when something is not in their UI and point them to admin if they need it.',
    client: 'The user is an EXTERNAL CLIENT. Stay strictly inside what their dashboard exposes; never reveal internal-staff features.',
  };
  // Hinglish for internal staff (admin / employee / sales / workroom).
  // Client users still get English because their dashboard is in
  // English and switching language would confuse them.
  const isInternal = ['admin', 'employee', 'sales', 'workroom'].includes(role || '');
  const languageInstruction = isInternal
    ? `Reply in HINGLISH — the casual Hindi-English mix the team actually speaks. Use English for things that don't translate (Shopify, Meta Ads, dashboard names) but Hindi-Roman script for everything else. NO heavy or formal English words. NO formal Hindi (no Sanskritised words like "kripaya", "uttam", "vishesh"). Sound like a teammate texting on WhatsApp, not a textbook. Examples of the right tone: "Bhai 3 leads aaj hot hain", "Velloer ka payment pending hai — client se follow up kar", "Darpan ka shopify almost done, bas 3 step bache".`
    : `Reply in clear, simple English. Short words. No jargon.`;

  return `You are Robin AI, the helpful in-app assistant for agency staff at robin.hastagcreator.com.

${ROBIN_DOCS}

The current user's role is: ${role || 'unknown'}.
${roleHints[role] || ''}

${languageInstruction}

Answer in 1-3 short paragraphs. No markdown headers, no code blocks unless absolutely required, no emojis. Address the user as "you" / "tu" / "aap" (match the team's casual register).

YOU ALSO WORK AS A GENERAL-PURPOSE AI ASSISTANT. If the user asks something outside Robin's operational scope — a general knowledge question, a math problem, a writing or coding task, an idea / explanation — answer it normally like ChatGPT or Gemini would. Don't redirect them or say "I can only help with Robin." Pick the most helpful answer for what they actually asked. Stay in the language register above (Hinglish for internal staff, English for clients).

When the question IS operational (about projects / leads / tasks / their day), be specific: name the sidebar item, the button, the client. If the question is asking for something Robin can't do as a feature, say so honestly. If the message reads as a bug report rather than a how-to, tell them to use the Report Issue tab.`;
}

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
  const body: any = {
    // Gemini doesn't have a dedicated "system" role; we wire it as system_instruction.
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPayload }] }],
    generationConfig: {
      temperature: 0.3,
      // Bump a little so 2.5's "thinking" tokens don't starve the actual
      // text response. 2.5 Flash reserves a slice of maxOutputTokens for
      // internal reasoning before producing output — at very low budgets
      // (e.g. 16) the budget can be entirely consumed by thinking and
      // the visible response comes back empty.
      maxOutputTokens: Math.max(maxOutputTokens, 256),
      responseMimeType: 'text/plain',
      // Disable thinking on models that support it (Gemini 2.5 family).
      // Ignored by 2.0 / 1.5 silently. Triage and quick Q&A don't need
      // deep reasoning; this makes responses faster, cheaper, and ensures
      // every output token is real text.
      thinkingConfig: { thinkingBudget: 0 },
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
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('').trim();
  if (!text) {
    // Surface the EXACT reason so we don't lose context in the next round
    // of debugging. SAFETY = content blocked by Gemini's safety filters;
    // MAX_TOKENS = output cut off before text was emitted; RECITATION =
    // refused because output too closely matches copyrighted material.
    const finishReason = candidate?.finishReason || 'NO_CANDIDATE';
    const safetyRatings = candidate?.safetyRatings ? JSON.stringify(candidate.safetyRatings).slice(0, 200) : '';
    throw new Error(`gemini_empty_response (${model}): finishReason=${finishReason}${safetyRatings ? ' safety=' + safetyRatings : ''}`);
  }
  return text;
}

export async function callGemini(systemPrompt: string, userPayload: string, maxOutputTokens: number): Promise<string> {
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
      // 404 = "model not found" → try the next one. Same for 400 with
      // a model-not-supported body. 503 = model overloaded (Google's
      // gemini-2.5-flash spikes are common around peak hours) — also
      // try the next model; the smaller flash variants are often free
      // when the headline one isn't.
      // 5xx (other) = transient — fall back too.
      // 403 = bad key, 429 = rate limit on OUR key — those WOULD fail
      // on every model so don't bother.
      const isOverloaded     = msg.includes('gemini_http_503') || msg.toLowerCase().includes('unavailable');
      const isTransient5xx   = /gemini_http_5\d\d/.test(msg);
      const isModelNotFound  =
        msg.includes('gemini_http_404') ||
        msg.includes('gemini_http_400') ||
        msg.includes('not found') ||
        msg.toLowerCase().includes('not supported');
      const shouldFallback = isOverloaded || isTransient5xx || isModelNotFound;
      if (!shouldFallback) {
        console.error('[aiTriage] hard error, not falling back:', msg);
        throw lastErr;
      }
      // Demote 503/5xx logs from error → warn so they don't bury real
      // issues in the log stream. They happen often and are not our
      // bug — Google's flash model just spikes around peak hours.
      if (isOverloaded || isTransient5xx) {
        console.warn(`[aiTriage] ${model} overloaded (${msg.match(/gemini_http_\d+/)?.[0] || 'http_5xx'}), trying next model`);
      } else {
        console.warn('[aiTriage] model failed, trying next:', msg);
      }
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
const BRIEF_SYSTEM = `You write the morning briefing for the agency owner / admin in HINGLISH (casual Hindi-English mix the team speaks every day). NOT formal Hindi, NOT pure English. Sound like a teammate giving a quick update on WhatsApp.

Tone: punchy, no hype, no big words, no markdown headers, no emojis. 5-7 short bullet points max.

Open with the things they MUST act on today (hot leads, stuck clients, open issues). End with anything good that happened (closed deals, completed work).

Reply with ONLY plain text. No JSON. No code blocks. Use simple bullets starting with "• ".

Sample tone lines (for register, not content):
• "Riya Mehra hot hai — demo Tuesday confirm karna hai."
• "Velloer ka Meta ads campaign live, abhi data settle hone do."
• "Darpan ka payment pending — Friday tak follow up kar lo."
• "3 tasks aaj overdue hain Om ke paas — uske saath baith lo."`;

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
    const msg = (err as Error).message || '';
    // 503 = Google flash model overloaded — common around peak hours
    // and NOT our bug. Demote to warn so it doesn't bury real issues
    // in log scrape. We still return the deterministic fallback brief
    // below so the cron stays useful.
    if (msg.includes('gemini_http_503') || msg.toLowerCase().includes('unavailable')) {
      console.warn('[morningBrief] Gemini overloaded, using deterministic fallback');
    } else {
      console.error('[morningBrief] failed:', msg);
    }
    // Deterministic fallback — same shape as the no-key branch above so
    // the brief is always actionable even when AI is unreachable.
    const parts: string[] = [];
    parts.push(`• ${snapshot.leadsCreated} new lead${snapshot.leadsCreated === 1 ? '' : 's'} yesterday`);
    if (snapshot.hotLeads.length) parts.push(`• ${snapshot.hotLeads.length} HOT lead${snapshot.hotLeads.length === 1 ? '' : 's'} to call today`);
    if (snapshot.blockedWorkflows.length) parts.push(`• ${snapshot.blockedWorkflows.length} client workflow${snapshot.blockedWorkflows.length === 1 ? '' : 's'} stuck`);
    if (snapshot.openIssues.length) parts.push(`• ${snapshot.openIssues.length} open issue${snapshot.openIssues.length === 1 ? '' : 's'}`);
    parts.push(`• ${snapshot.tasksCompletedYesterday} tasks completed yesterday`);
    if (snapshot.dealsClosed) parts.push(`• ${snapshot.dealsClosed} deal${snapshot.dealsClosed === 1 ? '' : 's'} closed`);
    return { text: parts.join('\n'), aiUsed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Client-update generator — paste-ready paragraph for the client.
//
// What changed (May 2026): the previous version saw only the last 8
// generic activity entries and dropped every per-step audit comment on
// the floor (`checklist[].title` was undefined because the real field
// is `text`). The owner reported AI updates that "looked plausible but
// missed the actual reason a step was slow". This version takes:
//
//   - every checklist step + whether it's done (with the actual text)
//   - every per-step AUDIT COMMENT from WorkflowActivity (the mandatory
//     3-600 char note attached to each tick / untick / completion /
//     return / note). Caller passes them with the team that posted
//     each one so the prompt can attribute the delay to a department.
//   - the structured blocker (type + reason + how long)
//   - the team currently holding the next move
//
// The prompt explicitly asks the model to NAME THE DEPARTMENT where
// any delay sits, using the team labels we pass (Dev / Meta Ads /
// Influencer / Sales / QA), and to lean on real comments verbatim
// rather than guessing.
// ─────────────────────────────────────────────────────────────────────────
const WORKFLOW_SYSTEM = `You write a paste-ready client update for an agency.

You will receive a JSON payload describing one client's project: every service line with its checklist (each step has \`text\`, whether \`done\`, and any \`stepComments\` left by the team when they ticked/unticked/finished it), the structured blocker if any, and which DEPARTMENT currently owns the next move.

Output: ONE short paragraph (50-100 words), plain text, no markdown, no bullets, no greeting / sign-off. Inside the paragraph you must:

1. Say what's already done (services and roughly how far).
2. Say what's in progress.
3. If something is delayed or stuck, name the responsible DEPARTMENT explicitly using the friendly label we provided (e.g. "delayed on the Dev side", "the Meta Ads team is waiting on…", "Influencer side is mid-shoot"). NEVER use internal team codes like 'meta', 'qa', 'development' — use the friendly label.
4. Use the real \`stepComments\` and \`blockerReason\` text verbatim or near-verbatim when they explain a delay. Don't invent reasons.
5. End with the single most useful next thing — phrased the way you'd say it to the client (e.g. "we'll send the next update on Friday once campaigns have a week of data").

Tone: calm, honest, no hype, no apology unless the data clearly demands one. If everything is on track, say so simply.`;

interface WorkflowSummaryInput {
  clientName?: string;
  blockerType?:   string;
  blockerReason?: string;
  blockedSince?:  string | Date | null;
  currentOwnerTeam?: string;        // raw code: sales / development / meta / influencer / qa
  services: Array<{
    label?: string;
    serviceType: string;
    status: string;
    /** Friendly department label, e.g. "Dev" / "Meta Ads" / "Influencer". */
    departmentLabel?: string;
    checklist?: Array<{ text?: string; title?: string; done: boolean }>;
    /** Per-step audit comments — keyed by checklist index. */
    stepComments?: Array<{ index: number; text: string; actorTeam?: string; at?: string | Date }>;
  }>;
  /** All free-form activity-log notes (no checklist tie-in). Caller passes
   *  these directly so the model can see the team's running commentary. */
  notes?: Array<{ at?: string | Date; actorTeam?: string; text: string }>;
}

// Map a team code → friendly client-facing department name. The model
// is also told via the system prompt to use these.
function departmentLabel(team?: string): string {
  switch ((team || '').toLowerCase()) {
    case 'sales':       return 'Sales';
    case 'development': return 'Dev';
    case 'meta':        return 'Meta Ads';
    case 'influencer':  return 'Influencer';
    case 'qa':          return 'QA';
    default:            return '';
  }
}

export async function summarizeWorkflow(wf: WorkflowSummaryInput): Promise<{ text: string; aiUsed: boolean }> {
  if (!apiKey) {
    return { text: 'AI updates are not set up yet. Ask your admin to add GEMINI_API_KEY on the server.', aiUsed: false };
  }
  try {
    const payload = JSON.stringify({
      clientName:    wf.clientName || 'Unnamed client',
      ownerDepartment: departmentLabel(wf.currentOwnerTeam),
      blocker: wf.blockerType ? {
        type:   wf.blockerType,
        reason: wf.blockerReason || '',
        since:  wf.blockedSince || null,
      } : null,
      services: (wf.services || []).map(s => ({
        name:      s.label || s.serviceType,
        status:    s.status,
        department: s.departmentLabel || departmentLabel((s as any).team) || '',
        steps: (s.checklist || []).map((c, i) => ({
          step: c.text || c.title || `Step ${i + 1}`,
          done: !!c.done,
        })),
        stepComments: (s.stepComments || []).map(c => ({
          step:       c.index,
          comment:    c.text,
          department: departmentLabel(c.actorTeam) || '',
          at:         c.at || null,
        })),
      })),
      notes: (wf.notes || []).map(n => ({
        department: departmentLabel(n.actorTeam) || '',
        text:       n.text,
        at:         n.at || null,
      })),
    });
    const text = await callGemini(WORKFLOW_SYSTEM, payload, 400);
    return { text: text.trim(), aiUsed: true };
  } catch (err) {
    console.error('[summarizeWorkflow] failed:', (err as Error).message);
    return { text: 'Could not generate the client update just now. Try again in a moment.', aiUsed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Brief ALL projects — one Gemini call summarizing every active workflow.
// Used by the "Brief all projects" button on the Project Pipeline page.
// Returns a tight paragraph the owner reads at a glance.
// ─────────────────────────────────────────────────────────────────────────
const ALL_PROJECTS_SYSTEM = `You write a single-paragraph status update covering every active project at the agency, in HINGLISH (casual Hindi-English mix the team speaks). NOT formal Hindi, NOT pure English. Read like a quick WhatsApp update.

Output: one paragraph, 80-180 words, plain text, no markdown, no bullets, no emojis, no heavy words. Name clients by name. Open with anything stuck or behind, then who's moving well, then a one-line "is hafte ka focus" closer. Be specific — don't say "sab theek hai" without naming who.

If there are zero projects, say so in one sentence.

Sample register: "Vellore ka Shopify done, Meta ads campaign live, ab data settle ho raha hai. Darpan abhi development side pe hai — 3 step bache hain. Oudfy ka payment gateway pending, baaki sab ready. Is hafte focus Oudfy payment + Darpan handover."`;

export async function summarizeAllProjects(projects: Array<{
  clientName?: string;
  services: Array<{ label?: string; serviceType: string; status: string; pct: number; remaining: number }>;
  lastUpdate?: string;
}>): Promise<{ text: string; aiUsed: boolean }> {
  if (!apiKey) {
    return { text: 'AI brief not configured. Add GEMINI_API_KEY on the server.', aiUsed: false };
  }
  if (!projects.length) {
    return { text: 'No active projects right now — onboard a client to get started.', aiUsed: false };
  }
  try {
    const payload = JSON.stringify({
      projectCount: projects.length,
      projects: projects.map(p => ({
        client: p.clientName || 'Unnamed',
        services: p.services.map(s => ({
          name: s.label || s.serviceType, status: s.status, pct: s.pct, remaining: s.remaining,
        })),
        lastUpdate: p.lastUpdate || null,
      })),
    });
    const text = await callGemini(ALL_PROJECTS_SYSTEM, payload, 400);
    return { text: text.trim(), aiUsed: true };
  } catch (err) {
    console.error('[summarizeAllProjects] failed:', (err as Error).message);
    return { text: 'AI brief generation failed. Try again in a moment.', aiUsed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Command parser — lets users tell Robin AI "do X" instead of clicking
// through Robin's UI. Gemini classifies the intent + returns structured
// args; the frontend confirms and dispatches to the relevant API. ONLY
// the actions listed below are supported — anything else gets parsed as
// "unsupported" and we politely tell the user.
// ─────────────────────────────────────────────────────────────────────────
const COMMAND_SYSTEM = `You are Robin AI's command parser. The user typed something — figure out if it's an ACTION (do something) or a QUESTION (info request).

Reply with ONLY valid JSON, no markdown, in this exact shape:
{
  "isAction":  true | false,
  "action":    "create_task" | "update_task" | "mark_task_done" | "mark_workflow_done" | "mark_service_done" | "schedule_meeting" | "update_lead" | "mark_lead_won" | "mark_lead_lost" | "add_lead_note" | "mark_lead_payment" | "start_day" | "end_day" | "take_break" | "resume_work" | "join_huddle" | "leave_huddle" | "brief_workflow" | "brief_all_projects" | "employee_report" | "unsupported" | "question",
  "params":    { ...action-specific keys... },
  "confirm":   one short sentence describing what you'll do, in second person ("I'll mark the … task done"),
  "userReply": only set when action="question" or "unsupported" — what to say back to the user
}

TASK ACTIONS:
- create_task         → params: { title: string, priority?: "low"|"medium"|"high"|"urgent", dueDate?: "YYYY-MM-DD" }
- update_task         → params: { match: string, priority?: "low"|"medium"|"high"|"urgent", dueDate?: "YYYY-MM-DD", status?: "pending"|"ongoing"|"done", title?: string }
                        \`match\` = a short text snippet from the existing task's title or its
                        project name that lets the server find it. Only set the params the
                        user actually wants changed.
- mark_task_done      → params: { match: string }   (alias for update_task with status="done")

PROJECT ACTIONS:
- mark_workflow_done  → params: { clientName: string }
- mark_service_done   → params: { clientName: string, serviceType: "shopify" | "meta_ads" | "influencer" }
- schedule_meeting    → params: { title: string, startTime: ISO-8601-string, endTime: ISO-8601-string, clientName?: string, description?: string }
                        Resolve relative times ("tomorrow 3pm", "Friday morning") to
                        actual ISO timestamps using TODAY's date in IST. Default
                        duration if user didn't say: 30 minutes.

SESSION + HUDDLE ACTIONS (no params; the user is acting on themselves):
- start_day    → params: {}     (== Log In: starts work session + joins huddle)
- end_day      → params: {}     (== Log Out: leaves huddle + ends work session)
- take_break   → params: {}
- resume_work  → params: {}
- join_huddle  → params: {}
- leave_huddle → params: {}

AI-SUMMARY ACTIONS (Robin runs an existing AI flow on the user's behalf):
- brief_workflow      → params: { match: string }
                        \`match\` is the client / project name. Fires the same
                        Gemini flow as the "Generate client update" button on
                        the workflow detail page. e.g. "brief me on Vellore"
- brief_all_projects  → params: {}
                        Fires the "Brief all projects" flow that summarises
                        every active client in one paragraph.
- employee_report     → params: { match: string, periodDays?: number }
                        Generates the 7-day (or N-day) AI report for one
                        employee. Admin only. \`match\` matches against
                        User.name. e.g. "give me a 7-day report on Om".

LEAD ACTIONS:
- update_lead         → params: { match: string, stage?: string, aiScore?: "hot"|"warm"|"cold", nextFollowUp?: "YYYY-MM-DD", estimatedValue?: number }
                        \`match\` matches against lead name / company / phone / email.
                        Valid stage values: new_lead, dialed, connected, demo_booked,
                        demo_done, demo2_conversion, follow_up, hot_follow_up, cooking.
- mark_lead_won       → params: { match: string, wonAmount?: number }
- mark_lead_lost      → params: { match: string, reason?: string }
- add_lead_note       → params: { match: string, text: string }
- mark_lead_payment   → params: { match: string, paymentStatus: "part_paid"|"full_paid"|"refunded", amount?: number, total?: number, note?: string }
                        \`note\` is the WHAT-TRIGGERS-THE-NEXT-PAYMENT sentence the rep
                        wants stored ("balance 50% after Shopify goes live"). If the user
                        just says "fully paid" without an amount, set paymentStatus="full_paid"
                        and leave amount unset.

If the user is asking a HOW-TO or status question, set isAction=false, action="question", userReply=null (handled elsewhere).
If the user wants something we don't support (delete a user, generate a report, edit a price, etc.), set action="unsupported" and userReply tells them politely.

NEVER invent params. If the user said "mark project done" without a client name, set isAction=true, action="mark_workflow_done", params={} (empty), and confirm asks "which client?"

EXAMPLES:
- "Push the Velloer Shopify review to next Monday" → update_task, match: "Velloer Shopify review", dueDate: <next Monday>
- "Bump Darpan pixel install to high priority" → update_task, match: "Darpan pixel install", priority: "high"
- "Mark the Oudfy payment task done" → mark_task_done, match: "Oudfy payment"
- "Move Riya Mehra to demo done" → update_lead, match: "Riya Mehra", stage: "demo_done"
- "Mark Aanya Aesthetics hot" → update_lead, match: "Aanya Aesthetics", aiScore: "hot"
- "We won the Karan Crafts deal at 30000" → mark_lead_won, match: "Karan Crafts", wonAmount: 30000
- "Karan lost — chose a competitor" → mark_lead_lost, match: "Karan", reason: "chose a competitor"
- "Add a note to Vellore lead: called back, demo Thursday" → add_lead_note, match: "Vellore", text: "called back, demo Thursday"
- "Remind me to follow up Aanya on Friday" → update_lead, match: "Aanya", nextFollowUp: <next Friday>
- "Vellore part payment done 15k, balance 50% after Shopify launch" → mark_lead_payment, match: "Vellore", paymentStatus: "part_paid", amount: 15000, note: "balance 50% after Shopify launch"
- "Karan Crafts paid full 30000" → mark_lead_payment, match: "Karan Crafts", paymentStatus: "full_paid", amount: 30000, total: 30000
- "Riya took the deposit — 10k, full deal is 40k" → mark_lead_payment, match: "Riya", paymentStatus: "part_paid", amount: 10000, total: 40000
- "Log me in for the day" / "Start the day" / "Clock me in" → start_day
- "Log me out" / "End the day" / "I'm done for today" → end_day
- "I'm taking a break" / "Going for lunch" → take_break
- "I'm back" / "Resume work" → resume_work
- "Join the huddle" / "Hop into the huddle" → join_huddle
- "Leave the huddle" / "Drop the huddle" → leave_huddle
- "Brief me on Vellore" / "What's the status of Darpan?" / "Generate client update for Oudfy" → brief_workflow, match: <client name>
- "Brief me on every project" / "Summarise all active clients" → brief_all_projects
- "Give me a 7-day report on Om" / "How is Shakshi doing this week?" → employee_report, match: "Om" / "Shakshi", periodDays: 7
- "Mark Vellore Shopify done" / "Close the meta service on Darpan" → mark_service_done, clientName: "Vellore", serviceType: "shopify" | "meta_ads" | "influencer"
- "Schedule a meeting with Velloer team tomorrow 3pm about Shopify launch" → schedule_meeting, clientName: "Velloer", when: "tomorrow 3pm", title: "Shopify launch"`;

export interface CommandResult {
  isAction: boolean;
  action: 'create_task' | 'update_task' | 'mark_task_done' | 'mark_workflow_done' | 'mark_service_done' | 'schedule_meeting' | 'update_lead' | 'mark_lead_won' | 'mark_lead_lost' | 'add_lead_note' | 'mark_lead_payment' | 'start_day' | 'end_day' | 'take_break' | 'resume_work' | 'join_huddle' | 'leave_huddle' | 'brief_workflow' | 'brief_all_projects' | 'employee_report' | 'unsupported' | 'question';
  params: Record<string, any>;
  confirm: string;
  userReply: string | null;
  aiUsed: boolean;
}

export async function parseCommand(message: string): Promise<CommandResult> {
  const fallback: CommandResult = {
    isAction: false, action: 'question', params: {}, confirm: '', userReply: null, aiUsed: false,
  };
  if (!apiKey) return fallback;
  try {
    let raw = await callGemini(COMMAND_SYSTEM, message, 400);
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);
    return {
      isAction:  !!parsed.isAction,
      action:    parsed.action || 'question',
      params:    parsed.params || {},
      confirm:   String(parsed.confirm   || ''),
      userReply: parsed.userReply ? String(parsed.userReply) : null,
      aiUsed: true,
    };
  } catch (err) {
    console.error('[parseCommand] failed:', (err as Error).message);
    return fallback;
  }
}

/**
 * draftLeadFollowup — write a single follow-up message a salesperson can
 * paste into WhatsApp or email. Tone-matched to the lead's stage + score.
 *
 * Falls back to a templated default when Gemini isn't configured so the UI
 * always has *something* to show. Caller is expected to wrap this in
 * withAICache + withRateLimit (see aiInsights).
 */
export async function draftLeadFollowup(input: {
  name?: string;
  company?: string;
  stage?: string;
  aiScore?: string;
  aiNextAction?: string;
  estimatedValue?: number;
  daysSinceLastContact?: number;
  channel?: 'whatsapp' | 'email';
}): Promise<{ message: string; aiUsed: boolean }> {
  const channel = input.channel || 'whatsapp';
  const name    = (input.name || 'there').split(' ')[0];

  // Fallback template — used when no API key OR Gemini errors.
  const fallback = channel === 'whatsapp'
    ? `Hi ${name}, just checking in. Wanted to see if you've had a chance to look at what we discussed. Happy to jump on a quick call this week — what's a good time?`
    : `Hi ${name},\n\nJust following up to see where things stand on your end. Happy to schedule a quick call this week to walk through next steps.\n\nBest,`;

  if (!apiKey) return { message: fallback, aiUsed: false };

  const system = [
    'You write short, professional sales follow-up messages for an Indian digital marketing agency.',
    'Tone: warm, direct, not pushy. Always second-person ("you").',
    `Channel: ${channel}. ${channel === 'whatsapp' ? 'Keep it to 1-2 sentences, conversational, no greeting line.' : 'Keep it under 4 sentences, with a one-line opener and a clear next step.'}`,
    'Never invent specifics not in the data. If the lead is going cold, acknowledge the gap gently — never accuse.',
    'No emojis. No exclamation marks. No "I hope this finds you well".',
    'Output ONLY the message text — no preamble, no JSON, no markdown.',
  ].join(' ');

  const payload = JSON.stringify({
    name:                 input.name             || '',
    company:              input.company          || '',
    stage:                input.stage            || 'new_lead',
    aiScore:              input.aiScore          || 'warm',
    aiNextAction:         input.aiNextAction     || '',
    estimatedValue:       input.estimatedValue   || 0,
    daysSinceLastContact: input.daysSinceLastContact ?? 0,
    channel,
  });

  try {
    const raw = await callGemini(system, payload, 300);
    const message = raw.trim();
    return { message: message || fallback, aiUsed: true };
  } catch (err) {
    console.error('[draftLeadFollowup] failed:', (err as Error).message);
    return { message: fallback, aiUsed: false };
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

    // Role-tailored system prompt — Gemini gets the right framing for
    // whoever is asking. Workroom users get answers scoped to their tiny
    // surface, admin gets operational answers, sales gets pipeline-flavoured
    // ones, etc.
    const answer = await callGemini(askSystemPrompt(context?.userRole || ''), userPayload, 800);
    return { answer: answer.trim(), aiUsed: true };
  } catch (err) {
    console.error('[askRobin] failed:', (err as Error).message);
    return {
      answer: "I couldn't reach the AI service just now. Please try again in a moment, or use the Report Issue tab.",
      aiUsed: false,
    };
  }
}

/**
 * askRobinThread — multi-turn variant used by the persistent Copilot drawer.
 *
 * Takes:
 *   - persona: the role-tuned framing returned by rolePersona() (server/services/robinAI.ts)
 *   - userContext: the compact "what Robin knows about me" snapshot from buildUserContext()
 *   - history: prior turns in this conversation [{role, text}, ...] (already trimmed to N)
 *   - pinnedNote: the user's "always remember this" note, if any
 *   - question: the new user message
 *
 * Returns { answer, aiUsed }. We package the history into the userPayload
 * JSON instead of using Gemini's native multi-turn contents API — keeps
 * tryGeminiOnce() unchanged + works identically across all model versions.
 */
export async function askRobinThread(args: {
  persona:     string;
  userContext: any;
  history:     Array<{ role: string; text: string }>;
  pinnedNote?: string;
  question:    string;
  route?:      string;
}): Promise<{ answer: string; aiUsed: boolean }> {
  if (!apiKey) {
    return {
      answer: "The AI assistant isn't configured yet. Ask your admin to set GEMINI_API_KEY on the server. Free key at https://aistudio.google.com/app/apikey.",
      aiUsed: false,
    };
  }
  try {
    // Match the casual Hinglish register the team uses for internal staff.
    // Clients still get clean English (different code path — askRobin /
    // summarizeWorkflow for client-facing copy).
    const userRole = String(args.userContext?.me?.role || '');
    const isInternal = ['admin', 'employee', 'sales', 'workroom'].includes(userRole);
    const languageInstruction = isInternal
      ? `Reply in HINGLISH — the casual Hindi-English mix the team actually speaks. English for things that don't translate (Shopify, Meta Ads, page names, brand names). Hindi-Roman script for everything else. NO heavy English words ("pursuant", "endeavour", "facilitate"), NO formal/Sanskritised Hindi ("kripaya", "uttam"). Sound like a WhatsApp message from a colleague.

Examples of the right tone:
- "Bhai, 3 leads aaj hot hain. Riya ko pehle call kar."
- "Vellore ka Shopify done hai, Meta ads chal rahe. Sales campaign launch hua kal."
- "Darpan ka payment pending hai — client se follow up kar bhai."`
      : `Reply in clear, simple English. Short words. No jargon.`;

    const system = `You are Robin AI, the persistent in-app assistant at robin.hastagcreator.com. You ARE the user's dedicated AI — remember their prior turns in this conversation, refer back to them naturally, and never start over.

${ROBIN_DOCS}

${args.persona}

${languageInstruction}

The user's profile and live Robin context are included in the next message under "me", "myProjects", "myTasks", "myLeads", "myFocus". When the user asks about "my projects", "my leads", "my tasks", or anything operational about this agency, use ONLY items from those arrays — never invent names.

YOU ALSO WORK AS A GENERAL-PURPOSE AI ASSISTANT. If the user asks something outside Robin's operational scope — a general knowledge question ("capital of France"), a math problem, a writing or coding task, an idea / explanation / brainstorm — answer it normally like ChatGPT or Gemini would. Don't redirect them or say "I can only help with Robin." Pick the most helpful answer for what they actually asked. Stay in the language register above.

Decide between the two modes based on the question itself: if it references the user's projects/leads/tasks/clients (Vellore, Darpan, Oudfy, etc.) it's operational; if it's a standalone question with no agency reference it's general.

Answer in 1-3 short paragraphs. No markdown headers, no code blocks unless required (code-related questions ARE allowed to use code blocks), no emojis. When you reference a project / lead / task, use its exact name from context. If the user's data shows nothing relevant for an operational question, say so — don't fabricate. If asked about a Robin feature that doesn't exist, say so honestly. If the message reads as a bug report, tell them to use the Report Issue tab.`;

    // Pack history + context + new question into a single user payload.
    // Tag the new question with [NEW] so the model knows which turn it's
    // actually responding to (vs. echoes of prior context).
    const payload = JSON.stringify({
      pinnedNote: args.pinnedNote || '',
      currentRoute: args.route || '',
      robinContext: args.userContext,
      conversation: args.history.map(h => ({ from: h.role, text: h.text.slice(0, 1200) })),
      newMessage: args.question,
    });
    const answer = await callGemini(system, payload, 900);
    return { answer: answer.trim(), aiUsed: true };
  } catch (err) {
    console.error('[askRobinThread] failed:', (err as Error).message);
    return {
      answer: "I couldn't reach the AI service just now. Try again in a moment.",
      aiUsed: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Employee report — admin-facing one-click "how is this person doing?"
//
// Built off the same data the structured report uses (sessions, tasks,
// activity, attendance). The AI's job is to TURN A WALL OF NUMBERS INTO
// A SHORT NARRATIVE the admin can scan in 15 seconds. Specifically:
//
//   - Effective working hours over the period (break-credit included).
//   - Break behaviour — calls out "took short breaks" as a positive.
//   - On-call / huddle attendance pattern.
//   - Task throughput vs. assigned.
//   - Anything notable: late starts, no-break days, missed deadlines.
//
// Output is two short paragraphs. No grades, no judgement, no apology.
// ─────────────────────────────────────────────────────────────────────────
const EMPLOYEE_REPORT_SYSTEM = `You write an admin-facing employee status report for the agency owner in HINGLISH (casual Hindi-English mix, NOT formal Hindi, NOT pure English). Sound like a teammate giving the owner a quick read on someone.

You will receive a JSON snapshot of one employee's recent work: per-day session totals (worked, break, on-call), task throughput (completed, ongoing, overdue), activity counts, and pattern flags ("shortBreakDays", "noBreakDays", "lateStartDays", "longBreakDays").

Output: TWO short paragraphs of plain text, no markdown, no bullets, no greeting / sign-off. Roughly 60-120 words total. NO heavy English words, NO Sanskritised Hindi.

Sample register: "Om ne is hafte ~38 ghante kaam kiya, average 7.7/day. Lunch chhota leta hai — 5 me se 4 din 30 min ke andar. Aur 6 me se 9 tasks complete kiye is week."
"Do din late start hua — 11 ke baad. Pattern nahi hai abhi but ek baar pooch lena worth hai. Koi overdue nahi."

Paragraph 1 — the headline. State effective working hours over the period, average per day, and the strongest positive pattern. The break allowance is 1 hour per day; anyone whose typical break is below that is doing the healthy thing — say so directly ("takes short breaks", "doesn't overspend on lunch"). Mention task completion rate when notable.

Paragraph 2 — anything the admin should know. Late starts, no-break days, overdue tasks, low huddle attendance, missed deadlines. Phrase concerns as observations, not accusations ("two days last week started after 11am", not "is consistently late"). If there's nothing concerning, say so honestly — don't manufacture issues.

Tone: factual, calm, no hype. NEVER use internal codes like 'meta' or 'qa' — use the friendly labels we provide ("on the Meta Ads team", "Dev side", etc.).`;

export interface EmployeeReportInput {
  name: string;
  role?: string;
  team?: string;
  periodDays: number;
  // Per-day totals (minutes for human-readability — model will compute hours)
  days: Array<{
    date: string;            // YYYY-MM-DD
    workedMin: number;       // effective working time (break-credit applied)
    grossMin: number;        // total clocked-in time before any deductions
    breakMin: number;
    onCallMin: number;
    huddleMin: number;
    awayMin: number;
    firstStart?: string;     // HH:mm local
    lastEnd?:    string;     // HH:mm local
    sessionCount: number;
  }>;
  // Computed pattern flags so the model doesn't have to do arithmetic.
  patterns: {
    avgWorkedHoursPerDay: number;
    avgBreakMin: number;
    shortBreakDays: number;   // days where break ≤ 30min
    longBreakDays:  number;   // days where break > 75min
    noBreakDays:    number;   // days where break = 0
    lateStartDays:  number;   // days where firstStart > 10:30
    onCallDays:     number;
    huddleDayPct:   number;   // % of days with > 1h huddle attendance
  };
  tasks: {
    completed: number;
    assigned:  number;
    ongoing:   number;
    overdue:   number;
  };
}

export async function generateEmployeeReport(snap: EmployeeReportInput): Promise<{ text: string; aiUsed: boolean }> {
  if (!apiKey) {
    return { text: 'AI reports are not set up yet. Ask your admin to add GEMINI_API_KEY on the server.', aiUsed: false };
  }
  try {
    const payload = JSON.stringify(snap);
    const text = await callGemini(EMPLOYEE_REPORT_SYSTEM, payload, 500);
    return { text: text.trim(), aiUsed: true };
  } catch (err) {
    console.error('[generateEmployeeReport] failed:', (err as Error).message);
    return { text: 'Could not generate the report just now. Try again in a moment.', aiUsed: false };
  }
}
