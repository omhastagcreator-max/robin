import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Project from '../models/Project';
import ProjectTask from '../models/ProjectTask';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
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
    const project = await Project.create({ ...req.body, organizationId: orgId });
    res.status(201).json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Project.findByIdAndDelete(req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId, roleInProject } = req.body;
    const project = await Project.findByIdAndUpdate(req.params.id, { $push: { members: { userId, roleInProject } } }, { new: true });
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, { $pull: { members: { userId: req.params.userId } } }, { new: true });
    res.json(project);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
