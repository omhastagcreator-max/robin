/**
 * keepOnlyBrands.ts — wipe every client out of Robin EXCEPT an explicit
 * allow-list (owner ask, Aug 2026: "make sure we have only these clients
 * as of now" + "wipe off all the old data of clients from the robin only
 * keep these clients and there there data").
 *
 * KEEP_BRANDS is the exact 11-brand list from the owner's brand-routing
 * sheet screenshot: Sroja, Darpan, Ghee-Neeraj, Oudfy, HeightAyura,
 * MotoCasa, ArdoWellness, Bombay, Woodsify, dufft, Polmouni — the same
 * set bulkAddWebsiteClients.ts onboarded. Matching is exact, case-
 * insensitive, on the whole name (NOT a substring/prefix match) —
 * deliberately narrow so this can't accidentally eat a brand whose name
 * happens to contain a kept brand's name as a substring.
 *
 * This is the inverse of purgeBrand.ts (which matches SPECIFIC bad
 * brand patterns and deletes those). Because this script instead keeps a
 * small allow-list and removes everything else, the removal side is
 * deliberately kept SURGICAL, not blanket:
 *   - ClientWorkflow / Lead / legacy Project: removed if their own name
 *     field doesn't match the allow-list. Straightforward.
 *   - Linked client User accounts: removed ONLY if (a) explicitly
 *     referenced via clientId/convertedToClientId from an already-removed
 *     root doc, OR (b) their own name doesn't match the allow-list AND
 *     they're not linked (by id) to any KEPT ClientWorkflow. Never a
 *     blind "delete every client-role user" sweep.
 *   - FocusList items / BrandPulse: only pulled/removed if they reference
 *     an already-removed id, OR their label/clientName EXACTLY matches
 *     one of the specific removed brand names collected in this run —
 *     never a blanket "label isn't one of the 11" match, since FocusList
 *     items can be generic tasks with nothing to do with a brand name at
 *     all, and sweeping those up on a "not in the keep list" test would
 *     silently destroy unrelated data.
 *
 * Known duplicate NOT auto-resolved: two real (non-bulk-imported) Darpan
 * ClientWorkflow docs exist (6a0eff0f8caf9cd458df2fa6 and
 * 6a0aa03bc1dc825d88b42e4a) — both match "Darpan" so both are kept by
 * this script's name-matching, but only one should really exist. Printed
 * as a manual-review note every run; this script will NEVER auto-delete
 * either one. See the printed recommendation for which looks like the
 * stale/demo copy.
 *
 * Safety: dry-run by default — prints exactly what would be kept vs
 * removed, deletes nothing. Pass --apply to actually commit. This is a
 * genuinely destructive, hard-to-undo operation (no soft-delete anywhere
 * in this schema) — always read the dry-run output carefully first.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run keep-only-brands
 *   APPLY:    npm run keep-only-brands -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import Lead from '../models/Lead';
import Project from '../models/Project';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import ClientPerformanceEntry from '../models/ClientPerformanceEntry';
import WorkflowActivity from '../models/WorkflowActivity';
import BrandPulse from '../models/BrandPulse';
import ClientSchedule from '../models/ClientSchedule';
import ClientTransaction from '../models/ClientTransaction';
import Deal from '../models/Deal';
import FocusList from '../models/FocusList';
import Notification from '../models/Notification';

const APPLY = process.argv.includes('--apply');

const KEEP_BRANDS = [
  'Sroja', 'Darpan', 'Ghee-Neeraj', 'Oudfy', 'HeightAyura', 'MotoCasa',
  'ArdoWellness', 'Bombay', 'Woodsify', 'dufft', 'Polmouni',
];
const norm = (s?: string | null) => (s || '').trim().toLowerCase();
const keepSet = new Set(KEEP_BRANDS.map(norm));
const isKept = (name?: string | null) => keepSet.has(norm(name));

/** Guards against a corrupt/non-ObjectId string in a String-typed clientId field. */
function toObjectIdSafe(id: string): Types.ObjectId | null {
  try { return new Types.ObjectId(id); } catch { return null; }
}

