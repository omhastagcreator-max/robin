import cron from 'node-cron';
import LeadSource from '../models/LeadSource';
import { syncSheetForOrg } from '../controllers/leadSourceController';
import * as sheets from '../services/googleSheetsService';

/**
 * Polls every connected Google Sheet across all orgs every 5 minutes and
 * pulls in any new leads. One scheduled task — fans out per-org sequentially
 * so we don't burst Google's 300 reads/min quota even if you have 50+
 * connected agencies.
 */
export function startSheetSyncJob() {
  if (!sheets.isConfigured()) {
    console.log('[sheetSync] Google Sheets not configured — sync job idle until env vars are set.');
    return;
  }

  // Overlap guard — without this, a tick that runs longer than 5 minutes
  // (50+ orgs, slow Google API, retries) would have a SECOND cron tick start
  // while the first is still iterating. Both ticks process the same orgs in
  // parallel, both call source.save() with their own importedKeys delta, and
  // last-write-wins corrupts the dedupe set. The same lead gets re-imported
  // on the next tick. The fix is the simplest possible: a single boolean,
  // skip-and-log on overlap.
  let running = false;

  // Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    if (running) {
      console.warn('[sheetSync] previous tick still running — skipping this one to avoid double-import');
      return;
    }
    running = true;
    try {
      const sources = await LeadSource.find({ kind: 'google-sheet', enabled: true }).select('organizationId').lean();
      if (sources.length === 0) return;
      console.log(`[sheetSync] polling ${sources.length} connected sheet${sources.length === 1 ? '' : 's'}…`);
      for (const s of sources) {
        try {
          const r = await syncSheetForOrg(String(s.organizationId));
          if (r.ok && (r.createdCount || 0) > 0) {
            console.log(`[sheetSync] org ${s.organizationId}: +${r.createdCount} new leads`);
          }
        } catch (err) {
          console.error(`[sheetSync] org ${s.organizationId} failed`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error('[sheetSync] tick failed', (err as Error).message);
    } finally {
      running = false;
    }
  });

  console.log('[sheetSync] scheduled — every 5 minutes');
}
