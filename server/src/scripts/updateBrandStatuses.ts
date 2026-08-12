/**
 * updateBrandStatuses.ts — one-shot script applying the owner's Aug 2026
 * chat status updates across the kept brands, plus onboarding one new
 * brand (Silvque) the owner added mid-session.
 *
 * Each existing brand gets a list of `ServiceOp`s — one per service line
 * that needs to be added and/or have its status/checklist progress set.
 * This replaced an earlier, narrower "addDone / addPending /
 * returnWithReason" shape once the owner started giving partial-progress
 * updates ("meta awareness running" = 2 of 4 checklist items done, not a
 * clean done/pending toggle) — one unified op now covers add-fresh AND
 * update-existing, whichever the doc currently needs.
 *
 * ── Known duplicate-Darpan / duplicate-Oudfy situation (IMPORTANT) ──────
 * Earlier in this session, the second "Darpan" ClientWorkflow doc
 * (6a0eff0f8caf9cd458df2fa6, clientId "dummy:darpan") was treated as
 * disposable seed/demo data because it's tagged "dummy" and its clientId
 * is a literal placeholder string, not a real linked User account.
 *
 * That assumption is NOW IN QUESTION: Oudfy's only remaining
 * ClientWorkflow doc (6a0eff0f8caf9cd458df2fa7) has the EXACT SAME
 * signature — tagged "dummy", clientId "dummy:oudfy" — and yet it is
 * clearly the live, actively-tracked Oudfy record (46 activity entries,
 * daily check-ins through today). So "dummy" tag + placeholder clientId
 * does NOT reliably mean "safe to delete" — it looks like an artifact of
 * however these records were originally seeded, not a live/fake marker.
 *
 * Given that, this script does NOT delete either Darpan doc. The status
 * update below (meta ads now "running") is applied to the NON-dummy
 * Darpan (6a0aa03bc1dc825d88b42e4a) only, same as before, purely because
 * it's the one already carrying this session's other edits — this is
 * still a GUESS, not a confirmed resolution. The owner needs to look at
 * both Darpan entries (and confirm Oudfy is fine as-is) before either
 * duplicate is ever deleted.
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

type Status = 'pending' | 'in_progress' | 'done' | 'blocked';

interface ServiceOp {
  type: ServiceType;
  /** How many checklist items (from the top) should end up ticked. */
  ticked: number;
  status: Status;
  /** Optional free-text reason, written to returnedReason (the only
   *  per-service free-text field the schema has — same one the in-app
   *  "Return service" action writes). */
  reason?: string;
}

interface BrandPlan {
  clientName: string;
  workflowId: string;
  ops: ServiceOp[];
  performance?: {
    periodType: 'month'; periodKey: string;
    metaAdsSpend: number; salesAchieved: number; notes: string;
  };
}

/** Applies one ServiceOp to a workflow doc — adds the service line if it
 *  doesn't exist yet, then sets its checklist/status/reason either way. */
function applyOp(wf: any, op: ServiceOp, defaultAssignee?: string): string {
  const tpl = SERVICE_TEMPLATES[op.type];
  let svc = (wf.services as any[]).find(s => s.serviceType === op.type);
  const isNew = !svc;
  if (!svc) {
    svc = { serviceType: op.type, label: tpl.label, assignedTo: defaultAssignee, checklist: tpl.checklist.map(text => ({ text, done: false })) };
    (wf.services as any[]).push(svc);
  }
  const n = svc.checklist.length;
  for (let i = 0; i < n; i++) {
    const done = i < op.ticked;
    svc.checklist[i].done = done;
    svc.checklist[i].doneAt = done ? new Date() : undefined;
    svc.checklist[i].doneBy = done ? (svc.assignedTo || defaultAssignee) : undefined;
  }
  svc.status = op.status;
  if (op.status === 'done' && !svc.completedAt) svc.completedAt = new Date();
  if (op.status !== 'done') svc.completedAt = undefined;
  if (!svc.startedAt) svc.startedAt = new Date();
  if (op.reason) {
    svc.returnedReason = op.reason.slice(0, 500);
    svc.returnedAt = new Date();
  }
  return `${isNew ? 'Added' : 'Updated'} ${tpl.label} → ${op.status} (${op.ticked}/${n} checked)${op.reason ? ` — ${op.reason}` : ''}`;
}

