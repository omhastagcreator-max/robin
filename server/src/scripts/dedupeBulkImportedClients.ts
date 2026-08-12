/**
 * dedupeBulkImportedClients.ts — remove the duplicate clients created by
 * bulkAddWebsiteClients.ts (Aug 2026).
 *
 * Root cause: that script only checked for an existing User by its OWN
 * synthetic placeholder email (`<slug>@client.hastagcreator.com`). Several
 * of the brands it was asked to add (Oudfy, Darpan, ...) were already
 * real, live clients under their real emails — so instead of finding
 * them, it created a second User + a second ClientWorkflow with the same
 * clientName. The owner spotted this from the Client CRM table view
 * showing "Oudfy" and "Darpan" twice, one row with real progress/activity
 * and one flat "Bulk-imported" row.
 *
 * This script:
 *   1. Finds every ClientWorkflow tagged importedFrom = the bulk-import
 *      marker.
 *   2. For each, checks whether ANOTHER ClientWorkflow in the same org
 *      has the same clientName (trimmed, case-insensitive) WITHOUT that
 *      tag — i.e. a pre-existing real client the bulk-import duplicated.
 *   3. If a real duplicate exists: deletes the bulk-imported ClientWorkflow
 *      + its cascade (ProjectTask, ClientPerformanceEntry, WorkflowActivity,
 *      BrandPulse) + the placeholder User IT created (only if that User is
 *      ALSO tagged with the bulk-import marker — never touches a real
 *      account, even if something looks off).
 *   4. If NO real duplicate exists (the brand genuinely didn't exist
 *      before — e.g. Polmouni, Woodsify, Bombay, dufft, ArdoWellness,
 *      MotoCasa, HeightAyura, Ghee-Neeraj, Sroja per the owner's original
 *      ask), it's left alone — that's a legitimately new client.
 *
 * Does NOT touch: the two pre-existing REAL "Darpan" rows the owner's
 * screenshot also showed (one at 57% with a Meta blocker, one at 100%
 * complete) — that duplication existed independently of the bulk-import
 * bug and isn't safe to auto-resolve (could be two different real
 * engagements, or the wrong one could get picked). Flagged in the
 * script's output for manual review instead of guessed at.
 *
 * Safety: dry-run by default. Pass --apply to actually delete.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run dedupe-bulk-clients
 *   APPLY:    npm run dedupe-bulk-clients -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import ClientPerformanceEntry from '../models/ClientPerformanceEntry';
import WorkflowActivity from '../models/WorkflowActivity';
import BrandPulse from '../models/BrandPulse';

const APPLY = process.argv.includes('--apply');
const IMPORT_TAG = 'bulk-website-clients-2026-08'; // matches bulkAddWebsiteClients.ts exactly

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).\n`);

  const allWorkflows = await ClientWorkflow.find({ organizationId: org._id })
    .select('_id clientName clientId importedFrom').lean();
  const bulkImported = allWorkflows.filter(w => w.importedFrom === IMPORT_TAG);
  console.log(`Found ${bulkImported.length} ClientWorkflow doc(s) tagged "${IMPORT_TAG}".\n`);

  const toDeleteWfIds: Types.ObjectId[] = [];
  const toDeleteUserIds: string[] = [];
  const keptAsNew: string[] = [];
  const flaggedManualReview: string[] = [];

  // Also detect duplication AMONG real (non-bulk) entries so it can be
  // surfaced without being touched — e.g. the two real "Darpan" rows.
  const realByName = new Map<string, typeof allWorkflows>();
  for (const w of allWorkflows) {
    if (w.importedFrom === IMPORT_TAG) continue;
    const key = norm(w.clientName);
    if (!realByName.has(key)) realByName.set(key, []);
    realByName.get(key)!.push(w);
  }
  for (const [name, rows] of realByName) {
    if (rows.length > 1) {
      flaggedManualReview.push(`"${rows[0].clientName}" has ${rows.length} REAL (non-bulk) ClientWorkflow docs — not touched, needs a human to pick which is current: ${rows.map(r => String(r._id)).join(', ')}`);
    }
  }

  for (const bw of bulkImported) {
    const realDupe = realByName.get(norm(bw.clientName));
    if (realDupe && realDupe.length > 0) {
      console.log(`DUPLICATE → "${bw.clientName}" (${String(bw._id)}) — real entry already exists (${realDupe.map(r => String(r._id)).join(', ')}). Will delete the bulk-imported one.`);
      toDeleteWfIds.push(bw._id as Types.ObjectId);
      if (bw.clientId) toDeleteUserIds.push(String(bw.clientId));
    } else {
      console.log(`KEEP → "${bw.clientName}" (${String(bw._id)}) — no pre-existing real entry, this was a genuinely new client.`);
      keptAsNew.push(bw.clientName || String(bw._id));
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Duplicates to remove: ${toDeleteWfIds.length}`);
  console.log(`  Kept (genuinely new): ${keptAsNew.length}  →  ${keptAsNew.join(', ') || '(none)'}`);
  if (flaggedManualReview.length) {
    console.log(`\n  ⚠️  Needs manual review (NOT touched by this script):`);
    flaggedManualReview.forEach(f => console.log(`    - ${f}`));
  }

  if (toDeleteWfIds.length === 0) {
    console.log('\nNothing to delete.');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!APPLY) {
    console.log('\nDRY RUN ONLY — nothing was deleted. Re-run with -- --apply to commit.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── Cascade delete the duplicate workflows + the placeholder users
  //    they created ────────────────────────────────────────────────
  const pt = await ProjectTask.deleteMany({ clientWorkflowId: { $in: toDeleteWfIds } });
  console.log(`Deleted ${pt.deletedCount} ProjectTask doc(s)`);
  const cpe = await ClientPerformanceEntry.deleteMany({ clientWorkflowId: { $in: toDeleteWfIds } });
  console.log(`Deleted ${cpe.deletedCount} ClientPerformanceEntry doc(s)`);
  const wa = await WorkflowActivity.deleteMany({ workflowId: { $in: toDeleteWfIds } });
  console.log(`Deleted ${wa.deletedCount} WorkflowActivity doc(s)`);
  const bp = await BrandPulse.deleteMany({ clientWorkflowId: { $in: toDeleteWfIds } });
  console.log(`Deleted ${bp.deletedCount} BrandPulse doc(s)`);

  const dw = await ClientWorkflow.deleteMany({ _id: { $in: toDeleteWfIds } });
  console.log(`Deleted ${dw.deletedCount} ClientWorkflow doc(s)`);

  // Only remove the placeholder User if IT is also tagged with the same
  // import marker — guarantees we can never delete a real client login
  // even if the linkage above were somehow wrong.
  const du = await User.deleteMany({ _id: { $in: toDeleteUserIds }, role: 'client', importedFrom: IMPORT_TAG });
  console.log(`Deleted ${du.deletedCount} placeholder client User doc(s)`);

  console.log('\nDone.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('dedupeBulkImportedClients failed:', err);
  process.exit(1);
});
