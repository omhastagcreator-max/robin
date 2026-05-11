import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import LeadSource from '../models/LeadSource';
import Lead from '../models/Lead';
import User from '../models/User';
import * as sheets from '../services/googleSheetsService';

/**
 * Lead-source integration controller. Today: Google Sheets only.
 *
 * Flow per agency:
 *   1. Admin POSTs spreadsheetId + sheetName to /api/integrations/sheet
 *   2. Server immediately attempts a sync to validate the sheet is reachable
 *      (this is also what surfaces "share with the service account" errors).
 *   3. If valid, save the LeadSource doc.
 *   4. Cron job runs every 5 min for ALL connected orgs and pulls new rows.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();

/**
 * Header aliases — common variants we auto-recognise so users connecting
 * Meta Lead Ads sheets (via Zapier / Meta's "Download Leads" CSV / native
 * leads-to-Sheets sync) don't have to rename a single column.
 *
 * Order matters: the FIRST alias that exists in the row wins. If the admin
 * has set an explicit columnMap for the source, that always trumps these.
 *
 * All keys are lowercased to match how fetchSheetRows normalises headers.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  // NB: fetchSheetRows lowercases + trims headers, so 'NAME' → 'name',
  // 'E MAIL ID' → 'e mail id', etc. Listed lowercased here.
  name:    ['name', 'full_name', 'fullname', 'full name', 'lead_name', 'first_name'],
  phone:   ['phone', 'phone_number', 'phonenumber', 'phone number', 'mobile', 'mobile_number', 'contact', 'contact_number', 'whatsapp'],
  email:   ['email', 'email_address', 'emailaddress', 'email address', 'e-mail', 'e mail', 'e mail id', 'email id', 'mail', 'mail id'],
  company: ['company', 'company_name', 'organization', 'business', 'business_name', 'website', 'websitr'], // 'websitr' = common typo we've seen in real sheets
  source:  ['source', 'campaign_name', 'campaign', 'ad_name', 'platform', 'utm_source'],
  notes:   ['notes', 'note', 'message', 'comments', 'remarks', 'enquiry', 'inquiry', 'city'],
};

/**
 * Meta wraps phone numbers with a `p:` prefix and lead IDs with `l:` —
 * artefacts of how Lead Center serialises ID-typed fields. We strip them
 * before saving so phone numbers display cleanly and dedupe works.
 */
const stripMetaPrefix = (s: string, prefix: string): string =>
  s.startsWith(prefix) ? s.slice(prefix.length).trim() : s;

// Alias for the SheetRow type so pickField stays typed without re-importing.
type SheetRow = sheets.SheetRow;

/**
 * Pick the first non-empty value for a Robin field from a row, honouring an
 * explicit override first and then falling back to the alias list.
 */
