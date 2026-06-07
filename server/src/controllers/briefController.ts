import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import Meeting from '../models/Meeting';
import UserBriefAI from '../models/UserBriefAI';
import { nextRecurrence } from './meetingScheduleController';
import { callGemini } from '../services/aiTriage';

/**
 * briefController — per-employee morning + evening brief.
 *
 * Deliberately model-less: we compute the brief on demand from live
 * collections. The cron (jobs/dailyBriefCron) calls computeBrief() to
 * generate the same payload, then writes it as a Notification so the
 * employee sees a bell ding at 9am + 7pm IST.
 *
 * Why no persistence? Two reasons:
 *   1. The data underneath changes — a stored brief goes stale within
 *      minutes. Computing on read avoids "this brief mentions a task
 *      that was already done 20 min ago".
 *   2. Cheap. The queries are O(few-dozen-docs) per employee. Even at
 *      50 employees we're under 100ms total per brief.
 *
 * Shape returned (same for /me and the cron):
 *   { kind: 'morning' | 'evening',
 *     dateIST: 'YYYY-MM-DD',
 *     openTasks: [...top 5],
 *     overdueTasks: [...],
 *     todaysMeetings: [...up to 4],
 *     priorityBrands: [...up to 3 brands I own that are urgent],
 *     accomplishments: [...] // evening only
 *     summary: human-readable one-liner }
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export interface Brief {
  kind: 'morning' | 'evening';
  dateIST: string;
  openTasks: Array<{ id: string; title: string; priority?: string; dueDate?: Date; clientName?: string }>;
  overdueTasks: Array<{ id: string; title: string; daysLate: number; clientName?: string }>;
  todaysMeetings: Array<{ title: string; startTime: Date; clientName?: string }>;
  priorityBrands: Array<{ id: string; name: string; reason: string }>;
  accomplishments: Array<{ id: string; title: string; clientName?: string }>;
  summary: string;
  // Gemini-generated 2-3 sentence paragraph with concrete advice.
  // Populated by getOrGenerateNarrative() lazily; empty string if AI
  // is unreachable (we never fail the brief over an AI hiccup).
  aiNarrative?: string;
}

export async function computeBrief(orgId: string, userId: string, kind: 'morning' | 'evening'): Promise<Brief> {
  const now = new Date();
  const startOfTodayIST = (() => {
    const ist = new Date(now.getTime() + 330 * 60_000);
    const istMid = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0));
    return new Date(istMid.getTime() - 330 * 60_000);
  })();
  const endOfTodayIST = new Date(startOfTodayIST.getTime() + 86_400_000);

  const [openTasksRaw, overdueRaw, oneOffMeets, brandsForMe, completedTodayRaw] = await Promise.all([
    ProjectTask.find({
      organizationId: orgId,
      assignedTo: userId,
      status: { $ne: 'done' },
    }).sort({ priority: -1, dueDate: 1 }).limit(8).lean(),
    ProjectTask.find({
      organizationId: orgId,
      assignedTo: userId,
      status: { $ne: 'done' },
      dueDate: { $exists: true, $ne: null, $lt: now },
    }).sort({ dueDate: 1 }).limit(8).lean(),
    Meeting.find({
      organizationId: orgId,
      status: 'scheduled',
      startTime: { $gte: now, $lt: endOfTodayIST },
      $or: [{ hostUserId: userId }, { attendees: userId }],
    }).sort({ startTime: 1 }).lean(),
    ClientWorkflow.find({
      organizationId: orgId,
      $or: [
        { 'services.assignedTo': userId },
        { currentOwnerId: userId },
        { nextActionOwnerId: userId },
      ],
    }).select('_id clientName priority eta riskScore delayCause daysInactive recurringMeeting').lean(),
    kind === 'evening'
      ? ProjectTask.find({
          organizationId: orgId,
          assignedTo: userId,
          status: 'done',
          completedAt: { $gte: startOfTodayIST, $lt: endOfTodayIST },
        }).sort({ completedAt: -1 }).limit(10).lean()
      : Promise.resolve([] as any[]),
  ]);

  // Enrich tasks with brand names so the brief reads naturally.
  const brandIdToName = new Map(brandsForMe.map(b => [String(b._id), b.clientName || '']));

  const openTasks = openTasksRaw.map((t: any) => ({
    id: String(t._id),
    title: t.title,
    priority: t.priority,
    dueDate: t.dueDate,
    clientName: t.clientWorkflowId ? brandIdToName.get(String(t.clientWorkflowId)) || '' : '',
  })).slice(0, 5);

  const overdueTasks = overdueRaw.map((t: any) => ({
    id: String(t._id),
    title: t.title,
    daysLate: Math.max(1, Math.round((now.getTime() - new Date(t.dueDate).getTime()) / 86_400_000)),
    clientName: t.clientWorkflowId ? brandIdToName.get(String(t.clientWorkflowId)) || '' : '',
  }));

  // Add today's recurring brand meetings.
  const todaysMeetings: Brief['todaysMeetings'] = oneOffMeets.map((m: any) => ({
    title: m.title,
    startTime: m.startTime,
    clientName: '',
  }));
  for (const b of brandsForMe) {
    const rm: any = (b as any).recurringMeeting || {};
    const next = nextRecurrence(rm.dayOfWeek, rm.timeIST, now);
    if (next && next < endOfTodayIST && next > now) {
      todaysMeetings.push({
        title: rm.label || `${b.clientName} sync`,
        startTime: next,
        clientName: b.clientName || undefined,
      });
    }
  }
  todaysMeetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Priority brands — top 3 with urgent priority or high risk score.
  const priorityBrands = brandsForMe
    .map((b: any) => ({
      id: String(b._id), name: b.clientName || 'Brand',
      _rank: (b.priority === 'urgent' ? 100 : b.priority === 'high' ? 70 : 0) + (b.riskScore || 0),
      reason: b.delayCause || (b.priority === 'urgent' ? 'Urgent priority' : 'High priority'),
    }))
    .filter(b => b._rank >= 60)
    .sort((a, b) => b._rank - a._rank)
    .slice(0, 3)
    .map(({ _rank, ...rest }) => rest);

  const accomplishments = completedTodayRaw.map((t: any) => ({
    id: String(t._id),
    title: t.title,
    clientName: t.clientWorkflowId ? brandIdToName.get(String(t.clientWorkflowId)) || '' : '',
  }));

  // One-line summary. Plain English — the UI shows this on the brief
  // card under the title before the user expands the lists.
  const summary = kind === 'morning'
    ? buildMorningSummary(openTasks.length, overdueTasks.length, todaysMeetings.length, priorityBrands.length)
    : buildEveningSummary(accomplishments.length, openTasks.length, overdueTasks.length);

  return {
    kind,
    dateIST: istDate(now),
    openTasks,
    overdueTasks,
    todaysMeetings: todaysMeetings.slice(0, 4),
    priorityBrands,
    accomplishments,
    summary,
  };
}

/**
 * getOrGenerateNarrative — returns the cached Gemini paragraph for
 * (user, day, kind), or generates + caches a new one.
 *
 * Prompt design:
 *   - System prompt fixes Robin's voice: warm, direct, agency-internal,
 *     uses first names, ends with ONE concrete suggestion. Two sentences
 *     max for morning ("focus on X"), three for evening ("you closed
 *     X; tomorrow start with Y"). No emojis (agency owner is allergic).
 *   - Payload is the structured brief, plus the user's first name.
 *   - maxOutputTokens kept tight (180) — the paragraph should be
 *     scannable, not a wall of text.
 *
 * The cache key is (userId, dateIST, kind). A second call within the
 * same day for the same kind returns the cached paragraph instantly.
 * The dailyBriefCron warms the cache at 9am + 7pm so the page never
 * waits on Gemini.
 *
 * Failure mode: if Gemini is unreachable / billed-out / blocked, we
 * log a warning and return an empty string. The structured brief
 * still renders — the UI hides the AI section when narrative is empty.
 */
