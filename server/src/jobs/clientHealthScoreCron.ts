import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';

/**
 * clientHealthScoreCron — every 15 min, recomputes a 0-100 healthScore
 * + traffic-light healthLevel + structured healthFactors[] on every
 * ClientWorkflow.
 *
 * Penalty model (compounding):
 *
 *   -10 per overdue task (max -30)
 *   -8  per blocked service (max -24)
 *   -5  if daysInactive >= 3
 *   -10 if daysInactive >= 7
 *   -15 if priority='urgent' AND daysInactive >= 2
 *   -20 if eta is past AND not all services done
 *   -10 if eta within 3 days AND <50% checklist done
 *   -10 if blockerType is set
 *
 * Starting at 100, score is clamped to [0, 100].
 *
 * Buckets:
 *   >= 90 green   (Healthy)
 *   70-89 yellow  (Attention required)
 *   40-69 orange  (At risk)
 *   < 40  red     (Critical)
 *
 * Why a separate cron from healthInference? They compute related-but-
 * distinct things — healthInference sets `health` (the SOP-stage
 * status: at_risk / blocked / waiting_client / etc.) and `riskScore`,
 * while this one rolls them up into an executive-friendly 0-100
 * number + the four-colour brand-health taxonomy for the Command
 * Center cards. Keeping the jobs separate means tuning one doesn't
 * break the other.
 */

const TICK_INTERVAL_MS = 15 * 60 * 1000;

function bucket(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score >= 90) return 'green';
  if (score >= 70) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

async function scoreOne(wf: any): Promise<{ score: number; level: 'green' | 'yellow' | 'orange' | 'red'; factors: string[] }> {
  const factors: string[] = [];
  let score = 100;

  // Overdue tasks for THIS brand.
  const now = new Date();
  const overdueCount = await ProjectTask.countDocuments({
    organizationId: wf.organizationId,
    clientWorkflowId: wf._id,
    status: { $ne: 'done' },
    dueDate: { $exists: true, $ne: null, $lt: now },
  });
  if (overdueCount > 0) {
    const penalty = Math.min(30, overdueCount * 10);
    score -= penalty;
    factors.push(`${overdueCount} overdue ${overdueCount === 1 ? 'task' : 'tasks'}`);
  }

  // Blocked services.
  const blockedServiceCount = ((wf.services as any[]) || []).filter(s => s.status === 'blocked').length;
  if (blockedServiceCount > 0) {
    const penalty = Math.min(24, blockedServiceCount * 8);
    score -= penalty;
    factors.push(`${blockedServiceCount} blocked ${blockedServiceCount === 1 ? 'service' : 'services'}`);
  }

  // Inactivity.
  const dInact = wf.daysInactive || 0;
  if (dInact >= 7) {
    score -= 10;
    factors.push(`Idle ${dInact} days`);
  } else if (dInact >= 3) {
    score -= 5;
    factors.push(`Idle ${dInact} days`);
  }

  // Urgent + idle is especially bad.
  if (wf.priority === 'urgent' && dInact >= 2) {
    score -= 15;
    factors.push('Urgent priority with no activity');
  }

  // ETA pressure.
  if (wf.eta) {
    const etaMs = new Date(wf.eta).getTime();
    const daysToEta = (etaMs - now.getTime()) / 86_400_000;
    const services = (wf.services as any[]) || [];
    const allDone = services.length > 0 && services.every(s => s.status === 'done');
    if (!allDone && daysToEta < 0) {
      score -= 20;
      factors.push(`Past ETA by ${Math.abs(Math.round(daysToEta))}d`);
    } else if (!allDone && daysToEta <= 3) {
      const totalCl = services.reduce((s, sv) => s + (sv.checklist?.length || 0), 0);
      const doneCl  = services.reduce((s, sv) => s + (sv.checklist?.filter((c: any) => c.done).length || 0), 0);
      const pct = totalCl > 0 ? doneCl / totalCl : 0;
      if (pct < 0.5) {
        score -= 10;
        factors.push(`Due in ${Math.round(daysToEta)}d, ${Math.round(pct * 100)}% done`);
      }
    }
  }

  // Explicit blocker.
  if (wf.blockerType) {
    score -= 10;
    factors.push(`Blocked: ${String(wf.blockerType).replace(/_/g, ' ')}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: bucket(score), factors };
}

async function tick() {
  try {
    const wfs = await ClientWorkflow.find().select(
      '_id organizationId priority eta daysInactive blockerType services',
    ).lean();
    let updated = 0;
    for (const wf of wfs) {
      try {
        const result = await scoreOne(wf);
        await ClientWorkflow.updateOne(
          { _id: wf._id },
          { $set: {
              healthScore:        result.score,
              healthLevel:        result.level,
              healthFactors:      result.factors,
              healthComputedAtV2: new Date(),
          } },
        );
        updated++;
      } catch (err) {
        console.warn(`[client-health] ${wf._id} failed:`, (err as Error).message);
      }
    }
    if (updated > 0) console.log(`[client-health] scored ${updated} workflows`);
  } catch (err) {
    console.error('[client-health] tick failed:', (err as Error).message);
  }
}

export function startClientHealthScoreCron() {
  setTimeout(tick, 20_000);                      // boot delay
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[client-health] started (every 15 min)');
}
