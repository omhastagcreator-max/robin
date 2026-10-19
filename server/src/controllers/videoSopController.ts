import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import VideoSopRun from '../models/VideoSopRun';
import ClientWorkflow from '../models/ClientWorkflow';
import { notify, notifyDataChanged } from '../services/notify';
import { SOP_STEPS, SOP_STEP_BY_KEY, BRIEF_FIELDS, LATE_REASONS, LATE_REASON_KEYS } from '../lib/videoSop';
import { computeRunState, ensureRunsForOrg, startRun, mirrorToCrm, stepTitle, hasUpdateToday, updateRequired, istDateKey, depsDone, markDoneBefore, progressSummary, syncServiceChecklist } from '../services/videoSopEngine';

/**
 * videoSopController — Oct 2026. API for the Video SOP.
 *
 * Visibility: every staff member can SEE every run (it's a team board).
 * Acting: ONLY the run's assigned video-team person can tick items, fill the
 * brief or complete a step ("every step is to be marked by the assigned
 * person" — owner). Admin / managers (canViewOversight) can reassign, start a
 * run for an older brand, or reopen a step — they cannot tick on someone's
 * behalf, so the record of who did what stays honest.
 */

async function orgOf(req: AuthRequest): Promise<string | null> {
  if (req.user?.organizationId) return req.user.organizationId;
  const u = await User.findById(req.user!.id).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}
async function isManager(req: AuthRequest): Promise<boolean> {
  const r = [req.user!.role, ...(req.user!.roles || [])];
  if (r.includes('admin')) return true;
  const u: any = await User.findById(req.user!.id).select('canViewOversight').lean();
  return u?.canViewOversight === true;
}

async function hydrate(runs: any[]) {
  const ids = new Set<string>();
  runs.forEach(r => { if (r.assignedTo) ids.add(r.assignedTo); (r.helpers || []).forEach((h: string) => ids.add(h)); (r.steps || []).forEach((s: any) => s.doneBy && ids.add(s.doneBy)); (r.dailyUpdates || []).forEach((u: any) => u.by && ids.add(u.by)); });
  const users = await User.find({ _id: { $in: Array.from(ids) } }).select('name team').lean();
  const name = new Map(users.map((u: any) => [String(u._id), u.name]));
  return runs.map(r => {
    const st = computeRunState(r);
    return {
      _id: String(r._id),
      workflowId: String(r.workflowId),
      serviceId: String(r.serviceId),
      clientName: r.clientName,
      assignedTo: r.assignedTo,
      assigneeName: name.get(r.assignedTo) || '',
      helpers: (r.helpers || []).map((h: string) => ({ id: h, name: name.get(h) || '' })),
      startedAt: r.startedAt,
      status: r.status,
      completedAt: r.completedAt,
      brief: r.brief,
      salesBrief: r.salesBrief || null,
      progress: progressSummary(r),
      log: (r.log || []).slice(-60).reverse(),
      dailyUpdates: (r.dailyUpdates || []).slice(-14).reverse().map((u: any) => ({ ...u, byName: name.get(u.by) || '' })),
      updatedToday: hasUpdateToday(r),
      ...st,
      currentTitle: st.currentStep ? stepTitle(st.currentStep) : '',
      steps: st.steps.map((s: any) => ({ ...s, doneByName: name.get(s.doneBy) || '' })),
    };
  });
}

// GET /api/video-sop/meta
export async function getSopMeta(_req: AuthRequest, res: Response): Promise<void> {
  res.json({ steps: SOP_STEPS, briefFields: BRIEF_FIELDS, lateReasons: LATE_REASONS });
}

// GET /api/video-sop?status=active|completed|all
export async function listRuns(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    await ensureRunsForOrg(orgId);
    const status = String(req.query.status || 'active');
    const q: any = { organizationId: orgId };
    if (status !== 'all') q.status = status;
    const runs = await VideoSopRun.find(q).sort({ startedAt: -1 }).lean();
    // Brands with a UGC service but no run yet (onboarded before the SOP) — so admin can start them.
    const wfs = await ClientWorkflow.find({ organizationId: orgId, 'services.serviceType': 'influencer', operationalStatus: { $nin: ['cancelled', 'completed'] } })
      .select('_id clientName services').lean();
    const haveRun = new Set((await VideoSopRun.find({ organizationId: orgId }).select('serviceId').lean()).map((r: any) => String(r.serviceId)));
    const notStarted = (wfs as any[]).flatMap(wf => (wf.services || [])
      .filter((s: any) => s.serviceType === 'influencer' && s.status !== 'done' && !haveRun.has(String(s._id)))
      .map((s: any) => ({ workflowId: String(wf._id), serviceId: String(s._id), clientName: wf.clientName })));
    res.json({ runs: await hydrate(runs), notStarted, canManage: await isManager(req), me: req.user!.id });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/video-sop/:id
export async function getRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const run = await VideoSopRun.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!run) { res.status(404).json({ error: 'Video brand not found' }); return; }
    const [h] = await hydrate([run]);
    res.json({ ...h, canManage: await isManager(req), me: req.user!.id });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/video-sop/by-workflow/:workflowId — used by the Decision Tree card