export async function getOrGenerateNarrative(orgId: string, userId: string, brief: Brief, firstName?: string): Promise<string> {
  // 1. Cache hit?
  const cached = await UserBriefAI.findOne({
    userId, dateIST: brief.dateIST, kind: brief.kind,
  }).lean();
  if (cached?.narrative) return cached.narrative;

  // 2. Build the payload — tight, structured, no chit-chat.
  const payload = JSON.stringify({
    employeeFirstName: firstName || 'there',
    kind: brief.kind,
    openTasksCount:    brief.openTasks.length,
    overdueTasksCount: brief.overdueTasks.length,
    meetingsTodayCount: brief.todaysMeetings.length,
    priorityBrandCount: brief.priorityBrands.length,
    accomplishmentsCount: brief.accomplishments.length,
    overdueExamples:   brief.overdueTasks.slice(0, 3).map(t => `${t.title} (${t.daysLate}d late)`),
    openExamples:      brief.openTasks.slice(0, 3).map(t => `${t.title}${t.clientName ? ' for ' + t.clientName : ''}`),
    meetingsToday:     brief.todaysMeetings.slice(0, 3).map(m => m.title),
    priorityBrands:    brief.priorityBrands.slice(0, 3).map(b => `${b.name} — ${b.reason}`),
    finishedToday:     brief.accomplishments.slice(0, 4).map(a => a.title),
  });

  const system = brief.kind === 'morning'
    ? `You are Robin, an agency operations assistant writing a morning brief for one team member.
Write TWO short, warm sentences using their first name. Be direct, not chirpy.
Sentence 1: state what their day looks like at a glance.
Sentence 2: one specific, concrete suggestion of what to start with — name a brand or task by name.
No emojis. No exclamation marks. No "good morning" preamble (the UI already says that).
Max ~50 words total.`
    : `You are Robin, an agency operations assistant writing an end-of-day digest for one team member.
Write TWO or THREE short, warm sentences using their first name. Be direct, not chirpy.
Sentence 1: acknowledge what they finished (name the work).
Sentence 2: flag what didn't move or is still overdue.
Sentence 3 (only if relevant): one suggestion of what to start with tomorrow.
No emojis. No exclamation marks. Max ~60 words total.`;

  let narrative = '';
  try {
    narrative = (await callGemini(system, payload, 180)).trim();
  } catch (err) {
    console.warn(`[brief] AI narrative failed for ${userId}:`, (err as Error).message);
    return '';
  }
  if (!narrative) return '';

  // 3. Cache it. Upsert so two concurrent first-loads don't race.
  try {
    await UserBriefAI.findOneAndUpdate(
      { userId, dateIST: brief.dateIST, kind: brief.kind },
      { $set: { organizationId: orgId, narrative } },
      { upsert: true, new: true },
    );
  } catch { /* unique-index race — fine, the other write won */ }
  return narrative;
}

