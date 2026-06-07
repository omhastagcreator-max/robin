import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';
import Meeting from '../models/Meeting';
import { nextRecurrence } from './meetingScheduleController';

/**
 * workroomSnapshotController — one-shot endpoint for the new Workroom.
 *
 * Why this exists alongside the command-center snapshot:
 *   - CommandCenter is AGENCY-WIDE; admin sees every brand + every
 *     employee.
 *   - Workroom is USER-SCOPED; non-admins should see only the brands
 *     and tasks they actually touch.
 *
 * Both endpoints share the same compute primitives (KPIs, alerts,
 * brand cards) but with different filter clauses. Keeping them separate
 * keeps each endpoint's query shape simple and the response shape
 * stable for its consumer.
 *
 * Response sections:
 *   kpis              — agency health counts (scoped to my brands)
 *   priorityCenter    — AI-ranked buckets (critical/delayed/upcoming/
 *                       approvals/follow-ups/today)
 *   brandCards        — full-fat brand cards I own
 *   executionBoard    — kanban buckets of my tasks
 *   teamWorkload      — heatmap rows for the agency
 *   agencyHealthScore — 0-100 derived from brand health averages
 */

async function getOrgIdAndRole(userId: string): Promise<{ orgId: string | null; role: string }> {
  const u = await User.findById(userId).select('organizationId role').lean();
  return {
    orgId: u?.organizationId ? String(u.organizationId) : null,
    role: u?.role || 'employee',
  };
}

interface PriorityRow {
  bucket: 'critical' | 'delayed' | 'upcoming' | 'approvals' | 'follow_ups' | 'today';
  id: string;
  title: string;
  meta?: string;
  link?: string;
}

