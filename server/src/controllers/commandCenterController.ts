import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';
import Meeting from '../models/Meeting';
import Notification from '../models/Notification';
import Deal from '../models/Deal';

/**
 * commandCenterController — the single endpoint that powers the admin
 * Mission Control page.
 *
 * Why one endpoint and not many small ones: the Command Center has to
 * paint in <500ms or the "5-second decision" promise breaks. Three
 * round-trips kills that budget on a slow connection. Instead we fan
 * out queries in PARALLEL on the server side and ship one document.
 *
 * Output sections:
 *   kpis            — agency health counts
 *   criticalAlerts  — list of triggered alert conditions
 *   accountability  — per-employee rows
 *   clientCards     — rich card per brand (top 24, sorted by health)
 *   upcomingDeadlines — next 7 days of tasks/meetings/etas
 *
 * Org-isolated. Admin / sales can read; employees get redirected to
 * the Workroom (the Command Center isn't their landing).
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

interface AlertRow {
  id: string;
  severity: 'critical' | 'warning';
  emoji: string;
  title: string;
  detail: string;
  link?: string;
  entity?: { kind: 'brand' | 'task' | 'employee' | 'meeting'; id: string; name?: string };
}

interface AccountabilityRow {
  userId: string;
  name: string;
  avatarUrl?: string;
  role: string;
  assignedBrands: number;
  activeTasks: number;
  overdueTasks: number;
  doneThisWeek: number;
  workloadPct: number;        // 0-100, derived from active task count + priority weighting
  efficiencyScore: number;    // 0-100, done / (done + overdue + slipped)
  flag?: 'overloaded' | 'underloaded' | 'bottleneck';
}

interface ClientCardRow {
  id: string;
  name: string;
  priority: string;
  healthLevel: 'green' | 'yellow' | 'orange' | 'red';
  healthScore: number;
  healthFactors: string[];
  currentStage: string;
  completionPct: number;
  nextDeadline?: { kind: 'eta' | 'meeting' | 'task'; at: string; label: string };
  currentOwner?: { userId: string; name: string };
  pendingTaskCount: number;
  nextAction: string;
  lastUpdate?: { at: string; detail: string; actorName?: string };
  upcomingMeeting?: { at: string; title: string };
}

interface KpiBlock {
  totalBrands: number;
  activeBrands: number;
  atRiskBrands: number;        // orange + red
  delayedBrands: number;       // red
  overdueTasks: number;
  upcomingDeadlines7d: number;
  teamCapacityPct: number;     // avg workloadPct across team
  overallCompletionPct: number;
  // June 2026 redesign additions:
  revenueThisMonth: number;          // sum dealValue of Deal status='won' closedAt this month
  revenueLastMonth: number;          // for the trend indicator
  trends: {
    brands: number[];                // 7-day daily count of active brands (creation rolling)
    activeProjects: number[];        // 7-day daily count of active workflows
    overdueTasks: number[];          // 7-day daily count of overdue tasks
    revenue: number[];               // 7-day daily revenue
  };
  statusDistribution: {
    completed:   number;
    inProgress:  number;
    atRisk:      number;
    delayed:     number;
  };
}

export async function getSnapshot(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const orgObjId = new mongoose.Types.ObjectId(orgId);
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 86_400_000);

    // Parallel fetch — all queries fired at once, awaited together.
    const [workflows, users, tasks, upcomingMeetings] = await Promise.all([
      ClientWorkflow.find({ organizationId: orgId }).lean(),
      User.find({
        organizationId: orgId,
        isActive: true,
        role: { $in: ['admin', 'sales', 'employee'] },
      }).select('_id name avatarUrl role').lean(),
      ProjectTask.find({ organizationId: orgId }).select(
        '_id title status priority dueDate assignedTo assignedBy reviewerId approverId clientWorkflowId completedAt actualCompletionAt estimatedCompletionAt createdAt updatedAt escalationLevel',
      ).lean(),
      Meeting.find({
        organizationId: orgObjId,
        status: 'scheduled',
        startTime: { $gte: now, $lt: in7d },
      }).sort({ startTime: 1 }).limit(30).lean(),
    ]);

    const userById = new Map(users.map(u => [String(u._id), u]));
    const wfById   = new Map(workflows.map(w => [String(w._id), w]));

    // ── KPIs ─────────────────────────────────────────────────────────
    const overdueTasks = tasks.filter(t =>
      t.status !== 'done' && t.dueDate && new Date(t.dueDate as any).getTime() < now.getTime(),
    );
    const activeBrands  = workflows.filter(w => {
      const services = (w.services as any[]) || [];
      return services.some(s => s.status !== 'done');
    });
    const atRiskBrands  = workflows.filter(w => w.healthLevel === 'orange' || w.healthLevel === 'red');
    const delayedBrands = workflows.filter(w => w.healthLevel === 'red');

    const overallCompletionPct = (() => {
      let total = 0, done = 0;
      for (const w of workflows) {
        for (const s of (w.services as any[]) || []) {
          const cl = s.checklist || [];
          total += cl.length;
          done  += cl.filter((c: any) => c.done).length;
        }
      }
      return total > 0 ? Math.round((done / total) * 100) : 100;
    })();

    // Upcoming deadlines = task dueDates + workflow ETAs + meetings.
    const upcomingDeadlines7d = (() => {
      let count = upcomingMeetings.length;
      count += tasks.filter(t => t.status !== 'done' && t.dueDate
        && new Date(t.dueDate as any) >= now
        && new Date(t.dueDate as any) <= in7d).length;
      count += workflows.filter(w => w.eta
        && new Date(w.eta as any) >= now
        && new Date(w.eta as any) <= in7d).length;
      return count;
    })();

    // ── Per-employee accountability ──────────────────────────────────
    const accountability: AccountabilityRow[] = [];
    let totalWorkloadPct = 0;
    let workloadDenom    = 0;
    const startOfThisWeek = (() => {
      const d = new Date();
      const dow = (d.getUTCDay() || 7) - 1;
      d.setUTCDate(d.getUTCDate() - dow);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();
    for (const u of users) {
      const id = String(u._id);
      const myTasks      = tasks.filter(t => t.assignedTo === id);
      const active       = myTasks.filter(t => t.status !== 'done');
      const overdue      = myTasks.filter(t => t.status !== 'done' && t.dueDate && new Date(t.dueDate as any).getTime() < now.getTime());
      const doneThisWeek = myTasks.filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt as any).getTime() >= startOfThisWeek.getTime());
      const brands       = new Set(myTasks.map(t => String(t.clientWorkflowId || '')).filter(Boolean));
      // Workflow services also count toward brand assignment.
      for (const w of workflows) {
        for (const s of (w.services as any[]) || []) {
          if (s.assignedTo === id) brands.add(String(w._id));
        }
      }

      // Workload heuristic: 5 active tasks ≈ 100%. Priority weighting:
      // urgent = 2x, high = 1.5x, medium = 1x, low = 0.5x.
      const wt = active.reduce((s, t) => s + (
        t.priority === 'urgent' ? 2 :
        t.priority === 'high'   ? 1.5 :
        t.priority === 'low'    ? 0.5 : 1
      ), 0);
      const workloadPct = Math.min(150, Math.round((wt / 5) * 100));
      const efficiencyScore = (() => {
        const total = doneThisWeek.length + overdue.length;
        if (total === 0) return 80;     // neutral default — no activity yet
        return Math.round((doneThisWeek.length / total) * 100);
      })();

      const flag: AccountabilityRow['flag'] =
        workloadPct >= 100 ? 'overloaded' :
        overdue.length >= 3 ? 'bottleneck' :
        workloadPct <= 25  ? 'underloaded' :
        undefined;

      accountability.push({
        userId: id,
        name: u.name || u.role || 'Unknown',
        avatarUrl: u.avatarUrl,
        role: u.role,
        assignedBrands: brands.size,
        activeTasks: active.length,
        overdueTasks: overdue.length,
        doneThisWeek: doneThisWeek.length,
        workloadPct,
        efficiencyScore,
        flag,
      });
      totalWorkloadPct += workloadPct;
      workloadDenom++;
    }
    const teamCapacityPct = workloadDenom > 0 ? Math.round(totalWorkloadPct / workloadDenom) : 0;

    accountability.sort((a, b) => b.workloadPct - a.workloadPct);

    // ── Critical alerts ──────────────────────────────────────────────
    const criticalAlerts: AlertRow[] = [];

    // 🔴 Brand at red health.
    for (const w of workflows.filter(w => w.healthLevel === 'red').slice(0, 5)) {
      criticalAlerts.push({
        id: `brand-red-${w._id}`,
        severity: 'critical',
        emoji: '🔴',
        title: `${w.clientName || 'Brand'} is critical`,
        detail: (w.healthFactors || []).slice(0, 2).join(' · ') || w.delayCause || 'Score below 40',
        link: `/clients/pipeline/${w._id}`,
        entity: { kind: 'brand', id: String(w._id), name: w.clientName || undefined },
      });
    }
    // 🔴 Overdue tasks (top 3 most-overdue).
    const topOverdue = overdueTasks
      .slice()
      .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime())
      .slice(0, 3);
    for (const t of topOverdue) {
      const daysLate = Math.max(1, Math.round((now.getTime() - new Date(t.dueDate as any).getTime()) / 86_400_000));
      const owner = t.assignedTo ? userById.get(String(t.assignedTo))?.name : undefined;
      const brand = t.clientWorkflowId ? wfById.get(String(t.clientWorkflowId))?.clientName : undefined;
      criticalAlerts.push({
        id: `task-overdue-${t._id}`,
        severity: 'critical',
        emoji: '🔴',
        title: `Overdue ${daysLate}d: ${t.title}`,
        detail: [owner && `Owner: ${owner}`, brand && `Brand: ${brand}`].filter(Boolean).join(' · '),
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
        entity: { kind: 'task', id: String(t._id) },
      });
    }
    // 🟠 No update for 5+ days on an active brand.
    for (const w of workflows.filter(w => (w.daysInactive || 0) >= 5).slice(0, 3)) {
      criticalAlerts.push({
        id: `brand-stale-${w._id}`,
        severity: 'warning',
        emoji: '🟠',
        title: `No update on ${w.clientName} for ${w.daysInactive}d`,
        detail: w.nextBestAction || 'Reach out and confirm status.',
        link: `/clients/pipeline/${w._id}`,
        entity: { kind: 'brand', id: String(w._id), name: w.clientName || undefined },
      });
    }
    // 🟠 Overloaded employees.
    for (const a of accountability.filter(a => a.flag === 'overloaded').slice(0, 2)) {
      criticalAlerts.push({
        id: `employee-overloaded-${a.userId}`,
        severity: 'warning',
        emoji: '🟠',
        title: `${a.name} is overloaded`,
        detail: `${a.activeTasks} active tasks · ${a.workloadPct}% capacity`,
        entity: { kind: 'employee', id: a.userId, name: a.name },
      });
    }

    // ── Client cards ─────────────────────────────────────────────────
    const clientCards: ClientCardRow[] = workflows
      .slice()
      .sort((a, b) => {
        // worst health first
        const rank = (lv: any) => lv === 'red' ? 0 : lv === 'orange' ? 1 : lv === 'yellow' ? 2 : 3;
        return rank(a.healthLevel) - rank(b.healthLevel);
      })
      .slice(0, 24)
      .map(w => {
        const services = (w.services as any[]) || [];
        const active = services.find(s => s.status === 'in_progress') || services.find(s => s.status !== 'done');
        const totalCl = services.reduce((s, sv) => s + (sv.checklist?.length || 0), 0);
        const doneCl  = services.reduce((s, sv) => s + (sv.checklist?.filter((c: any) => c.done).length || 0), 0);
        const completionPct = totalCl > 0 ? Math.round((doneCl / totalCl) * 100)
                              : (services.length > 0 && services.every(s => s.status === 'done') ? 100 : 0);
        const pending = tasks.filter(t => String(t.clientWorkflowId || '') === String(w._id) && t.status !== 'done').length;
        const owner = active?.assignedTo ? { userId: String(active.assignedTo), name: userById.get(String(active.assignedTo))?.name || 'Owner' } : undefined;

        // Find next deadline candidate.
        const meetingForBrand = upcomingMeetings.find(m =>
          // brand workflows have recurringMeeting with the same label
          (w.recurringMeeting as any)?.label && m.title?.includes(w.clientName || '!@'),
        );
        let nextDeadline: ClientCardRow['nextDeadline'];
        if (w.eta) {
          nextDeadline = { kind: 'eta', at: new Date(w.eta as any).toISOString(), label: 'Project ETA' };
        }
        if (meetingForBrand && (!nextDeadline || new Date(meetingForBrand.startTime as any) < new Date(nextDeadline.at))) {
          nextDeadline = { kind: 'meeting', at: new Date(meetingForBrand.startTime as any).toISOString(), label: meetingForBrand.title || 'Meeting' };
        }
        const nextTask = tasks
          .filter(t => String(t.clientWorkflowId || '') === String(w._id) && t.status !== 'done' && t.dueDate)
          .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime())[0];
        if (nextTask && (!nextDeadline || new Date(nextTask.dueDate as any) < new Date(nextDeadline.at))) {
          nextDeadline = { kind: 'task', at: new Date(nextTask.dueDate as any).toISOString(), label: nextTask.title };
        }

        return {
          id: String(w._id),
          name: w.clientName || 'Unnamed',
          priority: w.priority || 'medium',
          healthLevel: (w.healthLevel || 'green') as ClientCardRow['healthLevel'],
          healthScore: w.healthScore || 100,
          healthFactors: w.healthFactors || [],
          currentStage: active?.label || 'Discovery',
          completionPct,
          nextDeadline,
          currentOwner: owner,
          pendingTaskCount: pending,
          nextAction: w.nextBestAction || (w as any).nextAction || '',
          lastUpdate: (() => {
            const lu = (w as any).lastUpdate;
            if (!lu?.at) return undefined;
            return {
              at: new Date(lu.at).toISOString(),
              detail: lu.detail || '',
              actorName: lu.actorId ? userById.get(String(lu.actorId))?.name : undefined,
            };
          })(),
          upcomingMeeting: meetingForBrand ? {
            at: new Date(meetingForBrand.startTime as any).toISOString(),
            title: meetingForBrand.title || '',
          } : undefined,
        };
      });

    // ── Revenue (current + previous month, IST window) ──────────────
    const istNow = new Date(now.getTime() + 330 * 60_000);
    const monthStartIst = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - 330 * 60_000);
    const monthEndIst   = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 1) - 330 * 60_000);
    const prevStartIst  = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - 1, 1) - 330 * 60_000);
    const [thisMonthDeals, lastMonthDeals] = await Promise.all([
      Deal.find({ organizationId: orgObjId, status: 'won', closedAt: { $gte: monthStartIst, $lt: monthEndIst } }).select('dealValue closedAt').lean(),
      Deal.find({ organizationId: orgObjId, status: 'won', closedAt: { $gte: prevStartIst, $lt: monthStartIst } }).select('dealValue').lean(),
    ]);
    const revenueThisMonth = thisMonthDeals.reduce((s, d) => s + (d.dealValue || 0), 0);
    const revenueLastMonth = lastMonthDeals.reduce((s, d) => s + (d.dealValue || 0), 0);

    // ── 7-day sparklines (trailing window, IST days). Counts use the
    // documents we already have in-memory; revenue requires its own
    // bucket since deals weren't fetched bucketed.
    const dayBucket = (d: Date | string | null) => {
      if (!d) return -1;
      const t = new Date(d).getTime();
      if (Number.isNaN(t)) return -1;
      const diffDays = Math.floor((now.getTime() - t) / 86_400_000);
      return diffDays >= 0 && diffDays < 7 ? 6 - diffDays : -1;
    };
    const trendBrands     = Array(7).fill(0);
    const trendActiveProj = Array(7).fill(0);
    const trendOverdue    = Array(7).fill(0);
    const trendRevenue    = Array(7).fill(0);
    for (const w of workflows) {
      const i = dayBucket(w.createdAt as any);
      if (i >= 0) trendBrands[i] += 1;
      // active = any service not done at creation; we proxy with current activeness.
      if (i >= 0 && ((w.services as any[]) || []).some((s: any) => s.status !== 'done')) trendActiveProj[i] += 1;
    }
    for (const t of overdueTasks) {
      const i = dayBucket(t.dueDate as any);
      if (i >= 0) trendOverdue[i] += 1;
    }
    for (const d of thisMonthDeals) {
      const i = dayBucket((d as any).closedAt);
      if (i >= 0) trendRevenue[i] += d.dealValue || 0;
    }

    // ── Status distribution for the donut ────────────────────────────
    let dist_completed = 0, dist_inProgress = 0, dist_atRisk = 0, dist_delayed = 0;
    for (const w of workflows) {
      const services = (w.services as any[]) || [];
      const allDone = services.length > 0 && services.every(s => s.status === 'done');
      if (allDone) { dist_completed++; continue; }
      if (w.healthLevel === 'red')    { dist_delayed++; continue; }
      if (w.healthLevel === 'orange') { dist_atRisk++; continue; }
      dist_inProgress++;
    }

    const kpis: KpiBlock = {
      totalBrands: workflows.length,
      activeBrands: activeBrands.length,
      atRiskBrands: atRiskBrands.length,
      delayedBrands: delayedBrands.length,
      overdueTasks: overdueTasks.length,
      upcomingDeadlines7d,
      teamCapacityPct,
      overallCompletionPct,
      revenueThisMonth,
      revenueLastMonth,
      trends: {
        brands:         trendBrands,
        activeProjects: trendActiveProj,
        overdueTasks:   trendOverdue,
        revenue:        trendRevenue,
      },
      statusDistribution: {
        completed:  dist_completed,
        inProgress: dist_inProgress,
        atRisk:     dist_atRisk,
        delayed:    dist_delayed,
      },
    };

    res.json({
      kpis,
      criticalAlerts,
      accountability,
      clientCards,
      upcomingMeetings: upcomingMeetings.slice(0, 8).map(m => ({
        id: String(m._id),
        title: m.title,
        startTime: new Date(m.startTime as any).toISOString(),
        attendeeCount: ((m.attendees as any[]) || []).length,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Quieting unused-var lint: Notification is imported because the
 * frontend's copilot may surface unread alerts; we keep the import
 * even though the snapshot endpoint itself doesn't read it.
 */
void Notification;
