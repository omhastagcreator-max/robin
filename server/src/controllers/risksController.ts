import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';

/**
 * Risks controller — surfaces the "what's on fire?" feed.
 *
 * We don't compute risk synchronously here — the jobs/healthInference
 * cron already runs every 15 min and writes `riskScore`, `delayCause`,
 * `nextBestAction`, `predictedCompletionAt` onto each ClientWorkflow
 * (cheap heuristics, no LLM). This endpoint READS those denormalised
 * fields, combines them with a few task-level signals, sorts the
 * combined set, and returns the top N.
 *
 * Signals we surface:
 *   - workflow.riskScore >= 60                 → "Brand at risk"
 *   - workflow.daysInactive >= 3 + priority high/urgent
 *   - workflow.eta within 3 days + checklist < 80% done
 *   - tasks past their dueDate, status != done
 *   - tasks status='blocked' for > 24h
 *
 * Output is a flat array of risk rows, each typed so the UI can pick a
 * colour / icon:
 *   { kind: 'brand' | 'task',
 *     severity: 'high' | 'medium',
 *     workflowId?, taskId?, title, reason, link }
 *
 * Endpoint is org-scoped and visible to admin + sales (the people who
 * actually act on the "Needs attention" strip). Employees get their
 * personal slice via the daily brief instead.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listRisks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '15'), 10)));

    const now = Date.now();
    const threeDaysOut = new Date(now + 3 * 86_400_000);

    const [wfs, lateTasks, blockedTasks] = await Promise.all([
      ClientWorkflow.find({ organizationId: orgId }).select(
        '_id clientName priority riskScore delayCause nextBestAction eta daysInactive health healthReason updatedAt services',
      ).lean(),
      ProjectTask.find({
        organizationId: orgId,
        status: { $ne: 'done' },
        dueDate: { $exists: true, $ne: null, $lt: new Date() },
      }).select('_id title assignedTo dueDate priority clientWorkflowId').limit(50).lean(),
      ProjectTask.find({
        organizationId: orgId,
        status: 'blocked',
        updatedAt: { $lt: new Date(now - 86_400_000) }, // blocked > 24h
      }).select('_id title assignedTo updatedAt priority clientWorkflowId').limit(20).lean(),
    ]);

    interface RiskRow {
      kind: 'brand' | 'task';
      severity: 'high' | 'medium';
      score: number;
      workflowId?: string;
      taskId?: string;
      title: string;
      reason: string;
      link: string;
    }
    const rows: RiskRow[] = [];

    for (const wf of wfs) {
      const isUrgent = wf.priority === 'urgent';
      const isHigh   = wf.priority === 'high';
      const r = wf.riskScore || 0;

      // High-severity if explicit risk score is high, OR urgent priority + days inactive
      // OR ETA imminent + work clearly not close to done.
      const services = (wf.services as any[]) || [];
      const totalCl  = services.reduce((s, sv) => s + (sv.checklist?.length || 0), 0);
      const doneCl   = services.reduce((s, sv) => s + (sv.checklist?.filter((c: any) => c.done).length || 0), 0);
      const pctDone  = totalCl > 0 ? doneCl / totalCl : 0;

      let reason: string | null = null;
      let severity: 'high' | 'medium' = 'medium';
      let score = r;

      if (r >= 60) {
        reason = wf.delayCause || `Risk score ${r}/100`;
        severity = r >= 80 ? 'high' : 'medium';
        score = r;
      } else if (isUrgent && (wf.daysInactive || 0) >= 2) {
        reason = `Urgent — no activity ${wf.daysInactive} days`;
        severity = 'high';
        score = 65 + Math.min(20, wf.daysInactive || 0);
      } else if (isHigh && (wf.daysInactive || 0) >= 5) {
        reason = `High priority idle ${wf.daysInactive} days`;
        severity = 'medium';
        score = 50 + Math.min(15, wf.daysInactive || 0);
      } else if (wf.eta && new Date(wf.eta).getTime() <= threeDaysOut.getTime() && pctDone < 0.8) {
        const daysToEta = Math.max(0, Math.round((new Date(wf.eta).getTime() - now) / 86_400_000));
        reason = `Due in ${daysToEta}d, ${Math.round(pctDone * 100)}% done`;
        severity = daysToEta <= 1 ? 'high' : 'medium';
        score = 70 - daysToEta * 5;
      }

      if (reason) {
        rows.push({
          kind: 'brand',
          severity,
          score,
          workflowId: String(wf._id),
          title: wf.clientName || 'Unnamed brand',
          reason,
          link: `/clients/pipeline/${wf._id}`,
        });
      }
    }

    for (const t of lateTasks) {
      const daysLate = Math.max(1, Math.round((now - new Date(t.dueDate as any).getTime()) / 86_400_000));
      const severity: 'high' | 'medium' = (t.priority === 'urgent' || daysLate >= 3) ? 'high' : 'medium';
      rows.push({
        kind: 'task',
        severity,
        score: 40 + daysLate * 3 + (t.priority === 'urgent' ? 10 : 0),
        taskId: String(t._id),
        title: t.title,
        reason: `Overdue ${daysLate}d`,
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      });
    }

    for (const t of blockedTasks) {
      const blockedHours = Math.round((now - new Date(t.updatedAt as any).getTime()) / 3_600_000);
      rows.push({
        kind: 'task',
        severity: blockedHours >= 48 ? 'high' : 'medium',
        score: 35 + Math.min(40, blockedHours / 2),
        taskId: String(t._id),
        title: t.title,
        reason: `Blocked ${Math.round(blockedHours / 24) || 1}d`,
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      });
    }

    rows.sort((a, b) => b.score - a.score);
    res.json(rows.slice(0, limit));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
