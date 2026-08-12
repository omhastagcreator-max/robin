/**
 * updateBrandStatuses.ts — one-shot script applying the owner's Aug 2026
 * status update for 6 of the 11 kept brands (see keepOnlyBrands.ts):
 *
 *   Polmouni     — website done (already); video pending; meta pending
 *                  (both service lines added fresh — didn't exist yet).
 *   Darpan       — website done (already), video done (already); social
 *                  media posting (meta ads) reverted from done → pending/
 *                  in-progress with a visible reason. Applied to the REAL
 *                  Darpan doc (6a0aa03bc1dc825d88b42e4a) — the OTHER
 *                  "Darpan" ClientWorkflow (6a0eff0f8caf9cd458df2fa6) has
 *                  clientId "dummy:darpan" (a literal placeholder, not a
 *                  real User id) and is tagged "dummy" — confirmed seed/
 *                  demo data, untouched here, flagged for deletion by
 *                  keepOnlyBrands.ts's duplicate-review note.
 *   Sroja        — website/video/meta all marked done (video+meta didn't
 *                  exist yet, added + completed); performance entry logged
 *                  for August 2026: Meta spend 19,619, sales achieved
 *                  30,257, notes carry the exact "11 July – 10 Aug 2026"
 *                  ad tenure since the model only supports day/week/month
 *                  buckets, not an arbitrary custom range.
 *   MotoCasa     — same pattern as Sroja; spend 39,279.71, sales 85,677.01,
 *                  ad tenure 1 July – 10 Aug 2026.
 *   ArdoWellness — website/video done (video didn't exist yet, added +
 *                  completed); meta ads added then immediately "returned"
 *                  with reason "Ads stopped — client's payment gateway
 *                  suspended" (status → in_progress, reason visible on the
 *                  service — there's no per-service "blocked with a custom
 *                  reason" field in the schema, `returnedReason` is the
 *                  closest fit and is what the UI already renders).
 *   Woodsify     — website/video/meta all marked done (video+meta didn't
 *                  exist yet, added + completed). No ad-spend numbers were
 *                  given for Woodsify, so no performance entry.
 *
 * Every service add/complete/return here goes through the SAME shape
 * `performWorkflowAction` normally produces (activity log entry with a
 * clear actor + detail, checklist items stamped done/doneAt, recomputed
 * service statuses) so this reads identically to a normal in-app action
 * in the activity feed — just applied in bulk from one script run instead
 * of one click at a time.
 *
 * Safety: dry-run by default — prints exactly what would change per
 * brand, writes nothing. Pass --apply to commit.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run update-brand-statuses
 *   APPLY:    npm run update-brand-statuses -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import ClientPerformanceEntry from '../models/ClientPerformanceEntry';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

const APPLY = process.argv.includes('--apply');

async function findUserByName(orgId: any, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id name').lean();
}

/** Builds a fresh service subdoc from its template, optionally pre-completed. */
function buildService(type: ServiceType, opts: { done: boolean; assignedTo?: string }) {
  const tpl = SERVICE_TEMPLATES[type];
  const now = new Date();
  return {
    serviceType: type,
    label: tpl.label,
    assignedTo: opts.assignedTo,
    status: opts.done ? 'done' : 'pending',
    startedAt: now,
    completedAt: opts.done ? now : undefined,
    checklist: tpl.checklist.map(text => ({
      text,
      done: opts.done,
      doneAt: opts.done ? now : undefined,
      doneBy: opts.done ? opts.assignedTo : undefined,
    })),
  };
}

interface BrandPlan {
  clientName: string;
  workflowId: string;
  /** Service types to ADD if missing (they don't exist on the doc yet). Marked done immediately. */
  addDone?: ServiceType[];
  /** Service types to ADD if missing, left pending (not started). */
  addPending?: ServiceType[];
  /** Existing service to revert to in-progress with a visible reason (also covers "add then immediately return"). */
  returnWithReason?: { type: ServiceType; reason: string; addFirstIfMissing?: boolean };
  performance?: {
    periodType: 'month'; periodKey: string;
    metaAdsSpend: number; salesAchieved: number; notes: string;
  };
}

