/**
 * seedDummyPipelines.ts — populate the database with realistic dummy
 * projects so you can click through every Project Pipeline feature
 * (board view, needs-attention view, list view, filters, saved filters,
 * bulk actions, mine-only, key facts strip, blockers, priorities,
 * activity log, AI client update, focus list, leads with all sources).
 *
 * Every dummy carries `tags: ['dummy']` (or for leads, `tags: ['dummy']`
 * on the lead) so the script is idempotent — re-running just upserts
 * matching docs by clientName / leadName rather than duplicating.
 *
 * Run (from `server/` directory):
 *
 *   # Default — adds (or refreshes) the dummy set.
 *   MONGODB_URI="…"  npx ts-node scripts/seedDummyPipelines.ts
 *
 *   # Wipe everything tagged 'dummy' first and reseed clean.
 *   MONGODB_URI="…"  npx ts-node scripts/seedDummyPipelines.ts --clean
 *
 *   # Remove all dummies, don't reseed.
 *   MONGODB_URI="…"  npx ts-node scripts/seedDummyPipelines.ts --wipe
 *
 * The script assumes Om / Shakshi / Sakshi / Rishi exist (run
 * updateTeamRoles.ts first to set their roles + teams). If any of those
 * names are missing the script falls back to "unassigned" for that
 * service rather than failing the whole run.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User';
import ClientWorkflow from '../src/models/ClientWorkflow';
import Lead from '../src/models/Lead';
import FocusList from '../src/models/FocusList';

// ── Plain-language helpers — used in checklist text so the seed itself
//    doesn't introduce more jargon than the rest of Robin. ───────────────
const SHOPIFY_STEPS = [
  'Kickoff call done — scope, products, timeline agreed',
  'Theme installed and brand look applied',
  'Products + variants uploaded with images and copy',
  'Payment and shipping set up',
  'Tracking pixel and Google Analytics in place',
  'Test order placed end-to-end',
  'Store handed over to client',
];
const META_STEPS = [
  'Account ready — Business Manager + pixel checked',
  'Awareness campaigns live, audience built',
  'Sales campaigns live, conversions tracking',
  'Weekly reporting check-in agreed',
];
const INFLUENCER_STEPS = [
  'Influencer picked from shortlist',
  'Product shipped',
  'Script approved with influencer',
  'Videos delivered to client',
];

async function findUserByPrefix(prefix: string): Promise<any | null> {
  const u = await User.findOne({ name: { $regex: `^${prefix}`, $options: 'i' } }).select('_id name email organizationId role teams').lean();
  return u || null;
}

interface SeededIds {
  orgId:      string;
  adminId:    string;
  omId:       string | null;
  shakshiId:  string | null;
  sakshiId:   string | null;
  rishiId:    string | null;
}

async function resolvePeople(): Promise<SeededIds> {
  // The org we operate in = whatever org Om / Shakshi / Rishi belong to.
  // We try in priority order; first found wins.
  const om      = await findUserByPrefix('om');
  const shakshi = await findUserByPrefix('shakshi');
  const sakshi  = await findUserByPrefix('sakshi');
  const rishi   = await findUserByPrefix('rishi');

  const orgUser = om || shakshi || sakshi || rishi;
  if (!orgUser) throw new Error('Could not find any of Om / Shakshi / Sakshi / Rishi to determine the organization. Run updateTeamRoles.ts first or create those users.');
  const orgId = String(orgUser.organizationId);

  // Pick any admin in the org as `createdBy`. ClientWorkflow.createdBy
  // is required but not authZ-meaningful here — it's just an audit field.
  const admin = await User.findOne({ organizationId: orgId, role: 'admin' }).select('_id name email').lean() as any;
  if (!admin) throw new Error(`No admin user found in organization ${orgId}. ClientWorkflow needs a createdBy.`);

  return {
    orgId,
    adminId:   String(admin._id),
    omId:      om      ? String(om._id)      : null,
    shakshiId: shakshi ? String(shakshi._id) : null,
    sakshiId: sakshi  ? String(sakshi._id)  : null,
    rishiId:  rishi   ? String(rishi._id)   : null,
  };
}

// ── Dummy project recipes — each one exercises a different feature ─────
// `tickFrom` says how many checklist steps are ticked (so a service can
// appear 0/N, 2/N, all done, etc.).
interface ServiceSpec {
  type: 'shopify' | 'meta_ads' | 'influencer';
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  tickFrom?: number;
  assignedTo?: string | null;
}

interface ProjectRecipe {
  clientName:    string;
  clientPhone:   string;
  clientEmail:   string;
  priority:      'low' | 'medium' | 'high' | 'urgent';
  health:        string;
  healthReason?: string;
  blockerType?:  'waiting_client_input' | 'waiting_internal_approval' | 'dependency' | 'technical' | 'budget' | '';
  blockerReason?:string;
  blockedSince?: Date;
  eta?:          Date;
  etaConfidence?:'high' | 'medium' | 'low' | '';
  riskScore:     number;
  delayCause?:   string;
  nextBestAction?: string;
  predictedCompletionAt?: Date;
  ownerTeam?:    '' | 'sales' | 'development' | 'meta' | 'influencer' | 'qa';
  services:      ServiceSpec[];
  /** Plain-language notes posted to the activity log. */
  notes?:        string[];
  /** Which seeded person should be `nextActionOwnerId`. */
  nextOwner?:    'om' | 'shakshi' | 'sakshi' | 'rishi' | null;
}