export async function getRunByWorkflow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const run = await VideoSopRun.findOne({ workflowId: req.params.workflowId, organizationId: orgId }).sort({ startedAt: -1 }).lean();
    if (!run) { res.json(null); return; }
    const [h] = await hydrate([run]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** Load a run the caller is allowed to ACT on (assignee only). */
async function loadForAction(req: AuthRequest, res: Response): Promise<any | null> {
  const orgId = await orgOf(req);
  const run = await VideoSopRun.findOne({ _id: req.params.id, organizationId: orgId });
  if (!run) { res.status(404).json({ error: 'Video brand not found' }); return null; }
  if (run.status !== 'active') { res.status(409).json({ error: 'This brand\'s video tasks are already closed' }); return null; }
  if (!run.assignedTo) { res.status(409).json({ error: 'No video-team person is assigned yet — ask admin to assign one first' }); return null; }
  if (run.assignedTo !== req.user!.id && !(run.helpers || []).includes(req.user!.id)) {
    res.status(403).json({ error: 'Only the assigned video-team person (or their helper) can tick these tasks' });
    return null;
  }
  return run;
}

/** Keep the CRM's UGC service owner in step with the SOP owner (load + save — no positional update). */
async function syncCrmOwner(run: any, userId: string) {
  const wf: any = await ClientWorkflow.findById(run.workflowId);
  const svc = wf?.services?.id(run.serviceId);
  if (svc && svc.assignedTo !== userId) { svc.assignedTo = userId; await wf.save(); }
}

function stepOf(run: any, key: string) {
  const idx = run.steps.findIndex((s: any) => s.key === key);
  return { idx, step: idx >= 0 ? run.steps[idx] : null, def: SOP_STEP_BY_KEY.get(key) };
}
function previousDone(run: any, idx: number) {
  return depsDone(run, run.steps[idx].key);
}
function blockersOf(run: any, key: string): string {
  const def = SOP_STEP_BY_KEY.get(key);
  const done = new Set(run.steps.filter((x: any) => x.doneAt).map((x: any) => x.key));
  return (def?.after || []).filter(k => !done.has(k)).map(k => `"${stepTitle(k)}"`).join(' and ');
}

// PUT /api/video-sop/:id/brief  { product, price, … }
export async function saveBrief(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await loadForAction(req, res); if (!run) return;
    const { step } = stepOf(run, 'brief');
    if (step?.doneAt) { res.status(409).json({ error: 'The client brief is already locked (step completed)' }); return; }
    for (const f of BRIEF_FIELDS) {
      if (typeof req.body?.[f.key] === 'string') (run.brief as any)[f.key] = String(req.body[f.key]).slice(0, 2000);
    }
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'brief_saved', stepKey: 'brief', detail: 'Client brief updated' });
    await run.save();
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/steps/:key/items/:idx  { done }
export async function toggleItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await loadForAction(req, res); if (!run) return;
    const { idx, step, def } = stepOf(run, req.params.key);
    if (!step || !def) { res.status(404).json({ error: 'Unknown step' }); return; }
    if (step.doneAt) { res.status(409).json({ error: 'Step already completed' }); return; }
    if (!previousDone(run, idx)) { res.status(409).json({ error: `Finish ${blockersOf(run, def.key)} first — tasks go in order` }); return; }
    const i = Number(req.params.idx);
    if (!step.items[i]) { res.status(400).json({ error: 'Invalid item' }); return; }
    const done = !!req.body?.done;
    step.items[i].done = done;
    step.items[i].doneAt = done ? new Date() : null;
    step.items[i].doneBy = done ? req.user!.id : '';
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: done ? 'item_done' : 'item_undone', stepKey: def.key, detail: def.items[i]?.text || '' });
    await run.save();
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/steps/:key/complete  { link?, note?, lateReason?, lateNote? }
export async function completeStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await loadForAction(req, res); if (!run) return;
    const { idx, step, def } = stepOf(run, req.params.key);
    if (!step || !def) { res.status(404).json({ error: 'Unknown step' }); return; }
    if (step.doneAt) { res.status(409).json({ error: 'Step already completed' }); return; }
    if (!previousDone(run, idx)) { res.status(409).json({ error: `Finish ${blockersOf(run, def.key)} first — tasks go in order` }); return; }

    const missing: string[] = [];
    if (def.briefFields) {
      for (const f of BRIEF_FIELDS) if (f.required && !String((run.brief as any)[f.key] || '').trim()) missing.push(f.label);
    }
    def.items.forEach((it, i) => { if (!step.items[i]?.done) missing.push(it.text); });
    const link = String(req.body?.link || step.link || '').trim();
    if (def.linkLabel && !/^https?:\/\/\S+/i.test(link)) missing.push(`${def.linkLabel} (a valid link)`);
    if (missing.length) { res.status(400).json({ error: `Still missing: ${missing.join(', ')}` }); return; }

    const now = new Date();
    const late = now > new Date(step.dueAt);
    const afterGrace = now > new Date(step.graceUntil);
    const lateReason = String(req.body?.lateReason || '');
    const lateNote = String(req.body?.lateNote || '').trim().slice(0, 600);
    if (late) {
      if (!LATE_REASON_KEYS.has(lateReason)) { res.status(400).json({ error: 'This step is past its deadline — pick a reason from the list', needsReason: true }); return; }
      if (lateReason === 'other' && lateNote.length < 5) { res.status(400).json({ error: 'Write the reason (at least a few words) for "Other"', needsReason: true }); return; }
    }

    step.link = link;
    if (typeof req.body?.note === 'string') step.note = String(req.body.note).slice(0, 600);
    step.doneAt = now;
    step.doneBy = req.user!.id;
    step.late = late;
    step.afterGrace = afterGrace;
    step.lateReason = late ? lateReason : '';
    step.lateNote = late ? lateNote : '';
    const reasonLabel = LATE_REASONS.find(r => r.key === lateReason)?.label || '';
    const lateTxt = late ? ` — LATE${afterGrace ? ' (after grace)' : ''}: ${reasonLabel}${lateNote ? ` · ${lateNote}` : ''}` : ' — on time';
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: late ? 'step_done_late' : 'step_done', stepKey: def.key, detail: `${def.title}${lateTxt}` });

    const allDone = run.steps.every((s: any) => !!s.doneAt);
    if (allDone) {
      run.status = 'completed';
      run.completedAt = now;
      run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'completed', detail: 'All video tasks complete' });
    }
    // A completed step resets escalation so the next step starts from "normal".
    run.lastNotifyLevel = '';
    run.lastNotifyAt = null;
    await run.save();

    await mirrorToCrm(run, req.user!.id, def.key, `Video task · ${def.title}${lateTxt}${step.link ? ` · ${step.link}` : ''}`);
    const io = req.app.get('io');
    notifyDataChanged(io, String(run.organizationId), 'video_sop.step', String(run._id));
    if (late) {
      // Late completions always reach admin + managers.
      const managers = await User.find({ organizationId: run.organizationId, isActive: true, $or: [{ role: 'admin' }, { roles: 'admin' }, { canViewOversight: true }] }).select('_id').lean();
      notify({
        io, organizationId: String(run.organizationId), actorId: req.user!.id,
        userIds: managers.map((m: any) => String(m._id)),
        type: 'video_sop.late', entityType: 'video_sop', entityId: String(run._id),
        title: `⚠️ ${run.clientName}: "${def.title}" done late`,
        body: `${req.user!.name} · ${reasonLabel}${lateNote ? ` — ${lateNote}` : ''}`,
      });
    }
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/video-sop/team — staff for the owner pickers, video team (influencer) first
export async function listSopTeam(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const users = await User.find({ organizationId: orgId, isActive: true, role: { $in: ['admin', 'employee', 'sales', 'workroom'] } })
      .select('_id name role team teams').sort({ name: 1 }).lean();
    const rows = users.map((u: any) => ({ _id: String(u._id), name: u.name, videoTeam: u.team === 'influencer' || (u.teams || []).includes('influencer') }));
    rows.sort((a, b) => Number(b.videoTeam) - Number(a.videoTeam) || a.name.localeCompare(b.name));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/video-sop/my-today — what Robin tells the signed-in video person to do today.
export async function myToday(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    if (!orgId) { res.json({ items: [] }); return; }
    const runs = await VideoSopRun.find({ organizationId: orgId, status: 'active', $or: [{ assignedTo: req.user!.id }, { helpers: req.user!.id }] }).lean();
    const now = Date.now();
    const items = runs.map((r: any) => {
      const st = computeRunState(r, now);
      const cur: any = st.steps.find((s: any) => s.key === st.currentStep);
      const def = cur ? SOP_STEP_BY_KEY.get(cur.key) : null;
      const req2 = updateRequired(r, now);
      const left = def ? def.items.filter((_, i) => !cur.items[i]?.done).map(i => i.text) : [];
      if (def?.briefFields) left.unshift('Fill the client brief (product, price, offer, competitors, links)');
      if (def?.linkLabel && !cur.link) left.push(`Add the ${def.linkLabel.toLowerCase()}`);
      return {
        runId: String(r._id), clientName: r.clientName, dayNumber: st.dayNumber,
        stepKey: cur?.key || '', stepTitle: def?.title || '', dueAt: cur?.dueAt || null, graceUntil: cur?.graceUntil || null,
        state: cur?.state || 'done', todo: left,
        updatedToday: hasUpdateToday(r, now),
        // The owner is accountable for the daily update; helpers see the work but aren't blocked.
        role: r.assignedTo === req.user!.id ? 'owner' : 'helper',
        required: r.assignedTo === req.user!.id && req2.required, why: req2.why,
        lastUpdate: (r.dailyUpdates || []).slice(-1)[0] || null,
        progress: progressSummary(r),
        // Owner or helper: the brand's video counts have never been confirmed → ask at login.
        needsProgress: !r.videoProgress?.updatedAt,
      };
    }).sort((a: any, b: any) => String(a.dueAt).localeCompare(String(b.dueAt)));
    res.json({ items, fromHour: 17 });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/daily-update  { text, blocker? } — assignee only
export async function postDailyUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await loadForAction(req, res); if (!run) return;
    const text = String(req.body?.text || '').trim();
    const blocker = String(req.body?.blocker || '').trim().slice(0, 400);
    if (text.length < 15) { res.status(400).json({ error: 'Write what was actually done today on this step (at least a full sentence).' }); return; }
    const st = computeRunState(run.toObject());
    const today = istDateKey();
    run.dailyUpdates.push({ dateIST: today, at: new Date(), by: req.user!.id, stepKey: st.currentStep || '', text: text.slice(0, 800), blocker });
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'daily_update', stepKey: st.currentStep || '',
      detail: `Daily update (${stepTitle(st.currentStep || '')}): ${text.slice(0, 200)}${blocker ? ` · Blocker: ${blocker}` : ''}` });
    await run.save();
    await mirrorToCrm(run, req.user!.id, '', `Video daily update · ${stepTitle(st.currentStep || '')}: ${text}${blocker ? ` · Blocker: ${blocker}` : ''}`);
    if (blocker) {
      const managers = await User.find({ organizationId: run.organizationId, isActive: true, $or: [{ role: 'admin' }, { roles: 'admin' }, { canViewOversight: true }] }).select('_id').lean();
      notify({ io: req.app.get('io'), organizationId: String(run.organizationId), actorId: req.user!.id, userIds: managers.map((m: any) => String(m._id)),
        type: 'video_sop.blocker', entityType: 'video_sop', entityId: String(run._id),
        title: `⛔ ${run.clientName}: video team is blocked`, body: `${req.user!.name}: ${blocker}` });
    }
    notifyDataChanged(req.app.get('io'), String(run.organizationId), 'video_sop.update', String(run._id));
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/progress  { total, scripting, shooting, editing, delivered, note } — owner or helper
export async function updateProgressCounts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await loadForAction(req, res); if (!run) return;
    const n = (v: any) => Math.max(0, Math.min(500, Math.round(Number(v) || 0)));
    const b = req.body || {};
    const total = n(b.total), scripting = n(b.scripting), shooting = n(b.shooting), editing = n(b.editing), delivered = n(b.delivered);
    if (total < 1) { res.status(400).json({ error: 'Enter the total number of videos for this brand' }); return; }
    if (scripting + shooting + editing + delivered > total) { res.status(400).json({ error: `Those add up to ${scripting + shooting + editing + delivered} — more than the ${total} total videos` }); return; }
    const before = progressSummary(run.toObject());
    run.videoProgress = { total, scripting, shooting, editing, delivered, note: String(b.note || '').slice(0, 300), updatedAt: new Date(), updatedBy: req.user!.id } as any;
    if (!run.brief?.videos) (run.brief as any).videos = String(total);
    const after = progressSummary(run.toObject());
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'progress', detail: `Videos: ${after.label}${after.note ? ` — ${after.note}` : ''}` });
    await run.save();
    await mirrorToCrm(run, req.user!.id, '', `Videos: ${after.label} (was ${before.label})${after.note ? ` — ${after.note}` : ''}`);
    notifyDataChanged(req.app.get('io'), String(run.organizationId), 'video_sop.progress', String(run._id));
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Manager actions ─────────────────────────────────────────────────────

