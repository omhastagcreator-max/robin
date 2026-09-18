/**
 * setUserRole.ts — change a user's `role` field from the terminal.
 *
 * Built to fix om@hastag.in showing role: "employee" in production,
 * which meant ProtectedRoute (see client/src/components/ProtectedRoute.tsx)
 * correctly — but silently — bounced him off every admin-only page
 * (/admin/attendance, /admin/leaves, /admin/crash-logs, /sales) straight
 * back to /workroom-home, with no error shown. The sidebar links weren't
 * broken; the account's role in Mongo was just never set to admin.
 *
 * Usage (from server/):
 *
 *     EMAIL='om@hastag.in' ROLE='admin' npm run set-user-role
 *
 * Valid ROLE values match dashboardForRole() in ProtectedRoute.tsx:
 *   admin | sales | employee | workroom | client
 *
 * Env vars only (never CLI args) — same reasoning as resetPassword.ts:
 * args land in shell history / `ps`, env vars scoped to one command don't.
 *
 * Prints the before/after role. Makes exactly one write.
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';

const VALID_ROLES = ['admin', 'sales', 'employee', 'workroom', 'client'];

async function main() {
  const email = (process.env.EMAIL || '').trim().toLowerCase();
  const role  = (process.env.ROLE  || '').trim().toLowerCase();

  if (!email || !role) {
    console.error('Usage: EMAIL="…" ROLE="admin" npm run set-user-role');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`ROLE must be one of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('MONGO_URI missing in .env'); process.exit(1); }
  await mongoose.connect(uri);

  const u = await User.findOne({ email });
  if (!u) {
    console.error(`No user found for email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const before = u.role;
  if (before === role) {
    console.log(`No change — ${email} already has role "${role}".`);
    await mongoose.disconnect();
    process.exit(0);
  }

  u.role = role as any;
  await u.save();

  console.log(`✅ ${email} (id ${String(u._id)}): role "${before}" → "${role}"`);
  console.log('   They must log out and log back in for the new JWT/role to take effect.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('set-user-role failed:', err);
  process.exit(1);
});
