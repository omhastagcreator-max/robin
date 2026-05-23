import User from '../models/User';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';
import { callGemini } from './aiTriage';

/**
 * aiService — single place that talks to the AI provider for per-user
 * features like the morning brief.
 *
 * Switched from Anthropic (Claude) to Gemini (May 2026) so the entire
 * app uses ONE provider key (GEMINI_API_KEY) instead of two. The owner
 * reported "ANTHROPIC_API_KEY not configured" on the morning-brief widget
 * — rather than ask them to add a second key, we re-pointed the brief
 * at the Gemini caller everything else already uses.
 *
 * Two reasons the service wrapper still exists:
 *  1. The API key only needs to live in ONE module. callGemini in
 *     aiTriage.ts is the single chokepoint.
 *  2. Prompt templates are content. They live next to the data-shaping
 *     logic that feeds them — when a prompt needs tweaking (and prompts
 *     ALWAYS need tweaking), you edit one file.
 */

const MODEL = 'gemini-2.5-flash';   // descriptive only — aiTriage picks the model

// Date-key in IST (Indian Standard Time). Two users opening the dashboard at
// 11:30pm IST and 12:30am IST should see different "today" briefs.
function todayKey(d = new Date()): string {
  // Convert to IST (UTC+5:30) by adding 330 minutes.
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function formatHours(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ── Pull a user's "context" — the data we feed to Claude ─────────────────────
//
// This is the most important function in the file. The QUALITY of any AI
// feature is bounded by the QUALITY of the context you feed it. Garbage in
// → bland output. Specific, structured input → specific, useful output.
//
// We pull:
//  - The user's name (so the brief feels personal)
//  - Yesterday's worked hours + breaks (signals their day's shape)
//  - Yesterday's completed tasks (what they finished — celebrate this)
//  - Today's open tasks, ranked by overdue → urgent → high → medium → low
//  - Overdue count (sparks urgency in the briefing)
async function buildUserContext(userId: string) {
  const user = await User.findById(userId).select('name email role').lean();

  // "Yesterday" = last 24 hours, so the brief still makes sense if generated
  // mid-morning rather than at midnight on the dot.
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  // Sum up working time from sessions overlapping the last 24h.
  const sessions = await Session.find({
    userId,
    startTime: { $gte: dayAgo },
  }).lean();

  let workedMs = 0;
  let breakMs = 0;
  for (const s of sessions) {
    const start = new Date(s.startTime).getTime();
    const end = s.endTime ? new Date(s.endTime).getTime() : now.getTime();
    workedMs += Math.max(0, end - start);
    for (const b of (s.breakEvents || []) as any[]) {
      if (!b.startedAt) continue;
      const bs = new Date(b.startedAt).getTime();
      const be = b.endedAt ? new Date(b.endedAt).getTime() : now.getTime();
      breakMs += Math.max(0, be - bs);
    }
  }
  const activeMs = Math.max(0, workedMs - breakMs);

  // Tasks completed in the last 24h.
  const completed = await ProjectTask.find({
    assignedTo: userId,
    status: 'done',
    completedAt: { $gte: dayAgo },
  }).select('title priority projectId').lean();

  // Open tasks (pending/ongoing). Sorted by overdue first, then priority.
  const open = await ProjectTask.find({
    assignedTo: userId,
    status: { $in: ['pending', 'ongoing'] },
  })
    .select('title priority dueDate status')
    .sort({ dueDate: 1, priority: -1 })
    .limit(10)
    .lean();

  const overdueCount = open.filter(
    (t: any) => t.dueDate && new Date(t.dueDate).getTime() < now.getTime()
  ).length;

  return {
    name: user?.name || user?.email || 'there',
    workedHours: formatHours(workedMs),
    activeHours: formatHours(activeMs),
    breakHours: formatHours(breakMs),
    completedYesterday: completed.map((t: any) => ({
      title: t.title,
      priority: t.priority,
    })),
    openTasks: open.map((t: any) => ({
      title: t.title,
      priority: t.priority,
      due: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : null,
      status: t.status,
    })),
    overdueCount,
  };
}

// ── The actual Claude call ───────────────────────────────────────────────────
//
// Anatomy of a good prompt:
//   1. SYSTEM message: tells Claude who it is and how to behave. Short, firm.
//      Think of it as "the role / personality."
//   2. USER message: the request + the structured data.
//   3. Output constraints: what shape we want back (length, tone, format).
//
// We pass the data as JSON inside the user message because:
//   - Claude is excellent at reading structured JSON.
//   - It separates "instructions" (English) from "data" (JSON).
//   - If the data has unusual values, JSON quoting prevents prompt injection.
export async function generateMorningBrief(userId: string): Promise<{
  content: string;
  inputTokens: number;
  outputTokens: number;
}> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY missing on server. Add it on Render → robin-api → Environment, then save.');
  }

  const ctx = await buildUserContext(userId);

  const system = [
    'You are Robin, a warm productivity coach inside an agency app.',
    'You write short morning briefings for one teammate.',
    'Tone: HINGLISH — the casual Hindi-English mix the team actually speaks on WhatsApp.',
    'NOT formal Hindi (no "kripaya", "uttam", "namaskar"). NOT pure English.',
    'Use English for things that don\'t translate (Shopify, Meta Ads, task titles).',
    'Hindi-Roman script for the connective tissue.',
    'Address the teammate as "tu" / "tum" / "aap" — pick the most natural register.',
    'Never invent tasks or facts. Only use what the data shows.',
    'No bullet lists, no headings, no markdown. Plain sentences.',
    'Keep it to 3-4 sentences, under 80 words total.',
    '',
    'Sample register (for tone, not content):',
    '"Subah ki dua, Om bhai! Kal 4 tasks complete kiye — solid. Aaj sabse zaroori cheez Velloer Shopify review hai, woh nikaal le pehle. Ek task overdue hai (Darpan pixel install) — usse lunch se pehle clear kar do. Baaki sab manage hai. Chai pee, kaam karo. 💪" — but no emojis, no markdown.',
  ].join('\n');

  const payload = [
    `Write today's morning briefing for ${ctx.name} in Hinglish.`,
    'Open with a warm one-line greeting that acknowledges yesterday.',
    'Mention the most important thing they should focus on today (pick from openTasks).',
    'If overdueCount > 0, gently flag it. End with one motivating line.',
    '',
    'DATA:',
    JSON.stringify(ctx, null, 2),
  ].join('\n');

  const content = await callGemini(system, payload, 400);

  // Gemini's REST response doesn't expose token counts the same way as
  // Anthropic's SDK did. The schema still requires the fields (UI shows
  // a "tokens" debug line for admins) so we return 0 placeholders — UI
  // already tolerates 0 gracefully.
  return {
    content: content.trim(),
    inputTokens:  0,
    outputTokens: 0,
  };
}

// Helpers exported for tests / future features
export const _internal = { buildUserContext, todayKey, MODEL };
export { todayKey };
