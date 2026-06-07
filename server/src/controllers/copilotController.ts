import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';
import { callGemini } from '../services/aiTriage';

/**
 * Copilot — natural-language Q&A over the agency state.
 *
 * Design:
 *   1. POST /api/copilot/ask { question }
 *   2. We build a TIGHT factual snapshot of the org: brand list with
 *      health + owners, recent tasks (open + overdue), team roster.
 *   3. We pass this to Gemini with a system prompt that pins it to
 *      ONLY answer from the snapshot, return a short paragraph + a
 *      list of clickable entities, and refuse questions about anything
 *      outside the snapshot.
 *
 * The snapshot is ~3-5 KB of plain text — well within Gemini's free
 * input budget, easy to cache, easy to debug.
 *
 * Response shape:
 *   { answer: string,            // 1-3 sentence paragraph
 *     entities: [                // referenced entities for click-through
 *       { kind: 'brand' | 'task' | 'employee', id, name, link }
 *     ],
 *     usedSnapshot: { brandCount, taskCount, employeeCount } }
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

interface SnapshotEntity {
  kind: 'brand' | 'task' | 'employee';
  id: string;
  name: string;
  link: string;
}

async function buildSnapshot(orgId: string): Promise<{ text: string; entities: SnapshotEntity[] }> {
  const orgObjId = new mongoose.Types.ObjectId(orgId);
  const [workflows, users, tasks] = await Promise.all([
    ClientWorkflow.find({ organizationId: orgObjId }).select(
      '_id clientName priority healthLevel healthScore healthFactors daysInactive nextBestAction eta services blockerType blockerReason',
    ).lean(),
    User.find({ organizationId: orgObjId, isActive: true, role: { $in: ['admin', 'sales', 'employee'] } })
      .select('_id name role').lean(),
    ProjectTask.find({ organizationId: orgObjId, status: { $ne: 'done' } })
      .select('_id title priority status dueDate assignedTo assignedBy clientWorkflowId').limit(120).lean(),
  ]);

  const entities: SnapshotEntity[] = [];
  const userById = new Map(users.map(u => [String(u._id), u.name || u.role || 'Unknown']));
  const brandById = new Map(workflows.map(w => [String(w._id), w.clientName || '']));

  const lines: string[] = [];

  lines.push('## BRANDS');
  for (const w of workflows.slice(0, 50)) {
    const id = String(w._id);
    const services = (w.services as any[]) || [];
    const ownerIds = Array.from(new Set(services.map(s => String(s.assignedTo || '')).filter(Boolean)));
    const owners = ownerIds.map(o => userById.get(o) || '').filter(Boolean).join(', ');
    const stage = services.find(s => s.status === 'in_progress')?.label
      || services.find(s => s.status !== 'done')?.label || 'Discovery';
    const factors = (w.healthFactors as string[] || []).join(' / ');
    lines.push(
      `- ${w.clientName} | priority=${w.priority || 'medium'} | health=${w.healthLevel} (${w.healthScore}) | stage=${stage} | owners=${owners || 'unassigned'} | idle=${w.daysInactive || 0}d${factors ? ' | issues=' + factors : ''}${w.blockerType ? ' | blocker=' + w.blockerType : ''}`,
    );
    entities.push({ kind: 'brand', id, name: w.clientName || 'Brand', link: `/clients/pipeline/${id}` });
  }

  lines.push('');
  lines.push('## OPEN TASKS (sample, sorted by priority/due)');
  const sortedTasks = tasks.slice().sort((a, b) => {
    const pr = (p: string) => p === 'urgent' ? 3 : p === 'high' ? 2 : p === 'medium' ? 1 : 0;
    const dp = pr(b.priority || '') - pr(a.priority || '');
    if (dp !== 0) return dp;
    return (a.dueDate ? new Date(a.dueDate as any).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate as any).getTime() : Infinity);
  });
  for (const t of sortedTasks.slice(0, 50)) {
    const owner = t.assignedTo ? userById.get(String(t.assignedTo)) : 'unassigned';
    const brand = t.clientWorkflowId ? brandById.get(String(t.clientWorkflowId)) : '';
    const due = t.dueDate ? new Date(t.dueDate as any).toISOString().slice(0, 10) : 'no-due';
    lines.push(`- "${t.title}" | priority=${t.priority || 'medium'} | due=${due} | owner=${owner}${brand ? ' | brand=' + brand : ''}`);
    entities.push({
      kind: 'task', id: String(t._id), name: t.title,
      link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
    });
  }

  lines.push('');
  lines.push('## TEAM');
  for (const u of users) {
    lines.push(`- ${u.name || 'Unknown'} | role=${u.role}`);
    entities.push({ kind: 'employee', id: String(u._id), name: u.name || '', link: '/team' });
  }

  return { text: lines.join('\n'), entities };
}

export async function ask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const question = String(req.body?.question || '').slice(0, 1000).trim();
    if (!question) { res.status(400).json({ error: 'question required' }); return; }

    const { text, entities } = await buildSnapshot(orgId);

    const system = `You are Robin Copilot, an in-app AI assistant for an agency operations platform.
ANSWER ONLY from the snapshot provided. If the answer isn't in the snapshot, say so directly — do not invent facts.

Output rules:
- Start with a single 1-3 sentence direct answer. Be concrete; name brands, people, tasks by name.
- Use plain prose. No bullet lists unless the question is "show me a list".
- When relevant, end with ONE concrete suggested next action (a short sentence).
- No greetings, no apologies, no padding. The user is a busy agency admin.
- Never mention the snapshot, prompt, or your own internals.
- Tone: warm but direct. Like a senior PM giving a status update.

Examples of good answers:
Q: "Which brands are at risk?"
A: "Three brands are critical right now: WOODSIFY (idle 7 days, 2 overdue tasks), VELLOR LIVING (past ETA), and DARPAN (blocked on client input). Reach out to WOODSIFY first — its owner Beant Kaur has 4 active tasks already."

Q: "Who is responsible for Woodsify?"
A: "Beant Kaur owns WOODSIFY's current stage (Video). Bhawna supports on Meta Ads. No reviewer is set on the open tasks."`;

    const payload = `QUESTION: ${question}\n\nSNAPSHOT:\n${text}`;

    let answer = '';
    try {
      answer = (await callGemini(system, payload, 280)).trim();
    } catch (err) {
      console.warn('[copilot] gemini failed:', (err as Error).message);
      res.json({
        answer: "I couldn't reach the AI service. Try again in a moment, or open the dashboard for the same data.",
        entities: [],
        usedSnapshot: { brandCount: 0, taskCount: 0, employeeCount: 0 },
      });
      return;
    }

    // Filter entities to those actually mentioned in the answer — keeps
    // the click-through list short and relevant.
    const lower = answer.toLowerCase();
    const mentioned = entities.filter(e =>
      e.name && e.name.length >= 3 && lower.includes(e.name.toLowerCase()),
    ).slice(0, 6);

    res.json({
      answer,
      entities: mentioned,
      usedSnapshot: {
        brandCount: entities.filter(e => e.kind === 'brand').length,
        taskCount: entities.filter(e => e.kind === 'task').length,
        employeeCount: entities.filter(e => e.kind === 'employee').length,
      },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
