/**
 * addBhawna.ts — one-shot script to onboard Bhawna as a Meta Ads
 * expert on the Hastag Creator agency.
 *
 * What it does:
 *   1. Connects to Mongo via MONGO_URI from server/.env.
 *   2. Finds the agency's organization (first org by createdAt — same
 *      heuristic every other onboarding script uses).
 *   3. Upserts a User with:
 *        email          bhawnahastagcreator@gmail.com
 *        name           Bhawna
 *        role           employee
 *        team           meta
 *        teams          [meta]
 *        department     Meta Ads
 *        passwordHash   Robin2024!  (auto-bcrypted by the User pre-save hook)
 *        isActive       true
 *   4. If Bhawna already exists but was deactivated, reactivates her.
 *   5. If she already exists and is active, just patches role/team/dept
 *      so the script is safe to re-run after manual edits.
 *
 * Owner note: as of June 2026 the canonical Meta Ads owner on every
 * brand is Sakshi (see reassignByRole.ts). Bhawna joins the Meta team
 * ALONGSIDE her — she's not replacing Sakshi. If you want Bhawna to
 * take over, change DEFAULT_RULES.meta_ads in reassignByRole.ts from
 * 'Sakshi' to 'Bhawna' and re-run `npm run reassign-roles`.
 *
 * How to run:
 *
 *     cd server
 *     npm run add-bhawna
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';
import Organization from '../models/Organization';

const DETAILS = {
  email:      'bhawnahastagcreator@gmail.com',
  name:       'Bhawna',
  role:       'employee' as const,
  team:       'meta',
  teams:      ['meta'],
  department: 'Meta Ads',
  password:   'Robin2024!',
};

(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }
  console.log(`Targeting org ${String(org._id)} (${org.name}).`);

  // Look in BOTH the same org AND across orgs, since the global
  // unique-email index means an orphan in another org would block
  // re-creation. If we find a cross-org match we move her over.
  let existing = await User.findOne({ email: DETAILS.email, organizationId: org._id });
  if (!existing) {
    const crossOrg = await User.findOne({ email: DETAILS.email });
    if (crossOrg) {
      console.log(`Found existing user in another org; moving to ${org.name}`);
      crossOrg.organizationId = org._id as any;
      await crossOrg.save();
      existing = crossOrg;
    }
  }

  if (existing) {
    existing.isActive   = true;
    existing.name       = DETAILS.name;
    existing.role       = DETAILS.role;
    existing.team       = DETAILS.team;
    existing.department = DETAILS.department;
    existing.teams      = Array.from(new Set([...(existing.teams || []), ...DETAILS.teams])) as any;
    // Always re-set the password on every run. The User pre-save
    // hook bcrypts any non-bcrypt value, so assigning the plain
    // 'Robin2024!' here lands a freshly-hashed credential in Mongo
    // and the printed credentials always match reality.
    existing.passwordHash = DETAILS.password;
    await existing.save();
    console.log(`Updated existing user → ${DETAILS.email} (id ${String(existing._id)})`);
    console.log('Password reset to the default printed below.');
  } else {
    const created = await User.create({
      organizationId: org._id,
      email:          DETAILS.email,
      name:           DETAILS.name,
      role:           DETAILS.role,
      team:           DETAILS.team,
      teams:          DETAILS.teams,
      department:     DETAILS.department,
      passwordHash:   DETAILS.password,    // pre-save hook bcrypts
      isActive:       true,
    } as any);
    console.log(`Created new user → ${DETAILS.email} (id ${String(created._id)})`);
  }

  console.log(`\nLogin credentials:\n  Email:    ${DETAILS.email}\n  Password: ${DETAILS.password}`);
  console.log('\nReminder: tell Bhawna to change her password on first login.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('addBhawna failed:', err);
  process.exit(1);
});