const DAY = 24 * 3600 * 1000;
const today = new Date();
const daysFromNow = (n: number) => new Date(today.getTime() + n * DAY);

function recipes(ids: SeededIds): ProjectRecipe[] {
  const dev   = ids.omId       || null;
  const meta1 = ids.shakshiId  || ids.sakshiId  || null;
  const meta2 = ids.sakshiId   || ids.shakshiId || null;
  const sales = ids.rishiId    || null;

  return [
    // 1. URGENT, BLOCKED on client — exercises blocker chip + urgency
    {
      clientName:    'Velloer Living',
      clientPhone:   '9876500001',
      clientEmail:   'team@velloerliving.com',
      priority:      'urgent',
      health:        'blocked',
      healthReason:  'Waiting on Business Manager access from client.',
      blockerType:   'waiting_client_input',
      blockerReason: 'Need Business Manager access and pixel approval from client.',
      blockedSince:  daysFromNow(-3),
      eta:           daysFromNow(2),
      etaConfidence: 'low',
      riskScore:     82,
      delayCause:    'Past due. Waiting on client for 3 days.',
      nextBestAction:'Follow up with client for Business Manager access.',
      predictedCompletionAt: daysFromNow(7),
      ownerTeam:     'meta',
      nextOwner:     'shakshi',
      services: [
        { type: 'shopify',    status: 'done',        tickFrom: SHOPIFY_STEPS.length, assignedTo: dev },
        { type: 'meta_ads',   status: 'blocked',     tickFrom: 1,                    assignedTo: meta1 },
        { type: 'influencer', status: 'in_progress', tickFrom: 1,                    assignedTo: null },
      ],
      notes: [
        'Sent the access request email — waiting on client to reply.',
        'Client said access will come by end of week. Will follow up Friday.',
      ],
    },

    // 2. HIGH priority, AT-RISK — exercises risk-score chip + attention bucket
    {
      clientName:    'Quanta Robotics',
      clientPhone:   '9876500002',
      clientEmail:   'sales@quanta.io',
      priority:      'high',
      health:        'at_risk',
      healthReason:  'Two services moving slowly. Risk of slipping past due date.',
      eta:           daysFromNow(10),
      etaConfidence: 'medium',
      riskScore:     58,
      delayCause:    'Slow product upload pace — only 12 of ~80 SKUs done.',
      nextBestAction:'Schedule a working session with client to bulk-import remaining SKUs.',
      predictedCompletionAt: daysFromNow(14),
      ownerTeam:     'development',
      nextOwner:     'om',
      services: [
        { type: 'shopify',  status: 'in_progress', tickFrom: 3, assignedTo: dev   },
        { type: 'meta_ads', status: 'pending',    tickFrom: 0, assignedTo: meta1 },
      ],
      notes: [
        'Big SKU catalogue — 80+ products. Discussed bulk upload approach.',
      ],
    },

    // 3. ON TRACK — exercises healthy state + on-track group
    {
      clientName:    'Greenfield Farms',
      clientPhone:   '9876500003',
      clientEmail:   'hi@greenfield.ag',
      priority:      'medium',
      health:        'healthy',
      eta:           daysFromNow(12),
      etaConfidence: 'high',
      riskScore:     12,
      delayCause:    '',
      nextBestAction:'Continue running awareness campaigns; review after this week.',
      predictedCompletionAt: daysFromNow(11),
      ownerTeam:     'meta',
      nextOwner:     'sakshi',
      services: [
        { type: 'shopify',    status: 'done',        tickFrom: SHOPIFY_STEPS.length, assignedTo: dev },
        { type: 'meta_ads',   status: 'in_progress', tickFrom: 2,                    assignedTo: meta2 },
        { type: 'influencer', status: 'in_progress', tickFrom: 1,                    assignedTo: null },
      ],
      notes: [
        'Store handover went smoothly. Ads launched this Monday.',
      ],
    },

    // 4. ALL DONE — exercises the Done group + collapsed-by-default
    {
      clientName:    'Helix Bio',
      clientPhone:   '9876500004',
      clientEmail:   'kira@helixbio.com',
      priority:      'medium',
      health:        'ready_to_deliver',
      eta:           daysFromNow(-2),
      etaConfidence: 'high',
      riskScore:     3,
      delayCause:    '',
      nextBestAction:'',
      ownerTeam:     '',
      services: [
        { type: 'shopify',    status: 'done', tickFrom: SHOPIFY_STEPS.length,    assignedTo: dev },
        { type: 'meta_ads',   status: 'done', tickFrom: META_STEPS.length,       assignedTo: meta1 },
        { type: 'influencer', status: 'done', tickFrom: INFLUENCER_STEPS.length, assignedTo: null },
      ],
      notes: [
        'All services complete. Final report sent to client.',
      ],
    },

    // 5. WAITING ON INTERNAL APPROVAL — different blocker type
    {
      clientName:    'Northwind Logistics',
      clientPhone:   '9876500005',
      clientEmail:   'ops@northwind.co',
      priority:      'medium',
      health:        'waiting_internal',
      healthReason:  'Waiting on internal copy review before going live.',
      blockerType:   'waiting_internal_approval',
      blockerReason: 'Sales team is reviewing the campaign copy before we push live.',
      blockedSince:  daysFromNow(-1),
      eta:           daysFromNow(6),
      etaConfidence: 'medium',
      riskScore:     35,
      delayCause:    'Internal copy review pending since yesterday.',
      nextBestAction:'Get sales sign-off on campaign copy.',
      ownerTeam:     'sales',
      nextOwner:     'rishi',
      services: [
        { type: 'shopify',  status: 'done',        tickFrom: SHOPIFY_STEPS.length, assignedTo: dev },
        { type: 'meta_ads', status: 'in_progress', tickFrom: 2,                    assignedTo: meta1 },
      ],
      notes: [
        'Sent campaign copy to Rishi for review.',
      ],
    },

    // 6. LOW priority, slow but steady — exercises low-priority filter
    {
      clientName:    'Pelican Press',
      clientPhone:   '9876500006',
      clientEmail:   'team@pelican.media',
      priority:      'low',
      health:        'healthy',
      eta:           daysFromNow(25),
      etaConfidence: 'high',
      riskScore:     8,
      ownerTeam:     'development',
      nextOwner:     'om',
      services: [
        { type: 'shopify', status: 'in_progress', tickFrom: 1, assignedTo: dev },
      ],
      notes: [
        'Kickoff done. Theme picked. Slow build — client okay with 4-week timeline.',
      ],
    },

    // 7. TECHNICAL BLOCKER — exercises that specific blocker type
    {
      clientName:    'Lumina Studios',
      clientPhone:   '9876500007',
      clientEmail:   'rio@luminastud.co',
      priority:      'high',
      health:        'blocked',
      healthReason:  'Meta API outage affecting catalogue sync.',
      blockerType:   'technical',
      blockerReason: 'Meta product-catalogue API has been failing for the last 24h. Filed support ticket.',
      blockedSince:  daysFromNow(-1),
      eta:           daysFromNow(9),
      etaConfidence: 'low',
      riskScore:     65,
      delayCause:    'Meta API issue — workaround being tested.',
      nextBestAction:'Switch to manual product upload as a temporary fix.',
      ownerTeam:     'meta',
      nextOwner:     'shakshi',
      services: [
        { type: 'shopify',  status: 'done',    tickFrom: SHOPIFY_STEPS.length, assignedTo: dev },
        { type: 'meta_ads', status: 'blocked', tickFrom: 1,                    assignedTo: meta1 },
      ],
      notes: [
        'Found the issue — Meta catalogue API is down. Trying the manual workaround.',
      ],
    },

    // 8. INFLUENCER-only, dependency blocker — exercises the third service path
    {
      clientName:    'Maple Marketing',
      clientPhone:   '9876500008',
      clientEmail:   'hello@maple.in',
      priority:      'medium',
      health:        'at_risk',
      healthReason:  'Influencer reschedule pushed delivery back a week.',
      blockerType:   'dependency',
      blockerReason: 'Influencer pushed shoot date to next week.',
      blockedSince:  daysFromNow(-2),
      eta:           daysFromNow(15),
      etaConfidence: 'medium',
      riskScore:     45,
      delayCause:    'Waiting for new shoot date confirmation.',
      nextBestAction:'Confirm the new shoot date with the influencer team.',
      ownerTeam:     'influencer',
      services: [
        { type: 'influencer', status: 'in_progress', tickFrom: 2, assignedTo: null },
      ],
      notes: [
        'Influencer pushed the shoot — waiting on a new date.',
      ],
    },
  ];
}

