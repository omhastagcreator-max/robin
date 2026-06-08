/**
 * reassignByRole.ts — overwrites assignments on every brand workflow
 * + every imported task per the agency owner's UNIFORM role rules.
 *
 * Rules (June 2026 — simplified):
 *
 *   - Om       → Website (shopify service) for ALL brands. No exceptions.
 *   - Priyanka → Videos (influencer service) for ALL brands. No exceptions.
 *   - Sakshi   → Meta Ads (meta_ads service) for ALL brands. No exceptions.
 *
 * The agency owner explicitly asked for these to be hard rules with
 * zero brand-level overrides. Bhawna / Beant Kaur are intentionally
 * not in the rule set — they retain whatever assignments they had on
 * non-three-stage work (or get freed up for other duties).
 *
 * The script touches BOTH:
 *   - ClientWorkflow.services[].assignedTo
 *   - ProjectTask.assignedTo  (only those tagged importedFrom=crm-sheets-*
 *     so in-app tasks people created themselves stay untouched.)
 *
 * Idempotent: re-running is a no-op if nothing changed.
 *
 * How to run:
 *
 *     cd server
 *     npm run reassign-roles
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';
import User from '../models/User';
import Organization from '../models/Organization';

// ── Role rules ─────────────────────────────────────────────────────
type Rule = {
  serviceType: 'shopify' | 'meta_ads' | 'influencer';
  ownerName: string;        // canonical name to look up in User
};

const DEFAULT_RULES: Rule[] = [
  { serviceType: 'shopify',    ownerName: 'Om' },
  { serviceType: 'meta_ads',   ownerName: 'Sakshi' },
  { serviceType: 'influencer', ownerName: 'Priyanka' },
];
// Brand-level overrides removed June 2026 — the owner wants ONE hard
// rule per service across every brand. Adding any override here would
// silently re-introduce inconsistency.

// ── Task-text classifier ───────────────────────────────────────────
// When we reassign tasks, we need to know which service each task
// belongs to so we can pick the right owner. Uses the same regexes
// as the CRM import.
function inferServiceFromText(text: string): Rule['serviceType'] {
  const t = (text || '').toLowerCase();
  if (/meta|fb\s*ad|ads?|campaign|pixel|catalog/i.test(t)) return 'meta_ads';
  if (/video|creative|reel|shoot|edit|influencer|creator|ugc|script/i.test(t)) return 'influencer';
  // Default — web/POC/dev work covers everything else (the broader bucket).
  return 'shopify';
}

// ── Helpers ────────────────────────────────────────────────────────
async function findUser(orgId: any, name: string): Promise<{ _id: any; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = await User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}$`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id name').lean();
  if (exact) return exact as any;
  // Prefix on first token.
  const first = trimmed.split(/\s+/)[0];
  return await User.findOne({
    organizationId: orgId,
    name: { $regex: `^${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id name').lean() as any;
}

function brandKey(name: string): string {
  return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// ── Main ───────────────────────────────────────────────────────────
(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Using org ${String(org._id)} (${org.name}).`);

  // Resolve named owners once.
  const ownerCache = new Map<string, string>();
  for (const n of ['Om', 'Sakshi', 'Priyanka']) {
    const u = await findUser(org._id, n);
    if (!u) {
      console.warn(`  ⚠️  Could not find user named "${n}" in this org. Tasks/services that would route to them will be SKIPPED.`);
    } else {
      ownerCache.set(n, String(u._id));
      console.log(`  resolved ${n} → ${u.name} (${String(u._id)})`);
    }
  }

  const ownerForServiceOnBrand = (_brand: string, serviceType: Rule['serviceType']): string | null => {
    // Uniform rule per service type, no brand-level overrides.
    const rule = DEFAULT_RULES.find(r => r.serviceType === serviceType);
    if (rule) return ownerCache.get(rule.ownerName) || null;
    return null;
  };

  // ── 1. Reassign services on every workflow ──────────────────────
  const workflows = await ClientWorkflow.find({ organizationId: org._id });
  let svcUpdates = 0, svcSkipped = 0;
  for (const wf of workflows) {
    let dirty = false;
    for (const svc of (wf.services as any[])) {
      const want = ownerForServiceOnBrand(wf.clientName || '', svc.serviceType);
      if (!want) { svcSkipped++; continue; }
      if (String(svc.assignedTo || '') !== want) {
        svc.assignedTo = want;
        dirty = true;
        svcUpdates++;
      }
    }
    if (dirty) await wf.save();
  }
  console.log(`Services reassigned: ${svcUpdates}  skipped (owner missing): ${svcSkipped}`);

  // ── 2. Reassign imported tasks (one query, in-mem map) ──────────
  // Build {clientWorkflowId → clientName} so we can resolve the brand
  // for each task without a join. ClientWorkflow IDs are ObjectIds.
  const wfNameById = new Map<string, string>();
  for (const wf of workflows) wfNameById.set(String(wf._id), wf.clientName || '');

  const tasks = await ProjectTask.find({
    organizationId: org._id,
    importedFrom: { $regex: /^crm-sheets-/ },
  });
  let taskUpdates = 0, taskSkipped = 0;
  for (const t of tasks) {
    const brand = t.clientWorkflowId ? wfNameById.get(String(t.clientWorkflowId)) : '';
    if (!brand) { taskSkipped++; continue; }
    const inferred = inferServiceFromText([t.title, t.description].filter(Boolean).join(' '));
    const want = ownerForServiceOnBrand(brand, inferred);
    if (!want) { taskSkipped++; continue; }
    if (String(t.assignedTo || '') !== want) {
      await ProjectTask.updateOne({ _id: t._id }, { $set: { assignedTo: want } });
      taskUpdates++;
    }
  }
  console.log(`Tasks reassigned: ${taskUpdates}  skipped: ${taskSkipped}  total scanned: ${tasks.length}`);

  console.log('\nDone.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Reassignment failed:', err);
  process.exit(1);
});
