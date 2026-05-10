import { google } from 'googleapis';

/**
 * Google Sheets read-only service.
 *
 * Auth model: ONE service account for the whole Robin instance. Each
 * customer org shares THEIR sheet with the service account email
 * (Viewer access is enough), then pastes the sheet ID into Robin.
 *
 * Env vars required (set on Render):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. robin-sync@robin-prod.iam.gserviceaccount.com
 *   GOOGLE_SERVICE_ACCOUNT_KEY     — the private key from the JSON, with literal \n preserved
 *
 * Google Sheets API free quota: 300 reads/min/user — far more than we'll
 * ever hit polling every 5 min for a few hundred orgs. Lifetime free.
 */

let cached: ReturnType<typeof google.sheets> | null = null;

function getClient() {
  if (cached) return cached;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // The private key in env vars usually has \n escaped. Normalise.
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Google Sheets not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY on the server.');
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  cached = google.sheets({ version: 'v4', auth });
  return cached;
}

export function isConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

export function serviceAccountEmail(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
}

export interface SheetRow { [column: string]: string }

/**
 * Fetch all data rows from a sheet. Treats the FIRST row as headers and
 * returns an array of objects keyed by header (lowercased + trimmed).
 *
 * Returns at most `limit` rows (default 1000) to protect against runaway
 * sheets. If you have a sheet with 5000 leads, raise the cap server-side
 * — but most agencies are well under.
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  sheetName = 'Sheet1',
  limit = 1000,
): Promise<SheetRow[]> {
  const sheets = getClient();
  const range = `${sheetName}!A1:Z${limit + 1}`; // header + N data rows, up to col Z
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];
  if (values.length < 2) return [];  // no data rows

  const headers = values[0].map((h: any) => String(h || '').trim().toLowerCase());
  const rows: SheetRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || r.length === 0) continue;
    const obj: SheetRow = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? '').trim();
    });
    rows.push(obj);
  }
  return rows;
}
