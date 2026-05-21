/**
 * robinAI.ts — the brain wiring behind Robin Copilot.
 *
 * Three responsibilities:
 *
 *   1. buildUserContext(userId, orgId)
 *      Pulls a compact JSON snapshot of "everything Robin should know
 *      about the asker": their open projects, tasks, leads, focus-list
 *      items, recent activity. Cached for 30s per user so a fast back-
 *      and-forth doesn't re-query Mongo every turn.
 *
 *   2. rolePersona(role, teams)
 *      Returns the system prompt tuned to the asker. Sales rep gets a
 *      sales-tuned voice, dev gets a dev voice, admin gets an operations
 *      voice. Teams (meta / influencer / qa / development) further refine
 *      the framing for employees.
 *
 *   3. getOrCreateThread / appendTurn / resetThread
 *      Persistent per-user conversation history (see model RobinThread).
 *      Capped at 200 turns on disk; the last MAX_CONTEXT_TURNS (20) are
 *      forwarded into Gemini on each call.
 */

import User from '../models/User';
import Lead from '../models/Lead';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import FocusList from '../models/FocusList';
import RobinThread from '../models/RobinThread';

// ── Context cache (in-memory, 30s TTL) ──────────────────────────────
// We don't want every Copilot keystroke triggering 5+ Mongo finds.
// 30s is short enough that the user perceives "live" but long enough
// to absorb a back-and-forth turn.
interface CtxCacheEntry { ctx: UserContext; expiresAt: number }
const ctxCache = new Map<string, CtxCacheEntry>();
const CTX_TTL_MS = 30_000;
const MAX_HISTORY_PERSIST = 200;     // cap on disk
const MAX_CONTEXT_TURNS   = 20;      // turns sent to the model

export interface UserContext {
  /** Compact identity block. */
  me: {
    id:    string;
    name:  string;
    role:  string;
    teams: string[];
  };
  /** Open projects that mention me as an owner / assignee somewhere. */
  myProjects: Array<{
    id:           string;
    client:       string;
    health:       string;
    eta:          string | null;
    blockerType:  string;
    delayCause:   string;
    nextAction:   string;
    priority:     string;
    riskScore:    number;
    services:     Array<{ type: string; status: string; progress: string }>;
  }>;
  /** Their open tasks, sorted by due date. */
  myTasks: Array<{
    id:       string;
    title:    string;
    priority: string;
    due:      string | null;
    status:   string;
    project?: string;
  }>;
  /** Their open leads (only populated for sales / admin). */
  myLeads: Array<{
    id:           string;
    name:         string;
    stage:        string;
    aiScore:      string;
    aiNextAction: string;
  }>;
  /** Their starred-this-week focus items. */
  myFocus: Array<{
    label:   string;
    urgency: string;
    note:    string;
  }>;
  /** Org-wide at-risk snapshot — top 5 highest risk score. Admins see all,
   *  everyone else sees a redacted version (count only). */
  atRisk: { count: number; topPaths: string[] };
}

