/**
 * setServiceScope.ts — Sep 2026 CRM access-scoping.
 *
 * Sets a teammate's `team`/`teams` (so new services auto-assign to them
 * the same way meta_ads/influencer already do — see pickAssignee in
 * clientWorkflowController.ts) AND `serviceScope` (so the Client CRM
 * only shows them clients where they hold an assigned service of that
 * type — see listWorkflows/getWorkflow/canSeeWorkflow). Both are driven
 * off the same TEAMS input so they can never drift apart.
 *
 * Team <-> service type mapping (from workflowTemplates.ts):
 *   design -> graphic_design   video  -> video_editing
 *   script -> script_writing   social -> social_media
 *   meta   -> meta_ads         influencer -> influencer
 *   dev    -> shopify
 *
 * Usage (from server/):
 *   EMAIL='beanat@hastag.in'  TEAMS='design,video'  npm run set-service-scope
 *   EMAIL='shakshi@hastag.in' TEAMS='meta'           npm run set-service-scope
 *   EMAIL='chetan@hastag.in'  TEAMS='meta'           npm run set-service-scope
 *
 * Pass TEAMS='' (empty) to CLEAR scoping and return someone to the
 * org-wide default (sees every client, like every other unscoped
 * employee).
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';

const TEAM_TO_SERVICE_TYPE: Record<string, string> = {
  dev: 'shopify',
  meta: 'meta_ads',
  influencer: 'influencer',
  design: 'graphic_design',
  video: 'video_editing',
  script: 'script_writing',
  social: 'social_media',
};

async function main() {
  const email = (process.env.EMAIL || '').trim().toLowerCase();
  const teamsRaw = process.env.TEAMS;
  if (!email || teamsRaw === undefined) {
    console.error("Usage: EMAIL='user@x.com' TEAMS='design,video' npm run set-service-scope  (TEAMS='' clears scoping)");
    process.exit(1);
  }
  const teams = teamsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const unknown = teams.filter(t => !TEAM_TO_SERVICE_TYPE[t]);
  if (unknown.length) {
    console.error(`Unknown team(s): ${unknown.join(', ')}. Known teams: ${Object.keys(TEAM_TO_SERVICE_TYPE).join(', ')}`);
    process.exit(1);
  }
  const scope = teams.map(t => TEAM_TO_SERVICE_TYPE[t]);

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.\n');

  const u = await User.findOne({ email });
  if (!u) { console.error(`No user found with email ${email}`); process.exit(1); }

  const before = { team: u.team, teams: u.teams, serviceScope: (u as any).serviceScope };
  u.team = teams[0] || '';
  u.teams = teams;
  (u as any).serviceScope = scope;
  await u.save();

  console.log(`✅ ${u.name} <${u.email}>`);
  console.log(`   team:         ${JSON.stringify(before.team)} → ${JSON.stringify(u.team)}`);
  console.log(`   teams:        ${JSON.stringify(before.teams)} → ${JSON.stringify(u.teams)}`);
  console.log(`   serviceScope: ${JSON.stringify(before.serviceScope)} → ${JSON.stringify(scope)}`);
  console.log(scope.length
    ? `   → Client CRM is now locked to clients where they're assigned a ${scope.join('/')} service.`
    : `   → Scoping cleared — this account now sees the full org client list again.`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
