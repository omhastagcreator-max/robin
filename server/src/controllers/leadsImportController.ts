import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Lead from '../models/Lead';

/**
 * Bulk lead import.
 *
 * Accepts an array of {name, phone?, email?, company?, source?, value?}
 * objects parsed by the client (from a CSV file OR a sheet paste). Server
 * validates each row, dedupes against existing leads in this org by
 * phone+email, and creates the new ones in the "new_lead" stage.
 *
 * Returns:
 *   created  — count of new leads added
 *   skipped  — array of rows that didn't pass validation OR were duplicates
 *
 * Why server-side dedupe: client-side filtering can miss leads created in
 * parallel by another teammate, and we want to be authoritative about what
 * actually got imported. The user sees a clean count.
 */

const MAX_ROWS = 1000;  // Hard cap per import — anything bigger should be a real Sheets API integration.

interface ImportRow {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  source?: string;
  value?: number | string;
  notes?: string;
}

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();

export async function importLeads(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'rows[] required' });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(400).json({ error: `Too many rows (max ${MAX_ROWS} per import). Split into multiple uploads.` });
      return;
    }

    // Pull existing leads in this org so we can dedupe by phone OR email.
    // For an agency-sized DB (thousands of leads tops) this is fine in-memory.
    const existing = await Lead.find({ organizationId: orgId })
      .select('contact email')
      .lean();
    const seenPhones = new Set(existing.map(l => norm((l as any).contact)).filter(Boolean));
    const seenEmails = new Set(existing.map(l => norm((l as any).email)).filter(Boolean));

    const created: any[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const toInsert: any[] = [];

    rows.forEach((raw: ImportRow, i: number) => {
      const name    = (raw.name    || '').toString().trim();
      const phone   = (raw.phone   || '').toString().trim();
      const email   = (raw.email   || '').toString().trim();
      const company = (raw.company || '').toString().trim();
      const source  = (raw.source  || 'imported').toString().trim().toLowerCase().slice(0, 30);
      const notes   = (raw.notes   || '').toString().trim();
      const value   = Number(raw.value) || 0;

      if (!name && !phone && !email) {
        skipped.push({ index: i, reason: 'empty row' });
        return;
      }
      if (!name) {
        skipped.push({ index: i, reason: 'missing name' });
        return;
      }

      const ph = norm(phone);
      const em = norm(email);
      if ((ph && seenPhones.has(ph)) || (em && seenEmails.has(em))) {
        skipped.push({ index: i, reason: 'duplicate (phone or email already in your CRM)' });
        return;
      }

      // Reserve so a duplicated row WITHIN the import is also caught.
      if (ph) seenPhones.add(ph);
      if (em) seenEmails.add(em);

      toInsert.push({
        organizationId: orgId,
        assignedTo:     req.user!.id,
        name,
        contact:        phone || undefined,
        email:          email || undefined,
        company:        company || undefined,
        source,
        notes:          notes  || undefined,
        estimatedValue: value,
        stage:          'new_lead',
        status:         'new_lead',
      });
    });

    if (toInsert.length > 0) {
      const inserted = await Lead.insertMany(toInsert, { ordered: false });
      created.push(...inserted);
    }

    res.json({
      ok: true,
      createdCount: created.length,
      skippedCount: skipped.length,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
