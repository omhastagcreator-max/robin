/**
 * applyOwnerRoundAug2026.ts — one script for the whole Aug 2026 owner
 * round: Bhawna's client ownership, Early Flux creation, per-brand status
 * corrections, owner flags and status tags.
 *
 * (Supersedes the narrower assignBhawnaClientsAug2026.ts from earlier in
 * the same session — that file was never run or committed, so this is a
 * rename + expansion rather than a second competing script.)
 *
 * ── Owner's exact corrections, and how each is encoded ───────────────
 *
 *  Woodsify   "IS RUNNING HEALTHY DON'T SAY COMPLETE" → operationalStatus
 *             is forced back to 'in_progress'. The services stay done —
 *             "complete" was the ENGAGEMENT-level label that was wrong,
 *             not the per-service checklists. ownerFlag 'smooth'.
 *  Oudfy      "meta ads started, don't say waiting client" → meta_ads
 *             in_progress, and every blocked/waiting signal cleared (see
 *             the two-places note below).
 *  Early Flux videos done; meta_ads paused, reason "new set of videos for
 *             social media are to be given" (owner's exact wording).
 *  Silvque    website done, meta ads started, videos in progress.
 *             NOTE: an earlier session recorded "website we are not
 *             managing" for Silvque, so there may be no shopify line —
 *             addIfMissing covers that.
 *  MotoCasa   everything done + tag "needs scaling".
 *  Ghee-Neeraj everything done, ownerFlag 'needs_attention', tag "needs scaling".
 *  Darpan     website done; meta ads (labelled "Social Media") paused,
 *             reason "social media plan needs to be given".
 *  Sroja      everything done, ownerFlag 'needs_attention'.
 *
 * ── "Blocked" appears in two independent places ──────────────────────
 * A blocked badge can come from the workflow-level blockerType/
 * blockerReason/blockedSince (the in-app Block action) OR from a service's
 * own status:'blocked' / leftover returnedReason (the Return-service
 * action). `clearBlockers` clears BOTH, because guessing which one is
 * showing is how "still shows block" happens twice.
 *
 * ── Two Darpan docs — PRINTED, NEVER AUTO-DELETED ────────────────────
 * Owner: "also there two darpans". This script prints both with enough
 * detail to tell them apart (id, tags, clientId, service count, activity
 * count, last update) and applies the corrections to the MORE COMPLETE
 * one, but deletes nothing. Reason: an earlier session's "the doc tagged
 * dummy is fake" heuristic was later PROVEN WRONG — Oudfy's only live,
 * actively-updated doc carries the exact same dummy tag + placeholder
 * clientId signature. Deleting on that heuristic would destroy a real
 * record. Read the printout, then delete the right one by _id.
 *
 * Safety: dry-run by default. Pass --apply to write.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run apply-owner-round
 *   APPLY:    npm run apply-owner-round -- --apply
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
const BHAWNA = 'Bhawna';
const DEFAULT_PASSWORD = 'Welcome123!';

type Status = 'pending' | 'in_progress' | 'done' | 'blocked';
type Flag = '' | 'smooth' | 'needs_attention' | 'critical';

interface ServiceSpec {
  type: ServiceType;
  status?: Status;
  /** Free-text "why is this stuck" — stored on returnedReason, the only
   *  per-service reason field the schema has (same one the in-app Return
   *  Service action writes, so it renders normally on the card). */
  reason?: string;
  ownerName?: string;
  addIfMissing?: boolean;
}

interface BrandPlan {
  clientName: string;
  services?: ServiceSpec[];
  operationalStatus?: 'in_progress' | 'paused' | 'completed' | 'cancelled' | 'on_hold';
  ownerFlag?: Flag;
  tags?: string[];
  /** Reassign EVERY existing service to this person (ownership round). */
  assignAllTo?: string;
  clearBlockers?: boolean;
  note?: string;
}

