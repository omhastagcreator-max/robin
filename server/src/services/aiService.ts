import Anthropic from '@anthropic-ai/sdk';
import User from '../models/User';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';

/**
 * aiService — single place that talks to Claude.
 *
 * Two reasons every codebase ends up with a wrapper like this:
 *  1. The API key only needs to live in ONE module. If we instantiate the
 *     SDK in every controller, we leak knowledge of "we use Anthropic"
 *     everywhere. With a service, controllers just call generateMorningBrief
 *     and don't care which provider answered.
 *  2. Prompt templates are content. They live next to the data-shaping logic
 *     that feeds them, not next to HTTP routing. When a prompt needs tweaking
 *     (and prompts ALWAYS need tweaking), you edit one file.
 *
 * Model selection note:
 *   We use claude-haiku-4-5 — the small, fast, cheap model. A morning brief
 *   doesn't need PhD-level reasoning, so paying for Sonnet/Opus is wasted
 *   money. Rule of thumb: start on Haiku, only upgrade if quality is bad.
 */

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const MODEL = 'claude-haiku-4-5-20251001';

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
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing on server. Add it on Render → Environment.');
  }

  const ctx = await buildUserContext(userId);

  const system = [
    'You are Robin, a warm, concise productivity coach inside an agency app.',
    'You write short morning briefings for an individual teammate.',
    'Tone: friendly, specific, second-person ("you"), India-context-aware.',
    'Never invent tasks or facts. Only use what the data shows.',
    'No bullet lists, no headings, no markdown. Plain sentences only.',
    'Keep it to 3-4 sentences total — under 80 words.',
  ].join(' ');

  const userPrompt = [
    `Write today's morning briefing for ${ctx.name}.`,
    'Open with a one-line greeting that acknowledges yesterday.',
    'Mention the most important thing they should focus on today (pick from openTasks).',
    'If overdueCount > 0, gently flag it. End with one motivating line.',
    '',
    'DATA:',
    '```json',
    JSON.stringify(ctx, null, 2),
    '```',
  ].join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // The response shape: resp.content is an array of "blocks." For text
  // responses we just want the first text block. (When you use tools,
  // tool-call blocks live here too.)
  const textBlock = resp.content.find((b) => b.type === 'text');
  const content = textBlock && 'text' in textBlock ? textBlock.text : '';

  return {
    content: content.trim(),
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  };
}

// Helpers exported for tests / future features
export const _internal = { buildUserContext, todayKey, MODEL };
export { todayKey };