function buildMorningSummary(open: number, overdue: number, meetings: number, brands: number): string {
  const parts: string[] = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (open)    parts.push(`${open} open ${open === 1 ? 'task' : 'tasks'}`);
  if (meetings) parts.push(`${meetings} ${meetings === 1 ? 'meeting' : 'meetings'} today`);
  if (brands)  parts.push(`${brands} ${brands === 1 ? 'brand' : 'brands'} needing focus`);
  return parts.length ? `Today: ${parts.join(' · ')}` : 'Today: clear deck. Pick up something new.';
}

function buildEveningSummary(done: number, open: number, overdue: number): string {
  const parts: string[] = [];
  if (done)    parts.push(`Closed ${done} ${done === 1 ? 'task' : 'tasks'}`);
  if (overdue) parts.push(`${overdue} still overdue`);
  if (!done && !overdue && !open) return 'Quiet day. No tasks moved or due.';
  if (open && !done) parts.push(`${open} ${open === 1 ? 'task' : 'tasks'} open`);
  return parts.join(' · ');
}

/**
 * GET /api/brief/me?kind=morning|evening
 *
 * Returns the live-computed brief for the caller. The UI polls this on
 * the WorkroomHome load + on each focus. The cron writes a Notification
 * with this same payload at 9am + 7pm IST.
 */
export async function getMyBrief(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrgId(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const ist = new Date(Date.now() + 330 * 60_000);
    const kind = (req.query.kind as 'morning' | 'evening')
      || (ist.getUTCHours() >= 17 ? 'evening' : 'morning');
    const brief = await computeBrief(orgId, me, kind);

    // Attach Gemini paragraph (cached per IST day). Best-effort: any
    // failure leaves aiNarrative empty and the UI hides that section.
    const u = await User.findById(me).select('name email').lean();
    const firstName = (u?.name || u?.email || '').split(/[\s@]/)[0];
    brief.aiNarrative = await getOrGenerateNarrative(orgId, me, brief, firstName);
    res.json(brief);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