const PLANS: BrandPlan[] = [
  {
    clientName: 'Woodsify',
    // Owner: "running healthy, DON'T say complete."
    operationalStatus: 'in_progress',
    ownerFlag: 'smooth',
    tags: ['going smooth'],
    clearBlockers: true,
    note: 'Running healthy — engagement is live, not complete.',
  },
  {
    clientName: 'Oudfy',
    // Owner: "meta ads started, don't say waiting client."
    services: [{ type: 'meta_ads', status: 'in_progress', addIfMissing: true }],
    operationalStatus: 'in_progress',
    tags: ['ads started only'],
    assignAllTo: BHAWNA,
    clearBlockers: true,
    note: 'Meta ads started; not waiting on client.',
  },
  {
    clientName: PURELY_FARM_ACTUAL_NAME,   // Ghee-Neeraj (= "Purely Farm")
    // Owner: "needs attention and scaling, rest everything done."
    services: [
      { type: 'shopify',    status: 'done', addIfMissing: true },
      { type: 'meta_ads',   status: 'done', addIfMissing: true },
      { type: 'influencer', status: 'done', addIfMissing: true },
    ],
    operationalStatus: 'in_progress',
    ownerFlag: 'needs_attention',
    tags: ['needs scaling', 'website changes given'],
    assignAllTo: BHAWNA,
    note: 'Everything delivered; needs attention + scaling.',
  },
  {
    clientName: 'Silvque',
    // Owner: "website done, meta ads started, videos in progress."
    // (An earlier session recorded "website we are not managing" — so the
    // shopify line may not exist yet; addIfMissing handles that.)
    services: [
      { type: 'shopify',    status: 'done',        addIfMissing: true },
      { type: 'meta_ads',   status: 'in_progress', addIfMissing: true },
      { type: 'influencer', status: 'in_progress', addIfMissing: true },
    ],
    operationalStatus: 'in_progress',
    clearBlockers: true,
  },
  {
    clientName: 'MotoCasa',
    // Owner: "everything done, needs scaling."
    services: [
      { type: 'shopify',    status: 'done', addIfMissing: true },
      { type: 'meta_ads',   status: 'done', addIfMissing: true },
      { type: 'influencer', status: 'done', addIfMissing: true },
    ],
    operationalStatus: 'in_progress',
    tags: ['needs scaling'],
    clearBlockers: true,
  },
  {
    clientName: 'Sroja',
    // Owner: "needs attention, rest everything done."
    services: [
      { type: 'shopify',    status: 'done', addIfMissing: true },
      { type: 'meta_ads',   status: 'done', addIfMissing: true },
      { type: 'influencer', status: 'done', addIfMissing: true },
    ],
    operationalStatus: 'in_progress',
    ownerFlag: 'needs_attention',
  },
];

/** Darpan is handled separately (two docs) — same shape as above. */
const DARPAN_PLAN: BrandPlan = {
  clientName: 'Darpan',
  // Owner: "website done, meta ads paused, social media plan needs to be given."
  // Darpan's meta_ads line is labelled "Social Media" (owner's earlier
  // correction: "DARPAN IS A SOCIAL MEDIA PACKAGE NOT THE META ADS").
  services: [
    { type: 'shopify',  status: 'done' },
    { type: 'meta_ads', status: 'blocked', reason: 'Paused — social media plan needs to be given' },
  ],
  operationalStatus: 'in_progress',
};

/** Early Flux — created if missing. Owner: "videos were done, meta ads
 *  paused, reason: new set of videos for social media are to be given." */
const EARLY_FLUX: BrandPlan = {
  clientName: 'Early Flux',
  services: [
    { type: 'shopify',    status: 'done',    addIfMissing: true },
    { type: 'influencer', status: 'done',    addIfMissing: true },
    { type: 'meta_ads',   status: 'blocked', addIfMissing: true,
      reason: 'Paused — new set of videos for social media are to be given' },
  ],
  operationalStatus: 'in_progress',
  assignAllTo: BHAWNA,
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function findStaffByName(orgId: any, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee', 'workroom'] },
  }).select('_id name').lean();
}

function applyService(wf: any, spec: ServiceSpec, ownerId?: string): string | null {
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

  if (ownerId && svc.assignedTo !== ownerId) { svc.assignedTo = ownerId; notes.push('owner set'); }

  if (spec.status && svc.status !== spec.status) {
    svc.status = spec.status;
    if (spec.status === 'done') {
      svc.checklist.forEach((c: any) => {
        c.done = true;
        c.doneAt = c.doneAt || new Date();
        c.doneBy = c.doneBy || svc.assignedTo;
      });
      svc.completedAt = svc.completedAt || new Date();
    } else {
      svc.completedAt = undefined;
    }
    if (!svc.startedAt) svc.startedAt = new Date();
    notes.push(`status→${spec.status}`);
  }

  // Reason only belongs on a blocked/paused service; clear it otherwise so
  // a stale "waiting on client" line can't keep rendering (the Oudfy bug).
  if (spec.reason !== undefined) {
    if (svc.returnedReason !== spec.reason) {
      svc.returnedReason = spec.reason;
      svc.returnedAt = new Date();
      notes.push(`reason→"${spec.reason}"`);
    }
  } else if (spec.status && spec.status !== 'blocked' && svc.returnedReason) {
    svc.returnedReason = undefined;
    svc.returnedAt = undefined;
    notes.push('stale reason cleared');
  }

  return notes.length ? `${svc.label || tpl.label}: ${notes.join(', ')}` : null;
}

