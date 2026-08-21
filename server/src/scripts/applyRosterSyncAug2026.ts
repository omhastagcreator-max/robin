/**
 * applyRosterSyncAug2026.ts — one-shot script applying the owner's
 * client-by-client roster review (Aug 2026, done live in chat, one
 * client at a time): per-service ownership, current status, Darpan's
 * duplicate cleanup + relabel, a stray test client removed, and a
 * backfilled Lead per real client so the Sales Dashboard reflects them
 * too (owner ask: "create them in sales dashboard as well").
 *
 * Matches by clientName (case-insensitive) rather than hardcoded _ids —
 * the ids weren't available to hardcode this round, and name-matching is
 * safe here since there's exactly one live doc per brand except Darpan,
 * which is special-cased below.
 *
 * ── Darpan duplicate — RESOLVED this round ──────────────────────────
 * Two live ClientWorkflow docs existed. Owner was asked which is real
 * and said "no preference" — so the call made here (not a guess dressed
 * up as fact, an explicit choice): keep the doc WITHOUT the "dummy" tag
 * / placeholder clientId (more complete — shopify + influencer both
 * done, only meta_ads still in progress), delete the other. This is the
 * opposite direction of caution from earlier sessions' "never delete
 * without a human decision" — that decision now exists, from the owner,
 * in this session.
 *
 * Darpan is also relabeled per owner correction: "DARPAN IS A SOCIAL
 * MEDIA PACKAGE NOT THE META ADS" — the meta_ads service keeps its
 * serviceType (drives checklist/dependency logic) but its `label`
 * becomes "Social Media". The influencer service is relabeled "Video
 * Scripting" and reassigned to Amit per the owner's answer.
 *
 * Safety: dry-run by default — prints exactly what would change, writes
 * nothing. Pass --apply to commit.
 *
 * Usage (from server/):
 *   DRY RUN:  npm run apply-roster-sync
 *   APPLY:    npm run apply-roster-sync -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Organization from '../models/Organization';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import Lead from '../models/Lead';
import ClientPerformanceEntry from '../models/ClientPerformanceEntry';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

const APPLY = process.argv.includes('--apply');

async function findUserByName(orgId: any, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${escaped}`, $options: 'i' },
    role: { $in: ['admin', 'sales', 'employee', 'workroom'] },
  }).select('_id name').lean();
}

type Status = 'pending' | 'in_progress' | 'done' | 'blocked';

interface ServiceUpdate {
  type: ServiceType;
  ownerName?: string;
  /** Only set when the owner told us this service's status explicitly —
   *  omit to leave the existing status/checklist alone. */
  status?: Status;
  /** Relabel the service line (Darpan's "Social Media" / "Video
   *  Scripting" correction) — omit to keep the template default label. */
  label?: string;
  /** Add this service line if the client doesn't already have it. */
  addIfMissing?: boolean;
  /** For status 'in_progress' only — how many checklist items (from the
   *  top) to mark done, so "in progress" actually shows visible progress
   *  instead of a freshly-added, all-unticked checklist. Ignored for
   *  'done' (which always ticks everything) and other statuses. */
  tickedCount?: number;
}

interface ClientPlan {
  clientName: string;
  services: ServiceUpdate[];
  operationalStatus?: 'in_progress' | 'completed' | 'paused' | 'on_hold' | 'cancelled';
  /** Clear any existing blocker (client said work resumed / no longer stuck). */
  clearBlocker?: boolean;
  weeklyStatus?: string;
}

/** ISO week key (YYYY-Www) for "today", matching ClientPerformanceEntry's
 *  week-granularity convention. */
function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