function buildServiceDocs(specs: ServiceSpec[]): any[] {
  const out: any[] = [];
  for (const s of specs) {
    const label  = s.type === 'shopify' ? 'Shopify Store'
                : s.type === 'meta_ads' ? 'Meta Ads'
                : 'Influencer Marketing';
    const steps = s.type === 'shopify' ? SHOPIFY_STEPS
                : s.type === 'meta_ads' ? META_STEPS
                : INFLUENCER_STEPS;
    const tick = Math.min(s.tickFrom ?? 0, steps.length);
    out.push({
      serviceType: s.type,
      label,
      assignedTo:  s.assignedTo || undefined,
      status:      s.status,
      checklist: steps.map((text, idx) => ({
        text,
        done:   idx < tick,
        doneAt: idx < tick ? new Date(Date.now() - (steps.length - idx) * 6 * 3600 * 1000) : undefined,
      })),
      startedAt:   s.status === 'pending' ? undefined : daysFromNow(-7),
      completedAt: s.status === 'done'    ? daysFromNow(-1) : undefined,
    });
  }
  return out;
}

async function seedOne(recipe: ProjectRecipe, ids: SeededIds) {
  const nextOwnerId = recipe.nextOwner
    ? recipe.nextOwner === 'om'      ? ids.omId
    : recipe.nextOwner === 'shakshi' ? ids.shakshiId
    : recipe.nextOwner === 'sakshi'  ? ids.sakshiId
    : recipe.nextOwner === 'rishi'   ? ids.rishiId
    : null
    : null;

  // Synthetic clientId so the (org, clientId) unique index is stable across
  // re-runs without us touching the real User collection.
  const clientId = `dummy:${recipe.clientName.toLowerCase().replace(/\s+/g, '-')}`;

  const services = buildServiceDocs(recipe.services);
  const activity = (recipe.notes || []).map((detail, i) => ({
    at: new Date(Date.now() - (recipe.notes!.length - i) * 6 * 3600 * 1000),
    actorId:   ids.adminId,
    actorName: 'Seed bot',
    action:    'note',
    detail,
  }));
  // Add a creation entry at the front so the activity log isn't empty.
  activity.unshift({
    at: daysFromNow(-7),
    actorId:   ids.adminId,
    actorName: 'Seed bot',
    action:    'created',
    detail:    'Project added from dummy seed.',
  });

  const update: any = {
    organizationId: new mongoose.Types.ObjectId(ids.orgId),
    clientId,
    clientName:  recipe.clientName,
    clientPhone: recipe.clientPhone,
    clientEmail: recipe.clientEmail,
    services,
    activity,
    health:        recipe.health,
    healthReason:  recipe.healthReason || '',
    blockerType:   recipe.blockerType || '',
    blockerReason: recipe.blockerReason || '',
    blockedSince:  recipe.blockedSince || null,
    eta:           recipe.eta || null,
    etaConfidence: recipe.etaConfidence || '',
    priority:      recipe.priority,
    tags:          ['dummy'],
    currentOwnerTeam:  recipe.ownerTeam || '',
    nextActionOwnerId: nextOwnerId ? new mongoose.Types.ObjectId(nextOwnerId) : null,
    riskScore:        recipe.riskScore,
    delayCause:       recipe.delayCause || '',
    nextBestAction:   recipe.nextBestAction || '',
    predictedCompletionAt: recipe.predictedCompletionAt || null,
    insightsComputedAt: new Date(),
    lastActivityAt:     activity.length ? activity[activity.length - 1].at : new Date(),
    lastActivitySummary: activity.length ? activity[activity.length - 1].detail : '',
    createdBy:          ids.adminId,
  };

  await ClientWorkflow.updateOne(
    { organizationId: ids.orgId, clientId },
    { $set: update },
    { upsert: true },
  );
}

