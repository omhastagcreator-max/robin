/**
 * importCrmSheets.ts — wipe-and-replace import of the four employee
 * CRM sheets (Beant Kaur / Bhawna / Priyanka / Om's master) into
 * Robin's central collections.
 *
 * June 2026 rewrite: the agency owner wanted ALL previously imported
 * data nuked and replaced with the fresh sheets. So this run:
 *
 *   1. Deletes every ProjectTask whose importedFrom starts with
 *      'crm-sheets-'.
 *   2. Deletes every ClientWorkflow whose importedFrom starts with
 *      'crm-sheets-'.
 *   3. Deletes every placeholder client User whose importedFrom
 *      starts with 'crm-sheets-' AND email ends @imported.robin.local.
 *      (Real internal staff Users are untouched — they never have
 *      importedFrom set.)
 *   4. Imports the JSON pre-pass (server/src/scripts/crm-seed-data.json)
 *      producing:
 *      - One placeholder client User per brand
 *      - One ClientWorkflow per brand, with services derived from the
 *        task text + a `recurringMeeting` block if a meeting_day was set
 *      - One ProjectTask per "task" line (existing work)
 *      - One ProjectTask per "next_task" line (queued work) — these
 *        get status='pending' and dueDate set to the brand's ETA.
 *
 * Everything new is stamped importedFrom='crm-sheets-jun-2026'
 * so the NEXT wipe-and-replace can find this batch.
 *
 * How to run:
 *
 *     cd server
 *     npm run import-crm                 (uses MONGO_URI from .env)
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load env from the server root (one dir up from src/scripts).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';
import User from '../models/User';
import Organization from '../models/Organization';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

const IMPORT_TAG    = 'crm-sheets-jun-2026';
const IMPORT_PREFIX = 'crm-sheets-';

// ── Types matching the JSON pre-pass ────────────────────────────────
interface SeedRow {
  brand:         string;
  display_brand: string;
  owners:        string[];
  pocs:          string[];
  tasks:         string[];
  next_tasks:    string[];
  eta?:          string | null;
  meeting_day?:  string;
  sources:       string[];
}

// ── Service catalog — every brand gets all three stages ─────────────
// Owner ask (June 2026): "for all projects we have 3 stages: website,
// videos, and meta". So we always materialise all three regardless of
// what the sheet text mentioned. Uniform ownership too — see
// reassignByRole.ts and STAGE_OWNERS below.
const STANDARD_SERVICES: Array<'shopify' | 'influencer' | 'meta_ads'> = ['shopify', 'influencer', 'meta_ads'];
const STAGE_OWNERS: Record<string, string> = {
  shopify:    'Om',         // Website
  influencer: 'Priyanka',   // Videos
  meta_ads:   'Sakshi',     // Meta
};

// Kept for future heuristic surfaces — but the import now always
// uses STANDARD_SERVICES, so this is currently unused.
function inferServices(_allText: string): string[] {
  return [...STANDARD_SERVICES];
}

function priorityFromEta(eta: string | null | undefined): 'urgent' | 'high' | 'medium' | 'low' {
  if (!eta) return 'medium';
  const t = new Date(eta).getTime();
  if (Number.isNaN(t)) return 'medium';
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days <= 3)  return 'urgent';
  if (days <= 7)  return 'high';
  if (days <= 14) return 'medium';
  return 'low';
}

function parseMeetingDay(raw: string | undefined | null): { dayOfWeek: number; timeIST: string; label: string } | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'na' || s === 'n/a' || s === '-') return null;
  const dayMap: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thrus: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  let dow = -1;
  for (const k of Object.keys(dayMap)) {
    if (s.includes(k)) { dow = dayMap[k]; break; }
  }
  if (dow < 0) return null;
  let timeIST = '11:00';
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tm) {
    let hh = parseInt(tm[1], 10);
    const mm = parseInt(tm[2] || '0', 10);
    const ap = (tm[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh < 24) timeIST = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return { dayOfWeek: dow, timeIST, label: raw.trim() };
}

async function findUserByName(orgId: any, name: string): Promise<any | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Skip placeholder labels that aren't real users.
  if (/^(client|clinet|tbd|unassigned|n\/?a)$/i.test(trimmed)) return null;
  const exact = await User.findOne({
    organizationId: orgId,
    name: { $regex: `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }).select('_id name email');
  if (exact) return exact;
  const first = trimmed.split(/\s+/)[0];
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
  }).select('_id name email');
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const seedPath = path.resolve(__dirname, 'crm-seed-data.json');
  if (!fs.existsSync(seedPath)) {
    console.error('crm-seed-data.json not found at', seedPath);
    process.exit(1);
  }
  const rows: SeedRow[] = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  console.log(`Loaded ${rows.length} brand rows from seed.`);

  const orgIdRaw = process.env.ROBIN_ORG_ID
    || (await Organization.findOne().sort({ createdAt: 1 }).select('_id').lean())?._id;
  if (!orgIdRaw) { console.error('No Organization in DB — create one first.'); process.exit(1); }
  const orgId = orgIdRaw as any;
  console.log(`Importing into org ${String(orgId)}.`);

  // ── 1. WIPE prior import batch ────────────────────────────────────
  // Match anything starting with 'crm-sheets-' so previous runs (May,
  // June, etc.) all get cleared, not just the current tag.
  const prefixRegex = new RegExp(`^${IMPORT_PREFIX}`);
  const wipeTasks = await ProjectTask.deleteMany({ importedFrom: { $regex: prefixRegex } });
  const wipeWorkflows = await ClientWorkflow.deleteMany({ importedFrom: { $regex: prefixRegex } });
  // Also wipe prior workflows that pre-dated the importedFrom field —
  // identified by their synthetic client email pattern.
  const stragglers = await ClientWorkflow.deleteMany({
    organizationId: orgId,
    clientEmail: '',
    importedFrom: { $in: [null, ''] },
    createdAt: { $lt: new Date('2026-06-08') },     // before this commit landed
  });
  const wipeUsers = await User.deleteMany({
    organizationId: orgId,
    importedFrom: { $regex: prefixRegex },
  });
  // Stragglers — placeholder client users with the synthetic email
  // pattern that pre-dated the importedFrom field.
  const userStragglers = await User.deleteMany({
    organizationId: orgId,
    role: 'client',
    email: { $regex: /@imported\.robin\.local$/ },
  });
  console.log(`Wiped:  tasks=${wipeTasks.deletedCount}  workflows=${wipeWorkflows.deletedCount} (+${stragglers.deletedCount} stragglers)  users=${wipeUsers.deletedCount} (+${userStragglers.deletedCount} stragglers)`);

  // ── 2. Pick the createdBy fallback ────────────────────────────────
  const sales = await User.findOne({ organizationId: orgId, role: { $in: ['admin', 'sales'] } }).select('_id');
  if (!sales) {
    console.error('No admin/sales user in org — cannot set createdBy. Add one and retry.');
    process.exit(1);
  }

  // ── 3. Import each brand ──────────────────────────────────────────
  let createdBrands = 0, createdTasks = 0, skippedOwners = 0;
  for (const row of rows) {
    const brand = row.display_brand.trim();
    if (!brand) continue;

    // 3a. Placeholder client User.
    const clientEmail = `${row.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@imported.robin.local`;
    let client = await User.findOne({ organizationId: orgId, email: clientEmail });
    if (!client) {
      client = await User.create({
        organizationId: orgId,
        name:           brand,
        email:          clientEmail,
        role:           'client',
        passwordHash:   'imported-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
        importedFrom:   IMPORT_TAG,
      } as any);
    }

    // 3b. Resolve the three fixed owners — Om, Priyanka, Sakshi —
    // once per brand. The sheet's "owners" column is now only used to
    // help match tasks; the SERVICE assignees are always the three
    // canonical specialists per the agency owner's uniform rules.
    const stageOwnerIds: Record<string, string | undefined> = {};
    for (const stage of STANDARD_SERVICES) {
      const ownerName = STAGE_OWNERS[stage];
      const u = await findUserByName(orgId, ownerName);
      stageOwnerIds[stage] = u?._id?.toString();
      if (!u) {
        console.warn(`  ${brand}: ${ownerName} (stage ${stage}) not found in Robin users`);
        skippedOwners++;
      }
    }

    // 3c. Always create all three services per brand, with the
    // canonical owner attached and the default SOP checklist seeded
    // from workflowTemplates.ts so the Stage Workspace page never
    // shows "No checklist configured for this stage yet".
    const serviceDocs = STANDARD_SERVICES.map(type => {
      const tpl = SERVICE_TEMPLATES[type as ServiceType];
      const checklist = (tpl?.checklist || []).map(text => ({ text, done: false }));
      return {
        serviceType: type,
        label:       tpl?.label
                    || (type === 'shopify' ? 'Development' : type === 'meta_ads' ? 'Meta Ads' : 'Video'),
        status:      'in_progress',
        checklist,
        assignedTo:  stageOwnerIds[type],
        eta:         row.eta ? new Date(row.eta) : undefined,
      };
    });

    const priority = priorityFromEta(row.eta);
    const rm = parseMeetingDay(row.meeting_day);
    const pocLabel = row.pocs.length > 0 ? row.pocs.join(', ') : '';
    const lastDetail = [
      row.tasks.length > 0 && `Active: ${row.tasks[0]}`,
      row.next_tasks.length > 0 && `Next: ${row.next_tasks[0]}`,
      pocLabel && `POC: ${pocLabel}`,
      row.meeting_day && `Meeting: ${row.meeting_day}`,
    ].filter(Boolean).join(' · ');

    // 3d. Create the workflow.
    const wf = await ClientWorkflow.create({
      organizationId: orgId,
      clientId:       String(client._id),
      clientName:     brand,
      clientEmail:    '',
      clientPhone:    '',
      services:       serviceDocs,
      priority:       priority,
      eta:            row.eta && !Number.isNaN(new Date(row.eta).getTime()) ? new Date(row.eta) : null,
      nextAction:     row.next_tasks[0] || row.tasks[0] || '',
      createdBy:      String(sales._id),
      lastUpdate:     { at: new Date(), detail: lastDetail, actorId: String(sales._id) },
      activity: [{
        actorId: String(sales._id),
        action:  'created',
        detail:  `Imported from CRM sheets · priority ${priority}${lastDetail ? ' · ' + lastDetail : ''}`,
      }],
      ...(rm ? { recurringMeeting: {
        dayOfWeek: rm.dayOfWeek, timeIST: rm.timeIST, label: rm.label, lastMaterialisedFor: null,
      } } : {}),
      importedFrom: IMPORT_TAG,
    } as any);
    createdBrands++;

    // 3e. Create ProjectTasks. Per the uniform rules, each task's
    // assignee is derived from its text:
    //   web/site/dev keywords      → Om
    //   video/reel/script keywords → Priyanka
    //   ads/meta/campaign keywords → Sakshi
    // Falls back to Om (website is the default catch-all stage).
    const dueDate = row.eta && !Number.isNaN(new Date(row.eta).getTime()) ? new Date(row.eta) : undefined;
    const inferStage = (text: string): 'shopify' | 'influencer' | 'meta_ads' => {
      const t = (text || '').toLowerCase();
      if (/meta|fb\s*ad|ads?|campaign|pixel|catalog/.test(t)) return 'meta_ads';
      if (/video|creative|reel|shoot|edit|influencer|creator|ugc|script/.test(t)) return 'influencer';
      return 'shopify';
    };
    for (const taskText of row.tasks) {
      if (!taskText.trim()) continue;
      const stage = inferStage(taskText);
      const assignee = stageOwnerIds[stage] || String(sales._id);
      await ProjectTask.create({
        organizationId: orgId,
        clientWorkflowId: wf._id,
        assignedTo: assignee,
        assignedBy: String(sales._id),
        requesterId: String(sales._id),
        title: taskText.slice(0, 200),
        description: pocLabel ? `Brand: ${brand} · POC: ${pocLabel}` : `Brand: ${brand}`,
        priority,
        status: 'ongoing',
        dueDate,
        startDate: new Date(),
        importedFrom: IMPORT_TAG,
      } as any);
      createdTasks++;
    }
    for (const nextText of row.next_tasks) {
      if (!nextText.trim()) continue;
      const stage = inferStage(nextText);
      const assignee = stageOwnerIds[stage] || String(sales._id);
      await ProjectTask.create({
        organizationId: orgId,
        clientWorkflowId: wf._id,
        assignedTo: assignee,
        assignedBy: String(sales._id),
        requesterId: String(sales._id),
        title: nextText.slice(0, 200),
        description: `[Next] Brand: ${brand}` + (pocLabel ? ` · POC: ${pocLabel}` : ''),
        priority,
        status: 'pending',
        dueDate,
        importedFrom: IMPORT_TAG,
      } as any);
      createdTasks++;
    }

    const ownerSummary = STANDARD_SERVICES.map(s => `${s}=${stageOwnerIds[s] ? STAGE_OWNERS[s] : '(none)'}`).join(' ');
    console.log(`  + ${brand}  priority=${priority}  tasks=${row.tasks.length}/+${row.next_tasks.length}next  ${ownerSummary}`);
  }

  console.log(`\nDone. Created ${createdBrands} brands + ${createdTasks} tasks. Unresolved owner refs: ${skippedOwners}.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
