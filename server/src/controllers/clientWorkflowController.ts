import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import { SERVICE_TEMPLATES, SERVICE_TYPES, blockingServices, type ServiceType } from '../lib/workflowTemplates';

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
    { $match: { organizationId: new (require('mongoose').Types.ObjectId)(orgId) } },
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

    // Build each service from its template, auto-assigning a teammate.
    const serviceDocs = await Promise.all(services.map(async (type: ServiceType) => {
      const tpl = SERVICE_TEMPLATES[type];
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

    if (mine === '1') {
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

// ── Get a single workflow (full detail + activity log) ───────────────────
export async function getWorkflow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    // Hydrate assignee names
    const assigneeIds = Array.from(new Set(wf.services.map((s: any) => s.assignedTo).filter(Boolean)));
    if (assigneeIds.length) {
      const users = await User.find({ _id: { $in: assigneeIds } }).select('name email').lean();
      const byId = new Map(users.map(u => [String(u._id), u]));
      wf.services = wf.services.map((s: any) => ({
        ...s,
        assignee: s.assignedTo ? byId.get(s.assignedTo) : null,
      }));
    }
    res.json(wf);
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
    const total = svc.checklist?.length || 0;
    const ticked = (svc.checklist || []).filter((c: any) => c.done).length;
    if (ticked < total) {
      res.status(409).json({ error: 'Tick every checklist item before completing the service' });
      return;
    }
    svc.status = 'done';
    svc.completedAt = new Date();
    wf.activity.push({
      actorId: req.user!.id, action: 'service_completed',
      serviceType: svc.serviceType, detail: svc.label,
    } as any);
    recomputeServiceStatuses(wf);
    await wf.save();
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
    wf.activity.push({
      actorId: req.user!.id, action: 'note',
      serviceType, detail: String(detail).slice(0, 1000),
    } as any);
    await wf.save();
    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Admin: reassign a service ────────────────────────────────────────────
export async function reassignService(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
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
    res.json(wf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Service templates endpoint (read-only) ───────────────────────────────
export async function getServiceTemplates(_req: AuthRequest, res: Response): Promise<void> {
  res.json(SERVICE_TEMPLATES);
}
