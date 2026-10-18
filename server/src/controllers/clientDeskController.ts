import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ActivityLog from '../models/ActivityLog';
import WorkflowActivity from '../models/WorkflowActivity';
import { performWorkflowAction, WorkflowActionError } from '../services/workflowActions';
import { notifyDataChanged } from '../services/notify';
import { isPrivilegedEditor, recomputeServiceStatuses } from './clientWorkflowController';
import VideoSopRun from '../models/VideoSopRun';

/**
 * clientDeskController — Oct 2026, from Rahul's voice notes on the Decision
 * Tree ("DT"):
 *   · record WHO OPENED a client and WHEN, even if they changed nothing
 *   · one-step status update: pick the stage reached from a dropdown, say
 *     the NEXT TASK (+ by when), add notes → one clean log line
 *     "Name (Dept) moved X → Y on <date, time>" with the notes under it
 *   · log every client update that was pushed (WhatsApp)
 *   · a clean log: who, department, what changed, when, notes — no noise
 */

const OPEN_THROTTLE_MS = 20 * 60_000;

async function orgOf(req: AuthRequest) {
  if (req.user?.organizationId) return req.user.organizationId;
  const u = await User.findById(req.user!.id).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}
const dept = (u: any) => (u?.department || u?.team || (u?.teams || [])[0] || u?.role || '').toString();

