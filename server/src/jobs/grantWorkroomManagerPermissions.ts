import User from '../models/User';
import Organization from '../models/Organization';

/**
 * Boot-time idempotent grant — ensure specific trusted teammates have
 * `canManageWorkroom: true` without requiring an admin to click anything.
 *
 * Owner ask: "allow Om to add new workroom employees without admin access."
 * Rather than depend on the admin remembering to flip his toggle, we
 * encode the list of always-permitted teammates here and run it on every
 * server start. Idempotent — running it twice is a no-op.
 *
 * To add another teammate later, append their email/name pattern below
 * (or just have admin flip the toggle via Admin → Employees, which still
 * works and persists in the DB).
 *
 * Matching is fuzzy on purpose: we don't always know the exact email a
 * user signed up with (om@hastagcreator.com vs om.dev@… vs ompandey@…),
 * but their NAME in Robin is stable. We OR name and email patterns.
 */
const ALWAYS_ALLOWED: Array<{ namePattern?: RegExp; emailPattern?: RegExp; reason: string }> = [
  {
    namePattern:  /^om(\s|$)/i,                       // "Om", "Om Sharma", etc.
    emailPattern: /^om(\.|@|[._-])/i,                 // om@…, om.dev@…, om_sharma@…
    reason:       'Developer — owner-delegated workroom-onboarding access',
  },
];

export async function grantWorkroomManagerPermissions(): Promise<void> {
  try {
    let granted = 0;
    for (const rule of ALWAYS_ALLOWED) {
      const orFilters: any[] = [];
      if (rule.namePattern)  orFilters.push({ name:  rule.namePattern });
      if (rule.emailPattern) orFilters.push({ email: rule.emailPattern });
      if (orFilters.length === 0) continue;

      // Combine all conditions under a single $and so MongoDB doesn't
      // silently drop one of two top-level $or keys.
      const update = await User.updateMany(
        {
          $and: [
            { $or: orFilters },
            { role: { $in: ['admin', 'employee', 'sales'] } },
            { isActive: true },
            // Only flip records that don't already have the flag — keeps
            // this idempotent and avoids unnecessary writes/index churn.
            { $or: [
              { canManageWorkroom: { $exists: false } },
              { canManageWorkroom: false },
            ] },
          ],
        },
        { $set: { canManageWorkroom: true } },
      );

      if (update.modifiedCount > 0) {
        console.log(`[boot-grant] canManageWorkroom → true for ${update.modifiedCount} user(s) — ${rule.reason}`);
        granted += update.modifiedCount;
      }
    }
    if (granted === 0) {
      console.log('[boot-grant] All trusted teammates already have canManageWorkroom ✓');
    }
  } catch (err) {
    // Non-fatal — the feature is still flippable manually via Admin →
    // Employees. Log so we know if the grant failed.
    console.error('[boot-grant] grantWorkroomManagerPermissions failed:', (err as Error).message);
  }

  // Default workroom accounts — created once on first boot, idempotent
  // thereafter. Owner asked: "inject Janvi by default so she can log in."
  await seedDefaultWorkroomUsers();
}

/**
 * Idempotent: creates a hard-coded list of workroom-only teammates if they
 * don't already exist. Re-running is a no-op. Use this for the handful of
 * staff Robin should always have provisioned (e.g. Janvi the huddle-only
 * agent) without the owner having to fill the onboarding form each deploy.
 */
const DEFAULT_WORKROOM_USERS: Array<{ email: string; name: string; password: string }> = [
  { email: 'janvi@hastag.com',  name: 'Janvi',  password: 'Janvi@123'  },
  { email: 'bhavna@hastag.com', name: 'Bhavna', password: 'Bhavna@123' },
];

async function seedDefaultWorkroomUsers(): Promise<void> {
  try {
    for (const u of DEFAULT_WORKROOM_USERS) {
      const existing = await User.findOne({ email: u.email.toLowerCase() }).select('_id').lean();
      if (existing) continue;                            // already provisioned — skip

      // Fall back to whichever organisation we have; agencies on Robin
      // currently only ever have one.
      const org = await Organization.findOne().select('_id').lean();
      if (!org) {
        console.warn(`[boot-seed] Skipping default workroom user ${u.email} — no Organization exists yet`);
        continue;
      }

      await User.create({
        email:         u.email.toLowerCase(),
        passwordHash:  u.password,                       // pre-save hook hashes plain → bcrypt
        name:          u.name,
        role:          'workroom',
        organizationId: org._id,
      });
      console.log(`[boot-seed] Created default workroom user: ${u.email}`);
    }
  } catch (err) {
    console.error('[boot-seed] seedDefaultWorkroomUsers failed:', (err as Error).message);
  }
}