/** Strip undefined / empty / null values from the snapshot so the prompt stays terse. */
function compact<T extends Record<string, any>>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Strict Monday-of-this-week, ISO date — matches FocusList.weekStart. */
function mondayKey(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

export async function buildUserContext(userId: string, orgId: string): Promise<UserContext> {
  const cached = ctxCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.ctx;

  const u = await User.findById(userId).select('name role teams').lean() as any;
  if (!u) {
    return {
      me: { id: userId, name: 'Unknown user', role: '', teams: [] },
      myProjects: [], myTasks: [], myLeads: [], myFocus: [],
      atRisk: { count: 0, topPaths: [] },
    };
  }

  // ── My open projects ──────────────────────────────────────────────
  // A workflow is "mine" if I'm the nextActionOwner OR any service in
  // it is assignedTo me. Admins always see the org's most-at-risk
  // projects in addition.
  const wfQuery: Record<string, unknown> = {
    organizationId: orgId,
    'services.status': { $ne: 'done' },
  };
  const wfs = await ClientWorkflow.find(wfQuery)
    .select('clientName health healthReason eta priority riskScore delayCause nextBestAction blockerType services nextActionOwnerId lastActivityAt')
    .sort({ riskScore: -1, lastActivityAt: -1 })
    .limit(40)
    .lean() as any[];

  const myProjects = wfs
    .filter(w => {
      if (u.role === 'admin') return (w.riskScore || 0) >= 35; // admins see at-risk only here
      const owners = (w.services || []).map((s: any) => String(s.assignedTo || ''));
      return String(w.nextActionOwnerId || '') === String(userId) || owners.includes(String(userId));
    })
    .slice(0, 8)
    .map(w => compact({
      id:          String(w._id),
      client:      w.clientName,
      health:      w.health,
      eta:         w.eta,
      blockerType: w.blockerType,
      delayCause:  w.delayCause,
      nextAction:  w.nextBestAction,
      priority:    w.priority,
      riskScore:   w.riskScore,
      services: (w.services || []).slice(0, 6).map((s: any) => ({
        type:     s.serviceType,
        status:   s.status,
        progress: `${(s.checklist || []).filter((c: any) => c.done).length}/${(s.checklist || []).length}`,
      })),
    })) as UserContext['myProjects'];

  // ── My open tasks ─────────────────────────────────────────────────
  const tasks = await ProjectTask.find({
    assignedTo: userId,
    status: { $in: ['pending', 'ongoing'] },
  }).select('title priority dueDate status projectId').sort({ dueDate: 1, priority: -1 }).limit(15).lean() as any[];

  const myTasks: UserContext['myTasks'] = tasks.map(t => compact({
    id:       String(t._id),
    title:    t.title,
    priority: t.priority,
    due:      t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : null,
    status:   t.status,
  })) as UserContext['myTasks'];

  // ── My leads (sales / admin only) ─────────────────────────────────
  let myLeads: UserContext['myLeads'] = [];
  if (u.role === 'admin' || u.role === 'sales' || (u.teams || []).includes('sales')) {
    const leads = await Lead.find({
      organizationId: orgId,
      stage: { $nin: ['won', 'lost'] },
      ...(u.role === 'admin' ? {} : { assignedTo: userId }),
    }).select('name stage aiScore aiNextAction').sort({ updatedAt: -1 }).limit(10).lean() as any[];
    myLeads = leads.map(l => compact({
      id:           String(l._id),
      name:         l.name,
      stage:        l.stage,
      aiScore:      l.aiScore,
      aiNextAction: l.aiNextAction,
    })) as UserContext['myLeads'];
  }

  // ── My focus items this week ──────────────────────────────────────
  const fl = await FocusList.findOne({
    organizationId: orgId, ownerId: String(userId), weekStart: mondayKey(),
  }).select('items').lean() as any;
  const myFocus: UserContext['myFocus'] = (fl?.items || [])
    .filter((i: any) => !i.doneAt)
    .slice(0, 10)
    .map((i: any) => compact({
      label:   i.label,
      urgency: i.urgency,
      note:    i.note,
    })) as UserContext['myFocus'];

  // ── Org-wide at-risk snapshot (for admins). Everyone else gets count only. ─
  const atRiskCount = wfs.filter(w => (w.riskScore || 0) >= 60).length;
  const atRisk: UserContext['atRisk'] = {
    count: atRiskCount,
    topPaths: u.role === 'admin'
      ? wfs.filter(w => (w.riskScore || 0) >= 60).slice(0, 5).map(w => w.clientName)
      : [],
  };

  const ctx: UserContext = {
    me: { id: String(userId), name: u.name || '', role: u.role || '', teams: u.teams || [] },
    myProjects, myTasks, myLeads, myFocus, atRisk,
  };
  ctxCache.set(userId, { ctx, expiresAt: Date.now() + CTX_TTL_MS });
  return ctx;
}

/** Invalidate cache when we know the user just mutated their world. */
export function invalidateUserContext(userId: string): void {
  ctxCache.delete(userId);
}

// ── Role-tuned persona ───────────────────────────────────────────────
/**
 * Returns the system prompt tail that frames the AI for this user.
 * The ROBIN_DOCS block lives in aiTriage.ts and is prepended elsewhere.
 */
export function rolePersona(role: string, teams: string[] = []): string {
  const baseByRole: Record<string, string> = {
    admin:    'You are speaking with the AGENCY OWNER / ADMIN. Default to operational, outcome-oriented answers: who is doing what, where the bottleneck is, what they should escalate. They can see everything; never refuse on confidentiality.',
    sales:    'You are speaking with a SALES REP. Default to pipeline-flavoured advice: which lead to call now, which deal is ghosting, what to write in a follow-up. Reference the user\'s open leads when relevant.',
    employee: 'You are speaking with an EMPLOYEE on the delivery side. Default to "what should I work on now" + "where in Robin do I click for X" answers. Reference their open tasks and projects.',
    workroom: 'You are speaking with a WORKROOM-ONLY teammate. Their UI is tiny (huddle + a thin dashboard). Tell them honestly when something is not in their UI and point to admin.',
    client:   'You are speaking with an EXTERNAL CLIENT. Stay strictly inside what their client dashboard exposes. Never reveal internal-staff features, costs, or other clients\' data.',
  };
  const teamHints: Record<string, string> = {
    development: 'Their team is DEVELOPMENT — emphasise dev-task hand-offs, code review checkpoints, deployment readiness.',
    meta:        'Their team is META ADS — emphasise creative pipeline, copy approval, ad set status.',
    influencer:  'Their team is INFLUENCER MARKETING — emphasise outreach, deliverables, content review.',
    qa:          'Their team is QA — emphasise blockers found, test plan coverage, regression risks.',
    sales:       'They also wear a SALES hat — fold pipeline thinking into their answers.',
  };
  const teamLine = (teams || []).map(t => teamHints[t]).filter(Boolean).join(' ');
  return `${baseByRole[role] || baseByRole.employee} ${teamLine}`.trim();
}

// ── Thread persistence ──────────────────────────────────────────────
export async function getOrCreateThread(orgId: string, ownerId: string): Promise<any> {
  let t = await RobinThread.findOne({ organizationId: orgId, ownerId });
  if (!t) {
    const u = await User.findById(ownerId).select('name role').lean() as any;
    t = await RobinThread.create({
      organizationId: orgId,
      ownerId,
      ownerName: u?.name || '',
      ownerRole: u?.role || '',
      turns: [],
    });
  }
  return t;
}

/** Append a turn and trim the thread to MAX_HISTORY_PERSIST. */
export async function appendTurn(orgId: string, ownerId: string, turn: { role: 'user'|'assistant'|'system'; text: string; route?: string; aiUsed?: boolean }): Promise<any> {
  const t = await getOrCreateThread(orgId, ownerId);
  t.turns.push({
    role: turn.role,
    text: turn.text,
    route: turn.route || '',
    aiUsed: !!turn.aiUsed,
    at: new Date(),
  });
  if (t.turns.length > MAX_HISTORY_PERSIST) {
    t.turns.splice(0, t.turns.length - MAX_HISTORY_PERSIST);
  }
  await t.save();
  return t;
}

/** Wipe history (keeps the thread doc + pinnedNote). */
export async function resetThread(orgId: string, ownerId: string): Promise<any> {
  const t = await getOrCreateThread(orgId, ownerId);
  t.turns = [];
  await t.save();
  return t;
}

/** Pull the last N turns formatted for prompt injection. */
export function recentTurnsForPrompt(thread: any, max = MAX_CONTEXT_TURNS): Array<{ role: string; text: string }> {
  const turns = (thread?.turns || []) as Array<any>;
  return turns.slice(-max).map(t => ({ role: t.role, text: t.text }));
}

export { MAX_CONTEXT_TURNS };
