import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Project from '../models/Project';

/**
 * Projects — STRICT org isolation. All read / update / delete handlers
 * filter by organizationId on the target document.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const role = req.user!.role;
    let query: any = { organizationId: orgId };
    if (role === 'employee') query = { ...query, $or: [{ projectLeadId: req.user!.id }, { 'members.userId': req.user!.id }] };
    if (role === 'client')   query = { ...query, clientId: req.user!.id };
    const projects = await Project.find(query).sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Whitelist project fields. Never spread req.body — would let a client
    // forge organizationId or other internal fields.
    const { name, description, status, clientId, projectLeadId, members, startDate, endDate, budget } = req.body || {};
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const project = await Project.create({
      name, description, status, clientId, projectLeadId,
      members: Array.isArray(members) ? members : [],
      startDate, endDate, budget,
      organizationId: orgId,
    });
    res.status(201).json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const project = await Project.findOne({ _id: req.params.id, organizationId: orgId });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['name', 'description', 'status', 'clientId', 'projectLeadId', 'startDate', 'endDate', 'budget'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await Project.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ message: 'Project deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { userId, roleInProject } = req.body || {};
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    // Verify the new member is also in MY org — can't pull a member from another agency.
    const candidate = await User.findOne({ _id: userId, organizationId: orgId }).select('_id').lean();
    if (!candidate) { res.status(404).json({ error: 'User not found in your organization' }); return; }
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { $push: { members: { userId, roleInProject } } },
      { new: true },
    );
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { $pull: { members: { userId: req.params.userId } } },
      { new: true },
    );
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