const PLANS: BrandPlan[] = [
  {
    clientName: 'Polmouni',
    workflowId: '6a7a9fa12b76c96ef9c1582c',
    addPending: ['meta_ads', 'influencer'],
  },
  {
    clientName: 'Darpan',
    workflowId: '6a0aa03bc1dc825d88b42e4a',
    returnWithReason: {
      type: 'meta_ads',
      reason: "Social media posting paused — reverted to pending per owner update",
    },
  },
  {
    clientName: 'Sroja',
    workflowId: '6a7a9f9a2b76c96ef9c157d9',
    addDone: ['meta_ads', 'influencer'],
    performance: {
      periodType: 'month', periodKey: '2026-08',
      metaAdsSpend: 19619, salesAchieved: 30257,
      notes: 'Ad Tenure: 11 July to 10 Aug 2026',
    },
  },
  {
    clientName: 'MotoCasa',
    workflowId: '6a7a9f9e2b76c96ef9c15804',
    addDone: ['meta_ads', 'influencer'],
    performance: {
      periodType: 'month', periodKey: '2026-08',
      metaAdsSpend: 39279.71, salesAchieved: 85677.01,
      notes: 'Ad Tenure: 1 July to 10 Aug 2026',
    },
  },
  {
    clientName: 'ArdoWellness',
    workflowId: '6a7a9f9e2b76c96ef9c1580c',
    addDone: ['influencer'],
    returnWithReason: {
      type: 'meta_ads',
      reason: "Ads stopped — client's payment gateway suspended",
      addFirstIfMissing: true,
    },
  },
  {
    clientName: 'Woodsify',
    workflowId: '6a7a9fa02b76c96ef9c1581c',
    addDone: ['meta_ads', 'influencer'],
  },
];

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).`);

  const admin = await User.findOne({ organizationId: org._id, role: 'admin' })
    .sort({ createdAt: 1 }).select('_id name').lean();
  if (!admin) { console.error('No admin user found — needed for activity log actor. Aborting.'); process.exit(1); }

  const om = await findUserByName(org._id, 'Om');
  const shakshi = await findUserByName(org._id, 'Shakshi') || await findUserByName(org._id, 'Sakshi');
  console.log(`Actor for activity log: ${admin.name}. Meta/influencer assignee fallback: ${om?.name || shakshi?.name || '(none found — left blank)'}\n`);
  const defaultAssignee = om?._id ? String(om._id) : (shakshi?._id ? String(shakshi._id) : undefined);

  for (const plan of PLANS) {
    console.log(`── ${plan.clientName} (${plan.workflowId}) ──`);
    const wf = await ClientWorkflow.findOne({ _id: plan.workflowId, organizationId: org._id });
    if (!wf) { console.log('  NOT FOUND — skipping.\n'); continue; }
    if ((wf.clientName || '').toLowerCase() !== plan.clientName.toLowerCase()) {
      console.log(`  ⚠️  clientName on doc is "${wf.clientName}", expected "${plan.clientName}" — skipping for safety.\n`);
      continue;
    }

    const existingTypes = new Set((wf.services || []).map((s: any) => s.serviceType));
    const changes: string[] = [];

    for (const type of plan.addDone || []) {
      if (existingTypes.has(type)) {
        console.log(`  ${type}: already present — leaving its current status alone (not re-marking done).`);
        continue;
      }
      console.log(`  ${type}: ADD, marked done`);
      changes.push(`Added ${SERVICE_TEMPLATES[type].label} (done)`);
      if (APPLY) (wf.services as any[]).push(buildService(type, { done: true, assignedTo: defaultAssignee }));
    }
    for (const type of plan.addPending || []) {
      if (existingTypes.has(type)) {
        console.log(`  ${type}: already present — leaving its current status alone.`);
        continue;
      }
      console.log(`  ${type}: ADD, left pending`);
      changes.push(`Added ${SERVICE_TEMPLATES[type].label} (pending)`);
      if (APPLY) (wf.services as any[]).push(buildService(type, { done: false, assignedTo: defaultAssignee }));
    }
    if (plan.returnWithReason) {
      const { type, reason, addFirstIfMissing } = plan.returnWithReason;
      if (!existingTypes.has(type)) {
        if (!addFirstIfMissing) {
          console.log(`  ${type}: NOT present and addFirstIfMissing not set — skipping return step.`);
        } else {
          console.log(`  ${type}: ADD, then immediately return with reason: "${reason}"`);
          changes.push(`Added ${SERVICE_TEMPLATES[type].label}, returned: ${reason}`);
          if (APPLY) {
            (wf.services as any[]).push(buildService(type, { done: false, assignedTo: defaultAssignee }));
          }
        }
      } else {
        console.log(`  ${type}: RETURN (status → in_progress) with reason: "${reason}"`);
        changes.push(`Reverted ${SERVICE_TEMPLATES[type].label}: ${reason}`);
      }
      if (APPLY && (existingTypes.has(type) || addFirstIfMissing)) {
        const svc = (wf.services as any[]).find(s => s.serviceType === type);
        if (svc) {
          svc.status = 'in_progress';
          svc.returnedReason = reason.slice(0, 500);
          svc.returnedAt = new Date();
          if (svc.checklist && svc.checklist.length) {
            const last = svc.checklist[svc.checklist.length - 1];
            last.done = false; last.doneAt = undefined; last.doneBy = undefined;
          }
        }
      }
    }

    if (APPLY && changes.length) {
      wf.activity.push({
        actorId: String(admin._id),
        actorName: admin.name,
        action: 'bulk_status_update',
        detail: changes.join('; '),
      } as any);
      wf.markModified('services');
      await wf.save();
      console.log(`  Saved.`);
    } else if (!changes.length) {
      console.log('  No changes needed.');
    }

    if (plan.performance) {
      const p = plan.performance;
      console.log(`  Performance entry (${p.periodType} ${p.periodKey}): spend=${p.metaAdsSpend}, sales=${p.salesAchieved}, notes="${p.notes}"`);
      if (APPLY) {
        // Same period-range math as clientPerformanceController.ts's
        // computePeriodRange() for periodType 'month'.
        const [yStr, mStr] = p.periodKey.split('-');
        const year = Number(yStr), month = Number(mStr);
        const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        const periodEnd   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        await ClientPerformanceEntry.findOneAndUpdate(
          { clientWorkflowId: wf._id, periodType: p.periodType, periodKey: p.periodKey },
          { $set: {
            organizationId: org._id,
            clientWorkflowId: wf._id,
            periodType: p.periodType, periodKey: p.periodKey,
            periodStart, periodEnd,
            metaAdsSpend: p.metaAdsSpend,
            salesAchieved: p.salesAchieved,
            notes: p.notes,
            enteredBy: String(admin._id),
          } },
          { upsert: true, setDefaultsOnInsert: true },
        );
        console.log('  Performance entry saved.');
      }
    }
    console.log('');
  }

  if (!APPLY) console.log('DRY RUN ONLY — nothing was written. Re-run with -- --apply to commit.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('updateBrandStatuses failed:', err);
  process.exit(1);
});