// POST /api/client-workflows/:id/viewed
export async function recordOpen(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const wf: any = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id clientName').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }
    const recent = await ActivityLog.exists({
      userId: req.user!.id, action: 'client.opened', entityId: wf._id,
      createdAt: { $gte: new Date(Date.now() - OPEN_THROTTLE_MS) },
    });
    if (!recent) {
      await ActivityLog.create({
        organizationId: orgId, userId: req.user!.id, action: 'client.opened',
        entity: 'client_workflow', entityId: wf._id,
        metadata: { label: wf.clientName, where: String(req.body?.where || 'decision_tree').slice(0, 40) },
      });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/client-workflows/:id/opens — who opened this client, newest first
export async function listOpens(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const wf: any = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }
    const rows = await ActivityLog.find({ action: 'client.opened', entityId: wf._id }).sort({ createdAt: -1 }).limit(30).lean();
    const users = await User.find({ _id: { $in: rows.map((r: any) => r.userId) } }).select('name role team teams department').lean();
    const byId = new Map(users.map((u: any) => [String(u._id), u]));
    res.json(rows.map((r: any) => {
      const u = byId.get(String(r.userId));
      return { at: r.createdAt, userId: r.userId, name: u?.name || 'Someone', department: dept(u) };
    }));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/client-workflows/:id/log — clean change log (who · dept · what · when · notes)
export async function cleanLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const wf: any = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id services').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }
    const rows = await WorkflowActivity.find({ workflowId: wf._id }).sort({ createdAt: -1 }).limit(150)
      .select('action serviceType serviceId actorId actorName actorRole comment before after createdAt').lean();
    const users = await User.find({ _id: { $in: rows.map((r: any) => r.actorId) } }).select('name role team teams department').lean();
    const byId = new Map(users.map((u: any) => [String(u._id), u]));
    const svcLabel = new Map((wf.services || []).map((s: any) => [String(s._id), s.label]));
    // Collapse noise: consecutive single-item ticks by the same person on the
    // same stage within 10 minutes become one line ("ticked 3 items").
    const out: any[] = [];
    for (const r of rows as any[]) {
      const u = byId.get(String(r.actorId));
      const stage = svcLabel.get(String(r.serviceId)) || r.serviceType || '';
      let what = '';
      switch (r.action) {
        case 'item_checked':   what = `ticked "${r.after?.text || r.before?.text || 'a checklist item'}"`; break;
        case 'item_unchecked': what = `unticked "${r.before?.text || r.after?.text || 'a checklist item'}"`; break;
        case 'service_completed': what = `completed the ${stage} stage`; break;
        case 'service_returned':  what = `returned ${stage} for rework`; break;
        case 'service_reassigned': what = `reassigned ${stage}`; break;
        case 'eta_updated':       what = `changed the ${stage} ETA`; break;
        case 'client_update_sent': what = 'sent the client an update'; break;
        case 'status_changed':
        default:
          if (r.before?.status !== undefined || r.after?.status !== undefined) {
            what = `changed status from "${r.before?.status || '—'}" to "${r.after?.status || '—'}"`;
          } else what = String(r.action || '').replace(/_/g, ' ');
      }
      const prev = out[out.length - 1];
      if (prev && r.action === 'item_checked' && prev.action === 'item_checked' && prev.actorId === String(r.actorId)
        && prev.stage === stage && new Date(prev.at).getTime() - new Date(r.createdAt).getTime() < 10 * 60_000) {
        prev.count = (prev.count || 1) + 1;
        prev.what = `ticked ${prev.count} checklist items`;
        continue;
      }
      out.push({
        at: r.createdAt, action: r.action, actorId: String(r.actorId),
        name: u?.name || r.actorName || 'Someone', department: dept(u) || r.actorRole || '',
        stage, what, notes: r.comment || '',
        nextTask: r.after?.nextTask || '', nextTaskDue: r.after?.nextTaskDue || null,
      });
    }
    res.json(out.slice(0, 80));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/client-workflows/:id/services/:sid/progress
//   { reachedIndex: number | 'complete', nextTask?, nextTaskDue?, note }
export async function updateProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const wf: any = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }
    const svc = wf.services.id(req.params.sid);
    if (!svc) { res.status(404).json({ error: 'Stage not found' }); return; }
    if (svc.assignedTo !== req.user!.id && !isPrivilegedEditor(req.user!)) {
      res.status(403).json({ error: 'Only the stage owner (or admin) can move this stage' }); return;
    }
    const note = String(req.body?.note || '').trim();
    const nextTask = String(req.body?.nextTask || '').trim().slice(0, 240);
    const nextTaskDue = req.body?.nextTaskDue ? new Date(req.body.nextTaskDue) : null;
    if (nextTaskDue && isNaN(nextTaskDue.getTime())) { res.status(400).json({ error: 'Invalid next-task date' }); return; }
    const items: any[] = svc.checklist || [];
    const reached = req.body?.reachedIndex;
    const lastDoneIdx = items.reduce((m: number, it: any, i: number) => it.done ? i : m, -1);
    const label = (i: number) => i < 0 ? 'Not started' : (items[i]?.text || `Step ${i + 1}`);
    const fromStatus = svc.status === 'done' ? 'Stage complete' : label(lastDoneIdx);
    let toIdx = lastDoneIdx;
    if (reached !== undefined && reached !== null && reached !== '') {
      toIdx = Number(reached);
      if (!Number.isInteger(toIdx) || toIdx < -1 || toIdx >= items.length) { res.status(400).json({ error: 'Pick a valid stage' }); return; }
      if (toIdx < lastDoneIdx) { res.status(400).json({ error: 'Moving a stage backwards is done with "Return for rework" — this only moves forward' }); return; }
    }
    const moved = toIdx !== lastDoneIdx;
    if (!moved && !nextTask && note.length < 3) { res.status(400).json({ error: 'Nothing to save — move the stage, set a next task, or add a note' }); return; }
    const toStatus = label(toIdx);
    const comment = note.length >= 3 ? note
      : moved ? `Moved to "${toStatus}"` : `Next task: ${nextTask}`;
    try {
      const result = await performWorkflowAction({
        workflowId: String(wf._id),
        actorId: req.user!.id,
        action: 'note_added',
        serviceId: String(svc._id),
        serviceType: svc.serviceType,
        comment,
        before: { status: fromStatus, nextTask: svc.nextTask || '' },
        after: { status: moved ? toStatus : fromStatus, nextTask, nextTaskDue },
        summaryForRollup: moved ? `${svc.label}: ${fromStatus} → ${toStatus}` : `${svc.label}: next — ${nextTask || note}`,
        isClientRelevant: moved,
        mutate: async (doc: any) => {
          const s = doc.services.id(String(svc._id));
          for (let i = 0; i <= toIdx; i++) {
            if (!s.checklist[i].done) { s.checklist[i].done = true; s.checklist[i].doneAt = new Date(); s.checklist[i].doneBy = req.user!.id; }
          }
          if (nextTask || req.body?.nextTask === '') {
            s.nextTask = nextTask; s.nextTaskDue = nextTaskDue; s.nextTaskSetBy = req.user!.id; s.nextTaskSetAt = new Date();
          }
          recomputeServiceStatuses(doc);
          doc.activity.push({ actorId: req.user!.id, action: 'status_update', serviceType: s.serviceType,
            detail: `${s.label}: ${fromStatus} → ${moved ? toStatus : fromStatus}${nextTask ? ` · next: ${nextTask}` : ''} — "${comment}"` });
        },
      });
      notifyDataChanged(req.app.get('io'), String(orgId), 'workflow.progress', String(wf._id));
      res.json(result.workflow);
    } catch (e: any) {
      if (e instanceof WorkflowActionError) { res.status(e.status || 400).json({ error: e.message }); return; }
      throw e;
    }
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/client-workflows/:id/client-update  { message, channel: 'whatsapp' | 'copy' }
export async function logClientUpdate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await orgOf(req);
    const wf: any = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }
    const message = String(req.body?.message || '').trim();
    if (message.length < 3) { res.status(400).json({ error: 'Message is empty' }); return; }
    const channel = req.body?.channel === 'whatsapp' ? 'WhatsApp' : 'copied';
    await performWorkflowAction({
      workflowId: String(wf._id), actorId: req.user!.id, action: 'client_update_sent',
      comment: `[${channel}] ${message}`.slice(0, 600), isClientRelevant: true,
      after: { channel }, summaryForRollup: `Client update sent (${channel})`,
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof WorkflowActionError) { res.status(err.status || 400).json({ error: err.message }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Admin, or a manager granted Team Oversight (Rahul). */
async function isManager(req: AuthRequest): Promise<boolean> {
  if ([req.user!.role, ...(req.user!.roles || [])].includes('admin')) return true;
  const u: any = await User.findById(req.user!.id).select('canViewOversight').lean();
  return u?.canViewOversight === true;
}

// GET /api/client-workflows/cleanup/list — every client in Robin, incl. archived
export async function cleanupList(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Admin / managers only' }); return; }
    const orgId = await orgOf(req);
    const rows = await ClientWorkflow.find({ organizationId: orgId })
      .select('clientName services operationalStatus tags lastActivityAt updatedAt onboardedAt createdAt totalAmount').sort({ clientName: 1 }).lean();
    res.json((rows as any[]).map(w => ({
      _id: String(w._id), clientName: w.clientName || 'Client',
      archived: (w.tags || []).includes('archived'),
      status: w.operationalStatus || 'in_progress',
      services: (w.services || []).map((s: any) => ({ label: s.label, status: s.status })),
      lastActivityAt: w.lastActivityAt || w.updatedAt, onboardedAt: w.onboardedAt || w.createdAt,
      totalAmount: w.totalAmount || 0,
    })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/client-workflows/cleanup  { keep: string[], archive: string[] }
// Archive = hidden from CRM / Decision Tree / Video SOP; nothing is deleted and
// it can be restored by ticking the client again.
export async function cleanupApply(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await isManager(req))) { res.status(403).json({ error: 'Admin / managers only' }); return; }
    const orgId = await orgOf(req);
    const keep: string[] = Array.isArray(req.body?.keep) ? req.body.keep.map(String) : [];
    const archive: string[] = Array.isArray(req.body?.archive) ? req.body.archive.map(String) : [];
    let archived = 0, restored = 0;
    for (const id of archive) {
      const wf: any = await ClientWorkflow.findOne({ _id: id, organizationId: orgId });
      if (!wf || (wf.tags || []).includes('archived')) continue;
      wf.tags = Array.from(new Set([...(wf.tags || []), 'archived']));
      wf.set('archivedFromStatus', wf.operationalStatus);
      wf.operationalStatus = 'cancelled';
      wf.activity.push({ actorId: req.user!.id, action: 'archived', detail: 'Archived in client clean-up (not active)' });
      await wf.save();
      await VideoSopRun.updateMany({ workflowId: wf._id, status: 'active' }, { $set: { status: 'cancelled' } });
      archived++;
    }
    for (const id of keep) {
      const wf: any = await ClientWorkflow.findOne({ _id: id, organizationId: orgId });
      if (!wf || !(wf.tags || []).includes('archived')) continue;
      wf.tags = (wf.tags || []).filter((t: string) => t !== 'archived');
      wf.operationalStatus = wf.get('archivedFromStatus') && wf.get('archivedFromStatus') !== 'cancelled' ? wf.get('archivedFromStatus') : 'in_progress';
      wf.activity.push({ actorId: req.user!.id, action: 'restored', detail: 'Restored in client clean-up (active)' });
      await wf.save();
      restored++;
    }
    await ActivityLog.create({ organizationId: orgId, userId: req.user!.id, action: 'clients.cleanup', entity: 'organization',
      metadata: { label: `${archived} archived, ${restored} restored` } }).catch(() => {});
    notifyDataChanged(req.app.get('io'), String(orgId), 'workflow.cleanup');
    res.json({ archived, restored });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
