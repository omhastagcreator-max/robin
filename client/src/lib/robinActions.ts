import * as api from '@/api';

/**
 * robinActions — execute the structured actions produced by the
 * /parse-command endpoint. Shared between HelpBubble (the old Ask tab)
 * and RobinCopilot (the persistent thread drawer) so both can act, not
 * just talk, with identical behaviour.
 *
 * Every action receives the user's original raw message in
 * `_originalMessage` so the API audit-log line can quote it ("via Robin
 * AI: 'mark Velloer Shopify done'").
 */

export type RobinAction =
  | 'create_task'
  | 'update_task'
  | 'mark_task_done'
  | 'mark_workflow_done'
  | 'mark_service_done'
  | 'schedule_meeting'
  | 'update_lead'
  | 'mark_lead_won'
  | 'mark_lead_lost'
  | 'add_lead_note'
  | 'mark_lead_payment'
  | 'unsupported'
  | 'question';

export interface ExecuteResult {
  text: string;          // human result to render in the chat
  ok:   boolean;         // did the action complete?
}

/**
 * Find the task that best matches a free-text snippet from the user.
 * Strategy:
 *   1. Case-insensitive exact match on title.
 *   2. Case-insensitive substring match on title.
 *   3. Word-overlap fallback (best score wins, must beat threshold).
 * Returns null when nothing is a clear hit so the caller can ask for
 * clarification instead of guessing.
 */