/** Escape a literal string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).`);
  console.log(`Keep-list (${KEEP_BRANDS.length}): ${KEEP_BRANDS.join(', ')}\n`);

  // ── 1. Partition every root doc into KEEP vs REMOVE ──────────────
  const allWorkflows = await ClientWorkflow.find({ organizationId: org._id })
    .select('_id clientName clientId tags').lean();
  const keepWorkflows   = allWorkflows.filter(w => isKept(w.clientName));
  const removeWorkflows = allWorkflows.filter(w => !isKept(w.clientName));

  const allLeads = await Lead.find({ organizationId: org._id })
    .select('_id name company convertedToClientId').lean();
  const keepLeads   = allLeads.filter(l => isKept(l.name) || isKept(l.company));
  const removeLeads = allLeads.filter(l => !isKept(l.name) && !isKept(l.company));

  const allLegacyProjects = await Project.find({ organizationId: org._id })
    .select('_id name clientId').lean();
  const keepProjects   = allLegacyProjects.filter(p => isKept(p.name));
  const removeProjects = allLegacyProjects.filter(p => !isKept(p.name));

  console.log(`ClientWorkflow: ${keepWorkflows.length} kept, ${removeWorkflows.length} to remove`);
  removeWorkflows.forEach(w => console.log(`  - REMOVE: ${w.clientName}  (${String(w._id)})`));
  console.log(`Lead: ${keepLeads.length} kept, ${removeLeads.length} to remove`);
  removeLeads.forEach(l => console.log(`  - REMOVE: ${l.name}${l.company ? ` / ${l.company}` : ''}  (${String(l._id)})`));
  console.log(`Legacy Project: ${keepProjects.length} kept, ${removeProjects.length} to remove`);
  removeProjects.forEach(p => console.log(`  - REMOVE: ${p.name}  (${String(p._id)})`));

  // Flag (never touch) the known duplicate-Darpan situation.
  const darpanKept = keepWorkflows.filter(w => norm(w.clientName) === 'darpan');
  if (darpanKept.length > 1) {
    console.log(`\n⚠️  ${darpanKept.length} ClientWorkflow docs named "Darpan" all match the keep-list — NOT auto-resolved:`);
    darpanKept.forEach(w => {
      const flag = (w.tags || []).includes('dummy') ? '  ← tagged "dummy", looks like the seed/demo copy' : '';
      console.log(`    - ${String(w._id)}${flag}`);
    });
    console.log('    Pick which one is current and delete the other by hand once you\'ve confirmed.');
  }

  // ── 2. Collect ids for the REMOVE side ────────────────────────────
  const removeWfIds    = removeWorkflows.map(w => w._id as Types.ObjectId);
  const removeLeadIds  = removeLeads.map(l => l._id as Types.ObjectId);
  const removeProjectIds = removeProjects.map(p => p._id as Types.ObjectId);

  // clientId strings explicitly referenced by REMOVE-side root docs.
  const removeClientIdStrings = new Set<string>();
  removeWorkflows.forEach(w => { if (w.clientId) removeClientIdStrings.add(String(w.clientId)); });
  removeLeads.forEach(l => { if (l.convertedToClientId) removeClientIdStrings.add(String(l.convertedToClientId)); });
  removeProjects.forEach(p => { if ((p as any).clientId) removeClientIdStrings.add(String((p as any).clientId)); });

  // clientId strings referenced by KEPT root docs — these must NEVER be
  // touched, even if a name-based scan below would otherwise flag them.
  const keepClientIdStrings = new Set<string>();
  keepWorkflows.forEach(w => { if (w.clientId) keepClientIdStrings.add(String(w.clientId)); });
  keepLeads.forEach(l => { if (l.convertedToClientId) keepClientIdStrings.add(String(l.convertedToClientId)); });
  keepProjects.forEach(p => { if ((p as any).clientId) keepClientIdStrings.add(String((p as any).clientId)); });

  // Orphan client-role Users: not linked (by id) to any kept doc, AND
  // their own name doesn't match the keep-list either.
  const allClientUsers = await User.find({ organizationId: org._id, role: 'client' })
    .select('_id name email').lean();
  const orphanUsersToRemove = allClientUsers.filter(u =>
    !keepClientIdStrings.has(String(u._id)) && !isKept(u.name),
  );
  orphanUsersToRemove.forEach(u => removeClientIdStrings.add(String(u._id)));

  console.log(`\nClient User accounts: ${allClientUsers.length} total, ${orphanUsersToRemove.length} orphaned/unmatched to remove`);
  orphanUsersToRemove.forEach(u => console.log(`  - REMOVE: ${u.name} <${u.email}>  (${String(u._id)})`));

  // Safe ObjectId filtering — computed immediately, reused everywhere a
  // User query needs it (this is exactly the bug that crashed
  // purgeBrand.ts on a stray "dummy:vellore-living" clientId string).
  const removeClientObjectIds: Types.ObjectId[] = [];
  const invalidClientIdStrings: string[] = [];
  for (const s of removeClientIdStrings) {
    const oid = toObjectIdSafe(s);
    if (oid) removeClientObjectIds.push(oid);
    else invalidClientIdStrings.push(s);
  }
  if (invalidClientIdStrings.length > 0) {
    console.log(`\nNon-ObjectId clientId value(s) on removed docs (skipped, no linked User to delete): ${invalidClientIdStrings.join(', ')}`);
  }

  if (removeWfIds.length === 0 && removeLeadIds.length === 0 && removeProjectIds.length === 0 && removeClientObjectIds.length === 0) {
    console.log('\nNothing to remove — Robin already matches the keep-list exactly.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Exact-name regex for the specific brands being removed (for
  // FocusList label / BrandPulse clientName matching) — NEVER a blanket
  // "not in the keep list" match, since those collections can hold
  // entries with nothing to do with a brand name at all.
  const removedNames = new Set<string>();
  removeWorkflows.forEach(w => { if (w.clientName) removedNames.add(w.clientName); });
  removeLeads.forEach(l => { if (l.name) removedNames.add(l.name); if (l.company) removedNames.add(l.company); });
  removeProjects.forEach(p => { if (p.name) removedNames.add(p.name); });
  const removedNameRegex = removedNames.size
    ? new RegExp(`^(${Array.from(removedNames).map(escapeRe).join('|')})$`, 'i')
    : null;

  // ── 3. Cascade counts ──────────────────────────────────────────────
  const cascadeFilters: Record<string, any> = {
    ProjectTask:              { clientWorkflowId: { $in: removeWfIds } },
    ClientPerformanceEntry:   { clientWorkflowId: { $in: removeWfIds } },
    WorkflowActivity:         { workflowId: { $in: removeWfIds } },
    BrandPulse:               removedNameRegex
      ? { $or: [{ clientWorkflowId: { $in: removeWfIds } }, { clientName: removedNameRegex }] }
      : { clientWorkflowId: { $in: removeWfIds } },
    ClientSchedule:           { clientId: { $in: Array.from(removeClientIdStrings) } },
    ClientTransaction:        { clientId: { $in: Array.from(removeClientIdStrings) } },
    Deal:                     { leadId: { $in: removeLeadIds } },
    Notification:             { entityId: { $in: removeWfIds } },
  };
  const models: Record<string, any> = {
    ProjectTask, ClientPerformanceEntry, WorkflowActivity, BrandPulse,
    ClientSchedule, ClientTransaction, Deal, Notification,
  };

  console.log('\n── Cascade matches ──');
  for (const key of Object.keys(cascadeFilters)) {
    const c = await models[key].countDocuments(cascadeFilters[key]);
    console.log(`  ${key}: ${c}`);
  }

  // FocusList — count items that would be $pull'd, not whole docs.
  const focusLists = await FocusList.find({
    organizationId: org._id,
    $or: [
      { 'items.leadId': { $in: removeLeadIds } },
      { 'items.clientUserId': { $in: removeClientObjectIds } },
      ...(removedNameRegex ? [{ 'items.label': removedNameRegex }] : []),
    ],
  }).select('_id items').lean();
  let focusItemCount = 0;
  focusLists.forEach(fl => {
    focusItemCount += (fl.items || []).filter((it: any) =>
      (it.leadId && removeLeadIds.some(id => String(id) === String(it.leadId))) ||
      (it.clientUserId && removeClientIdStrings.has(String(it.clientUserId))) ||
      (removedNameRegex && it.label && removedNameRegex.test(it.label)),
    ).length;
  });
  console.log(`  FocusList items (pulled, not whole docs): ${focusItemCount}`);

  if (!APPLY) {
    console.log('\nDRY RUN ONLY — nothing was deleted. Re-run with -- --apply to commit.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── 4. Delete cascade rows ────────────────────────────────────────
  for (const key of Object.keys(cascadeFilters)) {
    const res = await models[key].deleteMany(cascadeFilters[key]);
    console.log(`Deleted ${res.deletedCount} ${key} doc(s)`);
  }

  // FocusList — pull matching items in place.
  for (const fl of focusLists) {
    await FocusList.updateOne({ _id: fl._id }, { $pull: { items: {
      $or: [
        { leadId: { $in: removeLeadIds } },
        { clientUserId: { $in: removeClientObjectIds } },
        ...(removedNameRegex ? [{ label: removedNameRegex }] : []),
      ],
    } } });
  }
  console.log(`Pulled ${focusItemCount} item(s) from ${focusLists.length} FocusList doc(s)`);

  // ── 5. Delete the root docs themselves ───────────────────────────
  const dw = await ClientWorkflow.deleteMany({ _id: { $in: removeWfIds } });
  console.log(`Deleted ${dw.deletedCount} ClientWorkflow doc(s)`);
  const dl = await Lead.deleteMany({ _id: { $in: removeLeadIds } });
  console.log(`Deleted ${dl.deletedCount} Lead doc(s)`);
  const dp = await Project.deleteMany({ _id: { $in: removeProjectIds } });
  console.log(`Deleted ${dp.deletedCount} legacy Project doc(s)`);
  // Safety: role:'client' filter so this can NEVER touch a staff account
  // even if an id somehow ended up in the set by mistake.
  const du = await User.deleteMany({ _id: { $in: removeClientObjectIds }, role: 'client' });
  console.log(`Deleted ${du.deletedCount} client User doc(s)`);

  console.log(`\nDone. Robin's Client CRM should now contain exactly: ${KEEP_BRANDS.join(', ')}`);
  if (darpanKept.length > 1) {
    console.log('Reminder: the duplicate "Darpan" entries above were NOT touched — resolve by hand.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('keepOnlyBrands failed:', err);
  process.exit(1);
});
