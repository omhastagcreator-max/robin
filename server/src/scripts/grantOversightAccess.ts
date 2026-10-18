/**
 * grantOversightAccess.ts — Oct 2026. Gives a manager (default: Rahul) the
 * Team Oversight dashboard (/admin/oversight): every teammate's sign-ins,
 * clock-in/out, breaks, huddle time, check-ins, tasks and activity.
 *
 * Admins already see it. If the matched person is already an admin the
 * script says so and still sets the flag (harmless; keeps access if their
 * role is ever changed). Read-only access — grants no edit powers.
 *
 * Dry run by default. Usage (from server/):
 *   npm run grant-oversight                       # preview, matches "Rahul"
 *   npm run grant-oversight -- --apply            # write
 *   NAME=priya npm run grant-oversight -- --apply # someone else
 *   REVOKE=1 npm run grant-oversight -- --apply   # take it away
 *
 * Same thing is available in the UI: Team Oversight → Manage access (admin).
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import User from '../models/User';

(async () => {
  const apply = process.argv.includes('--apply');
  const name = (process.env.NAME || 'rahul').trim();
  const enable = process.env.REVOKE !== '1';
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }

  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await User.find({
    organizationId: org._id,
    isActive: true,
    name: { $regex: `^${esc}(\\s|$|\\.)`, $options: 'i' },
  });
  if (matches.length !== 1) {
    console.error(`Expected exactly one active user named "${name}", found ${matches.length}. Nothing changed.`);
    for (const u of matches) console.error(`  - ${u.name} <${u.email}> role=${u.role}`);
    process.exit(1);
  }
  const u = matches[0];
  const isAdmin = u.role === 'admin' || (u.roles || []).includes('admin');
  console.log(`${u.name} <${u.email}> role=${u.role}${isAdmin ? ' (admin — already sees Team Oversight)' : ''} canViewOversight=${!!u.canViewOversight}`);

  if (!!u.canViewOversight === enable) {
    console.log('Already set. Nothing to do.');
  } else if (!apply) {
    console.log(`DRY RUN — would set canViewOversight=${enable}. Re-run with --apply.`);
  } else {
    u.canViewOversight = enable;
    await u.save();
    console.log(`Done — canViewOversight=${enable}. They need to refresh Robin to see the sidebar link.`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => { console.error('grantOversightAccess failed:', err); process.exit(1); });