const PLANS: BrandPlan[] = [
  {
    clientName: 'Polmouni',
    workflowId: '6a7a9fa12b76c96ef9c1582c',
    ops: [
      { type: 'meta_ads', ticked: 0, status: 'pending' },
      { type: 'influencer', ticked: 0, status: 'pending' },
    ],
  },
  {
    clientName: 'Darpan',
    workflowId: '6a0aa03bc1dc825d88b42e4a',
    // GUESS — see docstring above. Meta ads now "running" per owner chat.
    ops: [{ type: 'meta_ads', ticked: 2, status: 'in_progress' }],
  },
  {
    clientName: 'Sroja',
    workflowId: '6a7a9f9a2b76c96ef9c157d9',
    ops: [
      { type: 'meta_ads', ticked: 4, status: 'done' },
      { type: 'influencer', ticked: 4, status: 'done' },
    ],
    performance: {
      periodType: 'month', periodKey: '2026-08',
      metaAdsSpend: 19619, salesAchieved: 30257,
      notes: 'Ad Tenure: 11 July to 10 Aug 2026',
    },
  },
  {
    clientName: 'MotoCasa',
    workflowId: '6a7a9f9e2b76c96ef9c15804',
    ops: [
      { type: 'meta_ads', ticked: 4, status: 'done' },
      { type: 'influencer', ticked: 4, status: 'done' },
    ],
    performance: {
      periodType: 'month', periodKey: '2026-08',
      metaAdsSpend: 39279.71, salesAchieved: 85677.01,
      notes: 'Ad Tenure: 1 July to 10 Aug 2026',
    },
  },
  {
    clientName: 'ArdoWellness',
    workflowId: '6a7a9f9e2b76c96ef9c1580c',
    ops: [
      { type: 'influencer', ticked: 4, status: 'done' },
      // "Meta started but currently blocked" — status literally 'blocked'
      // (not the usual dependency-auto-blocked case — shopify IS done
      // here — so this is a manual/external block, same as the schema's
      // 'blocked' enum value covers, with the reason on returnedReason
      // since there's no separate free-text "blocked reason" field).
      { type: 'meta_ads', ticked: 1, status: 'blocked', reason: "Ads stopped — client's payment gateway suspended" },
    ],
  },
  {
    clientName: 'Woodsify',
    workflowId: '6a7a9fa02b76c96ef9c1581c',
    ops: [
      { type: 'meta_ads', ticked: 4, status: 'done' },
      { type: 'influencer', ticked: 4, status: 'done' },
    ],
  },
  {
    clientName: 'Bombay',
    workflowId: '6a7a9f9f2b76c96ef9c15814',
    ops: [
      { type: 'influencer', ticked: 4, status: 'done' },
      { type: 'meta_ads', ticked: 2, status: 'in_progress' },
    ],
  },
  {
    clientName: 'dufft',
    workflowId: '6a7a9fa02b76c96ef9c15824',
    ops: [
      // "Website paused due to photo not available, 25% work done" — 2 of
      // 7 shopify checklist items (kickoff + theme) ≈ 28%, closest to 25%.
      { type: 'shopify', ticked: 2, status: 'blocked', reason: "Paused — client hasn't provided product photos yet" },
    ],
  },
  {
    clientName: 'Ghee-Neeraj',
    workflowId: '6a7a9f9c2b76c96ef9c157ec',
    ops: [
      { type: 'influencer', ticked: 4, status: 'done' },
      { type: 'meta_ads', ticked: 2, status: 'in_progress' },
    ],
  },
  // Oudfy — deliberately NOT in this list. Its current state (shopify
  // in_progress 6/7, meta_ads blocked-by-dependency but checklist shows
  // "Account ready" + "Awareness campaigns live" both ticked, influencer
  // in_progress) already matches "meta awareness running" — no change
  // needed. The 'blocked' status label is the system auto-computing meta
  // ads as blocked on shopify not being 100% done, which is expected
  // behavior, not a bug to fix here.
];

/** Silvque — brand-new client, owner ask: "website we are not managing,
 *  videos started, meta pending". No shopify service line at all (we
 *  don't handle their website). */
