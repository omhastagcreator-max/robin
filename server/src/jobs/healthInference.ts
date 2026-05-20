import ClientWorkflow from '../models/ClientWorkflow';
import WorkflowActivity from '../models/WorkflowActivity';
import { computeInsights, type InsightsResult } from '../services/aiInsights';

/**
 * Pipeline 2.0 health inference.
 *
 * The schema carries a `health` enum on every workflow:
 *   healthy · at_risk · delayed · blocked ·
 *   waiting_client · waiting_internal · revision · final_qa · ready_to_deliver
 *
 * This job runs every 15 minutes and rewrites `health` + `healthReason`
 * on every workflow that isn't fully done. UI everywhere just renders
 * `wf.health` — no inference logic in components.
 *
 * Inference priority (top wins):
 *   1. Explicit blocker  → blocked / waiting_client / waiting_internal
 *   2. All non-QA done + QA done → ready_to_deliver
 *   3. All non-QA done, QA pending → final_qa
 *   4. Recent reopen (24h) → revision
 *   5. ETA-based → delayed (past ETA) / at_risk (<3 days)
 *   6. Inactivity-based → delayed (>72h) / at_risk (>24h)
 *   7. Default → healthy
 *
 * Idempotent and cheap: skip the write if health didn't actually change.
 */

interface MinimalWorkflow {
  _id: any;
  services: Array<{ serviceType: string; status: string; checklist?: Array<{ done: boolean }> }>;
  health?: string;
  healthReason?: string;
  blockerType?: string;
  blockerReason?: string;
  eta?: Date | null;
  lastActivityAt?: Date | null;
}

interface HealthResult { health: string; reason: string }

async function computeHealth(wf: MinimalWorkflow): Promise<HealthResult> {
  const services = wf.services || [];

  // 1. Explicit blocker.
  const blocked = services.find(s => s.status === 'blocked');
  if (blocked) {
    if (wf.blockerType === 'waiting_client_input')      return { health: 'waiting_client',   reason: wf.blockerReason || 'Waiting on client' };
    if (wf.blockerType === 'waiting_internal_approval') return { health: 'waiting_internal', reason: wf.blockerReason || 'Waiting on internal review' };
    return { health: 'blocked', reason: wf.blockerReason || `${blocked.serviceType} blocked` };
  }

  // 2 & 3. QA stage detection.
  if (services.length > 0) {
    const nonQa = services.filter(s => s.serviceType !== 'qa');
    const qa    = services.find(s => s.serviceType === 'qa');
    const allNonQaDone = nonQa.length > 0 && nonQa.every(s => s.status === 'done');
    if (allNonQaDone && qa && qa.status === 'done') return { health: 'ready_to_deliver', reason: 'QA passed — ready to ship' };
    if (allNonQaDone && qa && qa.status !== 'done') return { health: 'final_qa',         reason: 'In final QA review' };
  }

  // 4. Recent reopen (24h) — surfaces as "revision".
  const reopenWindow = new Date(Date.now() - 24 * 3600 * 1000);
  const recentReopen = await WorkflowActivity.findOne({
    workflowId: wf._id,
    action: 'service_reopened',
    createdAt: { $gte: reopenWindow },
  }).select('comment').lean();
  if (recentReopen) {
    return { health: 'revision', reason: `Reopened — ${String(recentReopen.comment || '').slice(0, 80)}` };
  }

  // 5. ETA-based.
  const now = Date.now();
  if (wf.eta) {
    const etaMs = new Date(wf.eta).getTime();
    if (etaMs < now) {
      const daysPast = Math.max(1, Math.round((now - etaMs) / (24 * 3600 * 1000)));
      return { health: 'delayed', reason: `Past ETA by ${daysPast} day${daysPast === 1 ? '' : 's'}` };
    }
    const daysUntil = Math.round((etaMs - now) / (24 * 3600 * 1000));
    if (daysUntil < 3) return { health: 'at_risk', reason: `ETA in ${Math.max(0, daysUntil)} day${daysUntil === 1 ? '' : 's'}` };
  }

  // 6. Inactivity-based.
  const lastAt = wf.lastActivityAt ? new Date(wf.lastActivityAt).getTime() : 0;
  if (lastAt > 0) {
    const hoursIdle = (now - lastAt) / (3600 * 1000);
    if (hoursIdle > 72) return { health: 'delayed', reason: `No activity for ${Math.round(hoursIdle / 24)} day(s)` };
    if (hoursIdle > 24) return { health: 'at_risk', reason: `No activity for ${Math.round(hoursIdle / 24)} day(s)` };
  }

  return { health: 'healthy', reason: 'On track' };
}

