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

  // Build lookup of EXISTING leads in this org by phone/email so we never
  // re-create what's already there (handles cases where rows came in via
  // manual entry too).
  const existing = await Lead.find({ organizationId: orgId }).select('contact email').lean();
  const seenPhones = new Set(existing.map(l => norm((l as any).contact)).filter(Boolean));
  const seenEmails = new Set(existing.map(l => norm((l as any).email)).filter(Boolean));

  // importedKeys is a per-source dedupe in case a row in the sheet has
  // neither phone nor email yet (shouldn't happen often, but safe).
  const importedKeys = new Set(source.importedKeys || []);

  const map = source.columnMap || ({} as any);
  const toInsert: any[] = [];
  let skipped = 0;

  for (const r of rows) {
    const name    = (r[(map.name    || 'name').toLowerCase()]    || '').trim();
    const phone   = (r[(map.phone   || 'phone').toLowerCase()]   || '').trim();
    const email   = (r[(map.email   || 'email').toLowerCase()]   || '').trim();
    const company = (r[(map.company || 'company').toLowerCase()] || '').trim();
    const source2 = (r[(map.source  || 'source').toLowerCase()]  || 'sheet').trim().toLowerCase().slice(0, 30) || 'sheet';
    const notes   = (r[(map.notes   || 'notes').toLowerCase()]   || '').trim();

    if (!name && !phone && !email) { skipped++; continue; }
    if (!name) { skipped++; continue; }

    const ph = norm(phone);
    const em = norm(email);
    const key = `${ph}|${em}|${name.toLowerCase()}`;
    if ((ph && seenPhones.has(ph)) || (em && seenEmails.has(em)) || importedKeys.has(key)) {
      skipped++; continue;
    }
    if (ph) seenPhones.add(ph);
    if (em) seenEmails.add(em);
    importedKeys.add(key);

    toInsert.push({
      organizationId: orgId,
      assignedTo:     options.actorUserId,
      name, contact: phone || undefined, email: email || undefined,
      company: company || undefined,
      source:  source2,
      notes:   notes   || undefined,
      stage:   'new_lead',
      status:  'new_lead',
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

/** POST /api/integrations/sheet/sync — trigger an immediate poll */
export async function syncNow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await syncSheetForOrg(orgId, { actorUserId: req.user!.id });
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
