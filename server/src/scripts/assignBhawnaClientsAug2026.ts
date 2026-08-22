/**
 * assignBhawnaClientsAug2026.ts — put Oudfy, "Purely Farm" and Early Flux
 * under Bhawna, and create Early Flux with the status the owner gave.
 *
 * Owner asks (Aug 2026, chat):
 *   "the purely farm project and oudfy project access should [be] with
 *    Bhawna, it['s] assigned to her only"
 *   "also add early flux — website done, videos done, meta paused, reason
 *    new videos to be created, under Bhawna"
 *
 * ── What "access ... to her only" means here ─────────────────────────
 * Asked directly; owner clarified "she is managing it" — i.e. OWNERSHIP,
 * not restricted visibility. So this sets `services[].assignedTo` to
 * Bhawna (which is what drives "My work", the Mine-only pipeline filter,
 * and per-service accountability). It deliberately does NOT hide these
 * clients from other staff — org-wide Client CRM visibility was an
 * explicit earlier decision ("make sure everyone in Robin have Client CRM
 * option and the same data should sync across all roles") and reversing it
 * for two clients would need new server-side authz, not a data script.
 *
 * ── "Purely Farm" = Ghee-Neeraj (confirmed, not inferred) ────────────
 * "Purely Farm" is NOT a clientName in Robin — the live roster is Sroja,
 * Darpan, Ghee-Neeraj, Oudfy, HeightAyura, MotoCasa, ArdoWellness,
 * Bombay, Woodsify, dufft, Polmouni, Silvque. Asked the owner rather than
 * guessing (a "PURELY FARM raw&real" storefront on a teammate's shared
 * screen made Ghee-Neeraj look likely, but assigning the wrong brand to
 * the wrong person is exactly the silent error this project has been
 * bitten by before). Owner confirmed: "purely farm is ghee neeraj".
 * PURELY_FARM_ACTUAL_NAME below carries that answer; blanking it makes
 * the script skip that client loudly rather than act on a guess.
 *
 * Safety: dry-run by default — prints what would change, writes nothing.
 * Pass --apply to commit.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run assign-bhawna-clients
 *   APPLY:    npm run assign-bhawna-clients -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

const APPLY = process.argv.includes('--apply');

/** Confirmed by the owner in chat: "purely farm is ghee neeraj". */
const PURELY_FARM_ACTUAL_NAME = 'Ghee-Neeraj';

const OWNER_NAME = 'Bhawna';
const DEFAULT_PASSWORD = 'Welcome123!';

type Status = 'pending' | 'in_progress' | 'done' | 'blocked';

interface ServiceSpec {
  type: ServiceType;
  status?: Status;
  /** Free-text reason, stored on returnedReason — the only per-service
   *  "why is this stuck" field the schema has (same one the in-app
   *  "Return service" action writes, so it renders on the service card). */
  reason?: string;
  addIfMissing?: boolean;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function findUserByName(orgId: any, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee', 'workroom'] },
  }).select('_id name').lean();
}

/** Apply one service spec to a workflow in memory. Returns a change line. */
function applyService(wf: any, spec: ServiceSpec, ownerId: string): string | null {
  const tpl = SERVICE_TEMPLATES[spec.type];
  let svc = (wf.services as any[]).find(s => s.serviceType === spec.type);
  const notes: string[] = [];

  if (!svc) {
    if (!spec.addIfMissing) return null;
    svc = {
      serviceType: spec.type,
      label: tpl.label,
      checklist: tpl.checklist.map(text => ({ text, done: false })),
    };
    (wf.services as any[]).push(svc);
    notes.push('added');
  }

  if (svc.assignedTo !== ownerId) { svc.assignedTo = ownerId; notes.push(`owner→${OWNER_NAME}`); }

  if (spec.status && svc.status !== spec.status) {
    svc.status = spec.status;
    if (spec.status === 'done') {
      svc.checklist.forEach((c: any) => {
        c.done = true;
        c.doneAt = c.doneAt || new Date();
        c.doneBy = c.doneBy || ownerId;
      });
      svc.completedAt = svc.completedAt || new Date();
    } else {
      svc.completedAt = undefined;
    }
    if (!svc.startedAt) svc.startedAt = new Date();
    notes.push(`status→${spec.status}`);
  }

  if (spec.reason !== undefined && svc.returnedReason !== spec.reason) {
    svc.returnedReason = spec.reason;
    svc.returnedAt = new Date();
    notes.push(`reason→"${spec.reason}"`);
  }

  return notes.length ? `${tpl.label}: ${notes.join(', ')}` : null;
}

/** Reassign EVERY existing service on a workflow to Bhawna. Used for the
 *  two "put this client under her" cases, where no per-service status was
 *  given — only ownership changes, statuses are left exactly as they are. */