// POST /api/video-sop/start  { workflowId, serviceId, startedAt? }
export async function startRunManually(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Only admin / managers can add a brand manually' }); return; }
    const orgId = await orgOf(req);
    const { workflowId, serviceId, startedAt } = req.body || {};
    const start = startedAt ? new Date(startedAt) : new Date();
    if (isNaN(start.getTime())) { res.status(400).json({ error: 'Invalid start date' }); return; }
    const run: any = await startRun(orgId!, workflowId, serviceId, start, req.user!.id);
    // Live brands that are already part-way through: mark every step BEFORE
    // `currentStep` as done-before-tracking (not late), so the SOP picks up
    // exactly where the brand really is.
    const currentStep = String(req.body?.currentStep || '');
    if (currentStep && run.status === 'active' && !run.steps[0].doneAt && markDoneBefore(run, currentStep, start, req.user!.id) > 0) {
      run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'imported',
        detail: `Started mid-way — steps before "${stepTitle(currentStep)}" marked done before tracking` });
      await run.save();
      await syncServiceChecklist(run, req.user!.id);
    }
    if (req.body?.assignTo) {
      const u: any = await User.findOne({ _id: req.body.assignTo, organizationId: orgId, isActive: true }).select('_id name').lean();
      if (u) {
        run.assignedTo = String(u._id);
        run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'assigned', detail: `Assigned to ${u.name}` });
        await run.save();
        await syncCrmOwner(run, String(u._id));
      }
    }
    const [h] = await hydrate([run.toObject ? run.toObject() : run]);
    res.json(h);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/assign  { userId }
