/**
 * updateTeamRoles.ts — one-shot reassignment of role + teams for a small
 * fixed set of teammates. Idempotent; safe to re-run.
 *
 * Why a script and not the Admin → Employees UI?
 *   - The UI works fine for one person at a time. This script is the
 *     audit trail when "set the entire team's roles" comes up monthly.
 *   - The script is dry-run by default. You see exactly what it WOULD
 *     change before any write hits Mongo.
 *
 * Run (from `server/` directory):
 *
 *   # 1. Dry run — preview the changes (default).
 *   MONGODB_URI="<your URI>" npx ts-node scripts/updateTeamRoles.ts
 *
 *   # 2. Apply — pass --apply on the second pass once you're happy with
 *   #    the planned diff.
 *   MONGODB_URI="<your URI>" npx ts-node scripts/updateTeamRoles.ts --apply
 *
 * Matching: case-insensitive prefix on the User.name field. If a name
 * matches zero or more-than-one user, the script SKIPS that entry and
 * logs the candidates so you can resolve manually (e.g. "Om Sharma" vs
 * "Om Patel"). The other users still proceed.
 *
 * Team taxonomy (from User model): sales, development, meta, influencer, qa.
 * Role taxonomy: admin, employee, client, sales, workroom.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User';

interface Plan {
  /** Case-insensitive prefix matched against User.name. */
  namePrefix: string;
  role:  'admin' | 'employee' | 'client' | 'sales' | 'workroom';
  teams: string[];
  /** Free-text — what we want this person to BE, used in log lines. */
  description: string;
}

const PLAN: Plan[] = [
  { namePrefix: 'om',      role: 'employee', teams: ['development'], description: 'Development' },
  // 'Shakshi' is sometimes spelt 'Sakshi' in records — we prefix-match on
  // both. The runner checks each candidate name and skips ambiguity.
  { namePrefix: 'shakshi', role: 'employee', teams: ['meta'],        description: 'Meta Ads' },
  { namePrefix: 'sakshi',  role: 'employee', teams: ['meta'],        description: 'Meta Ads (alt spelling)' },
  { namePrefix: 'rishi',   role: 'sales',    teams: ['sales'],       description: 'Sales' },
];

async function main() {
  const uri    = process.env.MONGODB_URI;
  const apply  = process.argv.includes('--apply');
  if (!uri) { console.error('Set MONGODB_URI in your env.'); process.exit(1); }

  console.log(`[updateTeamRoles] mode = ${apply ? 'APPLY' : 'DRY-RUN'} (pass --apply to commit)`);
  await mongoose.connect(uri);
  console.log('[updateTeamRoles] connected to MongoDB');

  let updates = 0, skipped = 0, ambiguous = 0;
  // Dedupe — if both 'shakshi' and 'sakshi' resolve to the SAME user we
  // shouldn't double-process. Track userIds we've already handled.
  const handledIds = new Set<string>();

  for (const p of PLAN) {
    const candidates = await User.find({
      name: { $regex: `^${p.namePrefix}`, $options: 'i' },
    }).select('_id name email role teams organizationId').lean();

    if (candidates.length === 0) {
      console.log(`  · ${p.namePrefix} → ${p.description}: NO MATCH — skipping`);
      skipped++;
      continue;
    }
    if (candidates.length > 1) {
      console.log(`  · ${p.namePrefix} → ${p.description}: AMBIGUOUS (${candidates.length} matches), skipping:`);
      for (const c of candidates) {
        console.log(`      - ${c.name} <${c.email}> (role=${c.role}, teams=[${c.teams.join(',') || '-'}])`);
      }
      ambiguous++;
      continue;
    }
    const u = candidates[0];
    if (handledIds.has(String(u._id))) {
      console.log(`  · ${p.namePrefix} → already handled via earlier entry, skipping`);
      continue;
    }
    handledIds.add(String(u._id));

    const beforeRole  = u.role;
    const beforeTeams = (u.teams || []).slice().sort().join(',');
    const afterTeams  = p.teams.slice().sort().join(',');

    if (beforeRole === p.role && beforeTeams === afterTeams) {
      console.log(`  · ${u.name} <${u.email}>: already role=${p.role} teams=[${p.teams.join(',')}] — no change`);
      continue;
    }

    console.log(`  · ${u.name} <${u.email}>: ${beforeRole}/[${beforeTeams || '-'}]  →  ${p.role}/[${afterTeams}]`);
    if (apply) {
      await User.updateOne(
        { _id: u._id },
        { $set: { role: p.role, teams: p.teams } },
      );
    }
    updates++;
  }

  console.log(`\n[updateTeamRoles] summary: ${updates} ${apply ? 'updated' : 'planned'}, ${skipped} not found, ${ambiguous} ambiguous`);
  if (!apply && updates > 0) {
    console.log('\n[updateTeamRoles] DRY RUN — no writes performed. Re-run with --apply to commit the changes above.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[updateTeamRoles] failed:', err);
  process.exit(1);
});