// ── Lead seeds — one of each (Outbound / Inbound / Organic), one of each
//    AI score (hot / warm / cold), one of each stage bucket. ────────────
async function seedLeads(ids: SeededIds) {
  const leads = [
    { name: 'Riya Mehra',   company: 'Riya Living',   email: 'riya@riyaliving.com',  contact: '9876511111', source: 'outbound', stage: 'demo_booked',      aiScore: 'hot',  aiNextAction: 'Confirm Tuesday demo slot.', estimatedValue: 45000 },
    { name: 'Karan Joshi',  company: 'Karan Crafts',  email: 'k@karancrafts.in',     contact: '9876522222', source: 'inbound',  stage: 'connected',        aiScore: 'warm', aiNextAction: 'Send portfolio + case studies.',  estimatedValue: 30000 },
    { name: 'Aanya Roy',    company: 'Aanya Aesthetics', email: 'aanya@aestheticslab.in', contact: '9876533333', source: 'organic',  stage: 'hot_follow_up', aiScore: 'hot',  aiNextAction: 'Call today — they asked us to follow up Friday.', estimatedValue: 60000 },
    { name: 'Vikram Saini', company: 'Vikram Foods',  email: 'vikram@vsfoods.in',    contact: '9876544444', source: 'outbound', stage: 'follow_up',        aiScore: 'cold', aiNextAction: 'One last nudge before parking this lead.', estimatedValue: 15000 },
    { name: 'Priya Sharma', company: 'PS Wellness',   email: 'priya@pswellness.in',  contact: '9876555555', source: 'inbound',  stage: 'demo_done',        aiScore: 'warm', aiNextAction: 'Send proposal + pricing.', estimatedValue: 80000 },
    { name: 'Dev Nair',     company: 'Nair Studios',  email: 'dev@nairstudios.in',   contact: '9876566666', source: 'organic',  stage: 'new_lead',         aiScore: 'warm', aiNextAction: 'First call — qualify need + budget.', estimatedValue: 25000 },
  ];

  for (const l of leads) {
    await Lead.updateOne(
      { organizationId: ids.orgId, email: l.email },
      {
        $set: {
          organizationId: new mongoose.Types.ObjectId(ids.orgId),
          name:    l.name,
          company: l.company,
          email:   l.email,
          contact: l.contact,
          source:  l.source,
          stage:   l.stage,
          assignedTo: ids.rishiId || ids.adminId,
          estimatedValue: l.estimatedValue,
          aiScore:       l.aiScore,
          aiNextAction:  l.aiNextAction,
          aiReason:      'Seeded for testing.',
          aiScoredAt:    new Date(),
          tags:          ['dummy'],
          importedFrom:  'manual',
        },
      },
      { upsert: true },
    );
  }
}