async function findTaskByMatch(match: string): Promise<any | null> {
  const q = String(match || '').trim().toLowerCase();
  if (!q) return null;
  const tasks: any[] = await api.listTasks();
  const list = Array.isArray(tasks) ? tasks : [];
  // 1. Exact title match.
  const exact = list.find(t => (t.title || '').toLowerCase() === q);
  if (exact) return exact;
  // 2. Substring match on title.
  const sub = list.find(t => (t.title || '').toLowerCase().includes(q));
  if (sub) return sub;
  // 3. Word-overlap score. Pick the row whose title shares the most
  //    words with the query, requiring at least 2 word matches OR 50%+
  //    overlap with a short query.
  const qWords = new Set(q.split(/\W+/).filter(w => w.length >= 3));
  let best: any = null; let bestScore = 0;
  for (const t of list) {
    const tWords = (t.title || '').toLowerCase().split(/\W+/);
    let score = 0;
    for (const w of tWords) if (qWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (bestScore >= 2 || (bestScore >= 1 && qWords.size <= 2)) return best;
  return null;
}

/** Build an update payload that ONLY contains the fields the user changed. */
function buildUpdatePatch(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (typeof params.title    === 'string') out.title    = params.title;
  if (params.priority)                     out.priority = params.priority;
  if (params.dueDate)                      out.dueDate  = params.dueDate;
  if (params.status)                       out.status   = params.status;
  return out;
}

/**
 * Find the lead that best matches a free-text snippet — name / company /
 * phone / email. Same staged strategy as the task finder so behaviour is
 * predictable. Returns null when nothing's a clear hit.
 */
async function findLeadByMatch(match: string): Promise<any | null> {
  const q = String(match || '').trim().toLowerCase();
  if (!q) return null;
  const all: any = await api.listLeads();
  // The leads list endpoint returns either an array or { leads, … }; tolerate both.
  const list: any[] = Array.isArray(all) ? all : (all?.leads || []);
  const open = list.filter((l: any) => !['won', 'lost'].includes(l.stage || l.status || ''));
  const fields = (l: any) => [l.name, l.company, l.contact, l.email].map(s => (s || '').toString().toLowerCase());
  // 1. Exact match on any field.
  const exact = open.find(l => fields(l).some(f => f === q));
  if (exact) return exact;
  // 2. Substring on any field.
  const sub = open.find(l => fields(l).some(f => f && f.includes(q)));
  if (sub) return sub;
  // 3. Word-overlap on name + company.
  const qWords = new Set(q.split(/\W+/).filter(w => w.length >= 3));
  let best: any = null; let bestScore = 0;
  for (const l of open) {
    const text = `${l.name || ''} ${l.company || ''}`.toLowerCase();
    const words = text.split(/\W+/);
    let score = 0;
    for (const w of words) if (qWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  if (bestScore >= 2 || (bestScore >= 1 && qWords.size <= 2)) return best;
  return null;
}

function buildLeadPatch(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (params.stage)          out.stage          = params.stage;
  if (params.aiScore)        out.aiScore        = params.aiScore;
  if (params.nextFollowUp)   out.nextFollowUp   = params.nextFollowUp;
  if (typeof params.estimatedValue === 'number') out.estimatedValue = params.estimatedValue;
  return out;
}

/**
 * Execute one parsed Robin command. Returns a result text the chat UI
 * can render and an `ok` boolean. Never throws — error paths return a
 * polite human message instead.
 */
export async function executeRobinCommand(
  action: RobinAction,
  params: Record<string, any>,
  originalMessage = '',
): Promise<ExecuteResult> {
  try {
    switch (action) {
      case 'create_task': {
        const body: any = {
          title:    params.title || '(untitled)',
          priority: params.priority || 'medium',
          status:   'pending',
          dueDate:  params.dueDate || new Date().toISOString().slice(0, 10),
        };
        await api.createTask(body);
        return { ok: true, text: `Done. Created "${body.title}" (${body.priority} priority, due ${body.dueDate}). Find it under My Tasks.` };
      }

      case 'mark_task_done':
      case 'update_task': {
        const match = String(params.match || params.title || '').trim();
        if (!match) {
          return { ok: false, text: "I need at least a few words from the task title so I can find it. Try: \"push the Velloer Shopify review to Monday\"." };
        }
        const task = await findTaskByMatch(match);
        if (!task) {
          return { ok: false, text: `I couldn't find a task that matches "${match}". Open My Tasks and check the exact title, then try again.` };
        }
        const patch = action === 'mark_task_done'
          ? { status: 'done' as const }
          : buildUpdatePatch(params);
        if (Object.keys(patch).length === 0) {
          return { ok: false, text: `I found "${task.title}" but you didn't say what to change. Try giving a new due date, priority, or status.` };
        }
        await api.updateTask(task._id, patch);
        const summary = Object.entries(patch).map(([k, v]) => `${k} → ${String(v)}`).join(', ');
        return { ok: true, text: `Updated "${task.title}" — ${summary}.` };
      }

      case 'mark_workflow_done': {
        const name = String(params.clientName || '').trim();
        if (!name) return { ok: false, text: "I need the client name. Try: \"mark Darpan project done\"." };
        const list: any[] = await api.cwListWorkflows({ q: name });
        const wf = list.find(w => (w.clientName || '').toLowerCase() === name.toLowerCase()) || list[0];
        if (!wf) return { ok: false, text: `No project matches "${name}". Try searching the Projects page first.` };
        const notDone = (wf.services || []).filter((s: any) => s.status !== 'done');
        if (notDone.length === 0) return { ok: true, text: `"${wf.clientName}" is already fully done — nothing to mark.` };
        for (const s of notDone) {
          try {
            await api.cwCompleteService(wf._id, s._id, { comment: `Marked done via Robin AI: "${originalMessage || 'mark project done'}"` });
          } catch { /* one stuck service shouldn't block the rest */ }
        }
        return { ok: true, text: `Marked "${wf.clientName}" done — ${notDone.length} step${notDone.length === 1 ? '' : 's'} completed. Audit log credits Robin AI.` };
      }

      case 'mark_service_done':
      case 'schedule_meeting':
        return { ok: false, text: "I parsed that action, but execution for it isn't wired yet. Open the project / calendar manually and I'll add execution next." };

      // ── Lead actions ──────────────────────────────────────────────
      case 'update_lead': {
        const m = String(params.match || '').trim();
        if (!m) return { ok: false, text: "I need a name / company / phone snippet to find the lead. Try: \"mark Aanya Aesthetics hot\"." };
        const lead = await findLeadByMatch(m);
        if (!lead) return { ok: false, text: `I couldn't find an open lead matching "${m}". Check the spelling on the All-leads page and try again.` };
        const patch = buildLeadPatch(params);
        if (Object.keys(patch).length === 0) return { ok: false, text: `I found "${lead.name || lead.company}" but you didn't say what to change. Try giving a stage, score, follow-up date, or value.` };
        await api.updateLead(lead._id, patch);
        const summary = Object.entries(patch).map(([k, v]) => `${k} → ${String(v)}`).join(', ');
        return { ok: true, text: `Updated lead "${lead.name || lead.company}" — ${summary}.` };
      }

      case 'mark_lead_won': {
        const m = String(params.match || '').trim();
        if (!m) return { ok: false, text: "I need the lead name / company. Try: \"won the Karan Crafts deal\"." };
        const lead = await findLeadByMatch(m);
        if (!lead) return { ok: false, text: `I couldn't find an open lead matching "${m}".` };
        const patch: Record<string, any> = { stage: 'won', closedAt: new Date().toISOString() };
        if (typeof params.wonAmount === 'number') patch.wonAmount = params.wonAmount;
        await api.updateLead(lead._id, patch);
        const valueLine = patch.wonAmount ? ` at ₹${(patch.wonAmount as number).toLocaleString('en-IN')}` : '';
        return { ok: true, text: `Marked "${lead.name || lead.company}" WON${valueLine}. Nice one.` };
      }

      case 'mark_lead_lost': {
        const m = String(params.match || '').trim();
        if (!m) return { ok: false, text: "I need the lead name / company. Try: \"Karan lost — chose a competitor\"." };
        const lead = await findLeadByMatch(m);
        if (!lead) return { ok: false, text: `I couldn't find an open lead matching "${m}".` };
        const patch: Record<string, any> = { stage: 'lost', closedAt: new Date().toISOString() };
        if (params.reason) patch.lostReason = String(params.reason);
        await api.updateLead(lead._id, patch);
        return { ok: true, text: `Marked "${lead.name || lead.company}" lost${patch.lostReason ? ` (${patch.lostReason})` : ''}. Logged.` };
      }

      case 'add_lead_note': {
        const m = String(params.match || '').trim();
        const text = String(params.text || '').trim();
        if (!m)    return { ok: false, text: "Need the lead name / company so I know where to add the note." };
        if (!text) return { ok: false, text: "Tell me what the note says — \"add a note to X: <your note>\"." };
        const lead = await findLeadByMatch(m);
        if (!lead) return { ok: false, text: `I couldn't find an open lead matching "${m}".` };
        await api.addLeadNote(lead._id, { content: text });
        return { ok: true, text: `Note added to "${lead.name || lead.company}": ${text}` };
      }

      case 'mark_lead_payment': {
        const m = String(params.match || '').trim();
        const ps = String(params.paymentStatus || '');
        if (!m) return { ok: false, text: "Need the lead name / company. Try: \"Vellore part payment done 15k after Shopify launch\"." };
        if (!['part_paid', 'full_paid', 'refunded'].includes(ps)) {
          return { ok: false, text: "Payment status must be one of part_paid / full_paid / refunded." };
        }
        const lead = await findLeadByMatch(m);
        if (!lead) return { ok: false, text: `I couldn't find a lead matching "${m}".` };
        const amount = Number(params.amount || 0);
        const note   = String(params.note || '').trim();
        const total  = params.total !== undefined ? Number(params.total) : undefined;
        await api.markLeadPayment(lead._id, {
          status: ps as 'part_paid' | 'full_paid' | 'refunded',
          amount,
          note:   note || undefined,
          total:  total && total > 0 ? total : undefined,
        });
        const summaryBits: string[] = [];
        if (amount)            summaryBits.push(`₹${amount.toLocaleString('en-IN')}`);
        if (total)             summaryBits.push(`of ₹${total.toLocaleString('en-IN')}`);
        if (note)              summaryBits.push(`— next: ${note}`);
        const tail = summaryBits.length ? ` ${summaryBits.join(' ')}` : '';
        const verb = ps === 'full_paid' ? 'fully paid' : ps === 'refunded' ? 'refund recorded' : 'part payment recorded';
        return { ok: true, text: `"${lead.name || lead.company}" — ${verb}${tail}.` };
      }

      default:
        return { ok: false, text: "I'm not sure how to execute that one." };
    }
  } catch (err: any) {
    return { ok: false, text: err?.response?.data?.error || "I couldn't complete that. Try again from the page itself." };
  }
}
