/**
 * grantClientEditPermission.ts — sets User.canEditAllClients = true for
 * Om (owner ask, Aug 2026: "allow Om to edit anything any status of
 * clients... change the project owner as well, edit the timelines and
 * everything").
 *
 * This flag lets him bypass the normal "only the assignee (or an admin)
 * can touch this service" rule everywhere in clientWorkflowController.ts
 * (checklist ticking, marking a service done, setting its ETA, changing
 * who owns a service, bulk priority/on-track actions) WITHOUT giving him
 * a blanket extra 'admin' role — that would also open every other
 * admin-only surface in the app (payroll, employee reports, etc.), more
 * than what was actually asked for. Same "delegate one specific power to
 * a trusted employee" pattern as the existing `canManageWorkroom` flag.
 *
 * Idempotent — safe to re-run. Matched by name (same lookup style as
 * bulkAddWebsiteClients.ts's `findUserByName`), since Om's exact email
 * varies by environment/seed run.
 *
 * Usage (from server/):
 *   npm run grant-client-edit
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import User from '../models/User';

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }

  const om = await User.findOne({
    organizationId: org._id,
    name: { $regex: '^om(\\s|$|\\.)', $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee', 'workroom'] },
  });
  if (!om) {
    console.error('Could not find a user named "Om" in this org. Aborting — nothing changed.');
    process.exit(1);
  }

  if (om.canEditAllClients) {
    console.log(`${om.name} (${om.email}) already has canEditAllClients = true. Nothing to do.`);
  } else {
    om.canEditAllClients = true;
    await om.save();
    console.log(`Granted canEditAllClients to ${om.name} (${om.email}, id ${String(om._id)}).`);
    console.log('He can now edit any client\'s checklist/service status/ETA and reassign the project owner, regardless of assignment.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('grantClientEditPermission failed:', err);
  process.exit(1);
});
