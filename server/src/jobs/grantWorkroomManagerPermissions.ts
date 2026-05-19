import User from '../models/User';

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
}
