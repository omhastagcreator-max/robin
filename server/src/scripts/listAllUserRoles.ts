/**
 * listAllUserRoles.ts — read-only audit: every staff account, their role,
 * secondary roles, team/department, and where dashboardForRole() sends
 * them. Built to answer "why is everyone landing on the sales dashboard" —
 * prints the real role data instead of guessing. Read-only, zero writes.
 *
 * Usage (from server/): npm run list-user-roles
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';

function dashboardForRole(role: string): string {
  switch (role) {
    case 'client':   return '/client';
    case 'admin':    return '/executive-dashboard';
    case 'sales':    return '/executive-dashboard';
    case 'employee': return '/workroom-home';
    case 'workroom': return '/workroom-home';
    default:         return '/workroom-home';
  }
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.\n');

  const users = await User.find({ role: { $ne: 'client' } })
    .select('name email role roles team teams department isActive')
    .sort({ role: 1, name: 1 })
    .lean();

  console.log(`${users.length} non-client accounts:\n`);
  for (const u of users) {
    console.log(
      `${(u.name || '—').padEnd(22)} ${(u.email || '').padEnd(32)} role=${(u.role || '—').padEnd(9)} ` +
      `roles=${JSON.stringify(u.roles || [])}  team=${u.team || '—'}  dept=${u.department || '—'}  ` +
      `active=${u.isActive}  → lands on ${dashboardForRole(u.role)}`
    );
  }

  console.log('\nRole counts:');
  const counts: Record<string, number> = {};
  for (const u of users) counts[u.role || '—'] = (counts[u.role || '—'] || 0) + 1;
  console.log(counts);

  await mongoose.disconnect();
})();
