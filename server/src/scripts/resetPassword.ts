/**
 * resetPassword.ts — set a user's password from the terminal without
 * hard-coding either the email or the password into the repo.
 *
 * Reads the target email + new password from environment variables:
 *
 *     EMAIL='user@example.com' PASSWORD='Their!New@Password' \
 *       npm run reset-password
 *
 * Why env vars vs CLI args:
 *   - CLI args land in shell history and `ps` output — anyone with
 *     shell access to the machine can read them.
 *   - Env vars scoped to the single command (as above) do NOT persist
 *     into history and are only visible to the process while it runs.
 *
 * The User schema's pre-save hook auto-bcrypts any non-hash value
 * assigned to passwordHash, so we can drop the plain string in and
 * Mongoose does the rest.
 *
 * Prints only a boolean success — never echoes the password back.
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';

async function main() {
  const email    = (process.env.EMAIL    || '').trim().toLowerCase();
  const password = process.env.PASSWORD  || '';

  if (!email || !password) {
    console.error('Usage: EMAIL="…" PASSWORD="…" npm run reset-password');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('MONGO_URI missing in .env'); process.exit(1); }
  await mongoose.connect(uri);

  const u = await User.findOne({ email });
  if (!u) {
    console.error(`No user found for email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  u.passwordHash = password;   // pre-save hook bcrypts
  await u.save();

  console.log(`✅ Password reset for ${email} (id ${String(u._id)})`);
  console.log('   Tell them to change it on first login.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('reset-password failed:', err);
  process.exit(1);
});
