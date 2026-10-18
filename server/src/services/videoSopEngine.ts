import { Types } from 'mongoose';
import VideoSopRun from '../models/VideoSopRun';
import ClientWorkflow from '../models/ClientWorkflow';
import WorkflowActivity from '../models/WorkflowActivity';
import User from '../models/User';
import { SOP_STEPS, SOP_STEP_BY_KEY, SOP_EFFECTIVE_FROM, SERVICE_CHECKLIST_SYNC, HOUR } from '../lib/videoSop';

/**
 * videoSopEngine — Oct 2026. Shared logic for the UGC Video SOP:
 * creating runs, computing each step's live state, and mirroring progress
 * into the brand's CRM log + UGC service checklist. Used by the controller
 * and the escalation cron.
 */

export type StepState = 'done' | 'done_late' | 'locked' | 'open' | 'due_soon' | 'overdue' | 'missed';
export const DUE_SOON_MS = 6 * HOUR;

export function buildSteps(startedAt: Date) {
  const t0 = startedAt.getTime();
  return SOP_STEPS.map(def => ({
    key: def.key,
    dueAt: new Date(t0 + def.dueHours * HOUR),
    graceUntil: new Date(t0 + (def.dueHours + def.graceHours) * HOUR),
    items: def.items.map(() => ({ done: false, doneAt: null, doneBy: '' })),
  }));
}

/** Are all of a step's prerequisites done? (Day-2 work runs in parallel.) */
export function depsDone(run: any, key: string): boolean {
  const def = SOP_STEP_BY_KEY.get(key);
  const done = new Set((run.steps || []).filter((x: any) => x.doneAt).map((x: any) => x.key));
  return (def?.after || []).every(k => done.has(k) || !(run.steps || []).some((x: any) => x.key === k));
}

/** Live state of every step + the run as a whole. Pure. */
export function computeRunState(run: any, now = Date.now()) {
  const raw = (run.steps || []).map((s: any) => {
    const due = new Date(s.dueAt).getTime();
    const grace = new Date(s.graceUntil).getTime();
    const unlocked = depsDone(run, s.key);
    let state: StepState;
    if (s.doneAt) state = s.late ? 'done_late' : 'done';
    else if (now > grace) state = 'missed';
    else if (now > due) state = 'overdue';
    else if (!unlocked) state = 'locked';
    else if (due - now <= DUE_SOON_MS) state = 'due_soon';
    else state = 'open';
    return { ...s, state, unlocked };
  });
  // "Current" = the open, unlocked step with the earliest deadline.
  const openNow = raw.filter((s: any) => !s.doneAt && s.unlocked)
    .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const current: string | null = openNow[0]?.key || null;
  const steps = raw;
  const doneCount = steps.filter((s: any) => s.doneAt).length;
  const missed = steps.filter((s: any) => s.state === 'missed').length;
  const overdue = steps.filter((s: any) => s.state === 'overdue').length;
  const lateDone = steps.filter((s: any) => s.state === 'done_late').length;
  const cur = steps.find((s: any) => s.key === current);
  const health: 'on_track' | 'due_soon' | 'overdue' | 'missed' | 'completed' =
    run.status === 'completed' ? 'completed' : missed ? 'missed' : overdue ? 'overdue'
      : steps.some((s: any) => s.state === 'due_soon') ? 'due_soon' : 'on_track';
  return {
    steps, doneCount, total: steps.length, missed, overdue, lateDone, health,
    currentStep: current,
    currentDueAt: cur?.dueAt || null,
    dayNumber: Math.max(1, Math.ceil((now - new Date(run.startedAt).getTime()) / (24 * HOUR))),
  };
}

/**
 * Make sure every eligible UGC service in the org has a run. Eligible =
 * not done, workflow onboarded/created on or after SOP_EFFECTIVE_FROM.
 * Older brands are started manually (admin picks the start date). Also keeps
 * run.assignedTo / clientName in step with the CRM.
 */
export async function ensureRunsForOrg(orgId: string): Promise<void> {
  const wfs = await ClientWorkflow.find({
    organizationId: orgId,
    'services.serviceType': 'influencer',
    operationalStatus: { $nin: ['cancelled'] },
  }).select('_id clientName services onboardedAt createdAt').lean();
  if (!wfs.length) return;
  const existing = await VideoSopRun.find({ organizationId: orgId }).select('serviceId assignedTo clientName status').lean();
  const byService = new Map(existing.map((r: any) => [String(r.serviceId), r]));
  for (const wf of wfs as any[]) {
    for (const svc of wf.services || []) {
      if (svc.serviceType !== 'influencer') continue;
      const run: any = byService.get(String(svc._id));
      if (run) {
        const patch: any = {};
        if ((svc.assignedTo || '') !== (run.assignedTo || '') && run.status === 'active') patch.assignedTo = svc.assignedTo || '';
        if (wf.clientName && wf.clientName !== run.clientName) patch.clientName = wf.clientName;
        if (Object.keys(patch).length) await VideoSopRun.updateOne({ _id: run._id }, { $set: patch });
        continue;
      }
      const born = new Date(wf.onboardedAt || wf.createdAt || Date.now());
      if (svc.status === 'done' || born < SOP_EFFECTIVE_FROM) continue;
      await startRun(orgId, String(wf._id), String(svc._id), born, '');
    }
  }
}

