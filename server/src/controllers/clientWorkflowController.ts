import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import SopOverride from '../models/SopOverride';
import { SERVICE_TEMPLATES, SERVICE_TYPES, blockingServices, type ServiceType } from '../lib/workflowTemplates';
import { notify } from '../services/notify';

/**
 * Resolve the effective SOP checklist + label for a service in a given org.
 * Falls back to the default template if there's no override saved. Lets us
 * ship admin SOP editing later without changing any callers.
 */
async function resolveTemplate(orgId: string, type: ServiceType): Promise<{ label: string; checklist: string[]; team: string; dependsOn: ServiceType[] }> {
  const def = SERVICE_TEMPLATES[type];
  const override = await SopOverride.findOne({ organizationId: orgId, serviceType: type }).lean();
  return {
    label:     override?.label || def.label,
    checklist: (override?.checklist && override.checklist.length > 0) ? override.checklist : def.checklist,
    team:      def.team,
    dependsOn: def.dependsOn,
  };
}

/**
 * Client Workflow controller — org-isolated, role-gated.
 *
 * Capability matrix:
 *   - sales/admin: create workflows, see ALL workflows in the org, search
 *   - employee: see only workflows where they're assigned to a service;
 *     can tick checklist items on THEIR services; can return services to
 *     a previous owner.
 *   - all internal: search by phone, view a workflow.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

const normPhone = (p?: string) => (p || '').replace(/\D/g, '').slice(-10);

/**
 * Derive each service's status from checklist progress + dependencies.
 * Pure function — operates on the workflow in memory before save.
 */
function recomputeServiceStatuses(wf: any) {
  const presentTypes: ServiceType[] = wf.services.map((s: any) => s.serviceType);
  const doneTypes = new Set<ServiceType>(
    wf.services.filter((s: any) => s.status === 'done').map((s: any) => s.serviceType),
  );
  for (const s of wf.services) {
    // 'done' is sticky — only the explicit /complete or /return endpoint changes it.
    if (s.status === 'done') continue;
    const blockers = blockingServices(s.serviceType, presentTypes).filter(t => !doneTypes.has(t));
    if (blockers.length > 0) {
      s.status = 'blocked';
      continue;
    }
    // No blockers — base status on checklist progress.
    const total = (s.checklist || []).length;
    const ticked = (s.checklist || []).filter((c: any) => c.done).length;
    if (ticked === 0) s.status = 'pending';
    else              s.status = 'in_progress';
    if (!s.startedAt && ticked > 0) s.startedAt = new Date();
    // Clear stale startedAt if the user unticked everything — otherwise
    // reports show "started 3 weeks ago" on a service that's pending again.
    if (ticked === 0 && s.startedAt) s.startedAt = undefined;
  }
}

