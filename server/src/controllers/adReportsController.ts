import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import AdReport from '../models/AdReport';
import User from '../models/User';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listReports(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, from, to, platform } = req.query;
    const filter: any = {};
    if (projectId) filter.projectId = projectId;
    if (platform)  filter.platform  = platform;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to)   filter.date.$lte = new Date(to as string);
    }
    // Clients only see their own project reports that are visible
    if (req.user!.role === 'client') filter.isVisible = true;
    const reports = await AdReport.find(filter).sort({ date: -1 }).limit(90);
    res.json(reports);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const report = await AdReport.create({ ...req.body, organizationId: orgId, postedBy: req.user!.id });
    res.status(201).json(report);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const report = await AdReport.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!report) { res.status(404).json({ error: 'Report not found' }); return; }
    res.json(report);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    await AdReport.findByIdAndDelete(req.params.id);
    res.json({ message: 'Report deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, from, to } = req.query;
    const match: any = { projectId, isVisible: true };
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
