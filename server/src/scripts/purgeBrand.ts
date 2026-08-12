/**
 * purgeBrand.ts — fully remove one or more brands' data from every
 * corner of Robin (owner ask, Aug 2026: "remove all the old brand
 * history, vellore from the whole robin").
 *
 * Hardcoded target for this run: Vellore (incl. the "VELLOR LIVING" /
 * "Vellore Living" spelling variants seen in the CRM import + demo seed)
 * and History — these were routed together in BRAND_ROUTING
 * (brandPulseCron.ts) and shown as one combined row ("Vellore + History")
 * on the owner's brand sheet, but they're two separate brand records in
 * the data model, so both get matched independently.
 *
 * Cascade — deletes/pulls from EVERY collection that can reference a
 * brand, in this order:
 *   1. Find root docs: ClientWorkflow (clientName), Lead (name/company),
 *      Project — legacy model (name), User role=client (name).
 *   2. Collect their _ids (+ ClientWorkflow.clientId / Lead's
 *      convertedToClientId, to also catch the linked client login even
 *      if the User's own name doesn't literally contain the brand word).
 *   3. Cascade-delete everything referencing those ids: ProjectTask,
 *      ClientPerformanceEntry, WorkflowActivity, BrandPulse,
 *      ClientSchedule, ClientTransaction, Deal (via Lead), Notification
 *      (via ClientWorkflow entityId).
 *   4. $pull matching items out of FocusList docs (can't delete the
 *      whole list — it's a shared weekly doc, just remove the entries).
 *   5. Finally delete the root docs themselves.
 *
 * Safety: dry-run by default — prints every match with counts, deletes
 * nothing. Pass --apply to actually commit. This is a genuinely
 * destructive, hard-to-undo operation (no soft-delete anywhere in this
 * schema) — always run the dry run first and read the counts.
 *
 * Does NOT touch: brandPulseCron.ts's BRAND_ROUTING table (a separate,
 * intentional code edit — the two /vellore/i and /history/i entries
 * were removed by hand alongside this script) or the example brand
 * names used as illustrative text in AI prompts / demo seed scripts
 * (aiTriage.ts, seedDummyPipelines.ts, crm-seed-data.json) — those are
 * fixtures/prompt copy, not live data, and removing them has no
 * functional effect.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run purge-brand
 *   APPLY:    npm run purge-brand -- --apply
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

// The two brands being purged this run — see docstring above for why
// both are needed even though the owner's sheet showed one combined row.
// Aug 2026 — broadened /vellor/i → /^vell/i after "Velloer Living" (an
// inconsistent spelling of the same brand — see seedDummyPipelines.ts's
// own cleanup list, which already knew about both "Vellore Living" AND
// "Velloer Living") slipped through the narrower pattern and kept
// showing up in the Client CRM. Prefix match on a brand-name field is
// safe here — these regexes only ever run against clientName/name/
// company/label, never free text.
const BRAND_PATTERNS = [/^vell/i, /\bhistory\b/i];
const matchesBrand = (s?: string | null) => !!s && BRAND_PATTERNS.some(re => re.test(s));
const combinedRegex = new RegExp(BRAND_PATTERNS.map(re => re.source).join('|'), 'i');

/** Guards against a corrupt/non-ObjectId string in a String-typed clientId field. */
function toObjectIdSafe(id: string): Types.ObjectId | null {
  try { return new Types.ObjectId(id); } catch { return null; }
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).\n`);

  // ── 1. Find root docs ────────────────────────────────────────────
  const workflows = await ClientWorkflow.find({ organizationId: org._id, clientName: combinedRegex })
    .select('_id clientName clientId').lean();
  const leads = await Lead.find({ organizationId: org._id, $or: [{ name: combinedRegex }, { company: combinedRegex }] })
    .select('_id name company convertedToClientId').lean();
  const legacyProjects = await Project.find({ organizationId: org._id, name: combinedRegex })
    .select('_id name clientId').lean();

  console.log(`ClientWorkflow matches (${workflows.length}):`);
  workflows.forEach(w => console.log(`  - ${w.clientName}  (${String(w._id)})`));
  console.log(`\nLead matches (${leads.length}):`);
  leads.forEach(l => console.log(`  - ${l.name}${l.company ? ` / ${l.company}` : ''}  (${String(l._id)})`));
  console.log(`\nLegacy Project matches (${legacyProjects.length}):`);
  legacyProjects.forEach(p => console.log(`  - ${p.name}  (${String(p._id)})`));

  // ── 2. Collect ids to cascade on ─────────────────────────────────
  const wfIds = workflows.map(w => w._id as Types.ObjectId);
  const leadIds = leads.map(l => l._id as Types.ObjectId);

  // Client-login User ids: from ClientWorkflow.clientId, Lead.convertedToClientId,
  // Project.clientId (all stored as plain strings), PLUS any User whose own
  // name matches the brand (catches placeholder logins with no linked workflow).
  const clientIdStrings = new Set<string>();
  workflows.forEach(w => { if (w.clientId) clientIdStrings.add(String(w.clientId)); });
  leads.forEach(l => { if (l.convertedToClientId) clientIdStrings.add(String(l.convertedToClientId)); });
  legacyProjects.forEach(p => { if (p.clientId) clientIdStrings.add(String(p.clientId)); });
  const namedClientUsers = await User.find({ organizationId: org._id, role: 'client', name: combinedRegex })
    .select('_id name').lean();
  namedClientUsers.forEach(u => clientIdStrings.add(String(u._id)));

  // Some older demo/seed ClientWorkflow docs stored a non-ObjectId
  // placeholder in clientId (e.g. "dummy:vellore-living" from a seed
  // script that never linked a real User). Mongoose throws a CastError
  // if ANY of these hit a User query's $in — filter to valid ObjectId
  // strings only, and just report the bogus ones instead of crashing.
  const clientObjectIds: Types.ObjectId[] = [];
  const invalidClientIdStrings: string[] = [];
  for (const s of clientIdStrings) {
    const oid = toObjectIdSafe(s);
    if (oid) clientObjectIds.push(oid);
    else invalidClientIdStrings.push(s);
  }
  if (invalidClientIdStrings.length > 0) {
    console.log(`\nNon-ObjectId clientId value(s) found on matched docs (skipped, no linked User to delete): ${invalidClientIdStrings.join(', ')}`);
  }

  console.log(`\nLinked client User accounts (${clientObjectIds.length}):`);
  if (clientObjectIds.length > 0) {
    const users = await User.find({ _id: { $in: clientObjectIds } }).select('_id name email').lean();
    users.forEach(u => console.log(`  - ${u.name} <${u.email}>  (${String(u._id)})`));
  }

  if (wfIds.length === 0 && leadIds.length === 0 && legacyProjects.length === 0 && clientIdStrings.size === 0) {
    console.log('\nNothing matched — nothing to purge.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── 3. Cascade counts (dry-run always computes these; APPLY deletes them) ──
  const cascadeFilters: Record<string, any> = {
    ProjectTask:              { clientWorkflowId: { $in: wfIds } },
    ClientPerformanceEntry:   { clientWorkflowId: { $in: wfIds } },
    WorkflowActivity:         { workflowId: { $in: wfIds } },
    BrandPulse:               { $or: [{ clientWorkflowId: { $in: wfIds } }, { clientName: combinedRegex }] },
    ClientSchedule:           { clientId: { $in: Array.from(clientIdStrings) } },
    ClientTransaction:        { clientId: { $in: Array.from(clientIdStrings) } },
    Deal:                     { leadId: { $in: leadIds } },
    Notification:             { entityId: { $in: wfIds } },
  };
  const models: Record<string, any> = {
    ProjectTask, ClientPerformanceEntry, WorkflowActivity, BrandPulse,
    ClientSchedule, ClientTransaction, Deal, Notification,
  };

  console.log('\n── Cascade matches ──');
  const counts: Record<string, number> = {};
  for (const key of Object.keys(cascadeFilters)) {
    counts[key] = await models[key].countDocuments(cascadeFilters[key]);
    console.log(`  ${key}: ${counts[key]}`);
  }

  // FocusList — count items that would be $pull'd, not whole docs.
  // (clientObjectIds was already built above, right after clientIdStrings.)
  const focusLists = await FocusList.find({
    organizationId: org._id,
    $or: [
      { 'items.leadId': { $in: leadIds } },
      { 'items.clientUserId': { $in: clientObjectIds } },
      { 'items.label': combinedRegex },
    ],
  }).select('_id items').lean();
  let focusItemCount = 0;
  focusLists.forEach(fl => {
    focusItemCount += (fl.items || []).filter((it: any) =>
      (it.leadId && leadIds.some(id => String(id) === String(it.leadId))) ||
      (it.clientUserId && clientIdStrings.has(String(it.clientUserId))) ||
      matchesBrand(it.label),
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
        { leadId: { $in: leadIds } },
        { clientUserId: { $in: clientObjectIds } },
        { label: combinedRegex },
      ],
    } } });
  }
  console.log(`Pulled ${focusItemCount} item(s) from ${focusLists.length} FocusList doc(s)`);

  // ── 5. Delete the root docs themselves ───────────────────────────
  const dw = await ClientWorkflow.deleteMany({ _id: { $in: wfIds } });
  console.log(`Deleted ${dw.deletedCount} ClientWorkflow doc(s)`);
  const dl = await Lead.deleteMany({ _id: { $in: leadIds } });
  console.log(`Deleted ${dl.deletedCount} Lead doc(s)`);
  const dp = await Project.deleteMany({ _id: { $in: legacyProjects.map(p => p._id) } });
  console.log(`Deleted ${dp.deletedCount} legacy Project doc(s)`);
  // Safety: role:'client' filter so this can NEVER touch a staff account
  // even if an id somehow ended up in the set by mistake. Uses the
  // pre-filtered clientObjectIds (not the raw strings) so a stray
  // non-ObjectId placeholder like "dummy:vellore-living" can't crash this.
  const du = await User.deleteMany({ _id: { $in: clientObjectIds }, role: 'client' });
  console.log(`Deleted ${du.deletedCount} client User doc(s)`);

  console.log('\nDone. (BRAND_ROUTING in server/src/jobs/brandPulseCron.ts already had the');
  console.log('/vellore/i and /history/i entries removed in the same change as this script —');
  console.log('nothing left to do there.)');

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('purgeBrand failed:', err);
  process.exit(1);
});