const PLANS: ClientPlan[] = [
  {
    clientName: 'Oudfy',
    services: [
      { type: 'shopify', ownerName: 'Om' },
      { type: 'meta_ads', ownerName: 'Bhawna', status: 'in_progress' }, // "campaign started"
      { type: 'influencer', ownerName: 'Om' },
    ],
    operationalStatus: 'in_progress',
    clearBlocker: true,
  },
  {
    clientName: 'Polmouni',
    // Owner: website only — do NOT add meta_ads/influencer lines.
    services: [{ type: 'shopify', ownerName: 'Om', status: 'done' }],
    operationalStatus: 'completed',
  },
  {
    clientName: 'dufft',
    services: [
      // Website stays as-is (still "awaiting client" per owner — the
      // existing blocked/paused state on product photos is unchanged).
      { type: 'shopify', ownerName: 'Om' },
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'in_progress' },
      { type: 'influencer', ownerName: 'Priyanka', status: 'in_progress' },
    ],
    operationalStatus: 'in_progress',
  },
  {
    clientName: 'Woodsify',
    // Owner: website + social media only (influencer not mentioned —
    // left untouched, not part of this update).
    services: [
      { type: 'shopify', ownerName: 'Sakshi', status: 'done' },
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'done' },
    ],
    operationalStatus: 'completed',
    weeklyStatus: 'Steady',
  },
  {
    clientName: 'Bombay',
    // Owner: social media + video only (website not mentioned this
    // round — left untouched).
    services: [
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'done' },
      { type: 'influencer', ownerName: 'Sakshi', status: 'done' },
    ],
    operationalStatus: 'completed',
    weeklyStatus: 'Lead-gen campaign — running (not a direct-sales metric for this brand).',
  },
  {
    clientName: 'ArdoWellness',
    services: [
      { type: 'shopify', ownerName: 'Om' },
      // Owner: "ads running" — the payment-gateway block from the
      // earlier session is resolved; unblocking here.
      { type: 'meta_ads', ownerName: 'Bhawna', status: 'in_progress' },
      { type: 'influencer', ownerName: 'Priyanka' },
    ],
    operationalStatus: 'in_progress',
    clearBlocker: true,
  },
  {
    clientName: 'MotoCasa',
    services: [
      { type: 'shopify', ownerName: 'Sakshi', status: 'done' },
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'done' },
      { type: 'influencer', ownerName: 'Sakshi', status: 'done' },
    ],
    operationalStatus: 'completed',
    weeklyStatus: 'Strong / ramping up.',
  },
  {
    clientName: 'HeightAyura',
    services: [
      { type: 'shopify', ownerName: 'Sakshi' },
      // New line — previously "not started" / didn't exist. Owner
      // confirmed the ads are actually running now, not just started —
      // ticking the first 2 checklist items (account setup + campaigns
      // live) so the board reflects that instead of an empty checklist.
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'in_progress', addIfMissing: true, tickedCount: 2 },
      { type: 'influencer', ownerName: 'Sakshi', status: 'in_progress', addIfMissing: true },
    ],
    operationalStatus: 'in_progress',
  },
  {
    clientName: 'Ghee-Neeraj',
    services: [
      { type: 'shopify', ownerName: 'Bhawna' },
      { type: 'meta_ads', ownerName: 'Bhawna', status: 'in_progress' },
      { type: 'influencer', ownerName: 'Bhawna' },
    ],
    operationalStatus: 'in_progress',
  },
  {
    clientName: 'Sroja',
    // Owner: social media + video only this round (website not
    // mentioned — left untouched). Split ownership given as "Shakshi
    // and Om" — Shakshi on ads, Om on video, best read of the answer.
    services: [
      { type: 'meta_ads', ownerName: 'Shakshi', status: 'done' },
      { type: 'influencer', ownerName: 'Om', status: 'done' },
    ],
    operationalStatus: 'completed',
    weeklyStatus: 'Slow / needs attention.',
  },
  {
    clientName: 'Silvque',
    services: [
      { type: 'meta_ads', ownerName: 'Sakshi', status: 'in_progress' },
      { type: 'influencer', ownerName: 'Sakshi', status: 'in_progress' },
    ],
    operationalStatus: 'in_progress',
  },
];

/** Applies one ServiceUpdate to a workflow doc in memory. Returns a
 *  human-readable change line, or null if nothing to do (service doesn't
 *  exist and addIfMissing wasn't set). */