// ── Focus list — give Rishi a starter weekly priority list. ────────────
async function seedFocusList(ids: SeededIds) {
  if (!ids.rishiId) return;

  // Monday key — matches the FocusList controller's mondayKey().
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  const weekStart = d.toISOString().split('T')[0];

  const items = [
    { label: 'Velloer Living',  subLabel: 'Meta Ads blocked on client access', urgency: 'critical', note: 'Need to push the client today.', assignedTo: ids.shakshiId ? [ids.shakshiId] : [] },
    { label: 'Quanta Robotics', subLabel: 'SKU upload pace slipping',          urgency: 'high',     note: 'Book a working session this week.', assignedTo: ids.omId      ? [ids.omId]      : [] },
    { label: 'Aanya Aesthetics',subLabel: 'Lead asked us to follow up Friday', urgency: 'high',     note: 'Call before noon.', assignedTo: [] },
    { label: 'Lumina Studios',  subLabel: 'Meta API outage — workaround',     urgency: 'watch',    note: 'Track the support ticket.', assignedTo: ids.shakshiId ? [ids.shakshiId] : [] },
  ];

  await FocusList.updateOne(
    { organizationId: ids.orgId, ownerId: ids.rishiId, weekStart },
    {
      $set: {
        organizationId: new mongoose.Types.ObjectId(ids.orgId),
        ownerId:        ids.rishiId,
        weekStart,
        items: items.map(i => ({
          label:      i.label,
          subLabel:   i.subLabel,
          urgency:    i.urgency,
          note:       i.note,
          assignedTo: i.assignedTo,
          assignedAt: new Date(),
          doneAt:     null,
        })),
      },
    },
    { upsert: true },
  );
}

