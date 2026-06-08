/**
 * ensureAllStages.ts — guarantees every ClientWorkflow has all three
 * canonical stages (Website / Videos / Meta) with the right owner
 * attached.
 *
 * Rationale: earlier imports created services based on heuristic text
 * inference, so a brand that the sheet only mentioned in "ads"
 * context ended up with only a meta_ads service and was missing the
 * Website + Videos stages. The agency owner's June 2026 rule is that
 * EVERY brand has all three stages, period.
 *
 * What this script does:
 *   1. Walks every ClientWorkflow.
 *   2. If a brand is missing the shopify / influencer / meta_ads
 *      service, it appends one with the canonical owner and the
 *      default SOP checklist.
 *   3. If a stage already exists but has the wrong owner per the
 *      uniform rules, it reassigns. (Re-running reassignByRole does
 *      the same thing — keeping it here makes this script self-
 *      contained and safe to run standalone.)
 *
 * Idempotent: second run is a no-op.
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import Organization from '../models/Organization';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

const STANDARD_SERVICES: ServiceType[] = ['shopify', 'influencer', 'meta_ads'];
const STAGE_OWNERS: Record<ServiceType, string> = {
  shopify:    'Om',
  influencer: 'Priyanka',
  meta_ads:   'Sakshi',
};

async function findUserByName(orgId: any, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const u = await User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id').lean();
  return u ? String(u._id) : null;
}

(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization in DB.'); process.exit(1); }

  // Resolve canonical owners once.
  const ownerByStage: Record<ServiceType, string | null> = {
    shopify:    await findUserByName(org._id, STAGE_OWNERS.shopify),
    influencer: await findUserByName(org._id, STAGE_OWNERS.influencer),
    meta_ads:   await findUserByName(org._id, STAGE_OWNERS.meta_ads),
  };
  for (const stage of STANDARD_SERVICES) {
    if (!ownerByStage[stage]) {
      console.warn(`  ⚠️  ${STAGE_OWNERS[stage]} (stage ${stage}) not found — new service rows will be unassigned.`);
    } else {
      console.log(`  resolved ${STAGE_OWNERS[stage]} → ${ownerByStage[stage]}`);
    }
  }

  const workflows = await ClientWorkflow.find();
  let touched = 0, added = 0, reassigned = 0;
  for (const wf of workflows) {
    let dirty = false;
    const existingTypes = new Set(((wf.services as any[]) || []).map(s => s.serviceType));

    // Add any missing standard service.
    for (const stage of STANDARD_SERVICES) {
      if (existingTypes.has(stage)) continue;
      const tpl = SERVICE_TEMPLATES[stage];
      (wf.services as any[]).push({
        serviceType: stage,
        label: tpl.label,
        status: 'in_progress',
        checklist: tpl.checklist.map(text => ({ text, done: false })),
        assignedTo: ownerByStage[stage] || undefined,
      });
      added++;
      dirty = true;
    }

    // Reassign any existing service whose owner doesn't match the rule.
    for (const svc of (wf.services as any[])) {
      if (!STANDARD_SERVICES.includes(svc.serviceType)) continue;
      const want = ownerByStage[svc.serviceType as ServiceType];
      if (!want) continue;
      if (String(svc.assignedTo || '') !== want) {
        svc.assignedTo = want;
        reassigned++;
        dirty = true;
      }
    }

    if (dirty) { await wf.save(); touched++; }
  }
  console.log(`\nWorkflows touched: ${touched}.  Stages added: ${added}.  Assignments corrected: ${reassigned}.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('ensureAllStages failed:', err);
  process.exit(1);
});
