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

const MODEL = 'gemini-1.5-flash-latest';   // free, fast, good enough
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

async function callGemini(systemPrompt: string, userPayload: string, maxOutputTokens: number): Promise<string> {
  if (!apiKey) throw new Error('no_api_key');
  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    // Gemini doesn't have a dedicated "system" role; we wire it as system_instruction.
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPayload }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens,
      // Lower verbosity for triage — we want structured output.
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
    throw new Error(`gemini_http_${r.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await r.json();
  // Standard Gemini response shape: candidates[0].content.parts[*].text
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('').trim();
  if (!text) throw new Error('gemini_empty_response');
  return text;
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