async function wipeDummies(orgId: string) {
  const wf = await ClientWorkflow.deleteMany({ organizationId: orgId, tags: 'dummy' });
  const ld = await Lead.deleteMany({ organizationId: orgId, tags: 'dummy' });
  // Focus list seed — keyed on (org, ownerId, weekStart). The dummy is the
  // weekly list we created for Rishi this week; only delete if items match
  // our seed-prefix subLabel pattern so we don't nuke a user's real list.
  const fl = await FocusList.deleteMany({ organizationId: orgId, 'items.label': { $in: ['Velloer Living', 'Quanta Robotics', 'Aanya Aesthetics', 'Lumina Studios'] } });
  console.log(`  · wiped ${wf.deletedCount} dummy workflows, ${ld.deletedCount} dummy leads, ${fl.deletedCount} seeded focus lists`);
}

async function main() {
  const uri   = process.env.MONGODB_URI;
  const clean = process.argv.includes('--clean');
  const wipe  = process.argv.includes('--wipe');
  if (!uri) { console.error('Set MONGODB_URI in your env.'); process.exit(1); }

  console.log(`[seedDummyPipelines] mode = ${wipe ? 'WIPE' : clean ? 'CLEAN-RESEED' : 'UPSERT'}`);
  await mongoose.connect(uri);
  console.log('[seedDummyPipelines] connected to MongoDB');

  const ids = await resolvePeople();
  console.log(`[seedDummyPipelines] org=${ids.orgId} admin=${ids.adminId}`);
  console.log(`[seedDummyPipelines] om=${ids.omId || 'NOT FOUND'}  shakshi=${ids.shakshiId || 'NOT FOUND'}  sakshi=${ids.sakshiId || 'NOT FOUND'}  rishi=${ids.rishiId || 'NOT FOUND'}`);

  if (wipe || clean) await wipeDummies(ids.orgId);
  if (wipe) { await mongoose.disconnect(); return; }

  const projects = recipes(ids);
  for (const r of projects) {
    await seedOne(r, ids);
    console.log(`  · ${r.clientName} — priority=${r.priority} health=${r.health} risk=${r.riskScore}`);
  }
  await seedLeads(ids);
  console.log(`  · seeded 6 leads (Outbound / Inbound / Organic, mixed stages + AI scores)`);
  await seedFocusList(ids);
  console.log(`  · seeded Focus This Week for Rishi (4 items)`);

  console.log(`\n[seedDummyPipelines] done. Open the Projects page to see the dummy set; re-run anytime to refresh.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[seedDummyPipelines] failed:', err);
  process.exit(1);
});