const NEW_BRAND = {
  clientName: 'Silvque',
  email: 'silvque@client.hastagcreator.com',
  password: 'Welcome123!',
  ops: [
    { type: 'influencer' as ServiceType, ticked: 1, status: 'in_progress' as Status },
    { type: 'meta_ads' as ServiceType, ticked: 0, status: 'pending' as Status },
  ],
};

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
  const defaultAssignee = om?._id ? String(om._id) : (shakshi?._id ? String(shakshi._id) : undefined);
  console.log(`Actor for activity log: ${admin.name}. Default assignee fallback: ${om?.name || shakshi?.name || '(none found)'}\n`);

  for (const plan of PLANS) {
    console.log(`── ${plan.clientName} (${plan.workflowId}) ──`);
    const wf = await ClientWorkflow.findOne({ _id: plan.workflowId, organizationId: org._id });
    if (!wf) { console.log('  NOT FOUND — skipping.\n'); continue; }
    if ((wf.clientName || '').toLowerCase() !== plan.clientName.toLowerCase()) {
      console.log(`  ⚠️  clientName on doc is "${wf.clientName}", expected "${plan.clientName}" — skipping for safety.\n`);
      continue;
    }

    const changes = plan.ops.map(op => applyOp(wf, op, defaultAssignee));
    changes.forEach(c => console.log(`  ${c}`));

    if (APPLY) {
      wf.activity.push({
        actorId: String(admin._id), actorName: admin.name,
        action: 'bulk_status_update', detail: changes.join('; '),
      } as any);
      wf.markModified('services');
      await wf.save();
      console.log('  Saved.');
    }

    if (plan.performance) {
      const p = plan.performance;
      console.log(`  Performance entry (${p.periodType} ${p.periodKey}): spend=${p.metaAdsSpend}, sales=${p.salesAchieved}, notes="${p.notes}"`);
      if (APPLY) {
        const [yStr, mStr] = p.periodKey.split('-');
        const year = Number(yStr), month = Number(mStr);
        const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        const periodEnd   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        await ClientPerformanceEntry.findOneAndUpdate(
          { clientWorkflowId: wf._id, periodType: p.periodType, periodKey: p.periodKey },
          { $set: {
            organizationId: org._id, clientWorkflowId: wf._id,
            periodType: p.periodType, periodKey: p.periodKey,
            periodStart, periodEnd,
            metaAdsSpend: p.metaAdsSpend, salesAchieved: p.salesAchieved, notes: p.notes,
            enteredBy: String(admin._id),
          } },
          { upsert: true, setDefaultsOnInsert: true },
        );
        console.log('  Performance entry saved.');
      }
    }
    console.log('');
  }

  // ── Onboard Silvque (brand-new client) ────────────────────────────
  console.log(`── ${NEW_BRAND.clientName} (new brand) ──`);
  const existingByName = await ClientWorkflow.findOne({
    organizationId: org._id,
    clientName: { $regex: `^${NEW_BRAND.clientName}$`, $options: 'i' },
  }).select('_id').lean();
  if (existingByName) {
    console.log(`  Already exists (${String(existingByName._id)}) — skipping onboarding, run again with service ops added to PLANS above if it needs updates.\n`);
  } else {
    console.log(`  Would create User (role: client, email: ${NEW_BRAND.email})`);
    console.log(`  Would create ClientWorkflow — no shopify line (website not managed by us):`);
    NEW_BRAND.ops.forEach(op => console.log(`    ${op.type}: status=${op.status}, ${op.ticked} checklist item(s) ticked`));
    if (APPLY) {
      let user = await User.findOne({ email: NEW_BRAND.email, organizationId: org._id });
      if (!user) {
        user = await User.create({
          organizationId: org._id, email: NEW_BRAND.email, name: NEW_BRAND.clientName,
          role: 'client', passwordHash: NEW_BRAND.password, isActive: true,
        } as any);
      }
      const wf = new ClientWorkflow({
        organizationId: org._id,
        clientId: String(user._id),
        clientName: NEW_BRAND.clientName,
        clientEmail: NEW_BRAND.email,
        services: [],
        createdBy: String(admin._id),
        activity: [{ actorId: String(admin._id), actorName: admin.name, action: 'created', detail: 'Onboarded — website not managed by us' }],
      });
      const changes = NEW_BRAND.ops.map(op => applyOp(wf, op, defaultAssignee));
      changes.forEach(c => console.log(`  ${c}`));
      wf.activity.push({ actorId: String(admin._id), actorName: admin.name, action: 'bulk_status_update', detail: changes.join('; ') } as any);
      await wf.save();
      console.log(`  Created ClientWorkflow (${String(wf._id)}).`);
      console.log(`  Default login: ${NEW_BRAND.email} / ${NEW_BRAND.password} — placeholder, update if a real portal login is needed.`);
    }
  }

  console.log('\n⚠️  Reminder: the Darpan/Oudfy "dummy" tag question in the docstring above is UNRESOLVED — nothing was deleted. Please review both Darpan entries.');
  if (!APPLY) console.log('\nDRY RUN ONLY — nothing was written. Re-run with -- --apply to commit.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('updateBrandStatuses failed:', err);
  process.exit(1);
});
