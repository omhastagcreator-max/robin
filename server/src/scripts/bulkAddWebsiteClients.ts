/**
 * bulkAddWebsiteClients.ts — one-shot script to add a batch of brands as
 * Clients + give each a Website (shopify service) ClientWorkflow, marked
 * DONE for all of them except "dufft" (owner ask, Aug 2026: "add these
 * clients... except the red ones and mark them everyone's website is
 * completed except dufft").
 *
 * Source: owner pasted a screenshot of a brand-routing spreadsheet.
 * Non-red rows only (red rows = a different/excluded batch, not these
 * clients):
 *   Sroja, Darpan, Ghee-Neeraj, Oudfy, HeightAyura, MotoCasa,
 *   ArdoWellness, Bombay, Woodsify, dufft, Polmouni
 *
 * What it does per brand:
 *   1. Upserts a User (role: 'client') — email/password are PLACEHOLDERS
 *      (brand-slug@client.hastagcreator.com / Welcome123!, same default
 *      password SalesDashboard's onboarding flow uses) since the sheet
 *      only gave brand names, no real contact info. Update these by hand
 *      later if/when the client actually needs portal login.
 *   2. Upserts a ClientWorkflow (one per org+client, the real "Website /
 *      Shopify / Meta Ads / Influencer" SOP-pipeline model — see
 *      CLAUDE.md + workflowTemplates.ts) with a single `shopify` service
 *      (that's the literal service type for "Website" everywhere in this
 *      codebase — see reassignByRole.ts's "Website (shopify service)"
 *      comment):
 *        - every brand except dufft → status 'done', full checklist
 *          ticked, completedAt = now
 *        - dufft → status 'pending', checklist unticked (i.e. NOT done,
 *          exactly as asked)
 *      assignedTo is set to Om's userId when Om can be resolved by name,
 *      since Om owns the Website/shopify service for every brand per the
 *      owner's standing rule in reassignByRole.ts. If Om isn't found,
 *      assignedTo is left blank rather than guessing.
 *
 * Idempotent-ish: re-running upserts the User by email and the
 * ClientWorkflow by (org, clientId) — a second run won't duplicate
 * clients, but WILL overwrite the shopify service back to the state
 * defined below (safe for a one-off import, don't re-run after someone
 * has started manually editing these workflows).
 *
 * Safety: dry-run by default — prints what it WOULD do and touches
 * nothing. Pass --apply to actually write.
 *
 * How to run (from server/):
 *   DRY RUN:  npm run bulk-add-website-clients
 *   APPLY:    npm run bulk-add-website-clients -- --apply
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';
import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import { SERVICE_TEMPLATES } from '../lib/workflowTemplates';

const APPLY = process.argv.includes('--apply');

// Non-red rows from the owner's screenshot, in sheet order.
// "dufft" is the one brand whose website is NOT marked completed.
const BRANDS = [
  'Sroja',
  'Darpan',
  'Ghee-Neeraj',
  'Oudfy',
  'HeightAyura',
  'MotoCasa',
  'ArdoWellness',
  'Bombay',
  'Woodsify',
  'dufft',
  'Polmouni',
];
const NOT_COMPLETED = new Set(['dufft']);

const DEFAULT_PASSWORD = 'Welcome123!'; // same default the lead→client onboarding flow uses

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function findUserByName(orgId: any, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee'] },
  }).select('_id name').lean();
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).`);

  // Admin/creator for ClientWorkflow.createdBy (required field).
  const admin = await User.findOne({ organizationId: org._id, role: 'admin' })
    .sort({ createdAt: 1 }).select('_id name').lean();
  if (!admin) { console.error('No admin user found in this org — needed for createdBy. Aborting.'); process.exit(1); }
  console.log(`createdBy → ${admin.name} (${String(admin._id)})`);

  // Om owns the Website/shopify service for every brand (reassignByRole.ts
  // standing rule) — assign the new service lines to him when found.
  const om = await findUserByName(org._id, 'Om');
  if (om) console.log(`Website service assignee → ${om.name} (${String(om._id)})`);
  else console.warn('Could not find a user named "Om" — leaving assignedTo blank on new services.');

  const shopifyTpl = SERVICE_TEMPLATES.shopify;

  let usersCreated = 0, usersExisting = 0, workflowsCreated = 0, workflowsUpdated = 0;

  for (const brand of BRANDS) {
    const email = `${slugify(brand)}@client.hastagcreator.com`;
    const isDone = !NOT_COMPLETED.has(brand);

    console.log(`\n— ${brand} (${email}) — website will be marked ${isDone ? 'DONE' : 'NOT done (pending)'}`);

    let user = await User.findOne({ email, organizationId: org._id });
    if (!user) {
      const crossOrg = await User.findOne({ email });
      if (crossOrg) {
        console.log(`  found existing user in another org — moving to ${org.name}`);
        if (APPLY) { crossOrg.organizationId = org._id as any; await crossOrg.save(); }
        user = crossOrg;
        usersExisting++;
      } else {
        console.log('  would create User (role: client)');
        if (APPLY) {
          user = await User.create({
            organizationId: org._id,
            email,
            name: brand,
            role: 'client',
            passwordHash: DEFAULT_PASSWORD, // pre-save hook bcrypts
            isActive: true,
            importedFrom: 'bulk-website-clients-2026-08',
          } as any);
        }
        usersCreated++;
      }
    } else {
      console.log('  User already exists — reusing');
      usersExisting++;
    }

    if (!APPLY) {
      console.log(`  would upsert ClientWorkflow → shopify service status=${isDone ? 'done' : 'pending'}`);
      continue; // can't build a ClientWorkflow without a real user _id
    }

    const clientId = String(user!._id);
    let wf = await ClientWorkflow.findOne({ organizationId: org._id, clientId });

    const serviceLine = {
      serviceType: 'shopify',
      label: shopifyTpl.label,
      assignedTo: om ? String(om._id) : undefined,
      status: isDone ? 'done' : 'pending',
      checklist: shopifyTpl.checklist.map(text => ({
        text,
        done: isDone,
        doneAt: isDone ? new Date() : undefined,
        doneBy: isDone && om ? String(om._id) : undefined,
      })),
      startedAt: new Date(),
      completedAt: isDone ? new Date() : undefined,
    };

    if (!wf) {
      wf = new ClientWorkflow({
        organizationId: org._id,
        clientId,
        clientName: brand,
        clientEmail: email,
        services: [serviceLine],
        createdBy: String(admin._id),
        importedFrom: 'bulk-website-clients-2026-08',
        activity: [{
          actorId: String(admin._id),
          actorName: admin.name,
          action: 'created',
          serviceType: 'shopify',
          detail: `Bulk-imported${isDone ? ' — website marked completed' : ''}`,
        }],
      });
      await wf.save();
      workflowsCreated++;
      console.log(`  created ClientWorkflow (${String(wf._id)})`);
    } else {
      const existingIdx = (wf.services as any[]).findIndex(s => s.serviceType === 'shopify');
      if (existingIdx >= 0) (wf.services as any[])[existingIdx] = { ...(wf.services as any[])[existingIdx], ...serviceLine };
      else (wf.services as any[]).push(serviceLine);
      wf.markModified('services'); // index-assignment on a DocumentArray needs an explicit nudge
      (wf.activity as any[]).push({
        actorId: String(admin._id),
        actorName: admin.name,
        action: 'reassigned',
        serviceType: 'shopify',
        detail: `Bulk-import update${isDone ? ' — website marked completed' : ''}`,
      });
      await wf.save();
      workflowsUpdated++;
      console.log(`  updated existing ClientWorkflow (${String(wf._id)})`);
    }
  }

  console.log('\n─────────────────────────────');
  console.log(`Users: ${usersCreated} created, ${usersExisting} already existed`);
  console.log(`Workflows: ${workflowsCreated} created, ${workflowsUpdated} updated`);
  if (!APPLY) console.log('\nDRY RUN ONLY — nothing was written. Re-run with -- --apply to commit.');
  else console.log(`\nDefault login for any newly-created client: password "${DEFAULT_PASSWORD}" — these are placeholder logins, update with real client emails when available.`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('bulkAddWebsiteClients failed:', err);
  process.exit(1);
});
