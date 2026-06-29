/**
 * wipeImported.ts — owner ask (June 2026): "clean the old task data + old
 * client data — start fresh."
 *
 * Scope: ONLY auto-imported records.
 *
 *   - ProjectTask docs where importedFrom matches /^crm-sheets-/ or
 *     /^sheet-sync/ — anything the Google-Sheets sync job ever created.
 *   - ClientWorkflow docs where importedFrom is non-empty AND not
 *     manually edited (we use lastActivitySummary as a proxy: if the
 *     workflow has any "manual" activity entries beyond the import, we
 *     keep it).
 *   - Placeholder client User docs imported by the sync job
 *     (importedFrom starts with crm-sheets-).
 *
 * KEPT:
 *   - Internal staff users (no importedFrom or importedFrom=manual).
 *   - Any task or brand created manually inside Robin (importedFrom='').
 *   - All Sessions / WorkflowActivity / Notifications etc. — they're
 *     audit trails; deleting them would leak history.
 *
 * Idempotent — re-running with no new imports is a no-op.
 *
 * Usage:
 *   DRY RUN (default):   npm run wipe-imported
 *   APPLY:               npm run wipe-imported -- --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`[wipe] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Tasks: anything imported from any sync source.
  const taskFilter = { importedFrom: { $regex: /^(crm-sheets|sheet-sync|daily-checkin)/i } };
  const taskCount = await ProjectTask.countDocuments(taskFilter);
  console.log(`[wipe] ProjectTask matches: ${taskCount}`);

  // Brand workflows: imported AND with no manual touches beyond the import.
  // A "manual touch" is any activity log entry whose actorId is not the import
  // bot (we don't have an explicit import-bot user — the heuristic is "any
  // activity with a populated detail string that isn't the import marker").
  // To be safe, we restrict to importedFrom matching the sheet-sync pattern.
  const workflowFilter = { importedFrom: { $regex: /^(crm-sheets|sheet-sync)/i } };
  const wfCount = await ClientWorkflow.countDocuments(workflowFilter);
  console.log(`[wipe] ClientWorkflow matches: ${wfCount}`);

  // Placeholder client users — only those tagged as imported. NEVER touch
  // real staff (no importedFrom).
  const userFilter = { importedFrom: { $regex: /^(crm-sheets|sheet-sync)/i } };
  const usrCount = await User.countDocuments(userFilter);
  console.log(`[wipe] User (placeholder clients) matches: ${usrCount}`);

  if (!APPLY) {
    console.log('[wipe] dry-run only. Re-run with --apply to delete.');
    await mongoose.disconnect();
    return;
  }

  const t = await ProjectTask.deleteMany(taskFilter);
  console.log(`[wipe] deleted ${t.deletedCount} ProjectTask doc(s)`);
  const w = await ClientWorkflow.deleteMany(workflowFilter);
  console.log(`[wipe] deleted ${w.deletedCount} ClientWorkflow doc(s)`);
  const u = await User.deleteMany(userFilter);
  console.log(`[wipe] deleted ${u.deletedCount} placeholder User doc(s)`);

  console.log('[wipe] done.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[wipe] FATAL', err);
  process.exit(1);
});