export async function assignRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Only admin / managers can reassign' }); return; }
    const orgId = await orgOf(req);
    const run = await VideoSopRun.findOne({ _id: req.params.id, organizationId: orgId });
    if (!run) { res.status(404).json({ error: 'Video brand not found' }); return; }
    const u: any = await User.findOne({ _id: req.body?.userId, organizationId: orgId, isActive: true }).select('_id name').lean();
    if (!u) { res.status(400).json({ error: 'Pick a teammate' }); return; }
    // CRM first, then the run — so a failure can't leave CRM, DT and the SOP disagreeing.
    await syncCrmOwner(run, String(u._id));
    run.assignedTo = String(u._id);
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'assigned', detail: `Assigned to ${u.name}` });
    await run.save();
    notify({ io: req.app.get('io'), organizationId: String(run.organizationId), userId: String(u._id), actorId: req.user!.id,
      type: 'video_sop.assigned', entityType: 'video_sop', entityId: String(run._id),
      title: `🎬 New video brand: ${run.clientName}`, body: 'Robin has set your tasks for this brand. Open My tasks to start.' });
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/steps/:key/reopen  { reason }
export async function reopenStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Only admin / managers can reopen a step' }); return; }
    const orgId = await orgOf(req);
    const run = await VideoSopRun.findOne({ _id: req.params.id, organizationId: orgId });
    if (!run) { res.status(404).json({ error: 'Video brand not found' }); return; }
    const { idx, def } = stepOf(run, req.params.key);
    if (idx < 0 || !def) { res.status(404).json({ error: 'Unknown step' }); return; }
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) { res.status(400).json({ error: 'Say why the step is being reopened' }); return; }
    // Reopening a step reopens everything after it too — the SOP is sequential.
    for (let i = idx; i < run.steps.length; i++) {
      const s: any = run.steps[i];
      s.doneAt = null; s.doneBy = ''; s.late = false; s.afterGrace = false; s.lateReason = ''; s.lateNote = '';
    }
    run.status = 'active'; run.completedAt = null;
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'reopened', stepKey: def.key, detail: `${def.title} reopened — ${reason}` });
    await run.save();
    const [h] = await hydrate([run.toObject()]);
    res.json(h);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/video-sop/:id/cancel  { reason }
export async function cancelRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Only admin / managers can cancel' }); return; }
    const orgId = await orgOf(req);
    const run = await VideoSopRun.findOne({ _id: req.params.id, organizationId: orgId });
    if (!run) { res.status(404).json({ error: 'Video brand not found' }); return; }
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) { res.status(400).json({ error: 'Say why the video tasks are being stopped' }); return; }
    run.status = 'cancelled';
    run.log.push({ actorId: req.user!.id, actorName: req.user!.name, action: 'cancelled', detail: reason });
    await run.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
