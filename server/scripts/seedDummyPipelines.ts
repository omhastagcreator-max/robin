/**
 * seedDummyPipelines.ts — seed the Projects board with the three real
 * clients Hastag is currently delivering (Vellore Living, Darpan, Oudfy)
 * plus a small lead set so the sales board isn't empty.
 *
 * Each project's ticked checklist matches reality so the page tells the
 * true story the moment you open it:
 *   - Vellore Living: site live, Meta sales campaign launched
 *   - Darpan: website 4/7 done, influencer not started, no Meta scope
 *   - Oudfy: website 6/7 (payment gateway pending), Meta not started,
 *            influencer 2/4 done
 *
 * Each seeded doc carries `tags: ['dummy']` so the script is idempotent —
 * re-running upserts matching docs by clientName / email rather than
 * duplicating, and `--wipe` removes only the seeded set (leaves anything
 * you've created by hand alone).
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

// ── Project recipes ─────────────────────────────────────────────────────
// `tickFrom`     — tick the FIRST N steps (use when progress is linear)
// `tickIndices`  — tick the SPECIFIC step indices listed (use when a step
//                  is skipped, e.g. Oudfy's "payment gateway is the only
//                  one not done")
interface ServiceSpec {
  type: 'shopify' | 'meta_ads' | 'influencer';
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  tickFrom?:    number;
  tickIndices?: number[];
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

  // Real clients. Three projects, each a different shape so the Projects
  // page covers all the visual states without becoming noisy.
  return [
    // ── 1. Vellore Living ────────────────────────────────────────────
    // Shopify store is fully delivered. Meta sales campaign has launched
    // and we're letting the data settle before scaling spend.
    {
      clientName:   'Vellore Living',
      clientPhone:  '9876500001',
      clientEmail:  'team@vellore-living.com',
      priority:     'high',
      health:       'healthy',
      healthReason: 'Site live, sales campaign running. Watching numbers before scaling.',
      eta:          daysFromNow(10),
      etaConfidence:'high',
      riskScore:    18,
      delayCause:   '',
      nextBestAction:'Pull 7-day ad numbers and decide whether to scale spend.',
      predictedCompletionAt: daysFromNow(9),
      ownerTeam:    'meta',
      nextOwner:    'shakshi',
      services: [
        // Website fully done.
        { type: 'shopify',  status: 'done',        tickFrom: SHOPIFY_STEPS.length, assignedTo: dev   },
        // Account ready + awareness live + sales campaign launched (steps 0,1,2)
        // — last tick (Weekly reporting cadence) still pending while we
        // analyse the early data.
        { type: 'meta_ads', status: 'in_progress', tickFrom: 3,                    assignedTo: meta1 },
      ],
      notes: [
        'Website handed over. Looks great in the store.',
        'Sales campaign launched yesterday. Letting it run a few days before we touch budget.',
      ],
    },

    // ── 2. Darpan ────────────────────────────────────────────────────
    // Shopify build still in progress (3 steps left). Influencer side
    // hasn't started. No Meta ads scope on this client.
    {
      clientName:   'Darpan',
      clientPhone:  '9876500002',
      clientEmail:  'hello@darpan.in',
      priority:     'medium',
      health:       'at_risk',
      healthReason: 'Three website steps still open; influencer plan not started yet.',
      eta:          daysFromNow(12),
      etaConfidence:'medium',
      riskScore:    42,
      delayCause:   '3 website steps still pending.',
      nextBestAction:'Finish payment + tracking + handover on the store. Pick an influencer in parallel.',
      predictedCompletionAt: daysFromNow(14),
      ownerTeam:    'development',
      nextOwner:    'om',
      services: [
        // 4 of 7 done (kickoff, theme, products, payment) — 3 left
        // (tracking pixel, test order, handover).
        { type: 'shopify',    status: 'in_progress', tickFrom: 4, assignedTo: dev },
        // Influencer plan not started.
        { type: 'influencer', status: 'pending',     tickFrom: 0, assignedTo: null },
        // (No meta_ads service — client doesn't need ads.)
      ],
      notes: [
        'No Meta ads scope on this client — only website + influencer.',
        'Three website steps left. Influencer shortlist still to be put together.',
      ],
    },

    // ── 3. Oudfy ─────────────────────────────────────────────────────
    // Website almost done — only payment gateway pending. Meta hasn't
    // started. Influencer videos only 2 of 4 done.
    {
      clientName:   'Oudfy',
      clientPhone:  '9876500003',
      clientEmail:  'team@oudfy.com',
      priority:     'high',
      health:       'at_risk',
      healthReason: 'Payment gateway holds website launch. Meta not started. Influencer halfway.',
      eta:          daysFromNow(7),
      etaConfidence:'medium',
      riskScore:    55,
      delayCause:   'Payment gateway not set up — store cannot go live yet.',
      nextBestAction:'Finish payment gateway on the store, then start Meta account setup.',
      predictedCompletionAt: daysFromNow(9),
      ownerTeam:    'development',
      nextOwner:    'om',
      services: [
        // Everything ticked EXCEPT step 3 (Payment and shipping set up).
        // tickIndices lets us model "the only one not done is payment".
        { type: 'shopify',    status: 'in_progress', tickIndices: [0, 1, 2, 4, 5, 6], assignedTo: dev   },
        // Meta hasn't started.
        { type: 'meta_ads',   status: 'pending',     tickFrom: 0,                    assignedTo: meta1 },
        // Influencer: videos only 2 of 4 done — influencer picked + product
        // shipped done; script + final video delivery still pending.
        { type: 'influencer', status: 'in_progress', tickFrom: 2,                    assignedTo: null  },
      ],
      notes: [
        'Store is ready apart from payment gateway. Payment vendor onboarding still in progress.',
        'Meta ads work pending — will start the moment the store is live.',
        '2 of 4 influencer steps complete. Script and final video delivery still pending.',
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
    // Resolve which indices are ticked. tickIndices wins when present (lets
    // us model "everything except payment is done"); otherwise fall back to
    // the linear tickFrom count.
    const tickedSet = new Set<number>(
      s.tickIndices
        ? s.tickIndices.filter(i => i >= 0 && i < steps.length)
        : Array.from({ length: Math.min(s.tickFrom ?? 0, steps.length) }, (_, i) => i),
    );
    out.push({
      serviceType: s.type,
      label,
      assignedTo:  s.assignedTo || undefined,
      status:      s.status,
      checklist: steps.map((text, idx) => ({
        text,
        done:   tickedSet.has(idx),
        doneAt: tickedSet.has(idx) ? new Date(Date.now() - (steps.length - idx) * 6 * 3600 * 1000) : undefined,
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

// ── A small believable lead set so the sales board isn't empty. Three
// leads, one each of Outbound / Inbound / Organic, across early/mid/late
// pipeline stages. Names are placeholders — replace with your real leads
// over time. ───────────────────────────────────────────────────────────
async function seedLeads(ids: SeededIds) {
  const leads = [
    { name: 'Riya Mehra',  company: 'Riya Living',      email: 'riya@riyaliving.com', contact: '9876511111', source: 'outbound', stage: 'demo_booked',   aiScore: 'hot',  aiNextAction: 'Confirm demo slot for Tuesday.',                          estimatedValue: 45000 },
    { name: 'Karan Joshi', company: 'Karan Crafts',     email: 'k@karancrafts.in',    contact: '9876522222', source: 'inbound',  stage: 'demo_done',     aiScore: 'warm', aiNextAction: 'Send proposal and pricing.',                              estimatedValue: 30000 },
    { name: 'Aanya Roy',   company: 'Aanya Aesthetics', email: 'aanya@aestheticslab.in', contact: '9876533333', source: 'organic', stage: 'hot_follow_up', aiScore: 'hot',  aiNextAction: 'Call today — they asked us to follow up by Friday.',     estimatedValue: 60000 },
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
    { label: 'Vellore Living', subLabel: 'Meta sales campaign — pull 7-day numbers', urgency: 'high',     note: 'Decide if we scale spend this week.',                assignedTo: ids.shakshiId ? [ids.shakshiId] : [] },
    { label: 'Oudfy',          subLabel: 'Payment gateway pending',                  urgency: 'critical', note: 'Store can\'t go live until this is sorted.',         assignedTo: ids.omId      ? [ids.omId]      : [] },
    { label: 'Darpan',         subLabel: '3 website steps left + influencer plan',   urgency: 'high',     note: 'Close the remaining steps and pick an influencer.', assignedTo: ids.omId      ? [ids.omId]      : [] },
    { label: 'Aanya Aesthetics', subLabel: 'Lead asked us to follow up by Friday',    urgency: 'watch',    note: 'Quick call before noon.',                            assignedTo: [] },
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
  // our seed labels so we don't nuke a user's real list.
  const fl = await FocusList.deleteMany({ organizationId: orgId, 'items.label': { $in: ['Vellore Living', 'Velloer Living', 'Oudfy', 'Darpan', 'Aanya Aesthetics', 'Quanta Robotics', 'Lumina Studios'] } });
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
  console.log(`  · seeded 3 leads (one Outbound, one Inbound, one Organic)`);
  await seedFocusList(ids);
  console.log(`  · seeded This week's focus for Rishi (4 items)`);

  console.log(`\n[seedDummyPipelines] done. Open the Projects page — Vellore Living, Darpan and Oudfy are now visible.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[seedDummyPipelines] failed:', err);
  process.exit(1);
});