function pickField(row: SheetRow, field: keyof typeof HEADER_ALIASES, override?: string): string {
  if (override) {
    const v = row[override.toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  for (const alias of HEADER_ALIASES[field]) {
    const v = row[alias];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Core sync function — pulls rows from the sheet, dedupes against existing
 * leads (by phone OR email) AND against importedKeys on the source doc,
 * inserts new ones, returns a summary.
 *
 * Pure function: no req/res. Used by both the manual /sync-now endpoint
 * and the cron job below.
 */
export async function syncSheetForOrg(orgId: string, options: { actorUserId?: string } = {}) {
  const source = await LeadSource.findOne({ organizationId: orgId, kind: 'google-sheet', enabled: true });
  if (!source) return { ok: false, reason: 'no-source' };
  if (!source.spreadsheetId) return { ok: false, reason: 'no-spreadsheet' };

  let rows: sheets.SheetRow[];
  try {
    rows = await sheets.fetchSheetRows(source.spreadsheetId, source.sheetName || 'Sheet1');
  } catch (err: any) {
    source.lastError = (err.message || 'Unknown sheet error').slice(0, 500);
    source.lastSyncedAt = new Date();
    await source.save();
    return { ok: false, reason: 'fetch-failed', error: source.lastError };
  }

  // Build lookup of EXISTING leads in this org by phone/email/externalId so
  // we never re-create what's already there (handles rows that also came in
  // via manual entry, AND Meta lead_ids we've already imported on a previous
  // tick).
  const existing = await Lead.find({ organizationId: orgId }).select('contact email externalId').lean();
  const seenPhones    = new Set(existing.map(l => norm((l as any).contact)).filter(Boolean));
  const seenEmails    = new Set(existing.map(l => norm((l as any).email)).filter(Boolean));
  const seenExternal  = new Set(existing.map(l => (l as any).externalId).filter(Boolean));

  // importedKeys is a per-source dedupe in case a row in the sheet has
  // neither phone nor email nor lead_id yet (shouldn't happen often).
  const importedKeys = new Set(source.importedKeys || []);

  const map = source.columnMap || ({} as any);
  const toInsert: any[] = [];
  let skipped = 0;

  for (const r of rows) {
    // Each pickField call honours admin override first, then tries the
    // alias list (handles Meta's full_name / phone_number / etc).
    let name    = pickField(r, 'name',    map.name);
    let phone     = pickField(r, 'phone',   map.phone);
    const email   = pickField(r, 'email',   map.email);
    const company = pickField(r, 'company', map.company);
    let source2   = (pickField(r, 'source',  map.source) || 'sheet').toLowerCase().slice(0, 30);
    const notes   = pickField(r, 'notes',   map.notes);

    // Meta serialises phones as "p:+91…" — strip the prefix so the saved
    // value is the actual E.164 number.
    phone = stripMetaPrefix(phone, 'p:');

    // Meta sometimes splits names into first_name + last_name. If we only
    // got first_name above, glue last_name onto it so the lead has a
    // sensible display name.
    if (name && r['last_name'] && !/\s/.test(name)) {
      name = `${name} ${r['last_name']}`.trim();
    }

    // Meta's stable lead identifier — `id` or `lead_id` column. Best dedupe
    // key because the user could fix a typo in phone/email later. Stored
    // with the `l:` prefix stripped so the value is just the numeric ID.
    const rawExt = (r['lead_id'] || r['id'] || r['leadgen_id'] || '').trim();
    const externalId = stripMetaPrefix(rawExt, 'l:') || undefined;

    // The strict Lead.source enum can't hold a campaign name. Save the raw
    // campaign as sourceLabel for display, and bucket the enum field as
    // 'social' for Meta-style rows (campaign_name/ad_name present),
    // otherwise 'inbound' for sheet-only rows.
    const sourceLabel = source2; // pre-bucket value (campaign_name etc.)
    const isMeta = !!(r['campaign_name'] || r['ad_name'] || r['adset_name'] || r['form_id'] || r['platform']);
    const sourceEnum = isMeta ? 'social' : 'inbound';

    if (!name && !phone && !email) { skipped++; continue; }
    if (!name) { skipped++; continue; }

    const ph  = norm(phone);
    const em  = norm(email);
    const key = `${externalId || ''}|${ph}|${em}|${name.toLowerCase()}`;
    if (
      (externalId && seenExternal.has(externalId)) ||
      (ph && seenPhones.has(ph)) ||
      (em && seenEmails.has(em)) ||
      importedKeys.has(key)
    ) {
      skipped++; continue;
    }
    if (externalId) seenExternal.add(externalId);
    if (ph) seenPhones.add(ph);
    if (em) seenEmails.add(em);
    importedKeys.add(key);

    toInsert.push({
      organizationId: orgId,
      assignedTo:     options.actorUserId,
      name, contact: phone || undefined, email: email || undefined,
      company: company || undefined,
      source:  sourceEnum,
      sourceLabel,
      notes:   notes   || undefined,
      stage:   'new_lead',
      status:  'new_lead',
      externalId,
      rawData: r,                     // keep the WHOLE original row
      importedFrom: isMeta ? 'meta-leadgen' : 'google-sheet',
    });
  }

  let createdCount = 0;
  if (toInsert.length > 0) {
    const ins = await Lead.insertMany(toInsert, { ordered: false });
    createdCount = ins.length;
  }

  // Persist sync state. importedKeys is bounded — keep last 5000.
  source.lastError = '';
  source.lastSyncedAt = new Date();
  source.totalImported = (source.totalImported || 0) + createdCount;
  source.importedKeys = Array.from(importedKeys).slice(-5000);
  await source.save();

  return { ok: true, createdCount, skippedCount: skipped, totalRows: rows.length };
}

// ── HTTP endpoints ───────────────────────────────────────────────────────

/** GET /api/integrations/sheet — returns current connection or { connected: false } */
export async function getSheetSource(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const src = await LeadSource.findOne({ organizationId: orgId, kind: 'google-sheet' }).lean();
    res.json({
      connected: !!src,
      configured: sheets.isConfigured(),
      serviceAccountEmail: sheets.serviceAccountEmail(),
      source: src ? {
        spreadsheetId: src.spreadsheetId,
        sheetName: src.sheetName,
        enabled: src.enabled,
        lastSyncedAt: src.lastSyncedAt,
        lastError: src.lastError,
        totalImported: src.totalImported,
      } : null,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** POST /api/integrations/sheet { spreadsheetId, sheetName? } */
export async function connectSheet(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    if (!sheets.isConfigured()) {
      res.status(503).json({ error: 'Google Sheets is not configured on the server. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY env vars.' });
      return;
    }

    const { spreadsheetId, sheetName } = req.body || {};
    if (!spreadsheetId) { res.status(400).json({ error: 'spreadsheetId required' }); return; }

    // Validate access by attempting a fetch.
    try {
      await sheets.fetchSheetRows(spreadsheetId, sheetName || 'Sheet1', 1);
    } catch (e: any) {
      const msg = e.message || '';
      const friendly = msg.includes('does not have permission') || msg.includes('not have access')
        ? `Robin can't read this sheet. Open the sheet → Share → invite ${sheets.serviceAccountEmail()} as Viewer.`
        : msg.includes('Unable to parse range')
          ? `Sheet name "${sheetName || 'Sheet1'}" not found. Check the tab name (case-sensitive).`
          : msg;
      res.status(400).json({ error: friendly });
      return;
    }

    // Upsert
    const updated = await LeadSource.findOneAndUpdate(
      { organizationId: orgId, kind: 'google-sheet' },
      {
        $set: {
          spreadsheetId,
          sheetName: sheetName || 'Sheet1',
          enabled: true,
          lastError: '',
          createdBy: req.user!.id,
        },
      },
      { upsert: true, new: true },
    );

    // Run an immediate sync so the user sees results right away.
    const syncResult = await syncSheetForOrg(orgId, { actorUserId: req.user!.id });
    res.json({ ok: true, source: updated, sync: syncResult });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** DELETE /api/integrations/sheet */
export async function disconnectSheet(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    await LeadSource.findOneAndDelete({ organizationId: orgId, kind: 'google-sheet' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/integrations/sheet/preview — live read of the sheet, returned
 * EXACTLY as it appears (headers untouched, no field-mapping). Used by the
 * Sales dashboard "Live from your sheet" section so the team can see the
 * raw Meta Lead Ads feed in real time.
 *
 * Returns:
 *   {
 *     headers: ["created_time", "full_name", "phone_number", "campaign_name", ...],
 *     rows:    [{ created_time: "...", full_name: "...", ... }, ...],
 *     total:   123,
 *     fetchedAt: ISO,
 *     spreadsheetId, sheetName,
 *   }
 *
 * No DB writes — this is a pass-through view, not a sync.
 */
export async function previewSheet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const src = await LeadSource.findOne({ organizationId: orgId, kind: 'google-sheet' }).lean();
    if (!src || !src.spreadsheetId) { res.status(404).json({ error: 'No sheet connected' }); return; }
    if (!sheets.isConfigured()) { res.status(503).json({ error: 'Google Sheets not configured on the server.' }); return; }

    const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 2000);
    const rows = await sheets.fetchSheetRows(src.spreadsheetId, src.sheetName || 'Sheet1', limit);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Annotate each row with the Robin Lead it created (if any), so the UI
    // can show the current stage + assignee without a second round trip.
    const externalIds = rows.map(r => r['lead_id'] || r['id'] || r['leadgen_id']).filter(Boolean);
    const linkedLeads = externalIds.length
      ? await Lead.find({ organizationId: orgId, externalId: { $in: externalIds } })
          .select('externalId stage assignedTo _id').lean()
      : [];
    const leadByExt = new Map(linkedLeads.map(l => [(l as any).externalId, l]));

    const annotated = rows.map(r => {
      const ext = r['lead_id'] || r['id'] || r['leadgen_id'];
      const linked = ext ? leadByExt.get(ext) : null;
      return {
        ...r,
        _robin: linked ? { leadId: String((linked as any)._id), stage: (linked as any).stage, assignedTo: (linked as any).assignedTo } : null,
      };
    });

    res.json({
      headers,
      rows: annotated,
      total: rows.length,
      fetchedAt: new Date().toISOString(),
      spreadsheetId: src.spreadsheetId,
      sheetName: src.sheetName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${src.spreadsheetId}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Preview failed' });
  }
}

/** POST /api/integrations/sheet/sync — trigger an immediate poll */
export async function syncNow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await syncSheetForOrg(orgId, { actorUserId: req.user!.id });
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
