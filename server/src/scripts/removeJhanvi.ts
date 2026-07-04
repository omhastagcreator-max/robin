/**
 * removeJhanvi.ts — owner ask (June 2026): "remove Jhanvi."
 *
 * Deactivates every user account matching the name "Jhanvi" (case-
 * insensitive) OR an email that starts with "jhanvi". Deactivation
 * (isActive = false) rather than hard delete so:
 *
 *   - Historical audit trails (Sessions, ProjectTasks, ChatMessages)
 *     still reference a valid User document — reports won't show
 *     "unknown user"
 *   - She can be reinstated later with one flag flip if needed
 *   - No cascading orphans in half a dozen collections
 *
 * Also strips her from every ClientWorkflow.services[].assignedTo she
 * currently owns, so brand cards don't keep her name after she's off.
 *
 * Prints every match with id + email before touching anything, so you
 * can eyeball it before committing.
 *
 * Usage:
 *   DRY RUN:  npm run remove-jhanvi
 *   APPLY:    npm run remove-jhanvi -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI missing in .env');
  await mongoose.connect(uri);
  console.log(`[remove-jhanvi] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // Match by name OR email prefix — case-insensitive.
  const matchFilter = {
    $or: [
      { name:  { $regex: /jhanvi/i } },
      { email: { $regex: /^jhanvi/i } },
    ],
  };

  const matches = await User.find(matchFilter).select('_id name email role team isActive organizationId').lean();
  if (matches.length === 0) {
    console.log('No matching users found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${matches.length} match${matches.length === 1 ? '' : 'es'}:`);
  for (const u of matches) {
    console.log(
      `  · ${u.name || '(no name)'.padEnd(18)}  <${u.email}>` +
      `  role=${u.role} team=${u.team || '(none)'} active=${u.isActive}  ${u._id}`,
    );
  }

  const ids = matches.map(u => u._id);

  // Count downstream references so the user knows what's about to
  // change on brand cards.
  const workflowsWithHer = await ClientWorkflow.countDocuments({
    'services.assignedTo': { $in: ids.map(String) },
  });
  console.log(`\nClientWorkflow services currently owned by these users: ${workflowsWithHer}`);

  if (!APPLY) {
    console.log('\n👀 DRY RUN — nothing was changed. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  // Deactivate the user records.
  const dr = await User.updateMany(matchFilter, { $set: { isActive: false } });
  console.log(`\nDeactivated ${dr.modifiedCount} user record${dr.modifiedCount === 1 ? '' : 's'}.`);

  // Strip her assignedTo from every service she owns. We don't
  // reassign — an admin should pick the new owner deliberately.
  const wr = await ClientWorkflow.updateMany(
    { 'services.assignedTo': { $in: ids.map(String) } },
    { $set: { 'services.$[svc].assignedTo': '' } },
    { arrayFilters: [{ 'svc.assignedTo': { $in: ids.map(String) } }] },
  );
  console.log(`Cleared assignedTo on ${wr.modifiedCount} ClientWorkflow doc${wr.modifiedCount === 1 ? '' : 's'}.`);

  console.log('\n✅ Done. Reinstate any of these accounts by flipping isActive=true.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[remove-jhanvi] FATAL', err);
  process.exit(1);
});
