/**
 * importCrmSheets.ts — one-shot import of the four employee CRM sheets
 * (Beant Kaur / Bhawna / Priyanka / Om's master) into Robin's central
 * ClientWorkflow collection.
 *
 * Workflow (May 2026):
 *
 *   1. Each employee was tracking brands in their own Excel sheet.
 *      Cross-team visibility = zero. Owner ask: bring them all into
 *      one source of truth so every dashboard reflects every brand.
 *
 *   2. The four .xlsx files were parsed offline by a Python pre-pass
 *      (see server/src/scripts/crm-seed-data.json) — that pass
 *      handles the messy cell formats, alias normalisation (BOMBAY
 *      NAIL ART → BOMBAY NAIL COMPANY, ARDOVELLNESS → ARDOWELLNESS,
 *      Beant → Beant Kaur, Shakshi → Sakshi etc.), and dedup.
 *
 *   3. THIS script reads that JSON and lands the data in Mongo.
 *      Idempotent: re-running upserts by clientName instead of
 *      creating duplicates.
 *
 *   4. Priority is auto-derived from ETA proximity:
 *        - ETA in next 3 days  → 'urgent'
 *        - ETA in next 7 days  → 'high'
 *        - ETA in next 14 days → 'medium'
 *        - else                → 'low'
 *
 *   5. Owners → services. We map task text + owner role to one of
 *      the three service types (shopify / influencer / meta_ads).
 *      Each owner becomes the assignee of one service.
 *
 *   6. Anything not directly inferred (POC contact, "next target"
 *      sentence, meeting day) gets stuffed into the workflow's
 *      lastUpdate field so the dashboards surface it in the
 *      "latest update" line.
 *
 *   How to run:
 *
 *       cd server
 *       npm run import-crm                 (uses MONGO_URI from .env)
 *
 *   The script logs every brand it touched (created / updated / skipped)
 *   and exits non-zero if MONGO_URI is missing.
 *
 *   Honest deferred items: per-stage activity timeline reconstruction,
 *   auto-scheduled meeting events, and a daily-brief AI cron remain
 *   out of scope for this first import — they'll land as separate
 *   passes.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load env from the server root (one dir up from src/scripts).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';
import Organization from '../models/Organization';

// ── Types matching the JSON pre-pass ────────────────────────────────
interface SeedRow {
  brand:         string;
  display_brand: string;
  poc?:          string;
  task?:         string;
  next_target?:  string;
  eta?:          string | null;
  started?:      string | null;
  meeting_day?:  string;
  owners:        string[];
}

// ── Heuristic: task text → service type ─────────────────────────────
// Maps free-text task descriptions to one of the three service types
// the rest of Robin already understands (shopify / influencer /
// meta_ads). Falls back to influencer because "video / creative" is
// the agency's most common service.
function inferServices(text: string): string[] {
  const t = (text || '').toLowerCase();
  const out: string[] = [];
  if (/website|web|landing\s*page|\blp\b|shopify|payment|gateway|cart/i.test(t)) out.push('shopify');
  if (/video|creative|reel|shoot|edit|influencer|creator|ugc|script/i.test(t))    out.push('influencer');
  if (/meta|fb\s*ad|ads?|campaign|pixel|whatsapp|audit/i.test(t))                  out.push('meta_ads');
  if (out.length === 0) out.push('influencer');
  return out;
}

// ── Heuristic: ETA proximity → priority ─────────────────────────────
function priorityFromEta(eta: string | null | undefined): 'urgent' | 'high' | 'medium' | 'low' {
  if (!eta) return 'medium';
  const days = Math.round((new Date(eta).getTime() - Date.now()) / 86_400_000);
  if (days <= 3)  return 'urgent';
  if (days <= 7)  return 'high';
  if (days <= 14) return 'medium';
  return 'low';
}

// ── Heuristic: free-text meeting-day string → recurringMeeting ───────
// CRM cells say things like "Wednesday", "Thrus", "Tuesday 11am" or
// "NA". We map to {dayOfWeek 0-6, timeIST "HH:MM"}. Anything we don't
// recognise returns null (no cadence — cron leaves brand alone).
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
  // Try to extract a time like "11am" / "11:30" / "2pm".
  let timeIST = '11:00';
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tm) {
    let hh = parseInt(tm[1], 10);
    const mm = parseInt(tm[2] || '0', 10);
    const ap = (tm[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh < 24) {
      timeIST = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  return { dayOfWeek: dow, timeIST, label: raw.trim() };
}

// ── User lookup with fuzzy name matching ────────────────────────────
// Owners in the JSON are first-names or "First Last". We try exact
// case-insensitive match first, then prefix match on the first name.
async function findUserByName(orgId: any, name: string): Promise<any | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = await User.findOne({
    organizationId: orgId,
    name: { $regex: `^${trimmed}$`, $options: 'i' },
  }).select('_id name email');
  if (exact) return exact;
  const first = trimmed.split(/\s+/)[0];
  return User.findOne({
    organizationId: orgId,
    name: { $regex: `^${first}`, $options: 'i' },
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

  // Pick the first (= oldest) org as the agency. Robin has one org per
  // agency; this lets the script run without taking the org id as an
  // arg. Override by passing ROBIN_ORG_ID in the env if needed.
  const orgIdRaw = process.env.ROBIN_ORG_ID
    || (await Organization.findOne().sort({ createdAt: 1 }).select('_id').lean())?._id;
  if (!orgIdRaw) { console.error('No Organization in DB — create one first.'); process.exit(1); }
  const orgId = orgIdRaw as any;
  console.log(`Importing into org ${String(orgId)}.`);

  // Find or create the "Sales" placeholder createdBy if we can't
  // attribute to a real user.
  const sales = await User.findOne({ organizationId: orgId, role: { $in: ['admin', 'sales'] } }).select('_id');
  if (!sales) {
    console.error('No admin/sales user in org — cannot set createdBy. Add one and retry.');
    process.exit(1);
  }

  let created = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    const brand = row.display_brand.trim();
    if (!brand) { skipped++; continue; }

    // 1. Find/create the client User (role='client'). We use the
    //    brand name as the client name + a stable synthetic email so
    //    re-runs don't duplicate.
    const clientEmail = `${row.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@imported.robin.local`;
    let client = await User.findOne({ organizationId: orgId, email: clientEmail });
    if (!client) {
      client = await User.create({
        organizationId: orgId,
        name:           brand,
        email:          clientEmail,
        role:           'client',
        // Required field on the User schema. The pre-save hook bcrypts any
        // non-bcrypt string, so passing a random throwaway is fine —
        // imported client placeholders aren't meant to log in.
        passwordHash:   'imported-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      } as any);
    }

    // 2. Resolve owners → User docs.
    const ownerUsers = (await Promise.all(row.owners.map(o => findUserByName(orgId, o))))
      .filter(Boolean) as Array<{ _id: any; name: string }>;
    if (ownerUsers.length === 0) {
      // No matching staff yet — the brand still lands; the assignee
      // remains empty so admin can resolve later from the UI.
      console.warn(`  ${brand}: no matching staff for owners ${row.owners.join(', ')} — leaving unassigned`);
    }

    // 3. Build services. We map task → service types, then round-
    //    robin the owners across the inferred services.
    const services = inferServices(row.task || row.next_target || '');
    const serviceDocs = services.map((type, i) => ({
      serviceType: type,
      label:       type === 'shopify' ? 'Development'
                  : type === 'meta_ads' ? 'Meta Ads' : 'Video',
      status:      'in_progress',
      checklist:   [],
      assignedTo:  ownerUsers[i % Math.max(1, ownerUsers.length)]?._id?.toString(),
      eta:         row.eta ? new Date(row.eta) : undefined,
    }));

    // 4. Upsert ClientWorkflow keyed on (org, clientId).
    let wf = await ClientWorkflow.findOne({ organizationId: orgId, clientId: String(client._id) });
    const priority = priorityFromEta(row.eta);
    const lastDetail = [
      row.task && `Task: ${row.task}`,
      row.next_target && `Next: ${row.next_target}`,
      row.poc && `POC: ${row.poc}`,
      row.meeting_day && `Meeting: ${row.meeting_day}`,
    ].filter(Boolean).join(' · ');

    // Parse recurring-meeting cadence once — shared by create & update paths.
    const rm = parseMeetingDay(row.meeting_day);

    if (wf) {
      // Refresh fields without wiping existing checklist progress.
      wf.priority    = priority as any;
      wf.eta         = row.eta ? new Date(row.eta) : (wf.eta || null);
      (wf as any).nextAction = row.next_target || row.task || (wf as any).nextAction;
      if (rm) {
        (wf as any).recurringMeeting = {
          dayOfWeek: rm.dayOfWeek,
          timeIST:   rm.timeIST,
          label:     rm.label,
          // Reset materialisation so the cron picks it up on next tick.
          lastMaterialisedFor: null,
        };
      }
      (wf as any).lastUpdate = {
        at: new Date(), detail: lastDetail || (wf as any).lastUpdate?.detail || '',
        actorId: String(sales._id),
      };
      // Service merge — add any missing types instead of overwriting.
      for (const svc of serviceDocs) {
        if (!wf.services.some(s => s.serviceType === svc.serviceType)) {
          wf.services.push(svc as any);
        }
      }
      await wf.save();
      updated++;
      console.log(`  ↻ ${brand}  priority=${priority}  owners=${ownerUsers.map(u=>u.name).join(',') || '(none)'}`);
    } else {
      wf = await ClientWorkflow.create({
        organizationId: orgId,
        clientId:       String(client._id),
        clientName:     brand,
        clientEmail:    '',
        clientPhone:    '',
        services:       serviceDocs,
        priority:       priority,
        eta:            row.eta ? new Date(row.eta) : null,
        nextAction:     row.next_target || row.task || '',
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
      } as any);
      created++;
      console.log(`  + ${brand}  priority=${priority}  owners=${ownerUsers.map(u=>u.name).join(',') || '(none)'}`);
    }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped} total=${rows.length}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
