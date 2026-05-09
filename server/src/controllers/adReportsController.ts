import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import AdReport from '../models/AdReport';
import User from '../models/User';
import { Types } from 'mongoose';

/**
 * AdReports — STRICT org isolation. listReports and getSummary previously
 * accepted any projectId without verifying that the project belongs to the
 * actor's org. That allowed cross-tenant ad-report enumeration. Now every
 * read filters by organizationId.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listReports(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { projectId, from, to, platform } = req.query;
    const filter: any = { organizationId: orgId };
    if (projectId) filter.projectId = projectId;
    if (platform)  filter.platform  = platform;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to)   filter.date.$lte = new Date(to as string);
    }
    if (req.user!.role === 'client') filter.isVisible = true;
    const reports = await AdReport.find(filter).sort({ date: -1 }).limit(90);
    res.json(reports);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['projectId', 'platform', 'date', 'spend', 'reach', 'clicks', 'leads',
                     'revenue', 'roas', 'cpl', 'ctr', 'notes', 'isVisible'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const report = await AdReport.create({ ...body, organizationId: orgId, postedBy: req.user!.id });
    res.status(201).json(report);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['platform', 'date', 'spend', 'reach', 'clicks', 'leads',
                     'revenue', 'roas', 'cpl', 'ctr', 'notes', 'isVisible'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const report = await AdReport.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!report) { res.status(404).json({ error: 'Report not found' }); return; }
    res.json(report);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await AdReport.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Report not found' }); return; }
    res.json({ message: 'Report deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { projectId, from, to } = req.query;
    const match: any = { organizationId: new Types.ObjectId(orgId), isVisible: true };
    if (projectId) match.projectId = new Types.ObjectId(projectId as string);
    if (from || to) {
      match.date = {};
      if (from) match.date.$gte = new Date(from as string);
      if (to)   match.date.$lte = new Date(to as string);
    }
    const [result] = await AdReport.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        totalSpend:  { $sum: '$spend' },
        totalLeads:  { $sum: '$leads' },
        totalReach:  { $sum: '$reach' },
        totalClicks: { $sum: '$clicks' },
        totalRevenue:{ $sum: '$revenue' },
        avgRoas:     { $avg: '$roas' },
        avgCpl:      { $avg: '$cpl' },
        avgCtr:      { $avg: '$ctr' },
        count:       { $sum: 1 },
      }},
    ]);
    res.json(result || {});
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