export async function recomputeWorkflowHealth(workflowId: string): Promise<void> {
  const wf = await ClientWorkflow.findById(workflowId).lean() as any;
  if (!wf) return;
  const { health, reason } = await computeHealth(wf);
  const insights: InsightsResult = computeInsights({ ...wf, health, healthReason: reason });
  const changes: any = {};
  if (wf.health !== health)                          changes.health = health;
  if (wf.healthReason !== reason)                    changes.healthReason = reason;
  if (wf.riskScore !== insights.riskScore)           changes.riskScore = insights.riskScore;
  if (wf.delayCause !== insights.delayCause)         changes.delayCause = insights.delayCause;
  if (wf.nextBestAction !== insights.nextBestAction) changes.nextBestAction = insights.nextBestAction;
  // Date comparison via .getTime() — Mongo will hand us Date objects, never strings on lean reads.
  const oldEta = wf.predictedCompletionAt ? new Date(wf.predictedCompletionAt).getTime() : 0;
  const newEta = insights.predictedCompletionAt ? insights.predictedCompletionAt.getTime() : 0;
  if (oldEta !== newEta)                             changes.predictedCompletionAt = insights.predictedCompletionAt;
  if (Object.keys(changes).length === 0) return;
  changes.healthComputedAt = new Date();
  changes.insightsComputedAt = new Date();
  await ClientWorkflow.updateOne({ _id: workflowId }, { $set: changes });
}

async function tick() {
  try {
    // Cap to 200 workflows per tick — covers any sane single-agency workload.
    // Larger orgs would shard by org; out of scope today.
    //
    // NOTE: we pull MORE fields now (`createdAt` for the predicted-completion
    // extrapolation, and the existing AI fields so we can diff before write).
    // The select list is still small enough that this stays O(workflow_count).
    const wfs = await ClientWorkflow.find({
      'services.status': { $ne: 'done' },
    }).select(
      '_id services health healthReason blockerType blockerReason eta lastActivityAt ' +
      'riskScore delayCause nextBestAction predictedCompletionAt createdAt updatedAt'
    ).limit(200).lean();

    let touched = 0;
    for (const wf of wfs as any[]) {
      const { health, reason } = await computeHealth(wf);
      const insights = computeInsights({ ...wf, health, healthReason: reason });
      const changes: any = {};
      if (wf.health !== health)                          changes.health = health;
      if (wf.healthReason !== reason)                    changes.healthReason = reason;
      if ((wf.riskScore ?? 0) !== insights.riskScore)    changes.riskScore = insights.riskScore;
      if ((wf.delayCause ?? '') !== insights.delayCause) changes.delayCause = insights.delayCause;
      if ((wf.nextBestAction ?? '') !== insights.nextBestAction) changes.nextBestAction = insights.nextBestAction;
      const oldEta = wf.predictedCompletionAt ? new Date(wf.predictedCompletionAt).getTime() : 0;
      const newEta = insights.predictedCompletionAt ? insights.predictedCompletionAt.getTime() : 0;
      if (oldEta !== newEta)                             changes.predictedCompletionAt = insights.predictedCompletionAt;
      if (Object.keys(changes).length === 0) continue;
      changes.healthComputedAt = new Date();
      changes.insightsComputedAt = new Date();
      await ClientWorkflow.updateOne({ _id: wf._id }, { $set: changes });
      touched += 1;
    }
    if (touched > 0) console.log(`[health] recomputed ${touched}/${wfs.length} workflow(s)`);
  } catch (err) {
    console.error('[health] tick failed:', (err as Error).message);
  }
}

export function startHealthInferenceCron() {
  // Fire once shortly after boot to seed health for projects that lack it,
  // then every 15 min thereafter. The setInterval keeps running for the
  // lifetime of the Node process (Render free-tier spin-down is mitigated
  // by UptimeRobot pinging /health every 5 min — see audit doc).
  setTimeout(tick, 5_000);
  setInterval(tick, 15 * 60 * 1000);
  console.log('[health] inference cron armed — 15-min cadence.');
}