/** Pick an employee on `team` to auto-assign a new service to. */
async function pickAssignee(orgId: string, team: string): Promise<string | null> {
  // Round-robin by lowest currently-assigned active-workflow count.
  // Cheap query: count open assignments per teammate in this team.
  const candidates = await User.find({
    organizationId: orgId,
    isActive: true,
    role: { $in: ['employee', 'sales', 'admin'] },
    $or: [{ team }, { teams: team }],
  }).select('_id name').lean();
  if (candidates.length === 0) return null;

  const ids = candidates.map(c => String(c._id));
  const counts = await ClientWorkflow.aggregate([
    { $match: { organizationId: new Types.ObjectId(orgId) } },
    { $unwind: '$services' },
    { $match: { 'services.status': { $in: ['pending', 'in_progress', 'blocked'] }, 'services.assignedTo': { $in: ids } } },
    { $group: { _id: '$services.assignedTo', n: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map(c => [String(c._id), c.n]));
  ids.sort((a, b) => (countById.get(a) || 0) - (countById.get(b) || 0));
  return ids[0];
}

// ── Create or upsert a workflow when sales onboards a client ────────────
/**
 * POST /api/client-workflows
 * Body: {
 *   clientId,                              // existing User with role=client
 *   services: ServiceType[],               // which services this client gets
 * }
 */
export async function createWorkflow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { clientId, services } = req.body || {};
    if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }
    if (!Array.isArray(services) || services.length === 0) {
      res.status(400).json({ error: 'Pick at least one service' });
      return;
    }
    const invalid = services.filter((s: string) => !SERVICE_TYPES.includes(s as any));
    if (invalid.length) { res.status(400).json({ error: `Unknown service: ${invalid.join(', ')}` }); return; }

    const client = await User.findOne({ _id: clientId, organizationId: orgId, role: 'client' }).select('name phone email').lean();
    if (!client) { res.status(400).json({ error: 'Client not found' }); return; }

    // Build each service from its (possibly overridden) template, auto-
    // assigning a teammate from the right team.
    const serviceDocs = await Promise.all(services.map(async (type: ServiceType) => {
      const tpl = await resolveTemplate(orgId, type);
      const assignedTo = await pickAssignee(orgId, tpl.team);
      return {
        serviceType: type,
        label: tpl.label,
        assignedTo: assignedTo || undefined,
        status: 'pending',
        checklist: tpl.checklist.map(text => ({ text, done: false })),
      };
    }));

    // Upsert — if a workflow already exists for this client, add NEW services
    // to it rather than refusing or duplicating.
    const existing = await ClientWorkflow.findOne({ organizationId: orgId, clientId });
    let wf;
    let notifyServices: typeof serviceDocs;
    if (existing) {
      const existingTypes = new Set(existing.services.map(s => s.serviceType));
      const toAdd = serviceDocs.filter(s => !existingTypes.has(s.serviceType));
      if (toAdd.length === 0) {
        res.status(409).json({ error: 'Client already has these services in the pipeline' });
        return;
      }
      existing.services.push(...(toAdd as any));
      existing.activity.push({
        actorId: req.user!.id, action: 'services_added',
        detail: `Added: ${toAdd.map(s => s.label).join(', ')}`,
      } as any);
      recomputeServiceStatuses(existing);
      wf = await existing.save();
      notifyServices = toAdd;
    } else {
      wf = await ClientWorkflow.create({
        organizationId: orgId,
        clientId,
        clientName: client.name,
        clientPhone: (client as any).phone,
        clientEmail: client.email,
        services: serviceDocs,
        createdBy: req.user!.id,
        activity: [{
          actorId: req.user!.id,
          action: 'created',
          detail: `Pipeline created with: ${serviceDocs.map(s => s.label).join(', ')}`,
        }],
      });
      recomputeServiceStatuses(wf);
      await wf.save();
      notifyServices = serviceDocs;
    }

    // Notify every freshly assigned teammate — one notification per
    // service they got. Skips the sales person who created the pipeline.
    const io = req.app.get('io');
    for (const s of notifyServices) {
      if (!s.assignedTo) continue;
      await notify({
        io, organizationId: orgId, actorId: req.user!.id,
        userId: s.assignedTo,
        type: 'workflow.assigned',
        title: `New client work: ${s.label}`,
        body:  `${client.name || 'A client'} just got onboarded. You're the owner for ${s.label}.`,
        entityId: String(wf._id), entityType: 'workflow',
      });
    }

    res.status(201).json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── List / search ────────────────────────────────────────────────────────
/**
 * GET /api/client-workflows
 *   ?q=phone-or-name   (universal search bar)
 *   ?mine=1            (only workflows where I'm assigned to a service)
 */
export async function listWorkflows(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const filter: any = { organizationId: orgId };
    const { q, mine } = req.query as Record<string, string>;

    // Non-admins/sales are FORCED to their own pipelines (created or
    // assigned). Without this, an employee could untick "Only mine" in
    // the UI and see every client in the org — the gate has to be on the
    // server, not in the React state.
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'sales') {
      filter.$or = [
        { 'services.assignedTo': req.user!.id },
        { createdBy: req.user!.id },
      ];
    } else if (mine === '1') {
      filter['services.assignedTo'] = req.user!.id;
    }

    if (q && q.trim()) {
      const trimmed = q.trim();
      const digits = trimmed.replace(/\D/g, '');
      filter.$or = [];
      // Phone search — match last-10-digits or substring
      if (digits.length >= 4) filter.$or.push({ clientPhone: { $regex: digits, $options: 'i' } });
      // Name + email partial match
      filter.$or.push({ clientName:  { $regex: trimmed, $options: 'i' } });
      filter.$or.push({ clientEmail: { $regex: trimmed, $options: 'i' } });
    }

    const list = await ClientWorkflow.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Workflow access policy:
 *   - admin/sales: can see ALL workflows in the org
 *   - employee:    can only see workflows where THEY own at least one service
 *                  OR where they created it.
 *
 * Centralised so getWorkflow / addNote / returnService / etc. all enforce
 * the same rule. Returns true if access is allowed.
 */
function canSeeWorkflow(wf: any, userId: string, role: string): boolean {
  if (role === 'admin' || role === 'sales') return true;
  if (wf.createdBy === userId) return true;
  return (wf.services || []).some((s: any) => s.assignedTo === userId);
}

// ── Get a single workflow (full detail + activity log) ───────────────────
export async function getWorkflow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    // AuthZ: stop employees from URL-guessing into workflows they don't own.
    if (!canSeeWorkflow(wf, req.user!.id, req.user!.role)) {
      res.status(403).json({ error: 'You do not have access to this client' });
      return;
    }

    // Hydrate assignee names on services AND activity log actor names so
    // the UI doesn't show user IDs as avatars.
    const ids = new Set<string>();
    wf.services.forEach((s: any) => { if (s.assignedTo) ids.add(s.assignedTo); });
    (wf.activity || []).forEach((a: any) => { if (a.actorId) ids.add(a.actorId); });
    // Build the hydrated response as a plain JS object so we can safely
    // attach assignee / actorName fields. We can't assign back to wf.services
    // / wf.activity directly because Mongoose's lean() still types those as
    // DocumentArray<...> and TS rejects a plain []. Spread into a fresh
    // object instead — exactly what we want to send to the client anyway.
    let payload: any = wf;
    if (ids.size) {
      const users = await User.find({ _id: { $in: Array.from(ids) } }).select('name email').lean();
      const byId = new Map(users.map(u => [String(u._id), u]));
      payload = {
        ...wf,
        services: wf.services.map((s: any) => ({
          ...s,
          assignee: s.assignedTo ? byId.get(s.assignedTo) : null,
        })),
        activity: (wf.activity || []).map((a: any) => ({
          ...a,
          actorName: byId.get(a.actorId)?.name || byId.get(a.actorId)?.email || 'Someone',
        })),
      };
    }
    res.json(payload);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Tick / untick a checklist item ───────────────────────────────────────
/** PUT /api/client-workflows/:id/services/:sid/check  { index, done } */
export async function toggleChecklist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { index, done } = req.body || {};
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const svc = wf.services.id(req.params.sid);
    if (!svc) { res.status(404).json({ error: 'Service not found' }); return; }
    // Only the assignee or an admin can tick
    if (svc.assignedTo !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You can only update your own assigned service' });
      return;
    }
    if (svc.status === 'blocked') { res.status(409).json({ error: 'Service is blocked by another service that isn\'t done yet' }); return; }
    const item = svc.checklist?.[index];
    if (!item) { res.status(400).json({ error: 'Invalid checklist index' }); return; }
    item.done = !!done;
    item.doneAt = done ? new Date() : undefined;
    item.doneBy = done ? req.user!.id : undefined;
    // Returning a service back to in_progress clears the prior return note.
    if (done && svc.returnedReason) { svc.returnedReason = undefined; svc.returnedAt = undefined; }
    recomputeServiceStatuses(wf);
    wf.activity.push({
      actorId: req.user!.id, action: done ? 'item_checked' : 'item_unchecked',
      serviceType: svc.serviceType, detail: item.text,
    } as any);
    await wf.save();
    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Mark a whole service done (and unlock dependents) ───────────────────
export async function completeService(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const svc = wf.services.id(req.params.sid);
    if (!svc) { res.status(404).json({ error: 'Service not found' }); return; }
    if (svc.assignedTo !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only the assignee can complete this service' });
      return;
    }
    if (svc.status === 'blocked') {
      res.status(409).json({ error: 'This service is waiting on an earlier service — can\'t complete it yet.' });
      return;
    }
    const total = svc.checklist?.length || 0;
    const ticked = (svc.checklist || []).filter((c: any) => c.done).length;
    if (ticked < total) {
      res.status(409).json({ error: 'Tick every checklist item before completing the service' });
      return;
    }
    // Snapshot which services were 'blocked' BEFORE we recompute — any that
    // flip to non-blocked are now actionable and their owners deserve a ping.
    const blockedBefore = new Set(
      wf.services.filter(s => s.status === 'blocked').map(s => String((s as any)._id)),
    );

    svc.status = 'done';
    svc.completedAt = new Date();
    wf.activity.push({
      actorId: req.user!.id, action: 'service_completed',
      serviceType: svc.serviceType, detail: svc.label,
    } as any);
    recomputeServiceStatuses(wf);
    await wf.save();

    // Notify the assignees of any service that JUST got unblocked.
    const io = req.app.get('io');
    for (const s of wf.services) {
      const idStr = String((s as any)._id);
      if (blockedBefore.has(idStr) && s.status !== 'blocked' && s.assignedTo) {
        await notify({
          io, organizationId: orgId, actorId: req.user!.id,
          userId: s.assignedTo,
          type: 'workflow.unblocked',
          title: `${s.label} is now ready for you`,
          body:  `${wf.clientName || 'A client'} — ${svc.label} just wrapped up, you can start.`,
          entityId: String(wf._id), entityType: 'workflow',
        });
      }
    }
    // Also notify sales (who created the pipeline) when a whole service completes.
    if (wf.createdBy && wf.createdBy !== req.user!.id) {
      await notify({
        io, organizationId: orgId, actorId: req.user!.id,
        userId: wf.createdBy,
        type: 'workflow.completed',
        title: `${svc.label} is done · ${wf.clientName || 'client'}`,
        body:  `Pipeline progressed — check the next stage when you have a sec.`,
        entityId: String(wf._id), entityType: 'workflow',
      });
    }

    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Return a service to a previous owner (e.g. Meta → Web Dev) ──────────
export async function returnService(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { targetServiceType, reason } = req.body || {};
    if (!targetServiceType || !reason) {
      res.status(400).json({ error: 'targetServiceType + reason required' });
      return;
    }
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    // AuthZ: only people who can see this workflow can return one of its
    // services. Admin/sales always, employees only when they own at least
    // one service on this client.
    if (!canSeeWorkflow(wf, req.user!.id, req.user!.role)) {
      res.status(403).json({ error: 'You do not have access to this client' });
      return;
    }
    const target = wf.services.find((s: any) => s.serviceType === targetServiceType);
    if (!target) { res.status(400).json({ error: 'Target service not in this pipeline' }); return; }
    target.status = 'in_progress';
    target.returnedReason = String(reason).slice(0, 500);
    target.returnedAt = new Date();
    // Untick the last item so the assignee sees there's work to redo.
    if (target.checklist && target.checklist.length) {
      const last = target.checklist[target.checklist.length - 1];
      last.done = false; last.doneAt = undefined;
    }
    wf.activity.push({
      actorId: req.user!.id, action: 'service_returned',
      serviceType: target.serviceType, detail: reason,
    } as any);
    recomputeServiceStatuses(wf);
    await wf.save();

    // Ping the upstream owner (and admin) — they have rework to do.
    const io = req.app.get('io');
    if (target.assignedTo) {
      await notify({
        io, organizationId: orgId, actorId: req.user!.id,
        userId: target.assignedTo,
        type: 'workflow.returned',
        title: `${target.label} returned for rework · ${wf.clientName || 'client'}`,
        body:  `Reason: "${String(reason).slice(0, 120)}"`,
        entityId: String(wf._id), entityType: 'workflow',
      });
    }

    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Free-form note on the activity log ───────────────────────────────────
export async function addNote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { detail, serviceType } = req.body || {};
    if (!detail?.trim()) { res.status(400).json({ error: 'detail required' }); return; }
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    // AuthZ: prevent spam-notes from random employees in the org.
    if (!canSeeWorkflow(wf, req.user!.id, req.user!.role)) {
      res.status(403).json({ error: 'You do not have access to this client' });
      return;
    }
    wf.activity.push({
      actorId: req.user!.id, action: 'note',
      serviceType, detail: String(detail).slice(0, 1000),
    } as any);
    await wf.save();

    // Notify everyone assigned to a service on this client — they all
    // care about the latest note. Dedupe handled inside notify().
    const io = req.app.get('io');
    const assignees = wf.services.map(s => s.assignedTo).filter(Boolean) as string[];
    if (wf.createdBy) assignees.push(wf.createdBy);
    await notify({
      io, organizationId: orgId, actorId: req.user!.id,
      userIds: assignees,
      type: 'workflow.note',
      title: `New note on ${wf.clientName || 'client'}`,
      body:  String(detail).slice(0, 160),
      entityId: String(wf._id), entityType: 'workflow',
    });

    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Admin: reassign a service ────────────────────────────────────────────
export async function reassignService(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { userId } = req.body || {};
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId });
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const svc = wf.services.id(req.params.sid);
    if (!svc) { res.status(404).json({ error: 'Service not found' }); return; }
    const before = svc.assignedTo;
    svc.assignedTo = userId || undefined;
    wf.activity.push({
      actorId: req.user!.id, action: 'reassigned',
      serviceType: svc.serviceType, detail: `from ${before || 'unassigned'} to ${userId || 'unassigned'}`,
    } as any);
    await wf.save();

    // Notify the new owner + (if any) the previous owner who lost the work.
    const io = req.app.get('io');
    if (userId) {
      await notify({
        io, organizationId: orgId, actorId: req.user!.id, userId,
        type: 'workflow.assigned',
        title: `New client work: ${svc.label}`,
        body:  `${wf.clientName || 'A client'} — admin reassigned ${svc.label} to you.`,
        entityId: String(wf._id), entityType: 'workflow',
      });
    }
    if (before && before !== userId) {
      await notify({
        io, organizationId: orgId, actorId: req.user!.id, userId: before,
        type: 'workflow.unassigned',
        title: `Reassigned away from ${svc.label}`,
        body:  `Admin moved ${svc.label} on ${wf.clientName || 'a client'} to someone else.`,
        entityId: String(wf._id), entityType: 'workflow',
      });
    }

    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Service templates endpoint (read-only) ───────────────────────────────
export async function getServiceTemplates(_req: AuthRequest, res: Response): Promise<void> {
  res.json(SERVICE_TEMPLATES);
}