export async function getWorkroomSnapshot(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const { orgId, role } = await getOrgIdAndRole(me);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const orgObjId = new mongoose.Types.ObjectId(orgId);

    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setUTCHours(23, 59, 59, 999);
    const in7d = new Date(now.getTime() + 7 * 86_400_000);
    const startOfToday = (() => {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();

    // For admin role, see all brands. For others, only mine.
    const myBrandFilter = role === 'admin' ? {} : {
      $or: [
        { 'services.assignedTo': me },
        { currentOwnerId: me },
        { nextActionOwnerId: me },
      ],
    };

    const [allWorkflows, myWorkflows, allUsers, myTasks, allTasksForKpi, todaysMeetings] = await Promise.all([
      // For org-wide KPI numerator (agency cap, etc.)
      ClientWorkflow.find({ organizationId: orgObjId }).select(
        '_id clientName priority healthLevel healthScore daysInactive services',
      ).lean(),
      ClientWorkflow.find({ organizationId: orgObjId, ...myBrandFilter }).lean(),
      User.find({
        organizationId: orgId, isActive: true,
        role: { $in: ['admin', 'sales', 'employee'] },
      }).select('_id name avatarUrl role').lean(),
      ProjectTask.find({
        organizationId: orgId,
        $or: [{ assignedTo: me }, { assignedBy: me }, { reviewerId: me }, { approverId: me }],
      }).limit(200).lean(),
      ProjectTask.find({ organizationId: orgId }).select(
        '_id status dueDate priority assignedTo completedAt clientWorkflowId',
      ).limit(500).lean(),
      Meeting.find({
        organizationId: orgObjId,
        status: 'scheduled',
        startTime: { $gte: now, $lt: todayEnd },
        $or: [{ hostUserId: me }, { attendees: me }],
      }).sort({ startTime: 1 }).limit(10).lean(),
    ]);

    const userById = new Map(allUsers.map(u => [String(u._id), u]));
    const wfById   = new Map(allWorkflows.map(w => [String(w._id), w]));

    // ── KPIs ─────────────────────────────────────────────────────────
    const activeBrands  = myWorkflows.filter((w: any) =>
      ((w.services as any[]) || []).some(s => s.status !== 'done'),
    ).length;
    const atRiskBrands  = myWorkflows.filter((w: any) => w.healthLevel === 'orange' || w.healthLevel === 'red').length;
    const tasksDueToday = myTasks.filter(t => t.status !== 'done' && t.dueDate
      && new Date(t.dueDate as any) >= startOfToday && new Date(t.dueDate as any) <= todayEnd).length;
    const overdueTasks  = myTasks.filter(t => t.status !== 'done' && t.dueDate
      && new Date(t.dueDate as any).getTime() < now.getTime()).length;
    const meetingsToday = todaysMeetings.length;

    // Agency-wide team utilisation %.
    const workloadByUser = new Map<string, number>();
    for (const t of allTasksForKpi) {
      if (t.status === 'done' || !t.assignedTo) continue;
      const w = t.priority === 'urgent' ? 2 : t.priority === 'high' ? 1.5 : t.priority === 'low' ? 0.5 : 1;
      workloadByUser.set(String(t.assignedTo), (workloadByUser.get(String(t.assignedTo)) || 0) + w);
    }
    const allWorkloads: number[] = [];
    for (const u of allUsers) {
      const wt = workloadByUser.get(String(u._id)) || 0;
      allWorkloads.push(Math.min(150, Math.round((wt / 5) * 100)));
    }
    const teamUtilisationPct = allWorkloads.length ? Math.round(allWorkloads.reduce((s, v) => s + v, 0) / allWorkloads.length) : 0;

    // Agency health = inverse of risk-weighted bad brands. 100 minus
    // ((red×12 + orange×7 + yellow×3) / brandsCount), clamped.
    const agencyHealthScore = (() => {
      const total = myWorkflows.length;
      if (total === 0) return 100;
      let penalty = 0;
      for (const w of myWorkflows) {
        const lvl = (w as any).healthLevel || 'green';
        if (lvl === 'red')    penalty += 12;
        if (lvl === 'orange') penalty += 7;
        if (lvl === 'yellow') penalty += 3;
      }
      return Math.max(0, Math.min(100, Math.round(100 - penalty / total)));
    })();

    // Revenue impact = count of brands with $-target activity blocked.
    // Proxy: brands with red health AND a recurring meeting (= client-
    // facing), since those tend to be revenue commitments.
    const revenueAtRiskBrands = myWorkflows.filter((w: any) => w.healthLevel === 'red').length;

    const kpis = {
      agencyHealthScore,
      activeBrands,
      atRiskBrands,
      tasksDueToday,
      overdueTasks,
      meetingsToday,
      teamUtilisationPct,
      revenueAtRiskBrands,
    };

    // ── AI Priority Center ──────────────────────────────────────────
    const priorityCenter: PriorityRow[] = [];

    // 🚨 Critical issues — red brands.
    for (const w of myWorkflows.filter((w: any) => w.healthLevel === 'red').slice(0, 5)) {
      priorityCenter.push({
        bucket: 'critical',
        id: `critical-${w._id}`,
        title: w.clientName || 'Brand',
        meta: (w as any).delayCause || ((w as any).healthFactors || []).slice(0, 1).join('') || `Score ${(w as any).healthScore}/100`,
        link: `/clients/pipeline/${w._id}`,
      });
    }

    // ⚠️ Delayed projects — past ETA, not done.
    for (const w of myWorkflows.filter((w: any) => {
      if (!w.eta) return false;
      const t = new Date(w.eta as any).getTime();
      if (Number.isNaN(t) || t > now.getTime()) return false;
      const allDone = ((w.services as any[]) || []).length > 0 && ((w.services as any[]) || []).every((s: any) => s.status === 'done');
      return !allDone;
    }).slice(0, 5)) {
      const daysLate = Math.round((now.getTime() - new Date((w as any).eta).getTime()) / 86_400_000);
      priorityCenter.push({
        bucket: 'delayed',
        id: `delayed-${w._id}`,
        title: w.clientName || 'Brand',
        meta: `Past ETA ${daysLate}d`,
        link: `/clients/pipeline/${w._id}`,
      });
    }

    // 📅 Upcoming deadlines — tasks due in 0-7 days.
    for (const t of myTasks
      .filter(t => t.status !== 'done' && t.dueDate
        && new Date(t.dueDate as any) >= now && new Date(t.dueDate as any) <= in7d)
      .sort((a, b) => new Date(a.dueDate as any).getTime() - new Date(b.dueDate as any).getTime())
      .slice(0, 5)) {
      const due = new Date(t.dueDate as any);
      const days = Math.max(0, Math.round((due.getTime() - now.getTime()) / 86_400_000));
      const brand = t.clientWorkflowId ? wfById.get(String(t.clientWorkflowId))?.clientName : '';
      priorityCenter.push({
        bucket: 'upcoming',
        id: `upcoming-${t._id}`,
        title: t.title,
        meta: `${brand ? brand + ' · ' : ''}due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days}d`}`,
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      });
    }

    // 👥 Waiting for approvals — tasks where I'm approver/reviewer and status isn't done.
    for (const t of myTasks
      .filter(t => t.status !== 'done' && (String(t.approverId || '') === me || String(t.reviewerId || '') === me))
      .slice(0, 5)) {
      const owner = t.assignedTo ? userById.get(String(t.assignedTo))?.name || '' : '';
      priorityCenter.push({
        bucket: 'approvals',
        id: `approval-${t._id}`,
        title: t.title,
        meta: owner ? `Owner: ${owner}` : '',
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      });
    }

    // 📞 Client follow-ups — brands waiting on the client + brands idle 5d+.
    for (const w of myWorkflows.filter((w: any) =>
      (w as any).blockerType === 'waiting_client_input' || (w.daysInactive || 0) >= 5,
    ).slice(0, 5)) {
      const reason = (w as any).blockerType === 'waiting_client_input'
        ? 'Waiting on client input'
        : `Idle ${w.daysInactive}d`;
      priorityCenter.push({
        bucket: 'follow_ups',
        id: `followup-${w._id}`,
        title: w.clientName || 'Brand',
        meta: reason,
        link: `/clients/pipeline/${w._id}`,
      });
    }

    // 🎯 Today's priorities — my urgent/high tasks due today + my meetings.
    for (const t of myTasks
      .filter(t => t.status !== 'done' && t.assignedTo === me
        && (t.priority === 'urgent' || t.priority === 'high'))
      .slice(0, 5)) {
      const brand = t.clientWorkflowId ? wfById.get(String(t.clientWorkflowId))?.clientName : '';
      priorityCenter.push({
        bucket: 'today',
        id: `today-${t._id}`,
        title: t.title,
        meta: `${t.priority?.toUpperCase()}${brand ? ' · ' + brand : ''}`,
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      });
    }
    for (const m of todaysMeetings.slice(0, 3)) {
      const startTime = new Date((m as any).startTime).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
      priorityCenter.push({
        bucket: 'today',
        id: `meeting-${m._id}`,
        title: m.title || 'Meeting',
        meta: `at ${startTime}`,
      });
    }

    // ── Brand cards — rich, full-fat ────────────────────────────────
    const brandCards = myWorkflows
      .slice()
      .sort((a: any, b: any) => {
        const rank = (lv: any) => lv === 'red' ? 0 : lv === 'orange' ? 1 : lv === 'yellow' ? 2 : 3;
        return rank(a.healthLevel) - rank(b.healthLevel);
      })
      .slice(0, 12)
      .map((w: any) => {
        const services = (w.services as any[]) || [];
        const totalCl = services.reduce((s, sv) => s + (sv.checklist?.length || 0), 0);
        const doneCl  = services.reduce((s, sv) => s + (sv.checklist?.filter((c: any) => c.done).length || 0), 0);
        const completionPct = totalCl > 0 ? Math.round((doneCl / totalCl) * 100)
                              : (services.length > 0 && services.every(s => s.status === 'done') ? 100 : 0);
        const active = services.find((s: any) => s.status === 'in_progress') || services.find((s: any) => s.status !== 'done');
        const team = Array.from(new Set(services.map((s: any) => s.assignedTo).filter(Boolean))) as string[];
        const teamResolved = team.map(uid => {
          const u = userById.get(uid);
          return u ? { userId: uid, name: u.name || '', avatarUrl: u.avatarUrl } : null;
        }).filter(Boolean);
        const pendingTasks = myTasks.filter(t => String(t.clientWorkflowId || '') === String(w._id) && t.status !== 'done').length;

        // Next meeting for this brand (one-off OR recurring).
        const rm = (w as any).recurringMeeting || {};
        const nextRecur = nextRecurrence(rm.dayOfWeek, rm.timeIST, now);
        const upcomingMeeting = nextRecur && (nextRecur.getTime() - now.getTime() < 14 * 86_400_000)
          ? { title: rm.label || `${w.clientName} sync`, at: nextRecur.toISOString() }
          : undefined;

        return {
          id: String(w._id),
          name: w.clientName || 'Brand',
          priority: w.priority || 'medium',
          healthLevel: w.healthLevel || 'green',
          healthScore: w.healthScore || 100,
          healthFactors: w.healthFactors || [],
          currentStage: active?.label || 'Discovery',
          completionPct,
          eta: w.eta ? new Date(w.eta).toISOString() : null,
          owner: active?.assignedTo ? {
            userId: String(active.assignedTo),
            name: userById.get(String(active.assignedTo))?.name || '',
            avatarUrl: userById.get(String(active.assignedTo))?.avatarUrl,
          } : undefined,
          team: teamResolved,
          pendingTaskCount: pendingTasks,
          upcomingMeeting,
          nextAction: (w as any).nextBestAction || (w as any).nextAction || '',
          lastUpdate: (w as any).lastUpdate?.at ? {
            at: new Date((w as any).lastUpdate.at).toISOString(),
            detail: (w as any).lastUpdate.detail || '',
            actorName: (w as any).lastUpdate.actorId ? userById.get(String((w as any).lastUpdate.actorId))?.name : undefined,
          } : undefined,
          // Standard 7-stage timeline; we map the active service to a stage.
          stages: deriveStages(services),
        };
      });

    // ── Execution Board — kanban buckets ────────────────────────────
    const myOpen = myTasks.filter(t => t.assignedTo === me && t.status !== 'done');
    const myToday = myOpen.filter(t => t.dueDate
      && new Date(t.dueDate as any) >= startOfToday
      && new Date(t.dueDate as any) <= todayEnd);
    const myWeek = myOpen.filter(t => t.dueDate
      && new Date(t.dueDate as any) > todayEnd
      && new Date(t.dueDate as any) <= in7d);
    const myBlocked = myOpen.filter(t => t.status === 'blocked');
    const myWaiting = myOpen.filter(t => t.status === 'pending' && !t.dueDate);
    const myOverdue = myOpen.filter(t => t.dueDate
      && new Date(t.dueDate as any).getTime() < now.getTime());

    const formatTask = (t: any) => ({
      id: String(t._id),
      title: t.title,
      priority: t.priority || 'medium',
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
      brand: t.clientWorkflowId ? (wfById.get(String(t.clientWorkflowId)) as any)?.clientName || '' : '',
      brandId: t.clientWorkflowId ? String(t.clientWorkflowId) : '',
      owner: t.assignedTo ? userById.get(String(t.assignedTo))?.name || '' : '',
      dependsOnCount: ((t.dependsOn as any[]) || []).length,
      hasReviewer: !!t.reviewerId,
      hasApprover: !!t.approverId,
    });

    const executionBoard = {
      today:    myToday.slice(0, 12).map(formatTask),
      week:     myWeek.slice(0, 12).map(formatTask),
      blocked:  myBlocked.slice(0, 12).map(formatTask),
      waiting:  myWaiting.slice(0, 12).map(formatTask),
      overdue:  myOverdue.slice(0, 12).map(formatTask),
    };

    // ── Team Workload Heatmap ───────────────────────────────────────
    const teamWorkload = allUsers
      .map(u => {
        const wt = workloadByUser.get(String(u._id)) || 0;
        const pct = Math.min(150, Math.round((wt / 5) * 100));
        const overdue = allTasksForKpi.filter(t => t.assignedTo === String(u._id) && t.status !== 'done'
          && t.dueDate && new Date(t.dueDate as any).getTime() < now.getTime()).length;
        return {
          userId: String(u._id),
          name: u.name || '',
          avatarUrl: u.avatarUrl,
          role: u.role,
          workloadPct: pct,
          overdue,
          flag: pct >= 100 ? 'overloaded' : overdue >= 3 ? 'bottleneck' : pct <= 25 ? 'underloaded' : null,
        };
      })
      .sort((a, b) => b.workloadPct - a.workloadPct);

    res.json({
      kpis,
      priorityCenter,
      brandCards,
      executionBoard,
      teamWorkload,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Derive a 7-stage timeline status for a brand. The canonical agency
 * stages (Discovery, Strategy, Design, Development, Content, Launch,
 * Optimization) don't map 1:1 to the existing serviceType taxonomy
 * (shopify / influencer / meta_ads), so we use a heuristic:
 *
 *   - Discovery / Strategy → always "done" if any service exists
 *   - Design → done if 'shopify' service has any done checklist item
 *   - Development → done if 'shopify' service is status='done'
 *   - Content → done if 'influencer' service is status='done'
 *   - Launch → done if 'meta_ads' service is status='in_progress' or 'done'
 *   - Optimization → done if 'meta_ads' service is status='done'
 *
 * Status enum:
 *   'done' | 'active' | 'upcoming'
 */
function deriveStages(services: any[]): Array<{ key: string; label: string; status: 'done' | 'active' | 'upcoming' }> {
  const shopify   = services.find(s => s.serviceType === 'shopify');
  const influencer = services.find(s => s.serviceType === 'influencer');
  const meta      = services.find(s => s.serviceType === 'meta_ads');
  const anyService = services.length > 0;
  const shopifyDoneItems = (shopify?.checklist || []).some((c: any) => c.done);

  const isDone = (svc: any) => svc?.status === 'done';
  const isActive = (svc: any) => svc?.status === 'in_progress' || svc?.status === 'blocked';

  return [
    { key: 'discovery',    label: 'Discovery',    status: anyService ? 'done' : 'upcoming' },
    { key: 'strategy',     label: 'Strategy',     status: anyService ? 'done' : 'upcoming' },
    { key: 'design',       label: 'Design',       status: shopifyDoneItems ? 'done' : (isActive(shopify) ? 'active' : 'upcoming') },
    { key: 'development',  label: 'Development',  status: isDone(shopify) ? 'done' : (isActive(shopify) ? 'active' : 'upcoming') },
    { key: 'content',      label: 'Content',      status: isDone(influencer) ? 'done' : (isActive(influencer) ? 'active' : 'upcoming') },
    { key: 'launch',       label: 'Launch',       status: isDone(meta) ? 'done' : (isActive(meta) ? 'active' : 'upcoming') },
    { key: 'optimization', label: 'Optimization', status: isDone(meta) && services.every(s => s.status === 'done') ? 'done' : 'upcoming' },
  ];
}
