/**
 * reactivateClients.ts — give onboarded clients their login back.
 *
 * Sep 2026 incident: deleteLead used to set isActive:false on the client
 * account linked to the lead. Deleting an old won lead therefore cut off
 * a client who had been onboarded long before. The controller no longer
 * does that, but accounts already switched off need turning back on —
 * that's this script.
 *
 * REST login never actually checked isActive, so these users could still
 * sign in; what broke was the socket layer (index.ts rejects inactive
 * users with "socket_user_inactive"), so the app loaded but realtime,
 * presence and notifications were dead. That's the "it's logged in but
 * nothing works" report.
 *
 * Safety rails:
 *   - Only touches role:'client' accounts. Staff deactivations are
 *     deliberate admin actions and are never reversed here.
 *   - Dry-run by default; pass --apply to write.
 *   - EMAIL=<address> narrows it to a single account.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run reactivate-clients
 *   APPLY:    npm run reactivate-clients -- --apply
 *   ONE USER: EMAIL=client@brand.com npm run reactivate-clients -- --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`[reactivate-clients] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const query: any = { role: 'client', isActive: false };
  if (process.env.EMAIL) query.email = process.env.EMAIL.toLowerCase().trim();

  const users = await User.find(query).select('_id name email company isActive').lean();

  if (users.length === 0) {
    console.log('\nNo deactivated client accounts found — nothing to do.\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n── ${users.length} deactivated client account(s) ──`);
  users.forEach((u: any) => {
    console.log(`   ${u.email}  ${u.name || ''}${u.company ? ` · ${u.company}` : ''}`);
  });

  if (APPLY) {
    const ids = users.map((u: any) => u._id);
    const r = await User.updateMany({ _id: { $in: ids } }, { $set: { isActive: true } });
    console.log(`\nReactivated ${r.modifiedCount} account(s) ✔  — they can log in and reconnect immediately.\n`);
  } else {
    console.log('\nDRY RUN — nothing written. Re-run with -- --apply to reactivate these.\n');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[reactivate-clients] FATAL', err.message || err);
  process.exit(1);
});