function applyServiceUpdate(wf: any, u: ServiceUpdate, ownerIdByName: Map<string, string>): string | null {
  const tpl = SERVICE_TEMPLATES[u.type];
  let svc = (wf.services as any[]).find(s => s.serviceType === u.type);
  const notes: string[] = [];

  if (!svc) {
    if (!u.addIfMissing) return null; // not requested to add — skip silently
    svc = { serviceType: u.type, label: u.label || tpl.label, assignedTo: undefined, checklist: tpl.checklist.map(text => ({ text, done: false })) };
    (wf.services as any[]).push(svc);
    notes.push('added');
  }

  if (u.label && svc.label !== u.label) { svc.label = u.label; notes.push(`label→"${u.label}"`); }

  if (u.ownerName) {
    const id = ownerIdByName.get(u.ownerName.toLowerCase());
    if (id && svc.assignedTo !== id) { svc.assignedTo = id; notes.push(`owner→${u.ownerName}`); }
    else if (!id) notes.push(`⚠️ owner "${u.ownerName}" not found — left unassigned`);
  }

  if (u.status && svc.status !== u.status) {
    svc.status = u.status;
    if (u.status === 'done') {
      svc.checklist.forEach((c: any) => { c.done = true; c.doneAt = c.doneAt || new Date(); c.doneBy = c.doneBy || svc.assignedTo; });
      svc.completedAt = svc.completedAt || new Date();
    } else {
      if (u.status === 'in_progress' && u.tickedCount) {
        svc.checklist.forEach((c: any, i: number) => {
          const done = i < u.tickedCount!;
          c.done = done;
          c.doneAt = done ? (c.doneAt || new Date()) : undefined;
          c.doneBy = done ? (c.doneBy || svc.assignedTo) : undefined;
        });
      }
      svc.completedAt = undefined;
    }
    if (u.status !== 'blocked') { svc.returnedReason = undefined; svc.returnedAt = undefined; }
    if (!svc.startedAt) svc.startedAt = new Date();
    notes.push(`status→${u.status}`);
  }

  return notes.length ? `${tpl.label}: ${notes.join(', ')}` : null;
}

