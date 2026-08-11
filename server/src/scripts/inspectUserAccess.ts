/**
 * inspectUserAccess.ts — read-only diagnostic for "X can't see Y" reports.
 *
 * Built for the Bhawna "still can't see clients" loop (Aug 2026): three
 * fixes have already shipped (role workroom→employee, mine-only default
 * removed) and it's STILL reportedly blank. Rather than guess a fourth
 * time, this prints exactly what her account looks like in Mongo and
 * exactly what the real listWorkflows query would return for her, so
 * the actual mismatch (wrong org? duplicate account? zero data? role
 * didn't actually save?) is visible instead of inferred.
 *
 * Read-only. Makes zero writes.
 *
 * Usage (from server/):
 *   EMAIL=bhawnahastagcreator@gmail.com npm run inspect-user-access
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';
import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';

(async () => {
  const email = (process.env.EMAIL || '').trim().toLowerCase();
  if (!email) { console.error('Set EMAIL=<user email> — e.g. EMAIL=bhawnahastagcreator@gmail.com npm run inspect-user-access'); process.exit(1); }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.\n');

  // ── 1. Find every account that could plausibly be "her" ────────────
  const exact = await User.find({ email }).lean();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nearMatches = await User.find({
    email: { $regex: escaped.split('@')[0], $options: 'i' },
  }).lean();

  console.log(`Exact email match for "${email}": ${exact.length} account(s)`);
  const allFound = exact.length ? exact : nearMatches;
  if (allFound.length === 0) {
    console.log('No account found at all with that email or a close variant. Is the email right?');
    await mongoose.disconnect();
    process.exit(0);
  }
  if (exact.length === 0 && nearMatches.length > 0) {
    console.log(`No EXACT match, but found ${nearMatches.length} near-match(es) on the local part — check for a typo:`);
  }

  for (const u of allFound) {
    const org = await Organization.findById(u.organizationId).select('name createdAt').lean();
    console.log('──────────────────────────────────────────');
    console.log(`User        ${u.name}  <${u.email}>`);
    console.log(`  _id:            ${String(u._id)}`);
    console.log(`  role:           ${u.role}`);
    console.log(`  roles[]:        ${JSON.stringify(u.roles || [])}`);
    console.log(`  isActive:       ${u.isActive}`);
    console.log(`  organizationId: ${String(u.organizationId)}  (${org ? org.name : 'ORG NOT FOUND — orphaned!'})`);
    console.log(`  team/teams:     ${u.team || '—'} / ${JSON.stringify(u.teams || [])}`);

    // ── 2. What listWorkflows would ACTUALLY return for this user ────
    // Mirrors clientWorkflowController.ts's listWorkflows exactly: staff
    // roles (admin/sales/employee/workroom) get organizationId-only
    // filter (no mine-gate) unless mine=1 was explicitly requested.
    const isStaff = ['admin', 'sales', 'employee', 'workroom'].includes(u.role);
    const totalInOrg = await ClientWorkflow.countDocuments({ organizationId: u.organizationId });
    const assignedToHer = await ClientWorkflow.countDocuments({ organizationId: u.organizationId, 'services.assignedTo': String(u._id) });
    const createdByHer  = await ClientWorkflow.countDocuments({ organizationId: u.organizationId, createdBy: String(u._id) });
    console.log(`  isStaff (per listWorkflows logic): ${isStaff}`);
    console.log(`  ClientWorkflow docs in her org (total):     ${totalInOrg}`);
    console.log(`  ClientWorkflow docs assigned to her:        ${assignedToHer}`);
    console.log(`  ClientWorkflow docs created by her:         ${createdByHer}`);
    console.log(`  → With current code, GET /client-workflows (no ?mine) should return: ${isStaff ? totalInOrg : (assignedToHer + createdByHer > 0 ? 'assigned+created (may overlap)' : 0)}`);
  }

  console.log('──────────────────────────────────────────');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('inspectUserAccess failed:', err);
  process.exit(1);
});
