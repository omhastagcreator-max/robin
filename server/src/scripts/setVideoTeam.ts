/**
 * setVideoTeam.ts — Oct 2026. Owner: the UGC video team is Priyanka and
 * Amit Kamble. New video brands auto-assign by team (pickAssignee('influencer')
 * in clientWorkflowController), so both need 'influencer' in their teams.
 *
 * Dry run by default. From server/:
 *   npm run set-video-team                 # preview
 *   npm run set-video-team -- --apply      # write
 *   EXCLUSIVE=1 npm run set-video-team -- --apply
 *        # also removes 'influencer' from anyone else, so ONLY these two get new brands
 *   NAMES="priyanka,amit kamble"           # override who (comma-separated name prefixes)
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import Organization from '../models/Organization';
import User from '../models/User';

(async () => {
  const apply = process.argv.includes('--apply');
  const exclusive = process.env.EXCLUSIVE === '1';
  const names = (process.env.NAMES || 'priyanka,amit kamble').split(',').map(s => s.trim()).filter(Boolean);
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('MONGO_URI missing in .env'); process.exit(1); }
  await mongoose.connect(uri);
  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id').lean();
  if (!org) { console.error('No Organization'); process.exit(1); }
  console.log(`[set-video-team] ${apply ? 'APPLY' : 'DRY-RUN'}${exclusive ? ' · EXCLUSIVE' : ''}`);

  const keep = new Set<string>();
  let failed = false;
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const found = await User.find({ organizationId: org._id, isActive: true, name: { $regex: `^${esc}`, $options: 'i' } });
    if (found.length !== 1) {
      console.log(`  ✗ "${n}": ${found.length} matches${found.length ? ' — ' + found.map(u => `${u.name} <${u.email}>`).join(', ') : ''}. Skipped.`);
      failed = true; continue;
    }
    const u = found[0];
    keep.add(String(u._id));
    const has = (u.teams || []).includes('influencer') || u.team === 'influencer';
    console.log(`  ✓ ${u.name} <${u.email}> role=${u.role} teams=[${(u.teams || []).join(',')}]${has ? ' — already on video team' : ' → add influencer'}`);
    if (u.role === 'workroom' || u.role === 'client') console.log(`    ⚠ role "${u.role}" is NOT auto-assigned new brands (only employee/sales/admin are). Change their role to employee in Admin if they should own brands.`);
    if (!has && apply) { u.teams = Array.from(new Set([...(u.teams || []), 'influencer'])); await u.save(); }
  }
  if (exclusive) {
    const others = await User.find({ organizationId: org._id, $or: [{ teams: 'influencer' }, { team: 'influencer' }] });
    for (const u of others) {
      if (keep.has(String(u._id))) continue;
      console.log(`  − ${u.name}: remove from video team`);
      if (apply) { u.teams = (u.teams || []).filter(t => t !== 'influencer'); if (u.team === 'influencer') u.team = ''; await u.save(); }
    }
  }
  if (!apply) console.log('Dry run — re-run with --apply to save.');
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