/** Apply a whole BrandPlan to a loaded workflow doc. Returns change lines. */
function applyPlan(wf: any, plan: BrandPlan, ownerId?: string): string[] {
  const changes: string[] = [];

  if (plan.assignAllTo && ownerId) {
    for (const svc of wf.services as any[]) {
      if (svc.assignedTo !== ownerId) {
        svc.assignedTo = ownerId;
        changes.push(`${svc.label || svc.serviceType}: owner→${plan.assignAllTo}`);
      }
    }
  }

  for (const spec of plan.services || []) {
    const line = applyService(wf, spec, plan.assignAllTo ? ownerId : undefined);
    if (line) changes.push(line);
  }

  if (plan.clearBlockers) {
    if (wf.blockerType || wf.blockerReason) {
      changes.push(`workflow blocker cleared (was: ${wf.blockerType || '—'} "${wf.blockerReason || ''}")`);
      wf.blockerType = undefined;
      wf.blockerReason = undefined;
      wf.blockedSince = null;
    }
    for (const svc of wf.services as any[]) {
      // Don't unblock a service this same plan deliberately just paused.
      const deliberate = (plan.services || []).some(s => s.type === svc.serviceType && s.status === 'blocked');
      if (deliberate) continue;
      if (svc.status === 'blocked') {
        svc.status = 'in_progress';
        changes.push(`${svc.label || svc.serviceType}: blocked→in_progress`);
      }
      if (svc.returnedReason) {
        changes.push(`${svc.label || svc.serviceType}: stale reason cleared ("${svc.returnedReason}")`);
        svc.returnedReason = undefined;
        svc.returnedAt = undefined;
      }
    }
  }

  if (plan.operationalStatus && wf.operationalStatus !== plan.operationalStatus) {
    changes.push(`operationalStatus: ${wf.operationalStatus || '—'}→${plan.operationalStatus}`);
    wf.operationalStatus = plan.operationalStatus;
  }

  if (plan.ownerFlag !== undefined && wf.ownerFlag !== plan.ownerFlag) {
    changes.push(`flag: ${wf.ownerFlag || '—'}→${plan.ownerFlag || 'cleared'}`);
    wf.ownerFlag = plan.ownerFlag;
  }

  for (const tag of plan.tags || []) {
    const tags: string[] = wf.tags || [];
    if (!tags.some((t: string) => t.toLowerCase() === tag.toLowerCase())) {
      wf.tags = [...tags, tag];
      changes.push(`+ tag "${tag}"`);
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
  if (!admin) { console.error('No admin user found — aborting.'); process.exit(1); }

  const bhawna = await findStaffByName(org._id, BHAWNA);
  if (!bhawna) console.warn(`⚠️  No user matching "${BHAWNA}" — ownership changes will be skipped.\n`);
  const bhawnaId = bhawna ? String(bhawna._id) : undefined;

  const save = async (wf: any, changes: string[], label: string) => {
    if (!changes.length) { console.log('  (already correct — nothing to change)'); return; }
    changes.forEach(c => console.log(`  ${c}`));
    if (APPLY) {
      wf.activity.push({
        actorId: String(admin._id), actorName: admin.name,
        action: 'bulk_status_update',
        detail: `Owner round: ${changes.join('; ')}`,
      } as any);
      wf.markModified('services');
      await wf.save();
      console.log(`  Saved (${label}).`);
    }
  };

  // ── 1. Straightforward per-brand plans ──────────────────────────────
  for (const plan of PLANS) {
    console.log(`── ${plan.clientName} ──`);
    if (plan.note) console.log(`  (${plan.note})`);
    const wf = await ClientWorkflow.findOne({
      organizationId: org._id,
      clientName: { $regex: `^${plan.clientName}$`, $options: 'i' },
    });
    if (!wf) { console.log('  NOT FOUND — skipping.\n'); continue; }
    await save(wf, applyPlan(wf, plan, bhawnaId), plan.clientName);
    console.log('');
  }

  // ── 2. Darpan — two docs, print both, update the fuller one ─────────
  console.log('── Darpan (owner: "there are two Darpans") ──');
  const darpans = await ClientWorkflow.find({
    organizationId: org._id,
    clientName: { $regex: '^darpan$', $options: 'i' },
  });
  if (darpans.length === 0) {
    console.log('  NOT FOUND — skipping.');
  } else {
    console.log(`  Found ${darpans.length} doc(s):`);
    for (const d of darpans) {
      const last = (d.activity || []).length ? (d.activity as any[])[d.activity.length - 1] : null;
      console.log(`   • _id=${String(d._id)}`);
      console.log(`     clientId=${String((d as any).clientId)}  tags=[${((d as any).tags || []).join(', ')}]`);
      console.log(`     services=${d.services.length} (${d.services.map((s: any) => `${s.serviceType}:${s.status}`).join(', ')})`);
      console.log(`     activity=${(d.activity || []).length}  lastUpdate=${last ? `${last.action} @ ${new Date(last.at || (d as any).updatedAt).toISOString().slice(0, 10)}` : '—'}`);
    }
    if (darpans.length > 1) {
      console.log('  ⚠️  NOT deleting either — the "dummy tag = fake" heuristic was');
      console.log('      already proven wrong once (Oudfy\'s real doc has the same');
      console.log('      signature). Read the two above and delete the dead one by _id.');
    }
    // Update the most complete doc: most services, then most activity.
    const target = [...darpans].sort((a, b) =>
      (b.services.length - a.services.length) || ((b.activity || []).length - (a.activity || []).length)
    )[0];
    console.log(`  Applying corrections to _id=${String(target._id)} (most complete).`);
    await save(target, applyPlan(target, DARPAN_PLAN, undefined), 'Darpan');
  }
  console.log('');

  // ── 3. Early Flux — create if missing ───────────────────────────────
  console.log('── Early Flux ──');
  let ef = await ClientWorkflow.findOne({
    organizationId: org._id,
    clientName: { $regex: `^${EARLY_FLUX.clientName}$`, $options: 'i' },
  });
  if (ef) {
    console.log('  Already exists — updating in place.');
    await save(ef, applyPlan(ef, EARLY_FLUX, bhawnaId), 'Early Flux');
  } else {
    const email = `${slugify(EARLY_FLUX.clientName)}@client.hastagcreator.com`;
    console.log(`  Does not exist — would create client User (${email}) + ClientWorkflow.`);
    console.log('  Website=done, UGC Videos=done, Meta Ads=paused ("new set of videos for social media are to be given")');
    console.log(`  All assigned to ${BHAWNA}.`);
    if (APPLY) {
      let clientUser: any = await User.findOne({ organizationId: org._id, email }).select('_id').lean();
      if (!clientUser) {
        clientUser = await User.create({
          organizationId: org._id,
          email, name: EARLY_FLUX.clientName, role: 'client',
          passwordHash: DEFAULT_PASSWORD,  // pre-save hook bcrypts
          isActive: true,
        } as any);
        console.log('  Client User created (placeholder email/password).');
      }
      const created = await ClientWorkflow.create({
        organizationId: org._id,
        clientId: String(clientUser._id),
        clientName: EARLY_FLUX.clientName,
        services: [],
        operationalStatus: 'in_progress',
        createdBy: String(admin._id),
        onboardedBy: String(admin._id),
        onboardedAt: new Date(),
      } as any);
      const changes = applyPlan(created, EARLY_FLUX, bhawnaId);
      created.activity.push({
        actorId: String(admin._id), actorName: admin.name, action: 'created',
        detail: `Created (owner round): ${changes.join('; ')}`,
      } as any);
      created.markModified('services');
      await created.save();
      console.log('  Created and saved.');
    }
  }
  console.log('');

  console.log(APPLY ? 'Done — changes written.' : 'Dry run complete — no writes. Re-run with -- --apply to commit.');
  await mongoose.disconnect();
})().catch(err => { console.error('[apply-owner-round] FATAL', err); process.exit(1); });