(async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);

  const org = await Organization.findOne().sort({ createdAt: 1 }).select('_id name').lean();
  if (!org) { console.error('No Organization found.'); process.exit(1); }

  const admin = await User.findOne({ organizationId: org._id, role: 'admin' })
    .sort({ createdAt: 1 }).select('_id name').lean();
  if (!admin) { console.error('No admin user found — needed for activity log actor. Aborting.'); process.exit(1); }

  const NAMES = ['Om', 'Sakshi', 'Priyanka', 'Bhawna', 'Amit', 'Shakshi'];
  const ownerIdByName = new Map<string, string>();
  for (const n of NAMES) {
    const u = await findUserByName(org._id, n);
    if (u) ownerIdByName.set(n.toLowerCase(), String(u._id));
  }
  // "Shakshi" and "Sakshi" are two different real people on this team
  // (confirmed live on /admin/employees — both exist) — resolved
  // independently above, NOT aliased to each other.
  console.log('Resolved owners:', Object.fromEntries(ownerIdByName));
  console.log('');

  // ── 1. Darpan duplicate cleanup + relabel ───────────────────────────
  console.log('── Darpan (duplicate resolution) ──');
  const darpanDocs = await ClientWorkflow.find({ organizationId: org._id, clientName: { $regex: '^darpan$', $options: 'i' } });
  const darpanFake = darpanDocs.find(d => (d as any).clientId === 'dummy:darpan' || (d.tags || []).includes('dummy'));
  const darpanReal = darpanDocs.find(d => d !== darpanFake) || darpanDocs[0];
  if (!darpanReal) {
    console.log('  NOT FOUND — skipping.\n');
  } else {
    if (darpanFake && darpanFake !== darpanReal) {
      console.log(`  Would DELETE duplicate doc ${String(darpanFake._id)} (tagged dummy / placeholder clientId).`);
      if (APPLY) await ClientWorkflow.deleteOne({ _id: darpanFake._id });
    }
    const changes = [
      applyServiceUpdate(darpanReal, { type: 'shopify', ownerName: 'Om' }, ownerIdByName),
      applyServiceUpdate(darpanReal, { type: 'meta_ads', ownerName: 'Om', status: 'in_progress', label: 'Social Media' }, ownerIdByName),
      applyServiceUpdate(darpanReal, { type: 'influencer', ownerName: 'Amit', status: 'in_progress', label: 'Video Scripting' }, ownerIdByName),
    ].filter(Boolean) as string[];
    changes.forEach(c => console.log(`  ${c}`));
    (darpanReal as any).operationalStatus = 'in_progress';
    (darpanReal as any).blockerType = undefined;
    (darpanReal as any).blockerReason = undefined;
    console.log('  operationalStatus → in_progress, blocker cleared.');
    if (APPLY) {
      darpanReal.activity.push({ actorId: String(admin._id), actorName: admin.name, action: 'bulk_status_update', detail: `Roster sync: ${changes.join('; ')}` } as any);
      darpanReal.markModified('services');
      await darpanReal.save();
      console.log('  Saved.');
    }
  }
  console.log('');

  // ── 2. Remaining clients ────────────────────────────────────────────
  for (const plan of PLANS) {
    console.log(`── ${plan.clientName} ──`);
    const wf = await ClientWorkflow.findOne({ organizationId: org._id, clientName: { $regex: `^${plan.clientName}$`, $options: 'i' } });
    if (!wf) { console.log('  NOT FOUND — skipping.\n'); continue; }

    const changes = plan.services
      .map(u => applyServiceUpdate(wf, u, ownerIdByName))
      .filter(Boolean) as string[];
    changes.forEach(c => console.log(`  ${c}`));

    if (plan.operationalStatus && (wf as any).operationalStatus !== plan.operationalStatus) {
      (wf as any).operationalStatus = plan.operationalStatus;
      console.log(`  operationalStatus → ${plan.operationalStatus}`);
    }
    if (plan.clearBlocker && (wf as any).blockerType) {
      (wf as any).blockerType = undefined;
      (wf as any).blockerReason = undefined;
      console.log('  blocker cleared.');
    }

    if (APPLY && (changes.length || plan.operationalStatus || plan.clearBlocker)) {
      wf.activity.push({ actorId: String(admin._id), actorName: admin.name, action: 'bulk_status_update', detail: `Roster sync: ${changes.join('; ') || plan.operationalStatus}` } as any);
      wf.markModified('services');
      await wf.save();
      console.log('  Saved.');
    }

    if (plan.weeklyStatus) {
      const periodKey = isoWeekKey();
      console.log(`  Weekly performance note (week ${periodKey}): "${plan.weeklyStatus}"`);
      if (APPLY) {
        const now = new Date();
        await ClientPerformanceEntry.findOneAndUpdate(
          { clientWorkflowId: wf._id, periodType: 'week', periodKey },
          { $set: {
            organizationId: org._id, clientWorkflowId: wf._id,
            periodType: 'week', periodKey,
            periodStart: now, periodEnd: now,
            notes: plan.weeklyStatus,
            enteredBy: String(admin._id),
          } },
          { upsert: true, setDefaultsOnInsert: true },
        );
        console.log('  Weekly entry saved.');
      }
    }

    // ── Backfill a matching Lead so the Sales Dashboard shows this
    // client too (owner ask: "create them in sales dashboard as well").
    const existingLead = await Lead.findOne({ organizationId: org._id, name: { $regex: `^${plan.clientName}$`, $options: 'i' } }).select('_id').lean();
    if (existingLead) {
      console.log('  Sales Dashboard lead already exists — skipping.');
    } else {
      console.log('  Would create a "won" Lead in the Sales Dashboard, linked to this client.');
      if (APPLY) {
        const primaryOwnerName = plan.services.find(s => s.ownerName)?.ownerName;
        const assignedTo = primaryOwnerName ? ownerIdByName.get(primaryOwnerName.toLowerCase()) : undefined;
        await Lead.create({
          organizationId: org._id,
          name: wf.clientName,
          company: wf.clientName,
          email: (wf as any).clientEmail,
          contact: (wf as any).clientPhone,
          source: 'organic',
          stage: 'won',
          status: 'won',
          assignedTo,
          convertedToClientId: (wf as any).clientId || null,
          closedAt: new Date(),
          notes: [{ content: 'Backfilled from Client CRM — Aug 2026 roster sync (already an active/onboarded client).', authorId: String(admin._id) }],
          stageHistory: [{ stage: 'won', movedAt: new Date(), movedBy: admin.name, note: 'Backfilled — already an active client' }],
        });
        console.log('  Lead created.');
      }
    }
    console.log('');
  }

  // ── 3. Remove the "RISHI" test/placeholder client entry ────────────
  console.log('── RISHI (test data — removing) ──');
  const rishi = await ClientWorkflow.findOne({ organizationId: org._id, clientName: { $regex: '^rishi$', $options: 'i' } });
  if (!rishi) {
    console.log('  Not found — already gone.\n');
  } else {
    console.log(`  Would delete ClientWorkflow ${String(rishi._id)} ("RISHI" — Pipeline created with: Shopify Store, Meta Ads; nothing started; confirmed test data by owner).`);
    if (APPLY) {
      await ClientWorkflow.deleteOne({ _id: rishi._id });
      console.log('  Deleted.');
    }
  }

  if (!APPLY) console.log('\nDRY RUN ONLY — nothing was written. Re-run with -- --apply to commit.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('applyRosterSyncAug2026 failed:', err);
  process.exit(1);
});