const BRIEF_KEYS = ['product', 'price', 'offer', 'competitors', 'competitorLinks', 'referenceVideo', 'videos', 'requirements'];
export function briefFromSales(ugc: any, quantity?: number | null) {
  const out: Record<string, string> = {};
  for (const k of BRIEF_KEYS) if (ugc && ugc[k] !== undefined && ugc[k] !== null && String(ugc[k]).trim()) out[k] = String(ugc[k]).slice(0, 2000);
  if (!out.videos && quantity) out.videos = String(quantity);
  return out;
}

export async function startRun(orgId: string, workflowId: string, serviceId: string, startedAt: Date, actorId: string) {
  const wf: any = await ClientWorkflow.findOne({ _id: workflowId, organizationId: orgId }).select('clientName services ugcBrief').lean();
  if (!wf) throw new Error('Client not found');
  const svc = (wf.services || []).find((s: any) => String(s._id) === serviceId);
  if (!svc) throw new Error('UGC service not found on this client');
  try {
    return await VideoSopRun.create({
      organizationId: orgId,
      workflowId, serviceId,
      clientName: wf.clientName || '',
      assignedTo: svc.assignedTo || '',
      startedAt, startedBy: actorId,
      steps: buildSteps(startedAt),
      // Sales handover pre-fills the Day-1 brief; the video person confirms it in the meeting.
      brief: briefFromSales(wf.ugcBrief, svc.quantity),
      salesBrief: wf.ugcBrief || null,
      log: [{ actorId, actorName: actorId ? '' : 'Robin', action: 'started', detail: `SOP started — Day 1 = ${startedAt.toISOString()}` }],
    });
  } catch (e: any) {
    if (e?.code === 11000) return VideoSopRun.findOne({ organizationId: orgId, serviceId });
    throw e;
  }
}

/**
 * Mirror an SOP event into the brand's CRM: a typed WorkflowActivity row
 * (shows in the Decision Tree log + Team Oversight feed) and, for the four
 * checkpoints that map onto the default UGC checklist, tick that item.
 */
export async function mirrorToCrm(run: any, actorId: string, stepKey: string, comment: string) {
  try {
    const actor: any = await User.findById(actorId).select('name role').lean();
    await WorkflowActivity.create({
      workflowId: run.workflowId,
      organizationId: run.organizationId,
      action: 'note_added',
      serviceId: run.serviceId,
      serviceType: 'influencer',
      actorId: new Types.ObjectId(actorId),
      actorName: actor?.name || '',
      actorRole: actor?.role || '',
      comment: comment.slice(0, 600),
      isDelayCause: /late|missed/i.test(comment),
    });
    const wf: any = await ClientWorkflow.findById(run.workflowId);
    if (!wf) return;
    const svc = wf.services.id(run.serviceId);
    const idx = SERVICE_CHECKLIST_SYNC[stepKey];
    if (svc && idx !== undefined && svc.checklist?.[idx] && !svc.checklist[idx].done) {
      svc.checklist[idx].done = true;
      svc.checklist[idx].doneAt = new Date();
      svc.checklist[idx].doneBy = actorId;
      if (svc.status === 'pending') svc.status = 'in_progress';
      if (!svc.startedAt) svc.startedAt = new Date();
    }
    wf.activity.push({ actorId, action: 'note_added', serviceType: 'influencer', detail: comment.slice(0, 300) });
    wf.lastActivityAt = new Date();
    wf.lastActivitySummary = comment.slice(0, 200);
    wf.lastActorId = new Types.ObjectId(actorId);
    await wf.save();
  } catch (e) {
    console.warn('[video-sop] mirrorToCrm failed', (e as Error).message);
  }
}

export const istDateKey = (ms = Date.now()) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
export const istHourNow = (ms = Date.now()) => new Date(ms + 330 * 60_000).getUTCHours();
/** Daily update is due from this IST hour if the step wasn't moved today. */
export const DAILY_UPDATE_FROM_HOUR = 17;

/**
 * Has the run had "today's update"? Either an explicit daily update, or real
 * progress today (a step completed / an item ticked / brief saved) by the owner.
 */
export function hasUpdateToday(run: any, now = Date.now()): boolean {
  const today = istDateKey(now);
  if ((run.dailyUpdates || []).some((u: any) => u.dateIST === today)) return true;
  return (run.steps || []).some((s: any) =>
    (s.doneAt && istDateKey(new Date(s.doneAt).getTime()) === today) ||
    (s.items || []).some((i: any) => i.done && i.doneAt && istDateKey(new Date(i.doneAt).getTime()) === today));
}

/**
 * Must the owner post an update RIGHT NOW? Yes if the current step is
 * overdue/missed and nothing was posted today, or (from 17:00 IST) any active
 * run has no update today. Drives the must-answer popup.
 */
export function updateRequired(run: any, now = Date.now()): { required: boolean; why: string } {
  if (run.status !== 'active' || hasUpdateToday(run, now)) return { required: false, why: '' };
  const st = computeRunState(run, now);
  const cur = st.steps.find((s: any) => s.key === st.currentStep);
  if (cur && (cur.state === 'overdue' || cur.state === 'missed')) return { required: true, why: 'overdue' };
  if (istHourNow(now) >= DAILY_UPDATE_FROM_HOUR) return { required: true, why: 'end_of_day' };
  return { required: false, why: '' };
}

export const stepTitle = (key: string) => SOP_STEP_BY_KEY.get(key)?.title || key;
