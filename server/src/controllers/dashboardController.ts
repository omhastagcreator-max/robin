import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import Project from '../models/Project';
import Session from '../models/Session';
import Lead from '../models/Lead';
import Deal from '../models/Deal';
import ClientTransaction from '../models/ClientTransaction';
import ProjectUpdate from '../models/ProjectUpdate';

async function getOrgId(userId: string) {
  const user = await User.findById(userId).select('organizationId');
  return user?.organizationId;
}

export async function adminStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const now = new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [totalTasks, completedTasks, overdueTasks, totalProjects, activeProjects, activeSessions] = await Promise.all([
      ProjectTask.countDocuments({ organizationId: orgId }),
      ProjectTask.countDocuments({ organizationId: orgId, status: 'done' }),
      ProjectTask.countDocuments({ organizationId: orgId, status: { $ne: 'done' }, dueDate: { $lt: now } }),
      Project.countDocuments({ organizationId: orgId }),
      Project.countDocuments({ organizationId: orgId, status: 'active' }),
      Session.countDocuments({ organizationId: orgId, status: 'active' }),
    ]);

    const txns = await ClientTransaction.find({ organizationId: orgId, status: 'paid' });
    const monthlyRevenue = txns.reduce((s, t) => s + t.amount, 0);

    // Task trend — last 14 days
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
    const recentDone = await ProjectTask.find({ organizationId: orgId, status: 'done', updatedAt: { $gte: twoWeeksAgo } });
    const trendMap: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      trendMap[d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })] = 0;
    }
    recentDone.forEach(t => {
      const key = new Date(t.updatedAt as Date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (trendMap[key] !== undefined) trendMap[key]++;
    });
    const taskTrend = Object.entries(trendMap).map(([date, done]) => ({ date, done }));

    // At-risk projects
    const projects = await Project.find({ organizationId: orgId, status: 'active' });
    const atRiskProjects = projects.filter(p => p.overdueTasks > 0).map(p => ({ _id: p._id, name: p.name, overdueTasks: p.overdueTasks }));

    res.json({ totalTasks, completedTasks, overdueTasks, totalProjects, activeProjects, activeSessions, monthlyRevenue, taskTrend, atRiskProjects });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function atRiskProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const projects = await Project.find({ organizationId: orgId, status: 'active', overdueTasks: { $gt: 0 } });
    res.json(projects.map(p => ({ _id: p._id, name: p.name, overdueTasks: p.overdueTasks })));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function employeeDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const in7Days = new Date(today.getTime() + 7 * 86400000);
    const tasks = await ProjectTask.find({ assignedTo: req.user!.id });
    res.json({
      overdue:  tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today),
      today:    tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate >= today && t.dueDate < tomorrow),
      upcoming: tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate >= tomorrow && t.dueDate <= in7Days),
      done:     tasks.filter(t => t.status === 'done'),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function clientDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const clientId = req.user!.id;
    const now = new Date();
    const projects = await Project.find({ clientId, status: 'active' });
    const transactions = await ClientTransaction.find({ clientId }).sort({ date: -1 }).limit(10);
    const pendingApprovals = await ProjectUpdate.find({
      projectId: { $in: projects.map(p => p._id) },
      requiresApproval: true,
      isApproved: null,
    }).sort({ createdAt: -1 });

    const enriched = projects.map(p => ({
      ...p.toObject(),
      progress: p.totalTasks ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0,
    }));

    res.json({ projects: enriched, transactions, pendingApprovals });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function salesDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const [leads, deals] = await Promise.all([
      Lead.find({ organizationId: orgId }),
      Deal.find({ organizationId: orgId }),
    ]);
    const byStatus = { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 };
    leads.forEach(l => { if (l.status in byStatus) (byStatus as any)[l.status]++; });
    res.json({
      leadsByStatus: byStatus,
      openDeals: deals.filter(d => d.status === 'open').length,
      totalDealValue: deals.reduce((s, d) => s + d.dealValue, 0),
      conversionRate: leads.length ? Math.round((byStatus.converted / leads.length) * 100) : 0,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