function reassignAll(wf: any, ownerId: string): string[] {
  const changes: string[] = [];
  for (const svc of wf.services as any[]) {
    if (svc.assignedTo !== ownerId) {
      svc.assignedTo = ownerId;
      changes.push(`${svc.label || svc.serviceType}: owner→${OWNER_NAME}`);
    }
  }
  return changes;
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}\n`);

  const org = await Organization.findOne({}).select('_id name').lean();
  if (!org) { console.error('No organization found — aborting.'); process.exit(1); }

  const admin = await User.findOne({ organizationId: org._id, role: 'admin' })
    .sort({ createdAt: 1 }).select('_id name').lean();
  if (!admin) { console.error('No admin user found (needed as activity actor) — aborting.'); process.exit(1); }

  const bhawna = await findUserByName(org._id, OWNER_NAME);
  if (!bhawna) { console.error(`No user matching "${OWNER_NAME}" — aborting.`); process.exit(1); }
  const ownerId = String(bhawna._id);
  console.log(`Owner resolved: ${bhawna.name} (${ownerId})\n`);

  const saveWf = async (wf: any, changes: string[]) => {
    changes.forEach(c => console.log(`  ${c}`));
    if (!changes.length) { console.log('  (already correct — nothing to change)'); return; }
    if (APPLY) {
      wf.activity.push({
        actorId: String(admin._id),
        actorName: admin.name,
        action: 'bulk_status_update',
        detail: `Assigned to ${OWNER_NAME}: ${changes.join('; ')}`,
      } as any);
      wf.markModified('services');
      await wf.save();
      console.log('  Saved.');
    }
  };

  // ── 1. Oudfy — every service under Bhawna, and unblock it ───────────
  // Owner follow-up: "oudfy still shows block". Two different things can
  // put a "blocked" badge on a client, so this clears BOTH rather than
  // guessing which one is showing:
  //   a) workflow-level blocker  → blockerType / blockerReason / blockedSince
  //      (set by the in-app "Block" action, drives the card's blocker strip)
  //   b) service-level           → status 'blocked', and/or a lingering
  //      returnedReason from a past "Return service"
  console.log('── Oudfy ──');
  const oudfy = await ClientWorkflow.findOne({
    organizationId: org._id,
    clientName: { $regex: '^oudfy$', $options: 'i' },
  });
  if (!oudfy) console.log('  NOT FOUND — skipping.');
  else {
    const changes = reassignAll(oudfy, ownerId);

    if ((oudfy as any).blockerType || (oudfy as any).blockerReason) {
      console.log(`  Existing workflow blocker: ${(oudfy as any).blockerType || '—'} — "${(oudfy as any).blockerReason || ''}"`);
      (oudfy as any).blockerType = undefined;
      (oudfy as any).blockerReason = undefined;
      (oudfy as any).blockedSince = null;
      changes.push('workflow blocker cleared');
    }

    for (const svc of oudfy.services as any[]) {
      if (svc.status === 'blocked') {
        svc.status = 'in_progress';
        changes.push(`${svc.label || svc.serviceType}: status blocked→in_progress`);
      }
      if (svc.returnedReason) {
        console.log(`  Clearing stale returned reason on ${svc.label || svc.serviceType}: "${svc.returnedReason}"`);
        svc.returnedReason = undefined;
        svc.returnedAt = undefined;
        changes.push(`${svc.label || svc.serviceType}: returned-reason cleared`);
      }
    }

    if ((oudfy as any).operationalStatus !== 'in_progress') {
      (oudfy as any).operationalStatus = 'in_progress';
      changes.push('operationalStatus→in_progress');
    }

    await saveWf(oudfy, changes);
  }
  console.log('');

  // ── 2. "Purely Farm" — only if the real name has been filled in ─────
  console.log('── Purely Farm ──');
  if (!PURELY_FARM_ACTUAL_NAME) {
    console.log('  SKIPPED — PURELY_FARM_ACTUAL_NAME is empty.');
    console.log('  "Purely Farm" is not a clientName in Robin. Owner said it is an');
    console.log('  existing client under a different name but has not said which.');
    console.log('  Set PURELY_FARM_ACTUAL_NAME at the top of this script and re-run.');
  } else {
    const pf = await ClientWorkflow.findOne({
      organizationId: org._id,
      clientName: { $regex: `^${PURELY_FARM_ACTUAL_NAME}$`, $options: 'i' },
    });
    if (!pf) console.log(`  NOT FOUND (looked for "${PURELY_FARM_ACTUAL_NAME}") — skipping.`);
    else {
      console.log(`  Matched "${pf.clientName}".`);
      await saveWf(pf, reassignAll(pf, ownerId));
    }
  }
  console.log('');

  // ── 3. Early Flux — create if missing, then set the given statuses ──
  // Owner: "website done, videos done, meta paused reason new videos to
  // be created, under Bhawna."
  //   website → shopify service, done
  //   videos  → influencer service, done
  //   meta    → meta_ads, 'blocked' + returnedReason (there's no separate
  //             per-service "paused" enum value; blocked + a free-text
  //             reason is the closest honest fit and is what the in-app
  //             Return-service action writes, so it renders normally).
  console.log('── Early Flux ──');
  const EF_NAME = 'Early Flux';
  const EF_SERVICES: ServiceSpec[] = [
    { type: 'shopify',    status: 'done',    addIfMissing: true },
    { type: 'influencer', status: 'done',    addIfMissing: true },
    { type: 'meta_ads',   status: 'blocked', reason: 'Paused — new videos to be created', addIfMissing: true },
  ];

  let ef = await ClientWorkflow.findOne({
    organizationId: org._id,
    clientName: { $regex: `^${EF_NAME}$`, $options: 'i' },
  });

  if (ef) {
    console.log('  Already exists — updating in place.');
    const changes = EF_SERVICES.map(s => applyService(ef, s, ownerId)).filter(Boolean) as string[];
    if ((ef as any).operationalStatus !== 'in_progress') {
      (ef as any).operationalStatus = 'in_progress';
      changes.push('operationalStatus→in_progress');
    }
    await saveWf(ef, changes);
  } else {
    const email = `${slugify(EF_NAME)}@client.hastagcreator.com`;
    console.log(`  Does not exist — would create client User (${email}) + ClientWorkflow.`);
    console.log('  Services: Website=done, UGC Videos=done, Meta Ads=blocked ("new videos to be created")');
    console.log(`  All assigned to ${OWNER_NAME}.`);
    if (APPLY) {
      let clientUser: any = await User.findOne({ organizationId: org._id, email }).select('_id').lean();
      if (!clientUser) {
        clientUser = await User.create({
          organizationId: org._id,
          email,
          name: EF_NAME,
          role: 'client',
          passwordHash: DEFAULT_PASSWORD,  // pre-save hook bcrypts it
          isActive: true,
        } as any);
        console.log('  Client User created (placeholder email/password — replace if they need portal login).');
      }
      const doc: any = {
        organizationId: org._id,
        clientId: String((clientUser as any)._id),
        clientName: EF_NAME,
        services: [],
        operationalStatus: 'in_progress',
        createdBy: String(admin._id),
        onboardedBy: String(admin._id),
        onboardedAt: new Date(),
      };
      const created = await ClientWorkflow.create(doc);
      EF_SERVICES.forEach(s => applyService(created, s, ownerId));
      created.activity.push({
        actorId: String(admin._id),
        actorName: admin.name,
        action: 'bulk_status_update',
        detail: `Created and assigned to ${OWNER_NAME}: website done, videos done, meta ads paused (new videos to be created)`,
      } as any);
      created.markModified('services');
      await created.save();
      console.log('  Created and saved.');
    }
  }
  console.log('');

  // ── 4. Owner's per-brand status tags ────────────────────────────────
  // Owner: "allow to add other tags — that need scaling to MotoCasa, going
  // smooth to Woodsify, website changes given for Neeraj Ghee, Oudfy ads
  // started only."
  //
  // These go on `tags[]` (the existing free-text tag array the Client CRM
  // already filters by), NOT on ownerFlag — ownerFlag is the fixed
  // three-way smooth/needs-attention/critical enum, and these are
  // free-text situational notes. Tags are additive: an existing tag list
  // is preserved, we only append what's missing.
  console.log('── Status tags ──');
  const TAGS: Array<{ clientName: string; tag: string }> = [
    { clientName: 'MotoCasa',    tag: 'needs scaling' },
    { clientName: 'Woodsify',    tag: 'going smooth' },
    { clientName: 'Ghee-Neeraj', tag: 'website changes given' },
    { clientName: 'Oudfy',       tag: 'ads started only' },
  ];
  for (const { clientName: cn, tag } of TAGS) {
    const doc = await ClientWorkflow.findOne({
      organizationId: org._id,
      clientName: { $regex: `^${cn}$`, $options: 'i' },
    });
    if (!doc) { console.log(`  ${cn}: NOT FOUND — skipping.`); continue; }
    const tags: string[] = ((doc as any).tags || []);
    if (tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      console.log(`  ${cn}: already tagged "${tag}".`);
      continue;
    }
    console.log(`  ${cn}: + "${tag}"`);
    if (APPLY) {
      (doc as any).tags = [...tags, tag];
      doc.activity.push({
        actorId: String(admin._id), actorName: admin.name,
        action: 'details_updated', detail: `Tag added: ${tag}`,
      } as any);
      await doc.save();
    }
  }
  console.log('');

  console.log(APPLY ? 'Done — changes written.' : 'Dry run complete — no writes. Re-run with -- --apply to commit.');
  await mongoose.disconnect();
})().catch(err => { console.error('[assign-bhawna-clients] FATAL', err); process.exit(1); });
